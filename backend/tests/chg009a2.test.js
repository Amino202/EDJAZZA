const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpush = require('web-push');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edjazza-chg009a2-')), 'test.sqlite');
const keys = webpush.generateVAPIDKeys();
process.env.DB_PATH = dbPath;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;

const serverModule = require('../server.js');
const { app, db, registerSubscription, replaceScheduledPushes, processScheduledPushes } = serverModule;

function request(listener, { method = 'GET', path: requestPath, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const address = listener.address();
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path: requestPath,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: responseBody }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('AC1: forwarded employee IPs have separate rate-limit buckets', async t => {
  const listener = app.listen(0);
  t.after(() => listener.close());
  for (let i = 0; i < 100; i += 1) {
    const response = await request(listener, {
      path: '/api/health',
      headers: { origin: 'https://edjazza11.netlify.app', 'x-forwarded-for': '203.0.113.10' }
    });
    assert.equal(response.status, 200);
  }
  const blocked = await request(listener, {
    path: '/api/health',
    headers: { origin: 'https://edjazza11.netlify.app', 'x-forwarded-for': '203.0.113.10' }
  });
  const otherEmployee = await request(listener, {
    path: '/api/health',
    headers: { origin: 'https://edjazza11.netlify.app', 'x-forwarded-for': '203.0.113.20' }
  });
  assert.equal(blocked.status, 429);
  assert.equal(otherEmployee.status, 200);
  console.log(`AC1 PASS ${JSON.stringify({ firstIpAfter100: blocked.status, secondIp: otherEmployee.status })}`);
});

test('AC2: spoofed left values cannot bypass the trusted final proxy address', async t => {
  const listener = app.listen(0);
  t.after(() => listener.close());
  for (let i = 0; i < 100; i += 1) {
    const response = await request(listener, {
      path: '/api/health',
      headers: {
        origin: 'https://edjazza11.netlify.app',
        'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.30`
      }
    });
    assert.equal(response.status, 200);
  }
  const blocked = await request(listener, {
    path: '/api/health',
    headers: {
      origin: 'https://edjazza11.netlify.app',
      'x-forwarded-for': '198.51.100.250, 203.0.113.30'
    }
  });
  assert.equal(blocked.status, 429);
  console.log(`AC2 PASS ${JSON.stringify({ fixedProxyIpAfter100: blocked.status })}`);
});

test('AC4: internal error logging excludes endpoint while preserving client generic response', async t => {
  const listener = app.listen(0);
  t.after(() => listener.close());
  const subscriptionId = registerSubscription({
    endpoint: 'https://push.example/registered',
    keys: { auth: 'auth', p256dh: 'p256dh' }
  });
  const originalSend = webpush.sendNotification;
  const originalError = console.error;
  const logs = [];
  webpush.sendNotification = async () => {
    const error = new Error('temporary push failure');
    error.name = 'PushFailure';
    error.code = 'E_PUSH';
    error.statusCode = 503;
    error.endpoint = 'https://push.example/secret';
    throw error;
  };
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const response = await request(listener, {
      method: 'POST',
      path: '/api/send-notification',
      headers: { origin: 'https://edjazza11.netlify.app' },
      body: { subscriptionId, title: 'test', body: 'test' }
    });
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body), { error: 'حدث خطأ داخلي.' });
    const output = logs.join('\n');
    assert.match(output, /temporary push failure/);
    assert.match(output, /E_PUSH/);
    assert.doesNotMatch(output, /https:\/\/push\.example\/secret/);
    console.log(`AC4 PASS ${JSON.stringify({ status: response.status, hasMessage: true, hasCode: true, leaksEndpoint: false })}`);
  } finally {
    console.error = originalError;
    webpush.sendNotification = originalSend;
  }
});

test('AC5: scheduler failure log contains row metadata but no endpoint or payload', async () => {
  const endpoint = 'https://push.example/scheduler';
  const subscriptionId = registerSubscription({ endpoint, keys: { auth: 'auth', p256dh: 'p256dh' } });
  const now = 2_000_000_000_000;
  replaceScheduledPushes(endpoint, [{
    vacationId: 'vac-log', kind: 'before_start', title: 'private title', body: 'private body', sendAt: now - 1000
  }], now - 2000);
  const row = db.prepare("SELECT id FROM scheduled_pushes WHERE vacation_id = 'vac-log'").get();
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const error = Object.assign(new Error('temporary scheduler failure'), { statusCode: 503, endpoint });
    await processScheduledPushes({ now, sendPush: async () => { throw error; } });
    const output = logs.join('\n');
    assert.match(output, new RegExp(`id=${row.id}`));
    assert.match(output, /kind=before_start/);
    assert.match(output, /attempt=1/);
    assert.doesNotMatch(output, /https:\/\/push\.example\/scheduler/);
    assert.doesNotMatch(output, /private title|private body/);
    console.log(`AC5 PASS ${JSON.stringify({ hasId: true, hasKind: true, hasAttempt: true, leaksEndpoint: false, leaksPayload: false })}`);
  } finally {
    console.error = originalError;
  }
  assert.equal(subscriptionId.length > 0, true);
});

test.after(() => {
  db.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});
