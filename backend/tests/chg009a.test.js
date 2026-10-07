const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpush = require('web-push');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edjazza-chg009a-')), 'test.sqlite');
const keys = webpush.generateVAPIDKeys();
process.env.DB_PATH = dbPath;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;

const serverModule = require('../server.js');
const { app, db, registerSubscription, replaceScheduledPushes, processScheduledPushes } = serverModule;

const now = 2_000_000_000_000;
const endpoint = 'https://push.example.test/subscription-1';
const subscription = {
  endpoint,
  keys: { auth: 'auth-1', p256dh: 'p256dh-1' }
};

function count(sql, ...params) {
  return db.prepare(sql).get(...params).count;
}

function request(appServer, { method = 'GET', path: requestPath, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const address = appServer.address();
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path: requestPath,
      headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers }
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

test('AC1: same endpoint is upserted and keeps one id', async t => {
  const listener = app.listen(0);
  t.after(() => listener.close());
  const responses = [];
  for (const auth of ['auth-1', 'auth-2', 'auth-3']) {
    responses.push(await request(listener, {
      method: 'POST',
      path: '/api/subscribe',
      headers: { origin: 'https://edjazza11.netlify.app' },
      body: { endpoint, keys: { auth, p256dh: `p256dh-${auth}` } }
    }));
  }
  const ids = responses.map(response => JSON.parse(response.body).id);
  assert.deepEqual(responses.map(response => response.status), [201, 201, 201]);
  assert.equal(ids[0], ids[1]);
  assert.equal(ids[1], ids[2]);
  assert.equal(count('SELECT COUNT(*) AS count FROM subscriptions WHERE endpoint = ?', endpoint), 1);
  assert.deepEqual(db.prepare('SELECT auth, p256dh FROM subscriptions WHERE endpoint = ?').get(endpoint), {
    auth: 'auth-3', p256dh: 'p256dh-auth-3'
  });
  console.log(`AC1 PASS ${JSON.stringify({ idsEqual: true, rows: 1 })}`);
});

test('AC2: replacing a schedule leaves only the second list', () => {
  const first = replaceScheduledPushes(endpoint, [
    { vacationId: 'vac-1', kind: 'before_start', title: 'A', body: 'A body', sendAt: now + 1000 }
  ], now);
  const second = replaceScheduledPushes(endpoint, [
    { vacationId: 'vac-2', kind: 'before_end', title: 'B', body: 'B body', sendAt: now + 2000 }
  ], now);
  const rows = db.prepare('SELECT vacation_id, status FROM scheduled_pushes ORDER BY vacation_id').all();
  assert.deepEqual(first, { scheduled: 1, skipped: 0 });
  assert.deepEqual(second, { scheduled: 1, skipped: 0 });
  assert.deepEqual(rows, [{ vacation_id: 'vac-2', status: 'scheduled' }]);
  console.log(`AC2 PASS ${JSON.stringify({ first, second, rows })}`);
});

test('AC3: due reminder is sent once and second cycle does not resend', async () => {
  replaceScheduledPushes(endpoint, [
    { vacationId: 'vac-3', kind: 'on_end', title: 'Due', body: 'Due body', sendAt: now - 1000 }
  ], now - 2000);
  const payloads = [];
  const fakeSend = async (sub, payload) => { payloads.push({ sub, payload: JSON.parse(payload) }); };
  const first = await processScheduledPushes({ now, sendPush: fakeSend });
  const second = await processScheduledPushes({ now: now + 1000, sendPush: fakeSend });
  const row = db.prepare("SELECT status, sent_at FROM scheduled_pushes WHERE vacation_id = 'vac-3'").get();
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].payload, {
    title: 'Due', body: 'Due body', tag: 'vacation-vac-3-on_end', data: { vacationId: 'vac-3', kind: 'on_end' }
  });
  assert.equal(row.status, 'sent');
  assert.equal(row.sent_at, now);
  console.log(`AC3 PASS ${JSON.stringify({ first, second, sends: payloads.length, status: row.status })}`);
});

test('AC4: reminder older than 24 hours expires without sending', async () => {
  replaceScheduledPushes(endpoint, [
    { vacationId: 'vac-4', kind: 'before_end', title: 'Old', body: 'Old body', sendAt: now - (24 * 60 * 60 * 1000 + 1) }
  ], now - (24 * 60 * 60 * 1000 + 2));
  let sends = 0;
  const result = await processScheduledPushes({ now, sendPush: async () => { sends += 1; } });
  const row = db.prepare("SELECT status FROM scheduled_pushes WHERE vacation_id = 'vac-4'").get();
  assert.equal(result.expired, 1);
  assert.equal(sends, 0);
  assert.equal(row.status, 'expired');
  console.log(`AC4 PASS ${JSON.stringify({ result, sends, status: row.status })}`);
});

test('AC5: 410 removes subscription and all its scheduled pushes', async () => {
  replaceScheduledPushes(endpoint, [
    { vacationId: 'vac-5', kind: 'before_start', title: 'Gone', body: 'Gone body', sendAt: now - 1000 }
  ], now - 2000);
  const error = Object.assign(new Error('gone'), { statusCode: 410 });
  await processScheduledPushes({ now, sendPush: async () => { throw error; } });
  assert.equal(count('SELECT COUNT(*) AS count FROM subscriptions WHERE endpoint = ?', endpoint), 0);
  assert.equal(count('SELECT COUNT(*) AS count FROM scheduled_pushes'), 0);
  console.log(`AC5 PASS ${JSON.stringify({ subscriptions: 0, scheduledPushes: 0 })}`);
});

test('CHG-003 regression: 403, 413, 429 and generic validation response remain enforced', async t => {
  const listener = app.listen(0);
  t.after(() => listener.close());
  const baseHeaders = { origin: 'https://edjazza11.netlify.app' };
  const forbidden = await request(listener, { path: '/api/health', headers: { origin: 'https://evil.example' } });
  assert.equal(forbidden.status, 403);
  const tooLarge = await request(listener, {
    method: 'PUT', path: '/api/schedule', headers: baseHeaders,
    body: { endpoint, reminders: [{ vacationId: 'v', kind: 'k', title: 't', body: 'x'.repeat(110000), sendAt: now + 1000 }] }
  });
  assert.equal(tooLarge.status, 413);
  const invalid = await request(listener, { method: 'PUT', path: '/api/schedule', headers: baseHeaders, body: { endpoint: 'https://push.example.test/validation', reminders: [{ vacationId: 'v', kind: 'k', title: 't', body: 'b', sendAt: 'bad' }] } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body, /البيانات غير صالحة/);
  let last;
  for (let i = 0; i < 101; i += 1) last = await request(listener, { path: '/api/health', headers: baseHeaders });
  assert.equal(last.status, 429);
  assert.match(last.body, /دقيقة/);
  console.log(`CHG-003 PASS ${JSON.stringify({ forbidden: forbidden.status, tooLarge: tooLarge.status, invalid: invalid.status, rateLimited: last.status })}`);
});

test.after(() => {
  db.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});
