const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const Database = require('better-sqlite3');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// ============ إعدادات VAPID ============
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ============ Middleware ============
const ALLOWED_ORIGIN = 'https://edjazza11.netlify.app';
const REQUEST_BODY_LIMIT = '100kb';
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 100;
const rateLimitStore = new Map();

function applicationRateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const current = rateLimitStore.get(ip);

  if (!current || now >= current.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    const minutesRemaining = Math.max(1, Math.ceil((current.resetAt - now) / 60000));
    return res.status(429).json({
      error: `تم تجاوز حد الطلبات. أعد المحاولة بعد ${minutesRemaining} دقيقة.`
    });
  }

  current.count += 1;
  return next();
}

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && origin !== ALLOWED_ORIGIN) {
    return res.status(403).json({ error: 'الأصل غير مسموح.' });
  }
  return next();
});
app.use(applicationRateLimit);
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));

// ============ قاعدة البيانات SQLite ============
const DB_PATH = process.env.DB_PATH || 'subscriptions.db';
const db = new Database(DB_PATH);

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      auth TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // احتفظ بأحدث صف فقط لكل endpoint قبل إنشاء الفهرس الفريد.
  db.exec(`
    DELETE FROM subscriptions
    WHERE rowid NOT IN (
      SELECT rowid FROM (
        SELECT rowid,
               ROW_NUMBER() OVER (
                 PARTITION BY endpoint
                 ORDER BY datetime(created_at) DESC, rowid DESC
               ) AS row_number
        FROM subscriptions
      )
      WHERE row_number = 1
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_endpoint_unique ON subscriptions(endpoint)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_pushes (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      vacation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data TEXT NOT NULL,
      send_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('scheduled', 'sent', 'expired', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      sent_at INTEGER
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS scheduled_pushes_identity ON scheduled_pushes(subscription_id, vacation_id, kind, send_at)');
  db.exec('CREATE INDEX IF NOT EXISTS scheduled_pushes_status_send_at ON scheduled_pushes(status, send_at)');
}

initializeDatabase();
console.log('✓ قاعدة البيانات جاهزة');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function validateSubscription(subscription) {
  return Boolean(
    subscription &&
    requireString(subscription.endpoint, 2048) &&
    subscription.keys &&
    requireString(subscription.keys.auth, 1024) &&
    requireString(subscription.keys.p256dh, 1024)
  );
}

function registerSubscription(subscription) {
  if (!validateSubscription(subscription)) {
    throw new HttpError(400, 'البيانات غير صالحة.');
  }

  const existing = db.prepare('SELECT id FROM subscriptions WHERE endpoint = ?').get(subscription.endpoint);
  if (existing) {
    db.prepare('UPDATE subscriptions SET auth = ?, p256dh = ? WHERE id = ?')
      .run(subscription.keys.auth, subscription.keys.p256dh, existing.id);
    return existing.id;
  }

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO subscriptions (id, endpoint, auth, p256dh) VALUES (?, ?, ?, ?)')
    .run(id, subscription.endpoint, subscription.keys.auth, subscription.keys.p256dh);
  return id;
}

function serializeReminder(reminder, now) {
  if (!reminder || typeof reminder !== 'object' || Array.isArray(reminder)) {
    throw new HttpError(400, 'البيانات غير صالحة.');
  }
  if (!requireString(reminder.vacationId, 64) ||
      !requireString(reminder.kind, 30) ||
      !requireString(reminder.title, 100) ||
      !requireString(reminder.body, 300) ||
      typeof reminder.sendAt !== 'number' ||
      !Number.isFinite(reminder.sendAt)) {
    throw new HttpError(400, 'البيانات غير صالحة.');
  }

  let data;
  try {
    data = JSON.stringify(reminder.data === undefined ? {} : reminder.data);
  } catch {
    throw new HttpError(400, 'البيانات غير صالحة.');
  }
  if (data === undefined) {
    throw new HttpError(400, 'البيانات غير صالحة.');
  }

  return {
    vacationId: reminder.vacationId,
    kind: reminder.kind,
    title: reminder.title,
    body: reminder.body,
    data,
    sendAt: reminder.sendAt,
    skipped: reminder.sendAt <= now
  };
}

function replaceScheduledPushes(endpoint, reminders, now = Date.now()) {
  if (!requireString(endpoint, 2048) || !Array.isArray(reminders) || reminders.length > 120) {
    throw new HttpError(400, 'البيانات غير صالحة.');
  }

  const normalized = reminders.map(reminder => serializeReminder(reminder, now));
  const subscription = db.prepare('SELECT id FROM subscriptions WHERE endpoint = ?').get(endpoint);
  if (!subscription) {
    throw new HttpError(404, 'الاشتراك غير موجود.');
  }

  let scheduled = 0;
  let skipped = 0;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO scheduled_pushes
      (id, subscription_id, vacation_id, kind, title, body, data, send_at, status, attempts, created_at, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 0, ?, NULL)
  `);

  const replace = db.transaction(() => {
    db.prepare("DELETE FROM scheduled_pushes WHERE subscription_id = ? AND status = 'scheduled'")
      .run(subscription.id);

    for (const reminder of normalized) {
      if (reminder.skipped) {
        skipped += 1;
        continue;
      }
      const result = insert.run(
        crypto.randomUUID(),
        subscription.id,
        reminder.vacationId,
        reminder.kind,
        reminder.title,
        reminder.body,
        reminder.data,
        reminder.sendAt,
        now
      );
      if (result.changes === 1) scheduled += 1;
      else skipped += 1;
    }
  });

  replace();
  return { scheduled, skipped };
}

