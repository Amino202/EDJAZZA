// ============================
// Service Worker - إدارة الإشعارات والـ Background Sync
// ============================

const CACHE_VERSION = 'v3';
const CACHE_NAME = `ejaza-cache-${CACHE_VERSION}`;
const OFFLINE_PAGE = 'offline.html';

// الموارد للـ caching
const STATIC_ASSETS = [
    './',
    './index.html',
    './app.js',
    './notification-manager.js',
    './offline.html',
    './manifest.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png'
];

// قاعدة بيانات الإشعارات في Service Worker
let notificationsDB = null;
const DB_NAME = 'VacationNotificationsDB';
const DB_VERSION = 1;
const STORE_NAME = 'notifications';

// ============================
// Install Event
// ============================
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    
    event.waitUntil(
        Promise.all([
            // 1. Cache static assets
            caches.open(CACHE_NAME).then((cache) => {
                console.log('Caching static assets');
                return cache.addAll(STATIC_ASSETS).catch(err => {
                    console.warn('Some assets failed to cache:', err);
                });
            }),
            
            // 2. Skip waiting to activate immediately
            self.skipWaiting()
        ])
    );
});

// ============================
// Activate Event
// ============================
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    
    event.waitUntil(
        Promise.all([
            // 1. Clear old caches
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            
            // 2. Take control of all clients
            self.clients.claim(),
            
            // 3. Initialize notifications database
            openNotificationsDatabase()
        ])
    );
});

// ============================
// Fetch Event - Network First Strategy
// ============================
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;
    
    // Skip chrome extensions and external resources
    if (!event.request.url.startsWith(self.location.origin)) return;
    
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clone the response before caching
                const responseToCache = response.clone();
                
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                
                return response;
            })
            .catch(() => {
                // If network fails, try cache
                return caches.match(event.request).then((response) => {
                    if (response) {
                        return response;
                    }
                    
                    // If navigation request, return offline page
                    if (event.request.mode === 'navigate') {
                        return caches.match(OFFLINE_PAGE);
                    }
                    
                    // Return a generic offline response
                    return new Response('Offline', {
                        status: 503,
                        statusText: 'Service Unavailable',
                        headers: new Headers({
                            'Content-Type': 'text/plain'
                        })
                    });
                });
            })
    );
});

// ============================
// Message Event - التواصل مع التطبيق
// ============================
self.addEventListener('message', (event) => {
    console.log('Service Worker received message:', event.data);
    
    const { type, payload } = event.data;
    
    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'SHOW_NOTIFICATION':
            handleShowNotification(payload);
            break;
            
        case 'SCHEDULE_NOTIFICATIONS':
            handleScheduleNotifications(payload);
            break;
            
        case 'SYNC_NOTIFICATIONS':
            handleSyncNotifications(payload);
            break;
            
        case 'CHECK_NOTIFICATIONS':
            checkAndSendDueNotifications();
            break;
            
        default:
            console.warn('Unknown message type:', type);
    }
});

// ============================
// Push Event - استقبال push notifications
// ============================
self.addEventListener('push', event => {
  console.log('📬 تم استقبال Push notification:', event.data);
  
  let notificationData = {
    title: 'إشعار من التطبيق',
    body: 'لديك تحديث جديد',
    icon: './icons/icon-192x192.png',
    badge: './icons/icon-72x72.png',
    tag: 'vacation-notification',
    requireInteraction: true
  };
  
  if (event.data) {
    try {
      notificationData = {
        ...notificationData,
        ...event.data.json()
      };
    } catch (e) {
      notificationData.body = event.data.text();
    }
  }
  
  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      requireInteraction: notificationData.requireInteraction,
      data: notificationData.data || {},
      actions: [
        { action: 'open', title: 'فتح' },
        { action: 'close', title: 'إغلاق' }
      ]
    })
  );
});

// ============================
// Notification Click Event
// ============================
self.addEventListener('notificationclick', event => {
  console.log('👆 تم النقر على الإشعار:', event.action);
  
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (let client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// ============================
// Background Sync Event
// ============================
self.addEventListener('sync', (event) => {
    console.log('Background sync triggered:', event.tag);
    
    if (event.tag === 'check-notifications') {
        event.waitUntil(checkAndSendDueNotifications());
    }
});

// ============================
// Periodic Sync Event (إذا كان مدعوماً)
// ============================
self.addEventListener('periodicsync', (event) => {
    console.log('Periodic sync triggered:', event.tag);
    
    if (event.tag === 'check-notifications') {
        event.waitUntil(checkAndSendDueNotifications());
    }
});

// ============================
// إدارة قاعدة البيانات
// ============================
async function openNotificationsDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            console.error('Failed to open notifications database');
            reject(request.error);
        };
        
        request.onsuccess = () => {
            notificationsDB = request.result;
            console.log('Notifications database opened in Service Worker');
            resolve(notificationsDB);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                
                store.createIndex('vacationId', 'vacationId', { unique: false });
                store.createIndex('scheduledTime', 'scheduledTime', { unique: false });
                store.createIndex('type', 'type', { unique: false });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('sent', 'sent', { unique: false });
            }
        };
    });
}

