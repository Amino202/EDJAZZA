// This is the service worker with the combined offline experience (Offline page + Offline copy of pages) and background notifications

const CACHE = "pwabuilder-offline-page";

importScripts('https://storage.googleapis.com/workbox-cdn/releases/5.1.2/workbox-sw.js');

const offlineFallbackPage = "offline.html";

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener('install', async (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(offlineFallbackPage))
  );
});

// Background Sync for Notifications
self.addEventListener('sync', (event) => {
  if (event.tag === 'send-vacation-notifications') {
    event.waitUntil(sendScheduledNotifications());
  }
});

// Push Notifications Handler
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const title = data.title || 'إشعار جديد';
    const options = {
      body: data.body || '',
      icon: data.icon || './icons/icon-192x192.png',
      badge: data.badge || './icons/icon-72x72.png',
      tag: data.tag || 'ejaza-notification',
      data: data.custom_data || {}
    };
    
    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  }
});

// Notification Click Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open_app') {
    event.waitUntil(
      clients.openWindow('./index.html')
    );
  } else {
    // Default action when clicking notification
    event.waitUntil(
      clients.openWindow('./index.html')
    );
  }
});

if (workbox.navigationPreload.isSupported()) {
  workbox.navigationPreload.enable();
}

workbox.routing.registerRoute(
  new RegExp('/*'),
  new workbox.strategies.StaleWhileRevalidate({
    cacheName: CACHE
  })
);

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloadResp = await event.preloadResponse;

        if (preloadResp) {
          return preloadResp;
        }

        const networkResp = await fetch(event.request);
        return networkResp;
      } catch (error) {

        const cache = await caches.open(CACHE);
        const cachedResp = await cache.match(offlineFallbackPage);
        return cachedResp;
      }
    })());
  }
});

// Function to send scheduled notifications
async function sendScheduledNotifications() {
  try {
    // Get app data from IndexedDB or localStorage equivalent
    const appDataJson = await getCachedAppData();
    if (!appDataJson) {
      console.log('No app data found for notifications');
      return;
    }
    
    const appData = JSON.parse(appDataJson);
    
    if (!appData.settings.notifications) {
      console.log('Notifications disabled in settings');
      return;
    }
    
    const now = new Date();
    const vacationsToProcess = appData.vacations || [];
    
    for (const vacation of vacationsToProcess) {
      try {
        const startDate = new Date(vacation.startDate);
        const endDate = new Date(vacation.endDate);
        
        // Check for before-start notifications
        if (appData.settings.notificationSettings.beforeStart > 0) {
          const notifyDate = new Date(startDate);
          notifyDate.setDate(notifyDate.getDate() - appData.settings.notificationSettings.beforeStart);
          
          // Check if this notification should be sent (within a reasonable timeframe)
          if (Math.abs(notifyDate - now) < 24 * 60 * 60 * 1000) { // Within 24 hours
            const timeDiff = Math.abs(notifyDate - now);
            if (timeDiff < 5 * 60 * 1000) { // Within 5 minutes of scheduled time
              await self.registration.showNotification(
                `إجازة قادمة: ${getVacationTypeName(vacation.type)}`,
                {
                  body: `تبدأ إجازتك من ${formatDate(startDate)} لمدة ${vacation.days} يوم`,
                  icon: './icons/icon-192x192.png',
                  badge: './icons/icon-72x72.png',
                  tag: `vacation-start-${vacation.id}`
                }
              );
            }
          }
        }
        
        // Check for before-end notifications
        if (appData.settings.notificationSettings.beforeEnd > 0) {
          const notifyDate = new Date(endDate);
          notifyDate.setDate(notifyDate.getDate() - appData.settings.notificationSettings.beforeEnd);
          
          if (Math.abs(notifyDate - now) < 24 * 60 * 60 * 1000) { // Within 24 hours
            const timeDiff = Math.abs(notifyDate - now);
            if (timeDiff < 5 * 60 * 1000) { // Within 5 minutes of scheduled time
              await self.registration.showNotification(
                `إجازة تنتهي قريباً: ${getVacationTypeName(vacation.type)}`,
                {
                  body: `تنتهي إجازتك في ${formatDate(endDate)}`,
                  icon: './icons/icon-192x192.png',
                  badge: './icons/icon-72x72.png',
                  tag: `vacation-end-${vacation.id}`
                }
              );
            }
          }
        }
        
        // Check for on-end notifications
        if (appData.settings.notificationSettings.onEnd) {
          const notifyDate = new Date(endDate);
          notifyDate.setDate(notifyDate.getDate() + 1); // Next day after end
          
          if (Math.abs(notifyDate - now) < 24 * 60 * 60 * 1000) { // Within 24 hours
            const timeDiff = Math.abs(notifyDate - now);
            if (timeDiff < 5 * 60 * 1000) { // Within 5 minutes of scheduled time
              await self.registration.showNotification(
                `انتهت الإجازة: ${getVacationTypeName(vacation.type)}`,
                {
                  body: `انتهت إجازتك اليوم`,
                  icon: './icons/icon-192x192.png',
                  badge: './icons/icon-72x72.png',
                  tag: `vacation-completed-${vacation.id}`
                }
              );
            }
          }
        }
      } catch (e) {
        console.error('Error processing vacation for notification:', vacation, e);
      }
    }
    
    // Check for short balance notifications
    if (appData.settings.notificationSettings.shortBalance && appData.userType === 'continuous') {
      if (appData.stats.shortBalance > 0) {
        // Already has balance, maybe notify if it's newly available
        await self.registration.showNotification(
          'رصيد إجازة قصيرة متاح',
          {
            body: `لديك ${appData.stats.shortBalance} أيام من الإجازة القصيرة المتاحة`,
            icon: './icons/icon-192x192.png',
            badge: './icons/icon-72x72.png',
            tag: 'short-balance-available'
          }
        );
      } else if (appData.settings.shortVacationStart) {
        const lastShortDate = new Date(appData.settings.shortVacationStart);
        const cooldownEnd = new Date(lastShortDate);
        cooldownEnd.setDate(cooldownEnd.getDate() + appData.settings.shortVacationCooldown);
        
        if (Math.abs(cooldownEnd - now) < 24 * 60 * 60 * 1000) { // Within 24 hours
          const timeDiff = Math.abs(cooldownEnd - now);
          if (timeDiff < 5 * 60 * 1000) { // Within 5 minutes of scheduled time
            await self.registration.showNotification(
              'رصيد إجازة قصيرة جديد',
              {
                body: 'لديك الآن رصيد جديد من الإجازة القصيرة المتاحة',
                icon: './icons/icon-192x192.png',
                badge: './icons/icon-72x72.png',
                tag: 'short-balance-renewed'
              }
            );
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in sendScheduledNotifications:', error);
  }
}

// Helper function to get cached app data
async function getCachedAppData() {
  // Since we can't directly access localStorage from service worker,
  // we'll rely on push notifications from the server or periodic sync
  return null;
}

// Helper function to get vacation type name (matching the main app)
function getVacationTypeName(type) {
  const labels = {
    short: 'الإجازة القصيرة',
    annual: 'العطلة السنوية',
    split: 'العطلة المقسمة',
    private: 'الإجازة الخاصة'
  };
  return labels[type] || type;
}

// Helper function to format date (simplified)
function formatDate(date) {
  return date.toLocaleDateString('ar-SA');
}