function deleteSubscription(subscriptionId) {
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM scheduled_pushes WHERE subscription_id = ?').run(subscriptionId);
    db.prepare('DELETE FROM subscriptions WHERE id = ?').run(subscriptionId);
  });
  remove();
}

let sendWebPush = (subscription, payload) => webpush.sendNotification(subscription, payload);
let schedulerRunning = false;
let lastCleanupAt = 0;
const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;

function setWebPushSender(sender) {
  if (typeof sender !== 'function') throw new TypeError('sender must be a function');
  sendWebPush = sender;
}

async function processScheduledPushes({ now = Date.now(), sendPush = sendWebPush } = {}) {
  if (schedulerRunning) return { skipped: true, sent: 0, expired: 0, failed: 0 };
  schedulerRunning = true;
  let sent = 0;
  let expired = 0;
  let failed = 0;

  try {
    const due = db.prepare(`
      SELECT p.*, s.endpoint, s.auth, s.p256dh
      FROM scheduled_pushes p
      JOIN subscriptions s ON s.id = p.subscription_id
      WHERE p.status = 'scheduled' AND p.send_at <= ?
      ORDER BY p.send_at ASC
    `).all(now);

    for (const row of due) {
      if (now - row.send_at > DAY_MS) {
        db.prepare("UPDATE scheduled_pushes SET status = 'expired' WHERE id = ? AND status = 'scheduled'")
          .run(row.id);
        expired += 1;
        continue;
      }

      const subscription = {
        endpoint: row.endpoint,
        keys: { auth: row.auth, p256dh: row.p256dh }
      };
      const payload = JSON.stringify({
        title: row.title,
        body: row.body,
        tag: `vacation-${row.vacation_id}-${row.kind}`,
        data: { vacationId: row.vacation_id, kind: row.kind }
      });

      try {
        await sendPush(subscription, payload);
        const result = db.prepare(`
          UPDATE scheduled_pushes
          SET status = 'sent', sent_at = ?
          WHERE id = ? AND status = 'scheduled'
        `).run(now, row.id);
        if (result.changes === 1) sent += 1;
      } catch (error) {
        if (error && (error.statusCode === 404 || error.statusCode === 410)) {
          deleteSubscription(row.subscription_id);
          continue;
        }
        const attempts = row.attempts + 1;
        db.prepare(`
          UPDATE scheduled_pushes
          SET attempts = ?, status = ?
          WHERE id = ? AND status = 'scheduled'
        `).run(attempts, attempts >= 5 ? 'failed' : 'scheduled', row.id);
        failed += 1;
      }
    }

    if (now - lastCleanupAt >= DAY_MS) {
      db.prepare(`
        DELETE FROM scheduled_pushes
        WHERE status IN ('sent', 'expired', 'failed') AND created_at < ?
      `).run(now - THIRTY_DAYS_MS);
      lastCleanupAt = now;
    }

    return { sent, expired, failed };
  } finally {
    schedulerRunning = false;
  }
}

function startScheduler() {
  const timer = setInterval(() => {
    processScheduledPushes().catch(() => {});
  }, 60 * 1000);
  return timer;
}

// ============ API Endpoints ============
app.post('/api/subscribe', (req, res) => {
  try {
    const id = registerSubscription(req.body);
    res.status(201).json({ id, message: 'تم التسجيل بنجاح' });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error('❌ خطأ داخلي في التسجيل');
    return res.status(500).json({ error: 'حدث خطأ داخلي.' });
  }
});