// ============================
// عرض إشعار
// ============================
async function handleShowNotification(payload) {
    try {
        await self.registration.showNotification(payload.title, {
            body: payload.body,
            icon: payload.icon || './icons/icon-192x192.png',
            badge: payload.badge || './icons/icon-72x72.png',
            tag: payload.tag || 'ejaza-notification',
            requireInteraction: payload.requireInteraction !== undefined ? payload.requireInteraction : false,
            data: payload.data || {},
            actions: payload.actions || [
                { action: 'view', title: 'عرض' },
                { action: 'dismiss', title: 'إغلاق' }
            ],
            vibrate: [200, 100, 200],
            timestamp: Date.now()
        });
        
        console.log('Notification shown:', payload.title);
    } catch (error) {
        console.error('Error showing notification:', error);
    }
}

// ============================
// جدولة إشعارات
// ============================
async function handleScheduleNotifications(payload) {
    console.log('Scheduling notifications for vacation:', payload.vacationId);
    
    // إعداد background sync للتحقق من الإشعارات
    try {
        await self.registration.sync.register('check-notifications');
        console.log('Background sync registered');
    } catch (error) {
        console.warn('Background sync not available:', error);
        
        // Fallback: جدولة تحقق دوري
        setTimeout(() => {
            checkAndSendDueNotifications();
        }, 60000); // كل دقيقة
    }
}

// ============================
// مزامنة الإشعارات
// ============================
async function handleSyncNotifications(payload) {
    console.log('Syncing notifications:', payload.notifications?.length || 0);
    
    // يمكن حفظ الإشعارات في cache للوصول السريع
    if (payload.notifications && payload.notifications.length > 0) {
        try {
            const cache = await caches.open('notifications-cache');
            await cache.put(
                new Request('./notifications-data'),
                new Response(JSON.stringify(payload.notifications))
            );
        } catch (error) {
            console.error('Error caching notifications:', error);
        }
    }
    
    // جدولة تحقق فوري
    await checkAndSendDueNotifications();
}

// ============================
// التحقق من الإشعارات المستحقة
// ============================
async function checkAndSendDueNotifications() {
    console.log('Checking for due notifications...');
    
    try {
        // التأكد من فتح قاعدة البيانات
        if (!notificationsDB) {
            await openNotificationsDatabase();
        }
        
        if (!notificationsDB) {
            console.error('Database not available');
            return;
        }
        
        const transaction = notificationsDB.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('status');
        
        // الحصول على الإشعارات المجدولة
        const scheduledRequest = index.getAll('scheduled');
        
        scheduledRequest.onsuccess = async () => {
            const notifications = scheduledRequest.result;
            const now = Date.now();
            let sentCount = 0;
            
            for (const notification of notifications) {
                // التحقق من وقت الاستحقاق (مع هامش 5 دقائق)
                if (notification.scheduledTime <= now + (5 * 60 * 1000)) {
                    try {
                        // إرسال الإشعار
                        await self.registration.showNotification(notification.title, {
                            body: notification.body,
                            icon: './icons/icon-192x192.png',
                            badge: './icons/icon-72x72.png',
                            tag: `vacation-${notification.vacationId}-${notification.type}`,
                            requireInteraction: true,
                            data: notification.data || {},
                            actions: [
                                { action: 'view', title: 'عرض' },
                                { action: 'dismiss', title: 'إغلاق' }
                            ],
                            vibrate: [200, 100, 200],
                            timestamp: Date.now()
                        });
                        
                        // تحديث حالة الإشعار
                        notification.status = 'sent';
                        notification.sent = true;
                        notification.sentAt = Date.now();
                        
                        const updateRequest = store.put(notification);
                        updateRequest.onsuccess = () => {
                            sentCount++;
                            console.log('Notification sent and updated:', notification.title);
                        };
                        
                    } catch (error) {
                        console.error('Error sending notification:', error);
                    }
                }
            }
            
            if (sentCount > 0) {
                console.log(`Sent ${sentCount} due notifications`);
                
                // إخطار التطبيق بالتحديث
                notifyClients({ type: 'NOTIFICATIONS_SENT', count: sentCount });
            }
        };
        
        scheduledRequest.onerror = () => {
            console.error('Error fetching scheduled notifications:', scheduledRequest.error);
        };
        
    } catch (error) {
        console.error('Error checking due notifications:', error);
    }
}

// ============================
// إخطار جميع الـ clients
// ============================
async function notifyClients(message) {
    const allClients = await clients.matchAll({ includeUncontrolled: true });
    
    for (const client of allClients) {
        client.postMessage(message);
    }
}

// ============================
// تنظيف دوري للإشعارات القديمة
// ============================
async function cleanupOldNotifications() {
    try {
        if (!notificationsDB) {
            await openNotificationsDatabase();
        }
        
        if (!notificationsDB) return;
        
        const transaction = notificationsDB.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const cutoffTime = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 يوماً
        
        const request = store.openCursor();
        let deletedCount = 0;
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const notification = cursor.value;
                
                if ((notification.status === 'sent' || notification.status === 'cancelled') 
                    && notification.createdAt < cutoffTime) {
                    cursor.delete();
                    deletedCount++;
                }
                cursor.continue();
            } else {
                if (deletedCount > 0) {
                    console.log('Cleaned up old notifications:', deletedCount);
                }
            }
        };
        
    } catch (error) {
        console.error('Error cleaning up notifications:', error);
    }
}

// تنظيف تلقائي كل 24 ساعة
setInterval(cleanupOldNotifications, 24 * 60 * 60 * 1000);

// تحقق دوري من الإشعارات المستحقة (كل 5 دقائق)
setInterval(checkAndSendDueNotifications, 5 * 60 * 1000);

console.log('Service Worker loaded successfully');