// ============================
// مدير الإشعارات - NotificationManager
// ============================

class NotificationManager {
    constructor() {
        this.DB_NAME = 'VacationNotificationsDB';
        this.DB_VERSION = 1;
        this.STORE_NAME = 'notifications';
        this.db = null;
        this.permissionStatus = 'default';
        this.isInitialized = false;
    }

    // ============================
    // تهيئة النظام
    // ============================
    async initialize() {
        if (this.isInitialized) return true;

        try {
            // 1. فتح قاعدة البيانات
            await this.openDatabase();

            // 2. التحقق من دعم الإشعارات
            if (!('Notification' in window)) {
                console.warn('Notifications not supported in this browser');
                return false;
            }

            // 3. التحقق من حالة الإذن
            this.permissionStatus = Notification.permission;

            // 4. تسجيل Service Worker
            if ('serviceWorker' in navigator) {
                await this.registerServiceWorker();
            }

            this.isInitialized = true;
            console.log('NotificationManager initialized successfully');
            return true;

        } catch (error) {
            console.error('Failed to initialize NotificationManager:', error);
            return false;
        }
    }

    // ============================
    // قاعدة بيانات الإشعارات
    // ============================
    async openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // إنشاء object store للإشعارات
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });

                    // إنشاء indexes
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
    // طلب إذن الإشعارات
    // ============================
    async requestPermission(force = false) {
        if (!('Notification' in window)) {
            console.warn('Notifications not supported');
            return false;
        }

        // إذا كان الإذن ممنوحاً بالفعل
        if (Notification.permission === 'granted') {
            this.permissionStatus = 'granted';
            return true;
        }

        // إذا كان مرفوضاً ولم نطلب force
        if (Notification.permission === 'denied' && !force) {
            this.permissionStatus = 'denied';
            return false;
        }

        try {
            const permission = await Notification.requestPermission();
            this.permissionStatus = permission;

            if (permission === 'granted') {
                console.log('Notification permission granted');
                
                // إرسال إشعار ترحيبي
                this.sendWelcomeNotification();
                
                return true;
            } else {
                console.log('Notification permission denied');
                return false;
            }
        } catch (error) {
            console.error('Error requesting notification permission:', error);
            return false;
        }
    }

    // ============================
    // إشعار ترحيبي
    // ============================
    async sendWelcomeNotification() {
        try {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                // إرسال عبر Service Worker
                navigator.serviceWorker.controller.postMessage({
                    type: 'SHOW_NOTIFICATION',
                    payload: {
                        title: 'مرحباً بك في تطبيق إجازة',
                        body: 'ستتلقى إشعارات بمواعيد إجازاتك والتذكيرات',
                        icon: './icons/icon-192x192.png',
                        badge: './icons/icon-72x72.png',
                        tag: 'welcome',
                        requireInteraction: false,
                        data: { type: 'welcome' }
                    }
                });
            } else {
                // إرسال مباشر
                new Notification('مرحباً بك في تطبيق إجازة', {
                    body: 'ستتلقى إشعارات بمواعيد إجازاتك والتذكيرات',
                    icon: './icons/icon-192x192.png',
                    badge: './icons/icon-72x72.png',
                    tag: 'welcome'
                });
            }
        } catch (error) {
            console.error('Error sending welcome notification:', error);
        }
    }

    // ============================
    // تسجيل Service Worker
    // ============================
    async registerServiceWorker() {
        try {
            const registration = await navigator.serviceWorker.register('./sw.js', {
                scope: './'
            });

            console.log('Service Worker registered:', registration.scope);

            // انتظار Service Worker يصبح active
            if (registration.installing) {
                await new Promise((resolve) => {
                    registration.installing.addEventListener('statechange', (e) => {
                        if (e.target.state === 'activated') {
                            resolve();
                        }
                    });
                });
            }

            // إعداد periodic sync (إذا كان مدعوماً)
            if ('periodicSync' in registration) {
                try {
                    await registration.periodicSync.register('check-notifications', {
                        minInterval: 60 * 60 * 1000 // كل ساعة
                    });
                    console.log('Periodic sync registered');
                } catch (error) {
                    console.warn('Periodic sync not available:', error);
                }
            }

            return registration;

        } catch (error) {
            console.error('Service Worker registration failed:', error);
            throw error;
        }
    }

    // ============================
    // جدولة إشعار
    // ============================
    async scheduleNotification(notification) {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        try {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);

            const notificationData = {
                vacationId: notification.vacationId,
                type: notification.type, // 'before_start', 'before_end', 'on_end', 'short_balance'
                title: notification.title,
                body: notification.body,
                scheduledTime: notification.scheduledTime, // timestamp
                createdAt: Date.now(),
                status: 'scheduled', // 'scheduled', 'sent', 'cancelled'
                sent: false,
                data: notification.data || {}
            };

            return new Promise((resolve, reject) => {
                const request = store.add(notificationData);
                request.onsuccess = () => {
                    console.log('Notification scheduled:', notificationData);
                    resolve(request.result);
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error scheduling notification:', error);
            throw error;
        }
    }

    // ============================
    // جدولة إشعارات إجازة
    // ============================
    async scheduleVacationNotifications(vacation, settings) {
        if (!vacation || !settings) return;

        const notifications = [];
        const now = Date.now();
        const startDate = new Date(vacation.startDate).getTime();
        const endDate = new Date(vacation.endDate).getTime();

        try {
            // 1. إشعار قبل البداية
            if (settings.beforeStart > 0) {
                const notifyTime = startDate - (settings.beforeStart * 24 * 60 * 60 * 1000);
                if (notifyTime > now) {
                    const id = await this.scheduleNotification({
                        vacationId: vacation.id,
                        type: 'before_start',
                        title: `إجازة قادمة: ${this.getVacationTypeName(vacation.type)}`,
                        body: `تبدأ إجازتك في ${this.formatDate(vacation.startDate)} لمدة ${vacation.days} يوم`,
                        scheduledTime: notifyTime,
                        data: { vacation }
                    });
                    notifications.push(id);
                }
            }

            // 2. إشعار قبل النهاية
            if (settings.beforeEnd > 0) {
                const notifyTime = endDate - (settings.beforeEnd * 24 * 60 * 60 * 1000);
                if (notifyTime > now) {
                    const id = await this.scheduleNotification({
                        vacationId: vacation.id,
                        type: 'before_end',
                        title: `إجازة تنتهي قريباً: ${this.getVacationTypeName(vacation.type)}`,
                        body: `تنتهي إجازتك في ${this.formatDate(vacation.endDate)}`,
                        scheduledTime: notifyTime,
                        data: { vacation }
                    });
                    notifications.push(id);
                }
            }

            // 3. إشعار عند النهاية
            if (settings.onEnd && endDate > now) {
                const id = await this.scheduleNotification({
                    vacationId: vacation.id,
                    type: 'on_end',
                    title: `انتهت الإجازة: ${this.getVacationTypeName(vacation.type)}`,
                    body: `انتهت إجازتك اليوم`,
                    scheduledTime: endDate,
                    data: { vacation }
                });
                notifications.push(id);
            }

            // إرسال الإشعارات المجدولة إلى Service Worker
            if (notifications.length > 0 && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'SCHEDULE_NOTIFICATIONS',
                    payload: { vacationId: vacation.id }
                });
            }

            return notifications;

        } catch (error) {
            console.error('Error scheduling vacation notifications:', error);
            return [];
        }
    }

    // ============================
    // إلغاء إشعارات إجازة
    // ============================
    async cancelVacationNotifications(vacationId) {
        if (!this.db) return;

        try {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            const index = store.index('vacationId');

            return new Promise((resolve, reject) => {
                const request = index.openCursor(IDBKeyRange.only(vacationId));
                const deletedIds = [];

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        // تحديث الحالة إلى cancelled بدلاً من الحذف
                        const notification = cursor.value;
                        notification.status = 'cancelled';
                        cursor.update(notification);
                        deletedIds.push(notification.id);
                        cursor.continue();
                    } else {
                        console.log('Cancelled notifications:', deletedIds);
                        resolve(deletedIds);
                    }
                };

                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error cancelling notifications:', error);
        }
    }

    // ============================
    // الحصول على إشعارات معلقة
    // ============================
    async getPendingNotifications() {
        if (!this.db) return [];

        try {
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const index = store.index('status');

            return new Promise((resolve, reject) => {
                const request = index.getAll('scheduled');
                request.onsuccess = () => {
                    const notifications = request.result.filter(n => 
                        n.scheduledTime > Date.now()
                    );
                    resolve(notifications);
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error getting pending notifications:', error);
            return [];
        }
    }

    // ============================
    // التحقق من الإشعارات المستحقة
    // ============================
    async checkDueNotifications() {
        if (!this.db || Notification.permission !== 'granted') return;

        try {
            const pending = await this.getPendingNotifications();
            const now = Date.now();
            const due = pending.filter(n => n.scheduledTime <= now);

            for (const notification of due) {
                await this.sendNotification(notification);
                await this.markNotificationAsSent(notification.id);
            }

            return due.length;

        } catch (error) {
            console.error('Error checking due notifications:', error);
            return 0;
        }
    }

    // ============================
    // إرسال إشعار
    // ============================
    async sendNotification(notification) {
        try {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                // إرسال عبر Service Worker
                navigator.serviceWorker.controller.postMessage({
                    type: 'SHOW_NOTIFICATION',
                    payload: {
                        title: notification.title,
                        body: notification.body,
                        icon: './icons/icon-192x192.png',
                        badge: './icons/icon-72x72.png',
                        tag: `vacation-${notification.vacationId}-${notification.type}`,
                        requireInteraction: true,
                        data: notification.data,
                        actions: [
                            {
                                action: 'view',
                                title: 'عرض',
                                icon: './icons/icon-72x72.png'
                            },
                            {
                                action: 'dismiss',
                                title: 'إغلاق'
                            }
                        ]
                    }
                });
            } else {
                // إرسال مباشر
                const notif = new Notification(notification.title, {
                    body: notification.body,
                    icon: './icons/icon-192x192.png',
                    badge: './icons/icon-72x72.png',
                    tag: `vacation-${notification.vacationId}-${notification.type}`,
                    requireInteraction: true,
                    data: notification.data
                });

                notif.onclick = () => {
                    window.focus();
                    notif.close();
                };
            }

            console.log('Notification sent:', notification.title);

        } catch (error) {
            console.error('Error sending notification:', error);
        }
    }

    // ============================
    // تحديث حالة الإشعار
    // ============================
    async markNotificationAsSent(notificationId) {
        if (!this.db) return;

        try {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);

            return new Promise((resolve, reject) => {
                const request = store.get(notificationId);
                request.onsuccess = () => {
                    const notification = request.result;
                    if (notification) {
                        notification.status = 'sent';
                        notification.sent = true;
                        notification.sentAt = Date.now();
                        store.put(notification);
                    }
                    resolve();
                };
                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error marking notification as sent:', error);
        }
    }

    // ============================
    // تنظيف الإشعارات القديمة
    // ============================
    async cleanupOldNotifications(daysOld = 30) {
        if (!this.db) return;

        try {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

            return new Promise((resolve, reject) => {
                const request = store.openCursor();
                let deletedCount = 0;

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const notification = cursor.value;
                        // حذف الإشعارات المرسلة أو الملغاة القديمة
                        if ((notification.status === 'sent' || notification.status === 'cancelled') 
                            && notification.createdAt < cutoffTime) {
                            cursor.delete();
                            deletedCount++;
                        }
                        cursor.continue();
                    } else {
                        console.log('Cleaned up old notifications:', deletedCount);
                        resolve(deletedCount);
                    }
                };

                request.onerror = () => reject(request.error);
            });

        } catch (error) {
            console.error('Error cleaning up notifications:', error);
            return 0;
        }
    }

    // ============================
    // Helper Functions
    // ============================
    getVacationTypeName(type) {
        const labels = {
            short: 'الإجازة القصيرة',
            annual: 'العطلة السنوية',
            split: 'العطلة المقسمة',
            private: 'الإجازة الخاصة'
        };
        return labels[type] || type;
    }

    formatDate(dateStr) {
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('ar-SA', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
        } catch (error) {
            return dateStr;
        }
    }

    // ============================
    // تصدير البيانات للـ Service Worker
    // ============================
    async syncWithServiceWorker() {
        if (!navigator.serviceWorker.controller) return;

        try {
            const pending = await this.getPendingNotifications();
            
            navigator.serviceWorker.controller.postMessage({
                type: 'SYNC_NOTIFICATIONS',
                payload: { notifications: pending }
            });

            console.log('Synced notifications with Service Worker:', pending.length);

        } catch (error) {
            console.error('Error syncing with Service Worker:', error);
        }
    }
}

// ============================
// تصدير النظام
// ============================
// إنشاء instance واحدة
const notificationManager = new NotificationManager();

// جعلها متاحة عالمياً
if (typeof window !== 'undefined') {
    window.NotificationManager = NotificationManager;
    window.notificationManager = notificationManager;
}