app.put('/api/schedule', (req, res) => {
  try {
    const result = replaceScheduledPushes(req.body?.endpoint, req.body?.reminders);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error('❌ خطأ داخلي في الجدولة');
    return res.status(500).json({ error: 'حدث خطأ داخلي.' });
  }
});

// ✅ API: إرسال إشعار لمستخدم واحد
app.post('/api/send-notification', async (req, res) => {
  const { subscriptionId, title, body, icon, badge } = req.body;
  try {
    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    const subscription = { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } };
    const payload = JSON.stringify({
      title: title || 'إشعار جديد', body: body || 'لديك إشعار جديد',
      icon: icon || './icons/icon-192x192.png', badge: badge || './icons/icon-72x72.png',
      tag: 'vacation-notification', requireInteraction: true,
      data: { dateOfArrival: Date.now(), primaryKey: subscriptionId }
    });
    await webpush.sendNotification(subscription, payload);
    res.status(200).json({ message: 'تم إرسال الإشعار بنجاح' });
  } catch (error) {
    console.error('❌ خطأ داخلي في إرسال الإشعار');
    res.status(500).json({ error: 'حدث خطأ داخلي.' });
  }
});

// ✅ API: إرسال إشعار لجميع المستخدمين
app.post('/api/broadcast-notification', async (req, res) => {
  const { title, body, icon } = req.body;
  const payload = JSON.stringify({
    title: title || 'إشعار بث', body: body || 'إشعار عام لجميع المستخدمين',
    icon: icon || './icons/icon-192x192.png', tag: 'vacation-notification', requireInteraction: true
  });
  let sent = 0;
  let failed = 0;
  try {
    const subs = db.prepare('SELECT * FROM subscriptions').all();
    for (const sub of subs) {
      const subscription = { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } };
      try {
        await webpush.sendNotification(subscription, payload);
        sent += 1;
      } catch (error) {
        if (error.statusCode === 410) deleteSubscription(sub.id);
        failed += 1;
      }
    }
    res.status(200).json({ message: 'تم الإرسال', sent, failed, total: subs.length });
  } catch (error) {
    console.error('❌ خطأ داخلي في البث');
    res.status(500).json({ error: 'حدث خطأ داخلي.' });
  }
});

// ✅ API: حذف الاشتراك
app.post('/api/unsubscribe', (req, res) => {
  const { subscriptionId } = req.body;
  try {
    deleteSubscription(subscriptionId);
    console.log('✓ تم إلغاء الاشتراك:', subscriptionId);
    res.status(200).json({ message: 'تم إلغاء الاشتراك' });
  } catch (error) {
    console.error('❌ خطأ داخلي في إلغاء الاشتراك');
    res.status(500).json({ error: 'حدث خطأ داخلي.' });
  }
});

// ✅ API: عرض إحصائيات الاشتراكات
app.get('/api/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM subscriptions').get().count;
    const recent = db.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE created_at > datetime('now', '-1 day')").get().count;
    const allSubs = db.prepare('SELECT * FROM subscriptions').all();
    res.status(200).json({
      total_subscriptions: total,
      subscriptions_24h: recent,
      timestamp: new Date().toISOString(),
      subscriptions: allSubs.map(s => ({ id: s.id, created_at: s.created_at }))
    });
  } catch (error) {
    console.error('❌ خطأ داخلي في جلب الإحصائيات');
    res.status(500).json({ error: 'حدث خطأ داخلي.' });
  }
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'الخادم يعمل بشكل سليم', timestamp: new Date().toISOString() });
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'حجم الطلب يتجاوز الحد المسموح.' });
  }
  console.error('❌ خطأ داخلي في الخادم');
  return res.status(500).json({ error: 'حدث خطأ داخلي.' });
});

// ============ تشغيل الخادم ============
const PORT = process.env.PORT || 3000;
let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    startScheduler();
    console.log(`🚀 الخادم يعمل على: http://localhost:${PORT}`);
    console.log(`📊 إحصائيات متاحة على: http://localhost:${PORT}/api/stats`);
    console.log(`❤️  Health Check على: http://localhost:${PORT}/api/health`);
    console.log('✅ جاهز لاستقبال الطلبات!');
  });
}

module.exports = {
  app,
  db,
  registerSubscription,
  replaceScheduledPushes,
  processScheduledPushes,
  setWebPushSender,
  startScheduler,
  getServer: () => server
};
