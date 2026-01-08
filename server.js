const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const Database = require('better-sqlite3');
require('dotenv').config();

const app = express();

// ============ إعدادات VAPID ============
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ============ Middleware ============
app.use(cors());
app.use(express.json());

// ============ قاعدة البيانات SQLite ============
const db = new Database('subscriptions.db');

// إنشاء جدول الـ subscriptions
db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    auth TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

console.log('✓ قاعدة البيانات جاهزة');

// ============ API Endpoints ============

// ✅ API: تسجيل الاشتراك
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  const subscriptionId = Date.now().toString();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO subscriptions (id, endpoint, auth, p256dh)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(
      subscriptionId,
      subscription.endpoint,
      subscription.keys.auth,
      subscription.keys.p256dh
    );
    
    console.log('✓ تم تسجيل اشتراك جديد:', subscriptionId);
    
    res.status(201).json({ 
      id: subscriptionId,
      message: 'تم التسجيل بنجاح'
    });
  } catch (error) {
    console.error('❌ خطأ في التسجيل:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ API: إرسال إشعار لمستخدم واحد
app.post('/api/send-notification', async (req, res) => {
  const { subscriptionId, title, body, icon, badge } = req.body;
  
  try {
    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId);
    
    if (!sub) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    
    const subscription = {
      endpoint: sub.endpoint,
      keys: {
        auth: sub.auth,
        p256dh: sub.p256dh
      }
    };
    
    const payload = JSON.stringify({
      title: title || 'إشعار جديد',
      body: body || 'لديك إشعار جديد',
      icon: icon || './icons/icon-192x192.png',
      badge: badge || './icons/icon-72x72.png',
      tag: 'vacation-notification',
      requireInteraction: true,
      data: {
        dateOfArrival: Date.now(),
        primaryKey: subscriptionId
      }
    });
    
    await webpush.sendNotification(subscription, payload);
    res.status(200).json({ message: 'تم إرسال الإشعار بنجاح' });
  } catch (error) {
    console.error('❌ خطأ في إرسال الإشعار:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ API: إرسال إشعار لجميع المستخدمين
app.post('/api/broadcast-notification', async (req, res) => {
  const { title, body, icon } = req.body;
  
  const payload = JSON.stringify({
    title: title || 'إشعار بث',
    body: body || 'إشعار عام لجميع المستخدمين',
    icon: icon || './icons/icon-192x192.png',
    tag: 'vacation-notification',
    requireInteraction: true
  });
  
  let sent = 0;
  let failed = 0;
  
  try {
    // احصل على جميع الـ subscriptions من قاعدة البيانات
    const subs = db.prepare('SELECT * FROM subscriptions').all();
    
    console.log(`📤 بدء الإرسال إلى ${subs.length} مستخدم...`);
    
    for (const sub of subs) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: {
          auth: sub.auth,
          p256dh: sub.p256dh
        }
      };
      
      try {
        await webpush.sendNotification(subscription, payload);
        sent++;
        console.log(`✓ تم الإرسال إلى: ${sub.id}`);
      } catch (error) {
        console.error(`❌ فشل الإرسال إلى ${sub.id}:`, error.message);
        
        // احذف الـ subscription إذا كان غير صالح (410)
        if (error.statusCode === 410) {
          db.prepare('DELETE FROM subscriptions WHERE id = ?').run(sub.id);
          console.log(`🗑️  تم حذف subscription غير صالح: ${sub.id}`);
        }
        failed++;
      }
    }
    
    res.status(200).json({ 
      message: 'تم الإرسال',
      sent,
      failed,
      total: subs.length
    });
  } catch (error) {
    console.error('❌ خطأ في البث:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ API: حذف الاشتراك
app.post('/api/unsubscribe', (req, res) => {
  const { subscriptionId } = req.body;
  
  try {
    db.prepare('DELETE FROM subscriptions WHERE id = ?').run(subscriptionId);
    console.log('✓ تم إلغاء الاشتراك:', subscriptionId);
    res.status(200).json({ message: 'تم إلغاء الاشتراك' });
  } catch (error) {
    console.error('❌ خطأ في إلغاء الاشتراك:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ API: عرض إحصائيات الاشتراكات
app.get('/api/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM subscriptions').get().count;
    const recent = db.prepare(`
      SELECT COUNT(*) as count FROM subscriptions 
      WHERE created_at > datetime('now', '-1 day')
    `).get().count;
    
    const allSubs = db.prepare('SELECT * FROM subscriptions').all();
    
    res.status(200).json({
      total_subscriptions: total,
      subscriptions_24h: recent,
      timestamp: new Date().toISOString(),
      subscriptions: allSubs.map(s => ({
        id: s.id,
        created_at: s.created_at
      }))
    });
  } catch (error) {
    console.error('❌ خطأ في جلب الإحصائيات:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ API: Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK',
    message: 'الخادم يعمل بشكل سليم',
    timestamp: new Date().toISOString()
  });
});

// ============ تشغيل الخادم ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على: http://localhost:${PORT}`);
  console.log(`📊 إحصائيات متاحة على: http://localhost:${PORT}/api/stats`);
  console.log(`❤️  Health Check على: http://localhost:${PORT}/api/health`);
  console.log('');
  console.log('='.repeat(50));
  console.log('✅ جاهز لاستقبال الطلبات!');
  console.log('='.repeat(50));
});