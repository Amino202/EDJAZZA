// ============================
// بيانات التطبيق
// ============================
const APP_CONFIG = {
    CACHE_VERSION: 'v3',
    DEFAULT_VACATION_BALANCE: {
        short: 6,
        annual: 30,
        split: 30
    },
    VACATION_RULES: {
        short: {
            maxDays: 6,
            cooldownDays: 70,
            availableFrom: { month: 10, day: 15 },
            availableTo: { month: 4, day: 15 }
        },
        annual: {
            maxDays: 30,
            availableFrom: { month: 5, day: 1 },
            availableTo: { month: 11, day: 1 }
        },
        split: {
            maxDays: 30,
            availableFrom: { month: 5, day: 1 },
            availableTo: null
        }
    }
};

// ============ PUSH NOTIFICATIONS CONFIG ============
const PUSH_SERVER_URL = 'https://your-server-url.com';
const VAPID_PUBLIC_KEY = 'BIC3p5grn2iKUow3xCpSyu8OQbElewSSYWd1eK4y54UiqSZwtRse5vxrP9XBMnQHhS8be5g0dcERMp1jgU5Nwhw';

// ✅ دالة الاشتراك في Push Notifications
async function subscribeToPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('❌ Push Notifications غير مدعومة');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    console.log('✓ تم الاشتراك بنجاح:', subscription);
    await sendSubscriptionToServer(subscription);

    return subscription;
  } catch (error) {
    console.error('❌ خطأ في الاشتراك:', error);
    return null;
  }
}

// ✅ إرسال Subscription إلى الخادم
async function sendSubscriptionToServer(subscription) {
  try {
    const response = await fetch(`${PUSH_SERVER_URL}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✓ تم حفظ الاشتراك على الخادم:', data.id);
      localStorage.setItem('subscriptionId', data.id);
      return data.id;
    }
  } catch (error) {
    console.error('❌ خطأ في إرسال الاشتراك:', error);
  }
}

// ✅ تحويل المفتاح
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ✅ اختبار الإشعار
async function testPushNotification() {
  const subscriptionId = localStorage.getItem('subscriptionId');
  
  if (!subscriptionId) {
    console.log('❌ لم تشترك بعد');
    return;
  }

  try {
    const response = await fetch(`${PUSH_SERVER_URL}/api/send-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriptionId,
        title: '🎉 اختبار الإشعار',
        body: 'تم إرسال الإشعار بنجاح!',
      })
    });

    if (response.ok) {
      console.log('✓ تم إرسال الإشعار التجريبي');
    }
  } catch (error) {
    console.error('❌ خطأ في إرسال الإشعار:', error);
  }
}

let appData = {
    userType: 'continuous',
    settings: {
        shortVacationDays: 6,
        shortVacationCooldown: 70,
        shortVacationStart: null,
        shortVacationPeriod: {
            startMonth: 10,
            startDay: 15,
            endMonth: 4,
            endDay: 15
        },
        annualVacationPeriod: {
            startMonth: 5,
            startDay: 1,
            endMonth: 11,
            endDay: 1
        },
        notifications: true,
        notificationSettings: {
            beforeStart: 3,
            beforeEnd: 3,
            onEnd: true,
            shortBalance: true
        },
        theme: 'light',
        language: 'ar'
    },
    vacations: [],
    stats: {
        shortBalance: 6,
        annualBalance: 30,
        splitBalance: 30,
        totalUsed: 0,
        
        lastAnnualPeriodYear: null,
        lastShortPeriodYear: null
    }
};

// PWA Install Variables
let deferredPrompt = null;
let installPromptShown = false;

// Confirm Modal Management
let confirmCallback = null;

// Global variables for management
let editingId = null;
let scheduledTimeouts = [];
let lastShortBalanceNotificationTime = null;
let nextShortBalanceNotificationTime = null;

// ============================
// نظام الإشعارات الجديد
// ============================
let notificationManager = null;

// ============================
// تهيئة التطبيق
// ============================
async function initApp() {
    try {
        // 1. تهيئة IndexedDB أولاً
        await setupPersistentStorage();
        
        // 2. تحميل البيانات
        await loadData();
        
        // 3. تهيئة نظام الإشعارات الجديد
        if (window.notificationManager) {
            notificationManager = window.notificationManager;
            await notificationManager.initialize();
            
            // طلب الإذن إذا كانت الإشعارات مفعلة
            if (appData.settings.notifications) {
                setTimeout(async () => {
                    const granted = await notificationManager.requestPermission();
                    if (granted) {
                        // جدولة جميع الإشعارات الموجودة
                        await scheduleAllNotifications();
                    }
                }, 2000);
            }
        }
        
        // 4. باقي التهيئة
        checkVacationPeriodRenewal();
        initializeApp();
        setupEventListeners();
        setupPWA();
        checkUrlParams();
        setupDateInputs();
        updatePermissionStatus();
        
        // Initialize Web Worker for heavy calculations
        initStatsWorker();
        
        // ✅ طلب الاشتراك في Push Notifications
        if (appData.settings.notifications && Notification.permission === 'granted') {
            await subscribeToPushNotifications();
        }
        
    } catch (error) {
        console.error('Initialization error:', error);
    }
    
    setTimeout(() => {
        if (typeof updateUI === 'function') {
            updateUI();
        }
        
        // Ensure stats are updated immediately after initialization
        if (window.Worker) {
            updateStatsWithWorker();
        } else {
            updateStats();
        }
    }, 500);
}

document.addEventListener('DOMContentLoaded', initApp);

function initializeApp() {
    // تعيين السنة الحالية
    const yearEl = document.getElementById('currentYear');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // إعداد الإعدادات الافتراضية
    setupDefaultSettings();

    // تحديث الواجهة حسب نوع المستخدم
    updateUserTypeUI();

    // تحديث قائمة السنوات
    updateYearFilter();

    // إعداد التواريخ
    setupDates();

    // تحديث حالة إذن الإشعارات
    updatePermissionStatus();

    // تحديث واجهة المستخدم
    updateUI();
    
    // Ensure stats are updated immediately after initialization
    if (window.Worker) {
        updateStatsWithWorker();
    } else {
        updateStats();
    }
}

// ============================
// إدارة أذونات الإشعارات - محسنة
// ============================
async function requestNotificationPermissions(force = false) {
    if (!notificationManager) {
        // Fallback للطريقة القديمة
        if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            updatePermissionStatus();
            return permission === 'granted';
        }
        return false;
    }
    
    const granted = await notificationManager.requestPermission(force);
    
    if (granted) {
        // جدولة جميع الإشعارات
        await scheduleAllNotifications();
        showToast('تم منح إذن الإشعارات بنجاح!', 'success');
    } else if (force) {
        showToast('تم رفض الإشعارات. لن تتلقى تنبيهات الإجازات.', 'warning', 5000);
    }
    
    updatePermissionStatus();
    updateNotificationUI();
    
    return granted;
}

// ============================
// دالة جدولة جميع الإشعارات
// ============================
async function scheduleAllNotifications() {
    if (!notificationManager || !appData.settings.notifications) return;
    
    try {
        // جدولة إشعارات كل الإجازات
        for (const vacation of appData.vacations) {
            // فقط الإجازات المستقبلية أو الحالية
            const endDate = new Date(vacation.endDate);
            if (endDate >= new Date()) {
                await notificationManager.scheduleVacationNotifications(
                    vacation,
                    appData.settings.notificationSettings
                );
            }
        }
        
        // مزامنة مع Service Worker
        await notificationManager.syncWithServiceWorker();
        
        console.log('All notifications scheduled successfully');
        
    } catch (error) {
        console.error('Error scheduling all notifications:', error);
    }
}

function updatePermissionStatus() {
    const statusElement = document.getElementById('currentPermissionStatus');
    if (!statusElement) return;
    
    if ('Notification' in window) {
        const status = Notification.permission;
        let statusText = '';
        let statusClass = '';
        
        switch(status) {
            case 'granted':
                statusText = 'مُمنوح ✓';
                statusClass = 'permission-granted';
                break;
            case 'denied':
                statusText = 'مرفوض ✗';
                statusClass = 'permission-denied';
                break;
            case 'default':
                statusText = 'في انتظار القرار';
                statusClass = 'permission-default';
                break;
            default:
                statusText = 'غير معروف';
                statusClass = 'text-gray-600';
        }
        
        statusElement.textContent = statusText;
        statusElement.className = statusClass;
        
        // تحديث نص حالة الإذن
        const permissionStatusText = document.getElementById('permissionStatus');
        if (permissionStatusText) {
            let description = '';
            switch(status) {
                case 'granted':
                    description = 'الإذن ممنوح. ستتلقى إشعارات الإجازات.';
                    break;
                case 'denied':
                    description = 'الإذن مرفوض. لن تتلقى إشعارات الإجازات.';
                    break;
                case 'default':
                    description = 'لم يتم تحديد الإذن بعد. اضغط على زر "طلب الإذن".';
                    break;
            }
            permissionStatusText.querySelector('span:not(#currentPermissionStatus)')?.remove();
            const descSpan = document.createElement('span');
            descSpan.className = 'block text-xs mt-1';
            descSpan.textContent = description;
            permissionStatusText.appendChild(descSpan);
        }
    } else {
        statusElement.textContent = 'غير مدعوم';
        statusElement.className = 'text-gray-600';
    }
}

function updateNotificationUI() {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        const hasNotifications = appData.vacations.some(v => {
            if (!appData.settings.notifications) return false;
            const start = new Date(v.startDate);
            const end = new Date(v.endDate);
            const now = new Date();
            
            // تحقق من الإجازات القادمة في الـ7 أيام القادمة
            const sevenDaysFromNow = new Date();
            sevenDaysFromNow.setDate(now.getDate() + 7);
            
            return (start <= sevenDaysFromNow && end >= now);
        });
        
        badge.classList.toggle('hidden', !hasNotifications);
        badge.classList.toggle('animate-pulse', hasNotifications);
    }
}

// ============================
// إدارة تخزين البيانات
// ============================

// IndexedDB database setup
let db;
const DB_NAME = 'VacationAppDB';
const DB_VERSION = 2; // Increased version to allow schema updates
const STORE_NAME = 'appData';

function setupIndexedDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            console.warn('IndexedDB not supported, falling back to localStorage');
            resolve(false);
            return;
        }
        
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = function(event) {
            console.error('IndexedDB error:', event.target.error);
            reject(event.target.error);
        };
        
        request.onsuccess = function(event) {
            db = event.target.result;
            console.log('IndexedDB connected successfully');
            resolve(true);
        };
        
        request.onupgradeneeded = function(event) {
            const db = event.target.result;
            
            // Create object store if it doesn't exist
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

// Save data to IndexedDB
function saveDataToIndexedDB() {
    if (!db) {
        // Fallback to localStorage if IndexedDB is not available
        saveData();
        return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // Clear existing data and add new data
        const clearRequest = store.clear();
        
        clearRequest.onsuccess = function() {
            const dataToStore = {
                id: 1, // Single record with fixed ID
                appData: appData,
                timestamp: new Date().toISOString(),
                version: APP_CONFIG.CACHE_VERSION
            };
            
            const addRequest = store.add(dataToStore);
            
            addRequest.onsuccess = function() {
                console.log('Data saved to IndexedDB successfully');
                resolve();
            };
            
            addRequest.onerror = function(event) {
                console.error('Error saving to IndexedDB:', event.target.error);
                reject(event.target.error);
            };
        };
        
        clearRequest.onerror = function(event) {
            console.error('Error clearing IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Load data from IndexedDB
function loadDataFromIndexedDB() {
    if (!db) {
        // Fallback to localStorage if IndexedDB is not available
        loadData();
        return Promise.resolve(false);
    }
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        
        const getRequest = store.get(1); // Get the single record with ID 1
        
        getRequest.onsuccess = function(event) {
            const result = event.target.result;
            if (result && result.appData) {
                console.log('Data loaded from IndexedDB successfully');
                // Merge the loaded data with current appData structure
                appData = deepMerge(appData, result.appData);
                resolve(true);
            } else {
                console.log('No data found in IndexedDB, will try localStorage');
                resolve(false);
            }
        };
        
        getRequest.onerror = function(event) {
            console.error('Error loading from IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Enhanced saveData function that uses both IndexedDB and localStorage for backup
function saveData() {
    try {
        // Save to localStorage as backup
        localStorage.setItem('ejaza-app-data', JSON.stringify(appData));
        
        // Try to save to IndexedDB as primary storage
        if (db) {
            saveDataToIndexedDB().catch(err => {
                console.warn('Failed to save to IndexedDB, localStorage backup exists:', err);
            });
        }
    } catch (error) {
        console.error('Save data error:', error);
        showToast('حدث خطأ أثناء حفظ البيانات', 'error');
    }
}

// Enhanced loadData function that tries IndexedDB first, then localStorage
async function loadData() {
    try {
        // Try to load from IndexedDB first
        const loadedFromIndexedDB = await loadDataFromIndexedDB();
        
        if (!loadedFromIndexedDB) {
            // Fallback to localStorage
            const savedData = localStorage.getItem('ejaza-app-data');
            if (savedData) {
                const parsedData = JSON.parse(savedData);
                
                if (!parsedData || typeof parsedData !== 'object') {
                    console.warn('Invalid data structure found in localStorage, using defaults');
                    return;
                }
                
                if (parsedData.vacations && Array.isArray(parsedData.vacations)) {
                    if (parsedData.vacations.length > 1000) {
                        console.warn(`Too many vacations found (${parsedData.vacations.length}), limiting to 1000`);
                        parsedData.vacations = parsedData.vacations.slice(0, 1000);
                    }
                    
                    parsedData.vacations = parsedData.vacations.filter(vacation => {
                        try {
                            if (!vacation.id || !vacation.type || !vacation.startDate || !vacation.endDate) {
                                console.warn('Invalid vacation data found:', vacation);
                                return false;
                            }
                            
                            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                            if (!dateRegex.test(vacation.startDate) || !dateRegex.test(vacation.endDate)) {
                                console.warn('Invalid date format in vacation:', vacation);
                                return false;
                            }
                            
                            return true;
                        } catch (e) {
                            console.error('Error validating vacation:', vacation, e);
                            return false;
                        }
                    });
                }
                
                appData = deepMerge(appData, parsedData);
            }
        }
    } catch (error) {
        console.error('Load data error:', error);
        if (error instanceof SyntaxError) {
            console.warn('Corrupted data detected, resetting to defaults');
            try {
                localStorage.removeItem('ejaza-app-data');
                if (db) {
                    const transaction = db.transaction([STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    store.clear();
                }
            } catch (removeError) {
                console.error('Could not clear corrupted data:', removeError);
            }
        }
    }
}

async function setupPersistentStorage() {
    if ('storage' in navigator && 'persist' in navigator.storage) {
        try {
            const granted = await navigator.storage.persist();
            if (granted) {
                console.log('Storage will not be cleared automatically');
            }
        } catch (error) {
            console.error('Error setting up persistent storage:', error);
        }
    }
    
    // Initialize IndexedDB - await to ensure it's ready before continuing
    try {
        await setupIndexedDB();
    } catch (err) {
        console.warn('IndexedDB setup failed, will use localStorage:', err);
    }
}



// ============================
// ميزة المشاركة - محسنة
// ============================
function shareVacation(vacation) {
    if (!vacation) {
        showToast('لا توجد بيانات إجازة للمشاركة', 'error');
        return;
    }
    
    if ('share' in navigator && navigator.canShare) {
        const shareData = {
            title: `إجازتي ${getVacationTypeName(vacation.type)}`,
            text: `لدي إجازة ${vacation.type === 'private' ? 'خاصة' : ''} من ${formatDate(new Date(vacation.startDate))} إلى ${formatDate(new Date(vacation.endDate))} لمدة ${vacation.days} يوم`,
            url: window.location.origin
        };
        
        // التحقق من إمكانية المشاركة بهذه البيانات
        if (navigator.canShare(shareData)) {
            navigator.share(shareData)
                .then(() => showToast('تم مشاركة الإجازة بنجاح!', 'success'))
                .catch(error => {
                    if (error.name !== 'AbortError') {
                        console.log('Sharing cancelled:', error);
                        copyVacationToClipboard(vacation);
                    }
                });
        } else {
            copyVacationToClipboard(vacation);
        }
    } else {
        copyVacationToClipboard(vacation);
    }
}

function copyVacationToClipboard(vacation) {
    const textToCopy = `إجازة ${getVacationTypeName(vacation.type)}: من ${formatDate(new Date(vacation.startDate))} إلى ${formatDate(new Date(vacation.endDate))} لمدة ${vacation.days} يوم`;
    
    navigator.clipboard.writeText(textToCopy)
        .then(() => {
            showToast('تم نسخ تفاصيل الإجازة إلى الحافظة ✓', 'success');
        })
        .catch(() => {
            // بديل يدوي
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                showToast('تم نسخ تفاصيل الإجازة', 'success');
            } catch (err) {
                showToast('تعذر نسخ التفاصيل. يمكنك نسخها يدوياً.', 'info');
            }
            document.body.removeChild(textArea);
        });
}

function checkShareSupport() {
    return 'share' in navigator && 'canShare' in navigator;
}

// ============================
// وظائف تجديد الفترات
// ============================
function checkVacationPeriodRenewal() {
    const today = new Date();
    const currentYear = today.getFullYear();
    
    const annualPeriod = appData.settings.annualVacationPeriod;
    const shortPeriod = appData.settings.shortVacationPeriod;
    
    const currentAnnualStart = new Date(currentYear, annualPeriod.startMonth - 1, annualPeriod.startDay);
    const currentShortStart = new Date(currentYear, shortPeriod.startMonth - 1, shortPeriod.startDay);
    
    const lastAnnualPeriodYear = appData.stats.lastAnnualPeriodYear || (currentYear - 1);
    const lastShortPeriodYear = appData.stats.lastShortPeriodYear || (currentYear - 1);
    
    if (today >= currentAnnualStart && currentYear > lastAnnualPeriodYear) {
        appData.stats.lastAnnualPeriodYear = currentYear;
        showToast(`بدأت فترة العطلة السنوية الجديدة (${formatDate(currentAnnualStart)})`, 'info', 5000);
    }
    
    if (today >= currentShortStart && currentYear > lastShortPeriodYear) {
        appData.stats.lastShortPeriodYear = currentYear;
        
        if (appData.settings.shortVacationStart) {
            const lastShortDate = parseLocalDate(appData.settings.shortVacationStart);
            if (lastShortDate) {
                const daysSinceLastShort = Math.floor((today - lastShortDate) / (1000 * 60 * 60 * 24));
                if (daysSinceLastShort >= appData.settings.shortVacationCooldown) {
                    appData.stats.shortBalance = appData.settings.shortVacationDays;
                    appData.settings.shortVacationStart = null;
                    showToast('تم تجديد رصيد الإجازة القصيرة لفترة جديدة', 'success', 5000);
                }
            }
        }
    }
    
    saveData();
    
    // Update stats after period renewal
    if (window.Worker) {
        updateStatsWithWorker();
    } else {
        updateStats();
    }
}

// ============================
// إدارة الأحداث - محسنة
// ============================

// Store references to event listeners to prevent duplicates
const eventListeners = new Map();

// WeakMaps to store handlers for different types of events
const tabHandlers = new WeakMap();
const userTypeHandlers = new WeakMap();
const formChangeHandlers = new WeakMap();
const buttonHandlers = new WeakMap();
const modalHandlers = new WeakMap();

function removeEventListenerIfExists(element, event, handler) {
    if (!element || !handler) return;
    
    const key = `${element.tagName}_${element.id || element.className || 'unknown'}_${event}`;
    
    // Remove existing listener if it exists
    if (eventListeners.has(key)) {
        const existingHandler = eventListeners.get(key);
        element.removeEventListener(event, existingHandler);
        eventListeners.delete(key);
    }
    
    // Add the new listener
    element.addEventListener(event, handler);
    eventListeners.set(key, handler);
}

function removeAllEventListeners() {
    eventListeners.forEach((handler, key) => {
        // Extract element info from key
        const parts = key.split('_');
        if (parts.length >= 3) {
            const tagName = parts[0];
            const idOrClass = parts[1];
            const eventType = parts[2];
            
            // Try to find the element by ID first, then by class
            let element;
            if (idOrClass !== 'unknown') {
                element = document.getElementById(idOrClass) || document.querySelector(`.${idOrClass}`);
            }
            
            if (element && handler) {
                element.removeEventListener(eventType, handler);
            }
        }
    });
    eventListeners.clear();
}

// Event delegation approach for dynamic content
function setupEventDelegation() {
    // Tab navigation delegation
    document.addEventListener('click', function(e) {
        const tabButton = e.target.closest('[data-tab]');
        if (tabButton) {
            const tabId = tabButton.dataset.tab;
            showTab(tabId);
        }
    });
    
    // Vacation type selection delegation
    document.addEventListener('click', function(e) {
        const vacationTypeBtn = e.target.closest('[data-vacation-type]');
        if (vacationTypeBtn) {
            const type = vacationTypeBtn.dataset.vacationType;
            selectVacationType(type);
        }
    });
    
    // Vacation card action delegation
    document.addEventListener('click', function(e) {
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            const id = actionBtn.dataset.id;
            
            if (action === 'edit') {
                editVacation(id);
            } else if (action === 'delete') {
                deleteVacation(id);
            } else if (action === 'share') {
                const vacation = appData.vacations.find(v => v.id === id);
                if (vacation) {
                    shareVacation(vacation);
                }
            }
        }
    });
    
    // Settings modal close delegation
    document.addEventListener('click', function(e) {
        if (e.target.matches('#closeSettings, #closeInstallPrompt, #installOverlay, .install-overlay')) {
            hideSettingsModal();
            hideInstallPrompt();
        }
    });
    
    // Filter change delegation
    document.addEventListener('change', function(e) {
        if (e.target.matches('#filterType, #filterYear')) {
            updateVacationsList();
        }
    });
}

function setupEventListeners() {
    // Remove any existing listeners to prevent duplicates
    removeAllEventListeners();
    
    // Set up event delegation for dynamically created elements
    setupEventDelegation();
    
    // Settings Modal
    removeEventListenerIfExists(document.getElementById('settingsBtn'), 'click', showSettingsModal);
    removeEventListenerIfExists(document.getElementById('closeSettings'), 'click', hideSettingsModal);
    
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
        let handler = modalHandlers.get(settingsModal);
        if (!handler) {
            handler = function (e) {
                if (e.target === this) {
                    hideSettingsModal();
                }
            };
            modalHandlers.set(settingsModal, handler);
        }
        settingsModal.removeEventListener('click', handler);
        settingsModal.addEventListener('click', handler);
    }

    // User Type Selection
    document.querySelectorAll('[data-user-type]').forEach(card => {
        let handler = userTypeHandlers.get(card);
        if (!handler) {
            handler = () => {
                const userType = card.dataset.userType;
                if (canSwitchUserType(userType)) {
                    selectUserType(userType);
                }
            };
            userTypeHandlers.set(card, handler);
        }
        card.removeEventListener('click', handler);
        card.addEventListener('click', handler);
    });

    // Auto-save settings on change
    removeEventListenerIfExists(document.getElementById('shortVacationDays'), 'change', autoSaveSettings);
    removeEventListenerIfExists(document.getElementById('shortVacationCooldown'), 'change', autoSaveSettings);
    
    const shortVacationStart = document.getElementById('shortVacationStart');
    if (shortVacationStart) {
        let handler = formChangeHandlers.get(shortVacationStart);
        if (!handler) {
            handler = function () {
                autoSaveSettings();
                updateCountdown();
            };
            formChangeHandlers.set(shortVacationStart, handler);
        }
        shortVacationStart.removeEventListener('change', handler);
        shortVacationStart.addEventListener('change', handler);
    }

    // Auto-save notification settings on change
    removeEventListenerIfExists(document.getElementById('notificationsToggle'), 'change', autoSaveSettings);
    removeEventListenerIfExists(document.getElementById('notificationBeforeStart'), 'change', autoSaveSettings);
    removeEventListenerIfExists(document.getElementById('notificationBeforeEnd'), 'change', autoSaveSettings);
    removeEventListenerIfExists(document.getElementById('notificationOnEnd'), 'change', autoSaveSettings);
    removeEventListenerIfExists(document.getElementById('notificationShortBalance'), 'change', autoSaveSettings);

    // Settings Controls
    removeEventListenerIfExists(document.getElementById('resetBtn'), 'click', confirmResetData);
    removeEventListenerIfExists(document.getElementById('exportBtn'), 'click', exportData);
    
    const importBtn = document.getElementById('importBtn');
    if (importBtn) {
        let handler = buttonHandlers.get(importBtn);
        if (!handler) {
            handler = () => {
                document.getElementById('importFile').click();
            };
            buttonHandlers.set(importBtn, handler);
        }
        importBtn.removeEventListener('click', handler);
        importBtn.addEventListener('click', handler);
    }
    
    removeEventListenerIfExists(document.getElementById('importFile'), 'change', handleImportFile);

    // Confirm Modal Listeners
    setupConfirmModalListeners();

    // Header Buttons
    removeEventListenerIfExists(document.getElementById('notificationBtn'), 'click', toggleNotifications);
    removeEventListenerIfExists(document.getElementById('refreshBtn'), 'click', refreshApp);

    // Install Prompt
    removeEventListenerIfExists(document.getElementById('installAppBtn'), 'click', installApp);
    removeEventListenerIfExists(document.getElementById('installLaterBtn'), 'click', hideInstallPrompt);
    removeEventListenerIfExists(document.getElementById('closeInstallPrompt'), 'click', hideInstallPrompt);
    removeEventListenerIfExists(document.getElementById('installOverlay'), 'click', hideInstallPrompt);

    // Form Submission
    const vacationForm = document.getElementById('vacationForm');
    if (vacationForm) {
        removeEventListenerIfExists(vacationForm, 'submit', handleVacationFormSubmit);
    }

    // Filter Controls
    removeEventListenerIfExists(document.getElementById('filterType'), 'change', updateVacationsList);
    removeEventListenerIfExists(document.getElementById('filterYear'), 'change', updateVacationsList);

    // Permission Button - محدثة
    const requestPermissionBtn = document.getElementById('requestPermissionBtn');
    if (requestPermissionBtn) {
        let handler = buttonHandlers.get(requestPermissionBtn);
        if (!handler) {
            handler = () => {
                requestNotificationPermissions(true);
                // إعادة تحميل الإعدادات لتحديث حالة الإذن
                setTimeout(() => {
                    updatePermissionStatus();
                }, 1000);
            };
            buttonHandlers.set(requestPermissionBtn, handler);
        }
        requestPermissionBtn.removeEventListener('click', handler);
        requestPermissionBtn.addEventListener('click', handler);
    }

    // Keyboard Navigation
    let keydownHandler = formChangeHandlers.get(document);
    if (!keydownHandler) {
        keydownHandler = function (e) {
            if (e.key === 'Escape') {
                hideSettingsModal();
                hideInstallPrompt();
                hideLoadingSpinner();
            }
        };
        formChangeHandlers.set(document, keydownHandler);
    }
    document.removeEventListener('keydown', keydownHandler);
    document.addEventListener('keydown', keydownHandler);

    // Online/Offline Detection
    removeEventListenerIfExists(window, 'online', handleOnlineStatus);
    removeEventListenerIfExists(window, 'offline', handleOfflineStatus);
    
    // Add cleanup for memory leaks
    window.addEventListener('beforeunload', cleanupEventListeners);
}

// Cleanup function to clear WeakMaps and prevent memory leaks
function cleanupEventListeners() {
    tabHandlers.clear();
    userTypeHandlers.clear();
    formChangeHandlers.clear();
    buttonHandlers.clear();
    modalHandlers.clear();
    
    // Clear event listeners map as well
    eventListeners.clear();
}

function setupConfirmModalListeners() {
    const confirmBtn = document.getElementById('confirmBtn');
    if (confirmBtn) {
        const handler = () => {
            if (confirmCallback) confirmCallback();
            hideConfirmModal();
        };
        removeEventListenerIfExists(confirmBtn, 'click', handler);
    }

    const cancelBtn = document.getElementById('cancelConfirmBtn');
    if (cancelBtn) {
        removeEventListenerIfExists(cancelBtn, 'click', hideConfirmModal);
    }

    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal) {
        const handler = function (e) {
            if (e.target === this) hideConfirmModal();
        };
        removeEventListenerIfExists(confirmModal, 'click', handler);
    }
}

// ============================
// إعدادات PWA
// ============================
function setupPWA() {
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
        // Register the main service worker which includes notification functionality
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('Service Worker registered:', registration);
                
                // Check if background sync is supported
                if ('sync' in registration) {
                    console.log('Background Sync is supported');
                } else {
                    console.log('Background Sync is not supported in this browser');
                }
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;

        setTimeout(() => {
            if (!installPromptShown && !isAppInstalled()) {
                showInstallPrompt();
            }
        }, 3000);
    });

    window.addEventListener('appinstalled', () => {
        console.log('App installed successfully');
        hideInstallPrompt();
        deferredPrompt = null;
        installPromptShown = true;
        showToast('تم تثبيت التطبيق بنجاح!', 'success');
    });
}

function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
}

function showInstallPrompt() {
    const overlay = document.getElementById('installOverlay');
    const prompt = document.getElementById('installPrompt');

    if (overlay && prompt) {
        overlay.classList.add('show');
        prompt.classList.add('show');
    }
}

function hideInstallPrompt() {
    const overlay = document.getElementById('installOverlay');
    const prompt = document.getElementById('installPrompt');

    if (overlay && prompt) {
        overlay.classList.remove('show');
        prompt.classList.remove('show');
    }
}

async function installApp() {
    if (!deferredPrompt) {
        showToast('التثبيت غير متاح حالياً', 'error');
        return;
    }

    try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            console.log('User accepted install');
        } else {
            console.log('User dismissed install');
        }

        deferredPrompt = null;
        hideInstallPrompt();
    } catch (error) {
        console.error('Install error:', error);
        showToast('حدث خطأ أثناء التثبيت', 'error');
    }
}

// ============================
// إدارة الإجازات
// ============================
function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;

    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    confirmCallback = onConfirm;
    modal.classList.add('show');
}

function hideConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;

    modal.classList.remove('show');
    confirmCallback = null;
}

function canSwitchUserType(targetType) {
    if (targetType === appData.userType) return true;

    const hasContinuousVacations = appData.vacations.some(v => ['short', 'annual'].includes(v.type));
    const hasSplitVacations = appData.vacations.some(v => v.type === 'split');

    if (targetType === 'split' && hasContinuousVacations) {
        showToast('لا يمكن التحويل لنظام العطلة المقسمة لوجود إجازات قصيرة أو سنوية مسجلة. قم بحذفها أولاً.', 'error');
        return false;
    }

    if (targetType === 'continuous' && hasSplitVacations) {
        showToast('لا يمكن التحويل لنظام العطلة المستمرة لوجود إجازات مقسمة مسجلة. قم بحذفها أولاً.', 'error');
        return false;
    }

    return true;
}

function selectUserType(userType) {
    appData.userType = userType;

    document.querySelectorAll('[data-user-type]').forEach(card => {
        card.classList.toggle('selected', card.dataset.userType === userType);
    });

    const continuousSettings = document.getElementById('continuousSettings');
    const splitSettings = document.getElementById('splitSettings');

    if (userType === 'continuous') {
        continuousSettings?.classList.remove('hidden');
        splitSettings?.classList.add('hidden');
    } else {
        continuousSettings?.classList.add('hidden');
        splitSettings?.classList.remove('hidden');
    }

    updateUserTypeUI();
    autoSaveSettings();
}

function updateUserTypeUI() {
    updateVacationTypesUI();
    updateFilterOptions();
    updateStatsCards();

    document.querySelectorAll('[data-user-type]').forEach(card => {
        card.classList.toggle('selected', card.dataset.userType === appData.userType);
    });

    const continuousSettings = document.getElementById('continuousSettings');
    const splitSettings = document.getElementById('splitSettings');

    if (appData.userType === 'continuous') {
        continuousSettings?.classList.remove('hidden');
        splitSettings?.classList.add('hidden');
    } else {
        continuousSettings?.classList.add('hidden');
        splitSettings?.classList.remove('hidden');
    }
}

function updateVacationTypesUI() {
    const container = document.getElementById('vacationTypesContainer');
    if (!container) return;

    let typesHTML = '';

    if (appData.userType === 'continuous') {
        typesHTML = `
            <button 
                type="button"
                data-vacation-type="short"
                class="vacation-type-btn bg-blue-50 border-2 border-blue-200 text-blue-700 py-3 rounded-lg hover:bg-blue-100 transition-colors flex flex-col items-center justify-center"
            >
                <i class="fas fa-bolt text-xl mb-1"></i>
                <span class="font-medium">إجازة قصيرة</span>
                <span class="text-xs mt-1">${appData.settings.shortVacationDays} أيام كل ${appData.settings.shortVacationCooldown} يوم</span>
            </button>
            
            <button 
                type="button"
                data-vacation-type="annual"
                class="vacation-type-btn bg-green-50 border-2 border-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-100 transition-colors flex flex-col items-center justify-center"
            >
                <i class="fas fa-sun text-xl mb-1"></i>
                <span class="font-medium">عطلة سنوية</span>
                <span class="text-xs mt-1">30 يوم مستمرة</span>
            </button>
            
            <button 
                type="button"
                data-vacation-type="private"
                class="vacation-type-btn bg-yellow-50 border-2 border-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-100 transition-colors flex flex-col items-center justify-center"
            >
                <i class="fas fa-user text-xl mb-1"></i>
                <span class="font-medium">إجازة خاصة</span>
                <span class="text-xs mt-1">غير محدودة</span>
            </button>
        `;
    } else {
        typesHTML = `
            <button 
                type="button"
                data-vacation-type="split"
                class="vacation-type-btn bg-purple-50 border-2 border-purple-200 text-purple-700 py-3 rounded-lg hover:bg-purple-100 transition-colors flex flex-col items-center justify-center"
            >
                <i class="fas fa-puzzle-piece text-xl mb-1"></i>
                <span class="font-medium">عطلة مقسمة</span>
                <span class="text-xs mt-1">30 يوم قابلة للتقسيم</span>
            </button>
            
            <button 
                type="button"
                data-vacation-type="private"
                class="vacation-type-btn bg-yellow-50 border-2 border-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-100 transition-colors flex flex-col items-center justify-center"
            >
                <i class="fas fa-user text-xl mb-1"></i>
                <span class="font-medium">إجازة خاصة</span>
                <span class="text-xs mt-1">غير محدودة</span>
            </button>
        `;
    }

    container.innerHTML = typesHTML;

    container.querySelectorAll('[data-vacation-type]').forEach(button => {
        button.addEventListener('click', () => {
            const type = button.dataset.vacationType;
            selectVacationType(type);
        });
    });
}

function updateFilterOptions() {
    const filterType = document.getElementById('filterType');
    if (!filterType) return;

    let optionsHTML = '<option value="all">كل الأنواع</option>';

    if (appData.userType === 'continuous') {
        optionsHTML += `
            <option value="short">إجازة قصيرة</option>
            <option value="annual">عطلة سنوية</option>
            <option value="private">إجازة خاصة</option>
        `;
    } else {
        optionsHTML += `
            <option value="split">عطلة مقسمة</option>
            <option value="private">إجازة خاصة</option>
        `;
    }

    filterType.innerHTML = optionsHTML;
}

function updateStatsCards() {
    const statsContainer = document.querySelector('#dashboard .grid');
    if (!statsContainer) return;

    let statsHTML = '';

    if (appData.userType === 'continuous') {
        statsHTML = `
            <article class="bg-white rounded-xl shadow-lg p-6 text-center">
                <div class="text-blue-600 mb-4">
                    <i class="fas fa-bolt text-3xl"></i>
                </div>
                <h3 class="text-lg font-bold text-gray-800 mb-2">إجازة قصيرة</h3>
                <p id="shortBalance" class="text-3xl font-bold text-blue-600">${appData.stats.shortBalance}</p>
                <p class="text-gray-500">يوم متاح (هذه الفترة)</p>
            </article>
            
            <article class="bg-white rounded-xl shadow-lg p-6 text-center">
                <div class="text-green-600 mb-4">
                    <i class="fas fa-sun text-3xl"></i>
                </div>
                <h3 class="text-lg font-bold text-gray-800 mb-2">عطلة سنوية</h3>
                <p id="annualBalance" class="text-3xl font-bold text-green-600">${appData.stats.annualBalance}</p>
                <p class="text-gray-500">يوم متاح (هذه الفترة)</p>
            </article>
            
            <article class="bg-white rounded-xl shadow-lg p-6 text-center">
                <div class="text-yellow-600 mb-4">
                    <i class="fas fa-user text-3xl"></i>
                </div>
                <h3 class="text-lg font-bold text-gray-800 mb-2">إجازات خاصة</h3>
                <p id="privateCount" class="text-3xl font-bold text-yellow-600">0</p>
                <p class="text-gray-500">إجازة هذا العام</p>
            </article>
        `;
    } else {
        statsHTML = `
            <article class="bg-white rounded-xl shadow-lg p-6 text-center">
                <div class="text-purple-600 mb-4">
                    <i class="fas fa-puzzle-piece text-3xl"></i>
                </div>
                <h3 class="text-lg font-bold text-gray-800 mb-2">عطلة مقسمة</h3>
                <p id="splitBalance" class="text-3xl font-bold text-purple-600">${appData.stats.splitBalance}</p>
                <p class="text-gray-500">يوم متاح (إجمالي)</p>
            </article>
            
            <article class="bg-white rounded-xl shadow-lg p-6 text-center">
                <div class="text-yellow-600 mb-4">
                    <i class="fas fa-user text-3xl"></i>
                </div>
                <h3 class="text-lg font-bold text-gray-800 mb-2">إجازات خاصة</h3>
                <p id="privateCount" class="text-3xl font-bold text-yellow-600">0</p>
                <p class="text-gray-500">إجازة هذا العام</p>
            </article>
        `;
    }

    statsHTML += `
        <article class="bg-white rounded-xl shadow-lg p-6 text-center">
            <div class="text-purple-600 mb-4">
                <i class="fas fa-chart-bar text-3xl"></i>
            </div>
            <h3 class="text-lg font-bold text-gray-800 mb-2">الإجازات المستخدمة</h3>
            <p id="totalUsed" class="text-3xl font-bold text-purple-600">${appData.stats.totalUsed}</p>
            <p class="text-gray-500">يوم هذا العام</p>
        </article>
        

    `;

    statsContainer.innerHTML = statsHTML;
}

// ============================
// إدارة التبويبات
// ============================
function showTab(tabId) {
    document.querySelectorAll('[data-tab]').forEach(button => {
        const isActive = button.dataset.tab === tabId;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });

    const url = new URL(window.location);
    url.searchParams.set('tab', tabId);
    window.history.replaceState({}, '', url);

    if (tabId === 'dashboard') {
        updateRecentVacations();
    }
}

function checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab');

    if (tab && ['dashboard', 'add', 'list'].includes(tab)) {
        showTab(tab);
    }
}

// ============================
// معالجة الإجازات
// ============================
function selectVacationType(type) {
    document.getElementById('noTypeSelected').style.display = 'none';
    document.getElementById('commonFields').classList.remove('hidden');

    document.querySelectorAll('[data-vacation-type]').forEach(btn => {
        const isActive = btn.dataset.vacationType === type;
        const colorMap = {
            short: ['blue', 'border-blue-200', 'text-blue-700', 'bg-blue-50'],
            annual: ['green', 'border-green-200', 'text-green-700', 'bg-green-50'],
            split: ['purple', 'border-purple-200', 'text-purple-700', 'bg-purple-50'],
            private: ['yellow', 'border-yellow-200', 'text-yellow-700', 'bg-yellow-50']
        };

        const colors = colorMap[type] || ['gray', 'border-gray-200', 'text-gray-700', 'bg-gray-50'];

        if (isActive) {
            btn.classList.add(...colors.slice(1));
            btn.classList.remove('border-gray-200', 'text-gray-700', 'bg-gray-50');
        } else {
            btn.classList.remove(...colors.slice(1));
            btn.classList.add('border-gray-200', 'text-gray-700', 'bg-gray-50');
        }
    });

    const container = document.getElementById('formFieldsContainer');
    container.innerHTML = getVacationFormFields(type);

    document.getElementById('vacationType').value = type;

    resetFormFields();
    setupDateFieldListeners();
    updateVacationStatusOptions();
}

function updateVacationStatusOptions() {
    const statusSelect = document.getElementById('vacationStatus');
    if (!statusSelect) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const hasActiveVacation = appData.vacations.some(v => {
        if (v.status === 'current') return true;
        const start = new Date(v.startDate);
        const end = new Date(v.endDate);
        return today >= start && today <= end;
    });

    let options = `
        <option value="upcoming">قادمة</option>
        ${!hasActiveVacation ? '<option value="current">حالية</option>' : ''}
        <option value="completed">منتهية</option>
    `;

    statusSelect.innerHTML = options;
}

function getVacationFormFields(type) {
    const today = new Date();
    const annualPeriod = appData.settings.annualVacationPeriod;
    const shortPeriod = appData.settings.shortVacationPeriod;
    
    const currentYear = today.getFullYear();
    let annualPeriodStart, annualPeriodEnd;
    let shortPeriodStart, shortPeriodEnd;
    
    const currentAnnualStart = new Date(currentYear, annualPeriod.startMonth - 1, annualPeriod.startDay);
    if (today < currentAnnualStart) {
        annualPeriodStart = new Date(currentYear - 1, annualPeriod.startMonth - 1, annualPeriod.startDay);
        annualPeriodEnd = new Date(currentYear, annualPeriod.endMonth - 1, annualPeriod.endDay);
    } else {
        annualPeriodStart = currentAnnualStart;
        annualPeriodEnd = new Date(currentYear, annualPeriod.endMonth - 1, annualPeriod.endDay);
    }
    
    const currentShortStart = new Date(currentYear, shortPeriod.startMonth - 1, shortPeriod.startDay);
    if (today < currentShortStart) {
        shortPeriodStart = new Date(currentYear - 1, shortPeriod.startMonth - 1, shortPeriod.startDay);
        shortPeriodEnd = new Date(currentYear, shortPeriod.endMonth - 1, shortPeriod.endDay);
    } else {
        shortPeriodStart = currentShortStart;
        shortPeriodEnd = new Date(currentYear + 1, shortPeriod.endMonth - 1, shortPeriod.endDay);
    }
    
    const templates = {
        short: `
            <div id="shortVacationFields" class="vacation-fields">
                <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <div class="flex items-center mb-2">
                        <i class="fas fa-info-circle text-blue-600 ml-2"></i>
                        <h3 class="font-medium text-blue-800">معلومات الإجازة القصيرة</h3>
                    </div>
                    <p class="text-blue-700 text-sm">
                        <strong>الفترة الحالية:</strong> من ${formatDate(shortPeriodStart)} إلى ${formatDate(shortPeriodEnd)}<br>
                        <strong>المدة:</strong> ${appData.settings.shortVacationDays} أيام كل ${appData.settings.shortVacationCooldown} يوم<br>
                        <strong>الرصيد المتاح:</strong> ${appData.stats.shortBalance} يوم
                    </p>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label for="shortStartDate" class="block text-sm font-medium text-gray-700 mb-2">
                            تاريخ البدء *
                        </label>
                        <input type="date" id="shortStartDate" name="shortStartDate" class="form-input" required>
                        <p class="text-xs text-gray-500 mt-1">يجب أن يكون بين ${formatDate(shortPeriodStart)} و ${formatDate(shortPeriodEnd)}</p>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            تاريخ الانتهاء (تلقائي)
                        </label>
                        <div class="p-3 bg-gray-50 border border-gray-300 rounded-lg">
                            <span id="shortEndDate" class="text-gray-800">سيتم حسابها تلقائياً</span>
                        </div>
                    </div>
                </div>
            </div>
        `,
        annual: `
            <div id="annualVacationFields" class="vacation-fields">
                <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <div class="flex items-center mb-2">
                        <i class="fas fa-info-circle text-green-600 ml-2"></i>
                        <h3 class="font-medium text-green-800">معلومات العطلة السنوية</h3>
                    </div>
                    <p class="text-green-700 text-sm">
                        <strong>الفترة الحالية:</strong> من ${formatDate(annualPeriodStart)} إلى ${formatDate(annualPeriodEnd)}<br>
                        <strong>المدة:</strong> 30 يوم مستمرة<br>
                        <strong>الرصيد المتاح:</strong> ${appData.stats.annualBalance} يوم
                    </p>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label for="annualStartDate" class="block text-sm font-medium text-gray-700 mb-2">
                            تاريخ البدء *
                        </label>
                        <input type="date" id="annualStartDate" name="annualStartDate" class="form-input" required>
                        <p class="text-xs text-gray-500 mt-1">يجب أن يكون بين ${formatDate(annualPeriodStart)} و ${formatDate(annualPeriodEnd)}</p>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            تاريخ الانتهاء (تلقائي)
                        </label>
                        <div class="p-3 bg-gray-50 border border-gray-300 rounded-lg">
                            <span id="annualEndDate" class="text-gray-800">سيتم حسابها تلقائياً (+29 يوم)</span>
                        </div>
                    </div>
                </div>
            </div>
        `,
        split: `
            <div id="splitVacationFields" class="vacation-fields">
                <div class="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
                    <div class="flex items-center mb-2">
                        <i class="fas fa-info-circle text-purple-600 ml-2"></i>
                        <h3 class="font-medium text-purple-800">معلومات العطلة المقسمة</h3>
                    </div>
                    <p class="text-purple-700 text-sm">
                        العطلة المقسمة: 30 يوم قابلة للتقسيم، متاحة من يونيو إلى مايو السنة القادمة.
                        <strong>الرصيد المتاح:</strong> ${appData.stats.splitBalance} يوم
                    </p>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                    <div>
                        <label for="splitStartDate" class="block text-sm font-medium text-gray-700 mb-2">
                            تاريخ البدء *
                        </label>
                        <input type="date" id="splitStartDate" name="splitStartDate" class="form-input" required>
                        <p class="text-xs text-gray-500 mt-1">انقر داخل الحقل لفتح التقويم</p>
                    </div>
                    
                    <div>
                        <label for="splitDays" class="block text-sm font-medium text-gray-700 mb-2">
                            عدد الأيام (باقي: <span id="remainingSplitDays">${appData.stats.splitBalance}</span> يوم) *
                        </label>
                        <input type="number" id="splitDays" name="splitDays" min="1" max="${appData.stats.splitBalance}" value="1" class="form-input" required>
                    </div>
                </div>
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        تاريخ الانتهاء (تلقائي)
                    </label>
                    <div class="p-3 bg-gray-50 border border-gray-300 rounded-lg">
                        <span id="splitEndDate" class="text-gray-800">سيتم حسابها تلقائياً بناءً على عدد الأيام</span>
                    </div>
                </div>
            </div>
        `,
        private: `
            <div id="privateVacationFields" class="vacation-fields">
                <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <div class="flex items-center mb-2">
                        <i class="fas fa-info-circle text-yellow-600 ml-2"></i>
                        <h3 class="font-medium text-yellow-800">معلومات الإجازة الخاصة</h3>
                    </div>
                    <p class="text-yellow-700 text-sm">
                        الإجازة الخاصة: غير محدودة ولا تدخل في حساب الإجازات الأخرى.
                    </p>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                    <div>
                        <label for="privateStartDate" class="block text-sm font-medium text-gray-700 mb-2">
                            تاريخ البدء *
                        </label>
                        <input type="date" id="privateStartDate" name="privateStartDate" class="form-input" required>
                        <p class="text-xs text-gray-500 mt-1">انقر داخل الحقل لفتح التقويم</p>
                    </div>
                    
                    <div>
                        <label for="privateEndDate" class="block text-sm font-medium text-gray-700 mb-2">
                            تاريخ الانتهاء *
                        </label>
                        <input type="date" id="privateEndDate" name="privateEndDate" class="form-input" required>
                        <p class="text-xs text-gray-500 mt-1">انقر داخل الحقل لفتح التقويم</p>
                    </div>
                </div>
                
                <div>
                    <label for="reason" class="block text-sm font-medium text-gray-700 mb-2">
                        سبب الإجازة الخاصة (اختياري)
                    </label>
                    <input type="text" id="reason" name="reason" placeholder="أدخل سبب الإجازة" class="form-input">
                </div>
            </div>
        `
    };

    return templates[type] || '';
}

function handleVacationFormSubmit(e) {
    e.preventDefault();

    const type = document.getElementById('vacationType').value;
    if (!type) {
        showToast('الرجاء اختيار نوع الإجازة أولاً', 'error');
        return;
    }

    showLoadingSpinner();

    try {
        const vacationData = collectVacationData(type);

        const isEditing = !!editingId;
        if (isEditing) {
            vacationData.id = editingId;
        }

        if (validateVacationData(vacationData)) {
            if (isEditing) {
                const oldVacation = appData.vacations.find(v => v.id === editingId);
                if (oldVacation) {
                    revertVacationImpact(oldVacation);
                    appData.vacations = appData.vacations.filter(v => v.id !== editingId);
                }
            }

            addVacation(vacationData);

            resetVacationForm();
            editingId = null;
            const submitBtn = document.querySelector('#vacationForm button[type="submit"]');
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-plus-circle ml-2"></i>إضافة إجازة';
            }

            showTab('dashboard');
            showToast(isEditing ? 'تم تحديث الإجازة بنجاح!' : 'تم إضافة الإجازة بنجاح!', 'success');
        }
    } catch (error) {
        console.error('Form submission error:', error);
        showToast('حدث خطأ أثناء حفظ الإجازة', 'error');
    } finally {
        hideLoadingSpinner();
    }
}

function collectVacationData(type) {
    const isEditing = !!editingId;
    let originalStatus = 'upcoming';
    
    if (isEditing) {
        const existingVacation = appData.vacations.find(v => v.id === editingId);
        if (existingVacation) {
            originalStatus = existingVacation.status;
        }
    }
    
    const data = {
        id: isEditing ? editingId : generateId(),
        type: type,
        status: originalStatus,
        createdAt: isEditing ? appData.vacations.find(v => v.id === editingId)?.createdAt || new Date().toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        notes: document.getElementById('notes')?.value || ''
    };

    switch (type) {
        case 'short':
            data.startDate = document.getElementById('shortStartDate').value;
            const shortStartDate = new Date(data.startDate);
            const shortEndDateObj = new Date(shortStartDate);
            shortEndDateObj.setDate(shortStartDate.getDate() + appData.settings.shortVacationDays - 1);
            data.endDate = shortEndDateObj.toISOString().split('T')[0];
            data.days = appData.settings.shortVacationDays;
            break;

        case 'annual':
            data.startDate = document.getElementById('annualStartDate').value;
            const annualStartDate = new Date(data.startDate);
            const annualEndDateObj = new Date(annualStartDate);
            annualEndDateObj.setDate(annualStartDate.getDate() + 29);
            data.endDate = annualEndDateObj.toISOString().split('T')[0];
            data.days = 30;
            break;

        case 'split':
            data.startDate = document.getElementById('splitStartDate').value;
            const splitDays = parseInt(document.getElementById('splitDays').value);
            const splitStartDate = new Date(data.startDate);
            const splitEndDateObj = new Date(splitStartDate);
            splitEndDateObj.setDate(splitStartDate.getDate() + splitDays - 1);
            data.endDate = splitEndDateObj.toISOString().split('T')[0];
            data.days = splitDays;
            data.splitDays = data.days;
            break;

        case 'private':
            data.startDate = document.getElementById('privateStartDate').value;
            data.endDate = document.getElementById('privateEndDate').value;
            data.reason = document.getElementById('reason')?.value || '';
            data.days = calculateDaysBetween(data.startDate, data.endDate);
            break;
    }

    return data;
}

function validateVacationData(data) {
    if (!data.startDate || !data.endDate) {
        showToast('الرجاء إدخال جميع البيانات المطلوبة', 'error');
        return false;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(data.startDate) || !dateRegex.test(data.endDate)) {
        showToast('تنسيق التاريخ غير صحيح. الرجاء استخدام التقويم لتحديد التاريخ', 'error');
        return false;
    }

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        showToast('التاريخ المدخل غير صحيح. الرجاء استخدام التقويم لتحديد تاريخ صحيح', 'error');
        return false;
    }

    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const fiveYearsFuture = new Date(now.getFullYear() + 5, now.getMonth(), now.getDate());

    if (start < oneYearAgo || start > fiveYearsFuture || end < oneYearAgo || end > fiveYearsFuture) {
        showToast('التاريخ المدخل غير معقول. الرجاء إدخال تاريخ خلال السنة الماضية أو الخمس سنوات القادمة', 'error');
        return false;
    }

    if (start > end) {
        showToast('تاريخ البدء يجب أن يكون قبل تاريخ الانتهاء', 'error');
        return false;
    }

    return validateVacationRules(data.type, start, end, data.days);
}

function validateVacationRules(type, startDate, endDate, days) {
    const rules = APP_CONFIG.VACATION_RULES[type];
    if (!rules) {
        if (type === 'private') return true;
        return true;
    }

    const hasOverlap = appData.vacations.some(vacation => {
        if (editingId && vacation.id === editingId) return false;

        const vStart = new Date(vacation.startDate);
        const vEnd = new Date(vacation.endDate);

        const overlaps = (startDate <= vEnd && endDate >= vStart);
        return overlaps;
    });

    if (hasOverlap) {
        showToast('لا يمكن إضافة إجازة في فترة تتداخل مع إجازة أخرى موجودة', 'error');
        return false;
    }

    const status = document.getElementById('vacationStatus')?.value || 'upcoming';
    if (status === 'upcoming') {
        if (type === 'annual') {
            const annualPeriod = appData.settings.annualVacationPeriod;
            const year = startDate.getFullYear();
            
            let periodStart, periodEnd;
            const currentPeriodStart = new Date(year, annualPeriod.startMonth - 1, annualPeriod.startDay);
            if (startDate < currentPeriodStart) {
                periodStart = new Date(year - 1, annualPeriod.startMonth - 1, annualPeriod.startDay);
                periodEnd = new Date(year, annualPeriod.endMonth - 1, annualPeriod.endDay);
            } else {
                periodStart = currentPeriodStart;
                periodEnd = new Date(year, annualPeriod.endMonth - 1, annualPeriod.endDay);
            }
            
            if (startDate < periodStart || endDate > periodEnd) {
                showToast(`العطلة السنوية مسموحة فقط من ${formatDate(periodStart)} إلى ${formatDate(periodEnd)}`, 'error');
                return false;
            }
        }
        
        if (type === 'short') {
            const shortPeriod = appData.settings.shortVacationPeriod;
            const year = startDate.getFullYear();
            
            let periodStart, periodEnd;
            const currentPeriodStart = new Date(year, shortPeriod.startMonth - 1, shortPeriod.startDay);
            if (startDate < currentPeriodStart) {
                periodStart = new Date(year - 1, shortPeriod.startMonth - 1, shortPeriod.startDay);
                periodEnd = new Date(year, shortPeriod.endMonth - 1, shortPeriod.endDay);
            } else {
                periodStart = currentPeriodStart;
                periodEnd = new Date(year + 1, shortPeriod.endMonth - 1, shortPeriod.endDay);
            }
            
            if (startDate < periodStart || endDate > periodEnd) {
                showToast(`الإجازة القصيرة مسموحة فقط من ${formatDate(periodStart)} إلى ${formatDate(periodEnd)}`, 'error');
                return false;
            }
        }
    }

    if (type === 'short') {
        const shortPeriod = appData.settings.shortVacationPeriod;
        const year = startDate.getFullYear();
        
        let periodStart, periodEnd;
        const currentPeriodStart = new Date(year, shortPeriod.startMonth - 1, shortPeriod.startDay);
        if (startDate < currentPeriodStart) {
            periodStart = new Date(year - 1, shortPeriod.startMonth - 1, shortPeriod.startDay);
            periodEnd = new Date(year, shortPeriod.endMonth - 1, shortPeriod.endDay);
        } else {
            periodStart = currentPeriodStart;
            periodEnd = new Date(year + 1, shortPeriod.endMonth - 1, shortPeriod.endDay);
        }
        
        if (startDate < periodStart || endDate > periodEnd) {
            showToast(`الإجازة القصيرة متاحة فقط من ${formatDate(periodStart)} إلى ${formatDate(periodEnd)}`, 'error');
            return false;
        }
    }

    if (type === 'short' && appData.stats.shortBalance < days) {
        showToast('ليس لديك رصيد كافٍ من الإجازة القصيرة', 'error');
        return false;
    }

    if (type === 'annual' && appData.stats.annualBalance < days) {
        showToast('ليس لديك رصيد كافٍ من العطلة السنوية', 'error');
        return false;
    }

    if (type === 'split' && appData.stats.splitBalance < days) {
        showToast(`ليس لديك رصيد كافٍ من العطلة المقسمة. باقي ${appData.stats.splitBalance} يوم`, 'error');
        return false;
    }

    if (type === 'split') {
        const hasOverlap = appData.vacations.some(vacation => {
            if (editingId && vacation.id === editingId) return false;
            if (vacation.type !== 'split') return false;

            const vStart = new Date(vacation.startDate);
            const vEnd = new Date(vacation.endDate);

            return (startDate <= vEnd && endDate >= vStart);
        });

        if (hasOverlap) {
            showToast('لا يمكن تداخل تواريخ العطلة المقسمة مع إجازة مقسمة أخرى', 'error');
            return false;
        }
    }

    return true;
}

function revertVacationImpact(vacation) {
    const days = Number(vacation.days) || 0;
    switch (vacation.type) {
        case 'short':
            break;
        case 'annual':
            break;
        case 'split':
            appData.stats.splitBalance += days;
            if (appData.stats.splitBalance > 30) appData.stats.splitBalance = 30;
            break;
    }
}

// ✅ مسح الـ cache عند تعديل البيانات
async function addVacation(vacationData) {
    switch (vacationData.type) {
        case 'short':
            appData.settings.shortVacationStart = vacationData.startDate;
            break;
        case 'annual':
            break;
        case 'split':
            appData.stats.splitBalance -= vacationData.days;
            break;
    }

    vacationData.status = calculateVacationStatus(vacationData);
    appData.vacations.push(vacationData);

    // ✅ جدولة إشعارات للإجازة الجديدة
    if (notificationManager && appData.settings.notifications) {
        await notificationManager.scheduleVacationNotifications(
            vacationData,
            appData.settings.notificationSettings
        );
        await notificationManager.syncWithServiceWorker();
    }

    // ✅ مسح الـ cache
    statsCache.data = null;
    statsCache.vacationsHash = null;

    saveData();
    updateUI();
    
    // Ensure stats are updated immediately
    if (window.Worker) {
        updateStatsWithWorker();
    } else {
        updateStats();
    }
}

function calculateVacationStatus(vacation) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const startDate = parseLocalDate(vacation.startDate);
    const endDate = parseLocalDate(vacation.endDate);
    
    if (!startDate || !endDate) {
        return 'pending';
    }
    
    if (startDate > today) {
        return 'upcoming';
    } else if (today >= startDate && today <= endDate) {
        return 'current';
    } else {
        return 'completed';
    }
}

function updateAllVacationStatuses() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const vacation of appData.vacations) {
        const newStatus = calculateVacationStatus(vacation);
        if (vacation.status !== newStatus) {
            vacation.status = newStatus;
        }
    }
}

function deleteVacation(id) {
    showConfirmModal(
        'حذف الإجازة',
        'هل أنت متأكد من حذف هذه الإجازة؟ لا يمكن التراجع عن هذا الإجراء.',
        () => {
            performDeleteVacation(id);
        }
    );
}

// ✅ مسح الـ cache عند تعديل البيانات
async function performDeleteVacation(id) {
    const vacationIndex = appData.vacations.findIndex(v => v.id === id);

    if (vacationIndex !== -1) {
        const vacation = appData.vacations[vacationIndex];

        revertVacationImpact(vacation);
        appData.vacations.splice(vacationIndex, 1);

        // ✅ إلغاء إشعارات الإجازة المحذوفة
        if (notificationManager) {
            await notificationManager.cancelVacationNotifications(id);
            await notificationManager.syncWithServiceWorker();
        }

        // ✅ مسح الـ cache
        statsCache.data = null;
        statsCache.vacationsHash = null;

        saveData();
        updateUI();
        
        // Ensure stats are updated immediately
        if (window.Worker) {
            updateStatsWithWorker();
        } else {
            updateStats();
        }
        
        showToast('تم حذف الإجازة بنجاح', 'success');
    }
}

// ============================
// تحديث الواجهة
// ============================
// Update queue for handling race conditions
let updateQueue = [];
let isProcessingQueue = false;
let isUpdatingUI = false;

// Performance optimization: Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Performance optimization: Throttle function
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Caching for expensive operations
const updateStatsCache = {
    lastUpdate: 0,
    cacheTimeout: 5000, // 5 seconds
    data: null
};

// Cache for updateStats function
const statsCalculationCache = {
    lastUpdate: 0,
    cacheTimeout: 3000, // 3 seconds
    cachedResults: {}
};

// ✅ إضافة caching layer لتحسين الأداء
const statsCache = {
    lastUpdate: 0,
    data: null,
    vacationsHash: null
};

function getVacationsHash() {
    // إنشاء hash بسيط من عدد وتواريخ الإجازات
    return appData.vacations.length + 
           appData.vacations.map(v => v.startDate + v.endDate).join('');
}

function getCachedStatsKey() {
    // Create a key based on the current app state that affects stats calculation
    return `${appData.vacations.length}_${appData.settings.shortVacationDays}_${appData.settings.shortVacationCooldown}_${appData.userType}`;
}

// Safe UI update function to prevent recursion
function updateUI() {
    // If update is already in progress, skip this call to prevent recursion
    if (isUpdatingUI) {
        console.warn('UI update already in progress, skipping duplicate call');
        return; // Simply exit, don't reschedule
    }
    
    isUpdatingUI = true;
    
    try {
        updateAllVacationStatuses();
        
        // Use requestAnimationFrame for visual updates
        requestAnimationFrame(() => {
            try {
                updateStats();
                updateVacationsList();
                updateCountdown();
                updateRecentVacations();
                updateNotificationUI();
                updateUserTypeUI(); // Update user type UI after other updates
            } catch (error) {
                console.error('Error during visual updates:', error);
            } finally {
                // Ensure flag is reset even if there's an error
                isUpdatingUI = false;
            }
        });
    } catch (error) {
        console.error('Error during UI update:', error);
        // Reset flag in case of error
        isUpdatingUI = false;
        
        if (error.message && !error.message.includes('Invalid date')) {
            showToast('حدث خطأ أثناء تحديث الواجهة', 'error');
        }
    }
}

// Safe version of updateUI with debounce to prevent rapid calls
const safeUpdateUI = debounce(updateUI, 100);

// Queue management functions
function addToUpdateQueue(operation) {
    updateQueue.push(operation);
    
    // Process the queue if not already processing
    if (!isProcessingQueue) {
        processUpdateQueue();
    }
}

async function processUpdateQueue() {
    if (updateQueue.length === 0 || isProcessingQueue) {
        return;
    }
    
    isProcessingQueue = true;
    
    while (updateQueue.length > 0) {
        const operation = updateQueue.shift();
        try {
            await operation();
        } catch (error) {
            console.error('Error in update queue operation:', error);
        }
    }
    
    isProcessingQueue = false;
}

// Enhanced updateUI with queue support
async function updateUIAsync() {
    // Add update operation to queue to prevent race conditions
    return new Promise((resolve) => {
        addToUpdateQueue(async () => {
            // Prevent recursive updates
            if (isUpdatingUI) {
                // Use requestAnimationFrame to prevent infinite loops
                if (typeof requestAnimationFrame !== 'undefined') {
                    requestAnimationFrame(() => {
                        if (!isUpdatingUI) {
                            updateUIAsync().then(resolve);
                        } else {
                            resolve();
                        }
                    });
                } else {
                    setTimeout(() => {
                        if (!isUpdatingUI) {
                            updateUIAsync().then(resolve);
                        } else {
                            resolve();
                        }
                    }, 0);
                }
                return;
            }
            
            isUpdatingUI = true;
            
            try {
                updateAllVacationStatuses();
                
                // Use requestAnimationFrame for UI updates to optimize performance
                requestAnimationFrame(() => {
                    try { updateStats(); } catch (e) { console.error('Error updating stats:', e); }
                    try { updateVacationsList(); } catch (e) { console.error('Error updating vacations list:', e); }
                    try { updateCountdown(); } catch (e) { console.error('Error updating countdown:', e); }
                    try { updateRecentVacations(); } catch (e) { console.error('Error updating recent vacations:', e); }
                    try { updateNotificationUI(); } catch (e) { console.error('Error updating notification UI:', e); }
                });
            } catch (error) {
                console.error('Error during UI update:', error);
                if (error.message && !error.message.includes('Invalid date')) {
                    showToast('حدث خطأ أثناء تحديث الواجهة', 'error');
                }
            } finally {
                // Use setTimeout to ensure isUpdatingUI is reset after UI rendering
                setTimeout(() => {
                    isUpdatingUI = false;
                }, 0);
            }
            
            resolve();
        });
    });
}

// Debounced version of updateUI for frequent updates
const debouncedUpdateUI = debounce(updateUI, 300);

// Async version for race condition handling
const debouncedUpdateUIAsync = debounce(updateUIAsync, 300);

// Web Worker for heavy calculations
let statsWorker = null;

function initStatsWorker() {
    if (typeof Worker !== 'undefined') {
        try {
            statsWorker = new Worker('./stats-worker.js');
            
            statsWorker.onmessage = (e) => {
                if (e.data.type === 'STATS_UPDATED') {
                    // Update appData stats with the calculated values
                    Object.assign(appData.stats, e.data.stats);
                    
                    // Update UI elements with new stats
                    updateElement('shortBalance', appData.stats.shortBalance);
                    updateElement('annualBalance', appData.stats.annualBalance);
                    updateElement('splitBalance', appData.stats.splitBalance);
                    updateElement('privateCount', appData.stats.privateCount);
                    updateElement('totalUsed', appData.stats.totalUsed);
                    
                    updateElement('completedPrivateCount', appData.stats.completedPrivateCount);
                    
                    // Update caches
                    const now = Date.now();
                    const currentHash = getVacationsHash();
                    statsCache.data = {
                        shortBalance: appData.stats.shortBalance,
                        annualBalance: appData.stats.annualBalance,
                        splitBalance: appData.stats.splitBalance,
                        privateCount: appData.stats.privateCount,
                        totalUsed: appData.stats.totalUsed,
                        
                        completedPrivateCount: appData.stats.completedPrivateCount
                    };
                    statsCache.lastUpdate = now;
                    statsCache.vacationsHash = currentHash;
                    
                    // Update the main cache as well
                    const cacheKey = getCachedStatsKey();
                    statsCalculationCache.cachedResults[cacheKey] = { ...e.data.stats };
                    statsCalculationCache.lastUpdate = now;
                }
            };
            
            statsWorker.onerror = (error) => {
                console.error('Web Worker error:', error);
                // Fall back to main thread calculation
                updateStats();
            };
        } catch (e) {
            console.warn('Failed to initialize Web Worker for stats calculation, falling back to main thread:', e);
            statsWorker = null;
        }
    } else {
        console.warn('Web Workers not supported, using main thread for stats calculation');
    }
}

// Function to calculate stats using Web Worker when possible
function updateStatsWithWorker() {
    if (statsWorker) {
        try {
            // Send data to worker
            statsWorker.postMessage({
                type: 'UPDATE_STATS',
                data: appData
            });
        } catch (e) {
            console.error('Error posting message to stats worker:', e);
            // Fall back to main thread calculation
            updateStats();
        }
    } else {
        // Fallback to main thread calculation
        updateStats();
    }
}

// Throttled version of updateStats for performance
const throttledUpdateStats = throttle(updateStatsWithWorker, 1000);

// Debounced save function to prevent too frequent saves
const debouncedSave = debounce(saveData, 500);

function updateStats() {
    try {
        const now = Date.now();
        const currentHash = getVacationsHash();
        
        // ✅ استخدام cache إذا لم تتغير البيانات
        if (statsCache.data && 
            statsCache.vacationsHash === currentHash &&
            (now - statsCache.lastUpdate) < 5000) { // 5 ثواني
            
            // ✅ تحديث UI من الـ cache
            updateElement('shortBalance', statsCache.data.shortBalance);
            updateElement('annualBalance', statsCache.data.annualBalance);
            updateElement('splitBalance', statsCache.data.splitBalance);
            updateElement('privateCount', statsCache.data.privateCount);
            updateElement('totalUsed', statsCache.data.totalUsed);
            updateElement('completedPrivateCount', statsCache.data.completedPrivateCount);
            return;
        }
        
        // Check if we have valid cached results
        const cacheKey = getCachedStatsKey();
        
        if (statsCalculationCache.cachedResults[cacheKey] && 
            (now - statsCalculationCache.lastUpdate) < statsCalculationCache.cacheTimeout) {
            // Use cached results
            const cachedStats = statsCalculationCache.cachedResults[cacheKey];
            Object.assign(appData.stats, cachedStats);
            
            // Update UI elements with cached values
            updateElement('shortBalance', appData.stats.shortBalance);
            updateElement('annualBalance', appData.stats.annualBalance);
            updateElement('splitBalance', appData.stats.splitBalance);
            updateElement('privateCount', cachedStats.privateCount || 0);
            updateElement('totalUsed', appData.stats.totalUsed);
            
            updateElement('completedPrivateCount', cachedStats.completedPrivateCount || 0);
            
            // ✅ حفظ النتيجة في الـ cache
            statsCache.data = {
                shortBalance: appData.stats.shortBalance,
                annualBalance: appData.stats.annualBalance,
                splitBalance: appData.stats.splitBalance,
                privateCount: cachedStats.privateCount || 0,
                totalUsed: appData.stats.totalUsed,
                
                completedPrivateCount: cachedStats.completedPrivateCount || 0
            };
            statsCache.lastUpdate = now;
            statsCache.vacationsHash = currentHash;
            
            return; // Exit early, using cached results
        }
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const currentYear = today.getFullYear();
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(today.getDate() + 30);

        let totalUsed = 0;

        let privateCount = 0;
        let completedPrivateCount = 0;
        
        let annualDaysUsedInCurrentPeriod = 0;
        let shortDaysUsedInCurrentPeriod = 0;
        let totalSplitDaysUsed = 0;

        const annualPeriod = appData.settings.annualVacationPeriod;
        const shortPeriod = appData.settings.shortVacationPeriod;

        let annualPeriodStart, annualPeriodEnd;
        const currentAnnualStart = new Date(currentYear, annualPeriod.startMonth - 1, annualPeriod.startDay);
        if (today < currentAnnualStart) {
            annualPeriodStart = new Date(currentYear - 1, annualPeriod.startMonth - 1, annualPeriod.startDay);
            annualPeriodEnd = new Date(currentYear, annualPeriod.endMonth - 1, annualPeriod.endDay);
        } else {
            annualPeriodStart = currentAnnualStart;
            annualPeriodEnd = new Date(currentYear, annualPeriod.endMonth - 1, annualPeriod.endDay);
        }

        let shortPeriodStart, shortPeriodEnd;
        const currentShortStart = new Date(currentYear, shortPeriod.startMonth - 1, shortPeriod.startDay);
        if (today < currentShortStart) {
            shortPeriodStart = new Date(currentYear - 1, shortPeriod.startMonth - 1, shortPeriod.startDay);
            shortPeriodEnd = new Date(currentYear, shortPeriod.endMonth - 1, shortPeriod.endDay);
        } else {
            shortPeriodStart = currentShortStart;
            shortPeriodEnd = new Date(currentYear + 1, shortPeriod.endMonth - 1, shortPeriod.endDay);
        }

        const vacationsToProcess = appData.vacations.slice(0, 100);

        for (const vacation of vacationsToProcess) {
            try {
                const startDate = parseLocalDate(vacation.startDate);
                const endDate = parseLocalDate(vacation.endDate);

                if (!startDate || !endDate) {
                    console.warn('Invalid date found in vacation:', vacation);
                    continue;
                }

                if (vacation.type === 'annual') {
                    if (startDate >= annualPeriodStart && startDate <= annualPeriodEnd) {
                        annualDaysUsedInCurrentPeriod += vacation.days;
                    }
                } else if (vacation.type === 'short') {
                    if (startDate >= shortPeriodStart && startDate <= shortPeriodEnd) {
                        shortDaysUsedInCurrentPeriod += vacation.days;
                    }
                } else if (vacation.type === 'split') {
                    totalSplitDaysUsed += vacation.days;
                } else if (vacation.type === 'private') {
                    // Count private vacations only for the current year
                    const vacationYear = new Date(vacation.startDate).getFullYear();
                    if (vacationYear === currentYear) {
                        privateCount++;
                        if (vacation.status === 'completed') {
                            completedPrivateCount++;
                        }
                    }
                }

                const daysUsed = calculateDaysBetween(vacation.startDate, vacation.endDate);
                totalUsed += daysUsed;

                if (startDate >= today && startDate <= thirtyDaysFromNow) {

                }
            } catch (error) {
                console.error('Error processing vacation in updateStats:', vacation, error);
                continue;
            }
        }

        // Calculate and store the results
        const calculatedStats = {
            totalUsed: totalUsed,

            annualBalance: Math.max(0, APP_CONFIG.DEFAULT_VACATION_BALANCE.annual - annualDaysUsedInCurrentPeriod),
            splitBalance: Math.max(0, APP_CONFIG.DEFAULT_VACATION_BALANCE.split - totalSplitDaysUsed),
            privateCount: privateCount,
            completedPrivateCount: completedPrivateCount
        };
        
        // Handle short balance calculation separately due to user type dependency
        if (appData.userType === 'continuous') {
            if (shortDaysUsedInCurrentPeriod > 0) {
                calculatedStats.shortBalance = 0;
                
                const latestShortVacation = appData.vacations
                    .filter(v => v.type === 'short')
                    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))[0];
                
                if (latestShortVacation && (!appData.settings.shortVacationStart || 
                    new Date(latestShortVacation.startDate) > new Date(appData.settings.shortVacationStart))) {
                    appData.settings.shortVacationStart = latestShortVacation.startDate;
                }
            } else if (appData.settings.shortVacationStart) {
                const lastShortDate = parseLocalDate(appData.settings.shortVacationStart);
                if (lastShortDate) {
                    const daysSinceLastShort = Math.floor((today - lastShortDate) / (1000 * 60 * 60 * 24));
                    if (daysSinceLastShort < appData.settings.shortVacationCooldown) {
                        calculatedStats.shortBalance = 0;
                    } else {
                        calculatedStats.shortBalance = appData.settings.shortVacationDays;
                    }
                }
            } else {
                calculatedStats.shortBalance = appData.settings.shortVacationDays;
            }
        } else {
            calculatedStats.shortBalance = appData.stats.shortBalance || 0; // Preserve for non-continuous users
        }
        
        // Update appData.stats with calculated values
        Object.assign(appData.stats, calculatedStats);
        
        // Update UI elements
        updateElement('shortBalance', appData.stats.shortBalance);
        updateElement('annualBalance', appData.stats.annualBalance);
        updateElement('splitBalance', appData.stats.splitBalance);
        updateElement('privateCount', appData.stats.privateCount);
        updateElement('totalUsed', appData.stats.totalUsed);
        updateElement('completedPrivateCount', appData.stats.completedPrivateCount);
        
        // Cache the results
        statsCalculationCache.cachedResults[cacheKey] = { ...calculatedStats };
        statsCalculationCache.lastUpdate = now;
        
        // ✅ حفظ النتيجة في الـ cache
        statsCache.data = {
            shortBalance: appData.stats.shortBalance,
            annualBalance: appData.stats.annualBalance,
            splitBalance: appData.stats.splitBalance,
            privateCount: appData.stats.privateCount,
            totalUsed: appData.stats.totalUsed,
            
            completedPrivateCount: appData.stats.completedPrivateCount
        };
        statsCache.lastUpdate = now;
        statsCache.vacationsHash = currentHash;
        
    } catch (error) {
        console.error('Error in updateStats:', error);
        showToast('حدث خطأ أثناء تحديث الإحصائيات', 'error');
        
        // Clear cache on error to force recalculation
        statsCalculationCache.cachedResults = {};
        
        // ✅ مسح الـ cache
        statsCache.data = null;
        statsCache.vacationsHash = null;
    }
}

function updateVacationsList() {
    try {
        const container = document.getElementById('vacationsList');
        if (!container) return;
        
        const filterType = document.getElementById('filterType')?.value || 'all';
        const filterYear = document.getElementById('filterYear')?.value || 'all';

        let filteredVacations = appData.vacations;

        if (filterType !== 'all') {
            filteredVacations = filteredVacations.filter(v => v.type === filterType);
        }

        if (filterYear !== 'all') {
            filteredVacations = filteredVacations.filter(v => {
                return new Date(v.startDate).getFullYear() === parseInt(filterYear);
            });
        }

        filteredVacations.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
        
        // For virtual scrolling, only render the first batch
        const vacationsToRender = filteredVacations.slice(0, VACATIONS_PER_BATCH);

        if (filteredVacations.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-calendar-times text-gray-300 text-4xl mb-4"></i>
                    <h3 class="text-lg font-medium text-gray-700 mb-2">لا توجد إجازات</h3>
                    <p class="text-gray-500">لم يتم العثور على إجازات تطابق معايير التصفية</p>
                </div>
            `;
            // Remove sentinel if it exists since there are no vacations
            const existingSentinel = container.querySelector('#scroll-sentinel');
            if (existingSentinel) {
                existingSentinel.remove();
            }
            return;
        }

        // Clear container and add rendered vacations
        container.innerHTML = vacationsToRender.map(vacation => createVacationCard(vacation)).join('');

        // ✅ استخدام event delegation بدلاً من listeners لكل زر
        container.removeEventListener('click', handleVacationAction);
        container.addEventListener('click', handleVacationAction);
        
        // Setup virtual scrolling for large lists
        currentVacationIndex = vacationsToRender.length;
        setupVirtualScrolling();
        
    } catch (error) {
        console.error('Error in updateVacationsList:', error);
        const container = document.getElementById('vacationsList');
        if (container) {
            container.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-exclamation-triangle text-red-500 text-4xl mb-4"></i>
                    <h3 class="text-lg font-medium text-gray-700 mb-2">حدث خطأ أثناء تحميل الإجازات</h3>
                    <p class="text-gray-500">يرجى تحديث الصفحة أو محاولة مرة أخرى</p>
                </div>
            `;
            // Remove sentinel if it exists in error case
            const existingSentinel = container.querySelector('#scroll-sentinel');
            if (existingSentinel) {
                existingSentinel.remove();
            }
        }
    }
}

// ✅ دالة واحدة للتعامل مع كل الأزرار
function handleVacationAction(e) {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    
    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === 'edit') {
        editVacation(id);
    } else if (action === 'delete') {
        deleteVacation(id);
    } else if (action === 'share') {
        const vacation = appData.vacations.find(v => v.id === id);
        if (vacation) {
            shareVacation(vacation);
        }
    }
}

function createVacationCard(vacation) {
    const startDate = parseLocalDate(vacation.startDate);
    const endDate = parseLocalDate(vacation.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let status, statusClass;
    if (vacation.status === 'completed') {
        status = 'منتهية';
        statusClass = 'status-rejected';
    } else if (vacation.status === 'current') {
        status = 'حالية';
        statusClass = 'status-approved';
    } else if (startDate > today) {
        status = 'قادمة';
        statusClass = 'status-pending';
    } else if (endDate >= today) {
        status = 'حالية';
        statusClass = 'status-approved';
    } else {
        status = 'منتهية';
        statusClass = 'status-rejected';
    }

    const typeLabels = {
        short: 'إجازة قصيرة',
        annual: 'عطلة سنوية',
        split: 'عطلة مقسمة',
        private: 'إجازة خاصة'
    };

    // إضافة زر المشاركة (يظهر دائماً مع رمز مختلف حسب الدعم)
    const shareSupported = checkShareSupport();
    const shareButton = `
        <button data-action="share" data-id="${vacation.id}" 
                class="p-2 ${shareSupported ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'} rounded-lg transition-colors" 
                aria-label="مشاركة"
                title="${shareSupported ? 'مشاركة الإجازة' : 'نسخ تفاصيل الإجازة'}">
            <i class="fas ${shareSupported ? 'fa-share-alt' : 'fa-copy'}"></i>
        </button>
    `;

    return `
        <article class="vacation-card bg-white rounded-lg shadow-md p-4 ${statusClass} type-${vacation.type}" role="listitem">
            <div class="flex flex-col md:flex-row md:items-center justify-between">
                <div class="mb-4 md:mb-0">
                    <div class="flex items-center mb-2">
                        <h3 class="text-lg font-bold text-gray-800 ml-2">${typeLabels[vacation.type]}</h3>
                        <span class="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-600">${status}</span>
                    </div>
                    <div class="flex items-center text-gray-600 mb-1">
                        <i class="fas fa-calendar-alt ml-2"></i>
                        <span>${formatDate(startDate)} - ${formatDate(endDate)}</span>
                    </div>
                    <div class="flex items-center text-gray-600">
                        <i class="fas fa-clock ml-2"></i>
                        <span>${vacation.days} يوم</span>
                    </div>
                    ${vacation.reason ? `<div class="flex items-center text-gray-600 mt-1">
                        <i class="fas fa-info-circle ml-2"></i>
                        <span>${vacation.reason}</span>
                    </div>` : ''}
                    ${vacation.notes ? `<div class="text-gray-500 text-sm mt-2">
                        <i class="fas fa-sticky-note ml-1"></i>
                        ${vacation.notes}
                    </div>` : ''}
                </div>
                <div class="flex gap-2">
                    ${shareButton}
                    <button data-action="edit" data-id="${vacation.id}" class="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors" aria-label="تعديل">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button data-action="delete" data-id="${vacation.id}" class="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors" aria-label="حذف">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </article>
    `;
}

function updateCountdown() {
    try {
        const container = document.getElementById('countdownSection');
        if (!container) return;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const countdowns = [];

        const vacationsToProcess = appData.vacations.slice(0, 50);

        const activeVacations = vacationsToProcess.filter(vacation => {
            try {
                const start = parseLocalDate(vacation.startDate);
                const end = parseLocalDate(vacation.endDate);
                return start && end && today >= start && today <= end && vacation.status !== 'completed';
            } catch (e) {
                console.error('Error checking active vacation:', vacation, e);
                return false;
            }
        });

        activeVacations.forEach(vacation => {
            try {
                const endDate = parseLocalDate(vacation.endDate);
                if (!endDate) return;
                
                const daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24)) + 1;

                if (daysRemaining > 0) {
                    countdowns.push({
                        type: vacation.type,
                        title: `الأيام المتبقية من ${getVacationTypeName(vacation.type)}`,
                        days: daysRemaining,
                        maxDays: vacation.days,
                        progress: ((vacation.days - daysRemaining) / vacation.days) * 100
                    });
                }
            } catch (e) {
                console.error('Error processing active vacation:', vacation, e);
            }
        });

        if (appData.userType === 'continuous' && appData.settings.shortVacationStart) {
            try {
                const lastShortDate = parseLocalDate(appData.settings.shortVacationStart);
                if (lastShortDate) {
                    const daysSinceLastShort = Math.floor((today - lastShortDate) / (1000 * 60 * 60 * 24));
                    const cooldownDays = appData.settings.shortVacationCooldown;

                    if (daysSinceLastShort < cooldownDays) {
                        const daysUntilNext = cooldownDays - daysSinceLastShort;
                        appData.stats.shortBalance = 0;
                        countdowns.push({
                            type: 'cooldown',
                            title: 'متبقي على الإجازة القصيرة التالية',
                            days: daysUntilNext,
                            maxDays: cooldownDays,
                            progress: (daysSinceLastShort / cooldownDays) * 100
                        });
                    } else {
                        if (appData.stats.shortBalance === 0) {
                            appData.stats.shortBalance = appData.settings.shortVacationDays;
                            saveData();
                            
                            // إشعار عند تجديد رصيد الإجازة القصيرة
                            if (appData.settings.notifications && appData.settings.notificationSettings.shortBalance) {
                                setTimeout(() => {
                                    createNotification('رصيد إجازة قصيرة متاح', `لديك ${appData.stats.shortBalance} أيام من الإجازة القصيرة المتاحة`);
                                }, 1000);
                            }
                            
                            showToast('تم تجديد رصيد الإجازة القصيرة المتاح', 'success');
                        }
                    }
                }
            } catch (e) {
                console.error('Error processing short vacation cooldown:', e);
            }
        }

        const upcomingVacations = vacationsToProcess
            .filter(vacation => {
                try {
                    const start = parseLocalDate(vacation.startDate);
                    return start && start > today && vacation.status !== 'completed';
                } catch (e) {
                    console.error('Error checking upcoming vacation:', vacation, e);
                    return false;
                }
            })
            .sort((a, b) => {
                try {
                    return parseLocalDate(a.startDate) - parseLocalDate(b.startDate);
                } catch (e) {
                    console.error('Error sorting upcoming vacations:', a, b, e);
                    return 0;
                }
            })
            .slice(0, 3 - countdowns.length);

        upcomingVacations.forEach(vacation => {
            try {
                const startDate = parseLocalDate(vacation.startDate);
                if (!startDate) return;
                
                const daysUntil = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));

                countdowns.push({
                    type: vacation.type,
                    title: `${getVacationTypeName(vacation.type)} قادمة`,
                    days: daysUntil,
                    maxDays: null,
                    progress: null
                });
            } catch (e) {
                console.error('Error processing upcoming vacation:', vacation, e);
            }
        });

        if (countdowns.length === 0) {
            container.innerHTML = `
                <div class="countdown-card">
                    <div class="text-center">
                        <i class="fas fa-calendar-check text-4xl mb-4"></i>
                        <h3 class="text-xl font-bold mb-2">لا توجد إجازات نشطة</h3>
                        <p>قم بإضافة إجازة جديدة لعرض العد التنازلي هنا</p>
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = countdowns.map(countdown => `
            <div class="countdown-card">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-bold">${countdown.title}</h3>
                    <div class="text-3xl font-bold">${countdown.days}</div>
                </div>
                ${countdown.progress !== null ? `
                    <div class="progress-bar mb-3">
                        <div class="progress-fill" style="width: ${countdown.progress}%"></div>
                    </div>
                ` : ''}
                <div class="text-sm opacity-90">
                    ${formatDaysCount(countdown.days)}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error in updateCountdown:', error);
        const container = document.getElementById('countdownSection');
        if (container) {
            container.innerHTML = `
                <div class="countdown-card">
                    <div class="text-center">
                        <i class="fas fa-exclamation-triangle text-red-500 text-4xl mb-4"></i>
                        <h3 class="text-xl font-bold mb-2">حدث خطأ أثناء تحميل العد التنازلي</h3>
                        <p>يرجى تحديث الصفحة أو محاولة مرة أخرى</p>
                    </div>
                </div>
            `;
        }
    }
}

function updateRecentVacations() {
    try {
        const container = document.getElementById('recentVacations');
        if (!container) return;

        const recentVacations = appData.vacations
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 10);

        if (recentVacations.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-calendar-times text-gray-300 text-4xl mb-4"></i>
                    <h3 class="text-lg font-medium text-gray-700 mb-2">لا توجد إجازات</h3>
                    <p class="text-gray-500">ابدأ بإضافة إجازة جديدة</p>
                </div>
            `;
            return;
        }

        container.innerHTML = recentVacations.map(vacation => {
            const startDate = parseLocalDate(vacation.startDate);
            const endDate = parseLocalDate(vacation.endDate);

            return `
                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div class="flex-1">
                        <div class="font-medium text-gray-800">${getVacationTypeName(vacation.type)}</div>
                        <div class="text-sm text-gray-600">${formatDate(startDate)} - ${formatDate(endDate)}</div>
                    </div>
                    <div class="text-left">
                        <div class="text-sm font-medium text-gray-700">${vacation.days} يوم</div>
                        <div class="text-xs text-gray-500">${getStatusText(vacation)}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error in updateRecentVacations:', error);
        const container = document.getElementById('recentVacations');
        if (container) {
            container.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-exclamation-triangle text-red-500 text-4xl mb-4"></i>
                    <h3 class="text-lg font-medium text-gray-700 mb-2">حدث خطأ أثناء تحميل الإجازات الحديثة</h3>
                    <p class="text-gray-500">يرجى تحديث الصفحة أو محاولة مرة أخرى</p>
                </div>
            `;
        }
    }
}

function updateYearFilter() {
    const select = document.getElementById('filterYear');
    if (!select) return;

    const currentYear = new Date().getFullYear();
    select.innerHTML = '<option value="all" selected>كل السنوات</option>';

    for (let year = currentYear - 5; year <= currentYear + 5; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        select.appendChild(option);
    }
}

// ============================
// إدارة الإعدادات
// ============================
function showSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.add('show');
        loadSettingsToForm();
    }
}

function hideSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.remove('show');
    }
    
    // إشعار عند توفر رصيد الإجازة القصيرة
    if (appData.settings.notificationSettings.shortBalance && 
        appData.userType === 'continuous' && 
        appData.stats.shortBalance > 0 && 
        appData.settings.notifications &&
        Notification.permission === 'granted') {
        setTimeout(() => {
            createNotification('رصيد إجازة قصيرة متاح', `لديك ${appData.stats.shortBalance} أيام من الإجازة القصيرة المتاحة`);
        }, 1000);
    }
}

function loadSettingsToForm() {
    selectUserType(appData.userType);

    document.getElementById('shortVacationDays').value = appData.settings.shortVacationDays;
    document.getElementById('shortVacationCooldown').value = appData.settings.shortVacationCooldown;

    if (appData.settings.shortVacationStart) {
        document.getElementById('shortVacationStart').value = appData.settings.shortVacationStart;
    }

    if (document.getElementById('shortVacationStartDate')) {
        document.getElementById('shortVacationStartDate').value = `${new Date().getFullYear()}-${String(appData.settings.shortVacationPeriod.startMonth).padStart(2, '0')}-${String(appData.settings.shortVacationPeriod.startDay).padStart(2, '0')}`;
    }
    if (document.getElementById('shortVacationEndDate')) {
        document.getElementById('shortVacationEndDate').value = `${new Date().getFullYear()}-${String(appData.settings.shortVacationPeriod.endMonth).padStart(2, '0')}-${String(appData.settings.shortVacationPeriod.endDay).padStart(2, '0')}`;
    }
    
    if (document.getElementById('annualVacationStartDate')) {
        document.getElementById('annualVacationStartDate').value = `${new Date().getFullYear()}-${String(appData.settings.annualVacationPeriod.startMonth).padStart(2, '0')}-${String(appData.settings.annualVacationPeriod.startDay).padStart(2, '0')}`;
    }
    if (document.getElementById('annualVacationEndDate')) {
        document.getElementById('annualVacationEndDate').value = `${new Date().getFullYear()}-${String(appData.settings.annualVacationPeriod.endMonth).padStart(2, '0')}-${String(appData.settings.annualVacationPeriod.endDay).padStart(2, '0')}`;
    }

    document.getElementById('notificationsToggle').checked = appData.settings.notifications;
    document.getElementById('notificationBeforeStart').value = appData.settings.notificationSettings.beforeStart;
    document.getElementById('notificationBeforeEnd').value = appData.settings.notificationSettings.beforeEnd;
    document.getElementById('notificationOnEnd').checked = appData.settings.notificationSettings.onEnd;
    document.getElementById('notificationShortBalance').checked = appData.settings.notificationSettings.shortBalance;
    
    updatePermissionStatus();
}

async function autoSaveSettings() {
    try {
        const shortVacationDays = parseInt(document.getElementById('shortVacationDays')?.value);
        if (shortVacationDays && shortVacationDays > 0 && shortVacationDays <= 30) {
            appData.settings.shortVacationDays = shortVacationDays;
            if (!appData.settings.shortVacationStart) {
                appData.stats.shortBalance = shortVacationDays;
            }
        }

        const shortVacationCooldown = parseInt(document.getElementById('shortVacationCooldown')?.value);
        if (shortVacationCooldown && shortVacationCooldown > 0 && shortVacationCooldown <= 365) {
            appData.settings.shortVacationCooldown = shortVacationCooldown;
        }

        const shortVacationStart = document.getElementById('shortVacationStart')?.value;
        if (shortVacationStart) {
            appData.settings.shortVacationStart = shortVacationStart;
        }

        if (document.getElementById('shortVacationStartDate')) {
            const shortStartValue = document.getElementById('shortVacationStartDate').value;
            if (shortStartValue) {
                const shortStartParts = shortStartValue.split('-');
                appData.settings.shortVacationPeriod.startMonth = parseInt(shortStartParts[1]);
                appData.settings.shortVacationPeriod.startDay = parseInt(shortStartParts[2]);
            }
        }
        if (document.getElementById('shortVacationEndDate')) {
            const shortEndValue = document.getElementById('shortVacationEndDate').value;
            if (shortEndValue) {
                const shortEndParts = shortEndValue.split('-');
                appData.settings.shortVacationPeriod.endMonth = parseInt(shortEndParts[1]);
                appData.settings.shortVacationPeriod.endDay = parseInt(shortEndParts[2]);
            }
        }
        
        if (document.getElementById('annualVacationStartDate')) {
            const annualStartValue = document.getElementById('annualVacationStartDate').value;
            if (annualStartValue) {
                const annualStartParts = annualStartValue.split('-');
                appData.settings.annualVacationPeriod.startMonth = parseInt(annualStartParts[1]);
                appData.settings.annualVacationPeriod.startDay = parseInt(annualStartParts[2]);
            }
        }
        if (document.getElementById('annualVacationEndDate')) {
            const annualEndValue = document.getElementById('annualVacationEndDate').value;
            if (annualEndValue) {
                const annualEndParts = annualEndValue.split('-');
                appData.settings.annualVacationPeriod.endMonth = parseInt(annualEndParts[1]);
                appData.settings.annualVacationPeriod.endDay = parseInt(annualEndParts[2]);
            }
        }

        const notificationsEnabled = document.getElementById('notificationsToggle')?.checked ?? true;
        const wasNotificationsEnabled = appData.settings.notifications;
        
        appData.settings.notifications = notificationsEnabled;
        appData.settings.notificationSettings.beforeStart = parseInt(document.getElementById('notificationBeforeStart')?.value) || 0;
        appData.settings.notificationSettings.beforeEnd = parseInt(document.getElementById('notificationBeforeEnd')?.value) || 0;
        appData.settings.notificationSettings.onEnd = document.getElementById('notificationOnEnd')?.checked ?? false;
        appData.settings.notificationSettings.shortBalance = document.getElementById('notificationShortBalance')?.checked ?? false;

        if (notificationsEnabled && !wasNotificationsEnabled) {
            setTimeout(async () => {
                const granted = await requestNotificationPermissions(true);
                if (granted) {
                    await scheduleAllNotifications();
                }
            }, 500);
        } else if (!notificationsEnabled && wasNotificationsEnabled) {
            showToast('تم إيقاف الإشعارات', 'info');
            // إلغاء جميع الإشعارات المجدولة
            if (notificationManager) {
                for (const vacation of appData.vacations) {
                    await notificationManager.cancelVacationNotifications(vacation.id);
                }
            }
        } else if (notificationsEnabled) {
            // إعادة جدولة الإشعارات مع الإعدادات الجديدة
            await scheduleAllNotifications();
        }
        
        updateNotificationUI();
        updatePermissionStatus();

        debouncedSave();
        debouncedUpdateUI();
        
        // Ensure stats are updated after settings change
        if (window.Worker) {
            updateStatsWithWorker();
        } else {
            updateStats();
        }

    } catch (error) {
        console.error('Auto-save settings error:', error);
    }
}

function confirmResetData() {
    showConfirmModal(
        'إعادة تعيين البيانات',
        'هل أنت متأكد من إعادة تعيين جميع البيانات؟ سيتم حذف جميع الإجازات والإعدادات.',
        () => {
            resetData();
        }
    );
}

function resetData() {
    appData = {
        userType: 'continuous',
        settings: {
            shortVacationDays: 6,
            shortVacationCooldown: 70,
            shortVacationStart: null,
            shortVacationPeriod: {
                startMonth: 10,
                startDay: 15,
                endMonth: 4,
                endDay: 15
            },
            annualVacationPeriod: {
                startMonth: 5,
                startDay: 1,
                endMonth: 11,
                endDay: 1
            },
            notifications: true,
            notificationSettings: {
                beforeStart: 3,
                beforeEnd: 3,
                onEnd: true,
                shortBalance: true
            },
            theme: 'light',
            language: 'ar'
        },
        vacations: [],
        stats: {
            shortBalance: 6,
            annualBalance: 30,
            splitBalance: 30,
            totalUsed: 0,

            lastAnnualPeriodYear: null,
            lastShortPeriodYear: null
        }
    };

    saveData();
    updateUI();
    hideSettingsModal();
    showToast('تم إعادة تعيين البيانات بنجاح', 'success');
}

function exportData() {
    try {
        const dataStr = JSON.stringify(appData, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

        const exportFileDefaultName = `ejaza-data-${new Date().toISOString().split('T')[0]}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();

        showToast('تم تصدير البيانات بنجاح', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showToast('حدث خطأ أثناء تصدير البيانات', 'error');
    }
}

function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoadingSpinner();

    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            const importedData = JSON.parse(e.target.result);

            if (!importedData.vacations || !Array.isArray(importedData.vacations)) {
                throw new Error('ملف البيانات غير صالح - يجب أن يحتوي على قائمة إجازات');
            }

            appData = deepMerge(appData, importedData);

            if (importedData.userType) {
                appData.userType = importedData.userType;
            }

            saveData();
            loadSettingsToForm();
            updateUserTypeUI();
            updateUI();
            hideSettingsModal();

            let msg = `تم استيراد ${importedData.vacations.length} إجازة`;
            if (importedData.settings) msg += ' والإعدادات';
            showToast(msg + ' بنجاح', 'success');
        } catch (error) {
            console.error('Import error:', error);
            showToast('خطأ في استيراد البيانات: ' + error.message, 'error');
        } finally {
            hideLoadingSpinner();
        }
    };

    reader.readAsText(file);
    event.target.value = '';
}

// ============================
// وظائف مساعدة
// ============================
function setupDefaultSettings() {
    // Default vacation creation has been removed
    // Only initialize if no data exists but don't create default vacation
    if (!appData.vacations) {
        appData.vacations = [];
        saveData();
    }
}

function setupDateInputs() {
    document.addEventListener('focusin', function (e) {
        if (e.target.type === 'date') {
            if (e.target.showPicker) {
                setTimeout(() => {
                    try {
                        e.target.showPicker();
                    } catch (error) {
                        console.log('Could not open date picker:', error);
                    }
                }, 10);
            }
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.target.type === 'date') {
            const allowedKeys = ['Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
            
            if (e.ctrlKey || e.metaKey) {
                if (['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) {
                    return;
                }
            }
            
            if (!allowedKeys.includes(e.key) && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                showToast('الرجاء استخدام التقويم لاختيار التاريخ', 'info', 2000);
            }
        }
    });

    document.addEventListener('paste', function (e) {
        if (e.target.type === 'date') {
            e.preventDefault();
            showToast('لا يمكن لصق التاريخ، الرجاء استخدام التقويم', 'info', 2000);
        }
    });
}

function setupDates() {
    const shortVacationStart = document.getElementById('shortVacationStart');
    if (shortVacationStart && appData.settings.shortVacationStart) {
        shortVacationStart.value = appData.settings.shortVacationStart;
    }
}

function setupDateFieldListeners() {
    const shortStartDate = document.getElementById('shortStartDate');
    if (shortStartDate) {
        shortStartDate.addEventListener('change', function () {
            if (this.value) {
                const endDate = calculateEndDate(this.value, appData.settings.shortVacationDays);
                document.getElementById('shortEndDate').textContent = endDate;
            }
        });
    }

    const annualStartDate = document.getElementById('annualStartDate');
    if (annualStartDate) {
        annualStartDate.addEventListener('change', function () {
            if (this.value) {
                const endDate = calculateEndDate(this.value, 30);
                document.getElementById('annualEndDate').textContent = endDate;
            }
        });
    }

    const splitStartDate = document.getElementById('splitStartDate');
    const splitDays = document.getElementById('splitDays');
    if (splitStartDate && splitDays) {
        splitStartDate.addEventListener('change', updateSplitEndDate);
        splitDays.addEventListener('input', updateSplitEndDate);
    }

    const privateStartDate = document.getElementById('privateStartDate');
    const privateEndDate = document.getElementById('privateEndDate');
    if (privateStartDate && privateEndDate) {
        privateStartDate.addEventListener('change', function () {
            if (this.value && !privateEndDate.value) {
                const endDate = calculateEndDate(this.value, 2);
                privateEndDate.value = endDate;
            }
        });
    }
}

function updateSplitEndDate() {
    const startDate = document.getElementById('splitStartDate')?.value;
    const days = parseInt(document.getElementById('splitDays')?.value) || 1;
    const endDateElement = document.getElementById('splitEndDate');

    if (startDate && endDateElement) {
        endDateElement.textContent = calculateEndDate(startDate, days);
    }
}

function editVacation(id) {
    const vacation = appData.vacations.find(v => v.id === id);
    if (!vacation) return;

    editingId = id;
    showTab('add');
    selectVacationType(vacation.type);

    const tryPopulate = () => {
        const startField = document.getElementById(`${vacation.type}StartDate`);
        if (!startField) {
            setTimeout(tryPopulate, 50);
            return;
        }

        switch (vacation.type) {
            case 'short':
                document.getElementById('shortStartDate').value = vacation.startDate;
                document.getElementById('shortEndDate').textContent = vacation.endDate;
                break;
            case 'annual':
                document.getElementById('annualStartDate').value = vacation.startDate;
                document.getElementById('annualEndDate').textContent = vacation.endDate;
                break;
            case 'split':
                document.getElementById('splitStartDate').value = vacation.startDate;
                document.getElementById('splitDays').value = vacation.days;
                updateSplitEndDate();
                break;
            case 'private':
                document.getElementById('privateStartDate').value = vacation.startDate;
                document.getElementById('privateEndDate').value = vacation.endDate;
                document.getElementById('reason').value = vacation.reason || '';
                break;
        }

        document.getElementById('notes').value = vacation.notes || '';
        document.getElementById('vacationStatus').value = vacation.status || 'upcoming';

        const submitBtn = document.querySelector('#vacationForm button[type="submit"]');
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fas fa-save ml-2"></i>تحديث الإجازة';
        }
    };

    tryPopulate();
}

function toggleNotifications() {
    const newState = !appData.settings.notifications;
    
    if (newState) {
        requestNotificationPermissions(true).then(granted => {
            appData.settings.notifications = granted;
            updateNotificationUI();
            saveData();
            showToast(granted ? 'تم تفعيل الإشعارات' : 'تم رفض الإشعارات', granted ? 'success' : 'warning');
        });
    } else {
        appData.settings.notifications = false;
        updateNotificationUI();
        saveData();
        showToast('تم إيقاف الإشعارات', 'info');
    }
}

function refreshApp() {
    showLoadingSpinner();

    setTimeout(() => {
        updateUI();
        hideLoadingSpinner();
        showToast('تم تحديث البيانات', 'success');
    }, 1000);
}

function handleOnlineStatus() {
    showToast('تم الاتصال بالإنترنت', 'success');
}

function handleOfflineStatus() {
    showToast('انقطع الاتصال بالإنترنت - يعمل في وضع Offline', 'info');
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function parseLocalDate(dateStr) {
    if (!dateStr) {
        console.warn('Empty date string provided to parseLocalDate');
        return null;
    }
    
    try {
        // Validate the format first
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateStr)) {
            console.warn('Invalid date format (expected YYYY-MM-DD):', dateStr);
            return null;
        }
        
        const [year, month, day] = dateStr.split('-').map(Number);
        
        if (isNaN(year) || isNaN(month) || isNaN(day)) {
            console.warn('Invalid date components:', dateStr);
            return null;
        }
        
        // Validate ranges
        if (year < 1900 || year > 2100) {
            console.warn('Year out of valid range:', dateStr);
            return null;
        }
        
        if (month < 1 || month > 12) {
            console.warn('Month out of valid range:', dateStr);
            return null;
        }
        
        if (day < 1 || day > 31) {
            console.warn('Day out of valid range:', dateStr);
            return null;
        }
        
        // ✅ إنشاء التاريخ في UTC ثم تحويله للـ local timezone
        const date = new Date(Date.UTC(year, month - 1, day));
        
        // ✅ ضبط على منتصف الليل local time
        const localDate = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
        
        if (isNaN(localDate.getTime()) || 
            localDate.getFullYear() !== year || 
            localDate.getMonth() !== month - 1 || 
            localDate.getDate() !== day) {
            console.warn('Invalid date combination (e.g., Feb 30):', dateStr);
            return null;
        }
        
        return localDate;
    } catch (error) {
        console.error('Unexpected error parsing date:', dateStr, error);
        return null;
    }
}

// Enhanced date formatting with fallback
function formatDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        console.warn('Invalid date object provided to formatDate:', date);
        return 'Invalid Date';
    }
    
    try {
        // Try the preferred format first
        const options = { year: 'numeric', month: 'long', day: 'numeric', calendar: 'gregory', numberingSystem: 'latn' };
        return date.toLocaleDateString('ar-SA', options);
    } catch (error) {
        console.warn('Error formatting date with preferred options:', error);
        
        // Fallback to simpler format
        try {
            return date.toLocaleDateString('ar-SA');
        } catch (fallbackError) {
            console.error('Error formatting date with fallback:', fallbackError);
            // Last resort: manual formatting
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        }
    }
}

function calculateDaysBetween(startDate, endDate) {
    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    if (!start || !end) return 0;

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const diffTime = Math.abs(end - start);
    return Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

function calculateEndDate(startDate, days) {
    const date = parseLocalDate(startDate);
    if (!date) return '';
    date.setDate(date.getDate() + days - 1);

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}



function formatDaysCount(days) {
    if (days === 1) return 'يوم واحد';
    if (days === 2) return 'يومان';
    if (days <= 10) return `${days} أيام`;
    return `${days} يوم`;
}

function getMonthName(monthNumber) {
    const monthNames = [
        'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];
    return monthNames[monthNumber - 1] || '';
}

function getVacationTypeName(type) {
    const labels = {
        short: 'الإجازة القصيرة',
        annual: 'العطلة السنوية',
        split: 'العطلة المقسمة',
        private: 'الإجازة الخاصة'
    };
    return labels[type] || type;
}

function getStatusText(vacation) {
    if (vacation.status === 'completed') return 'منتهية';
    if (vacation.status === 'current') return 'حالية';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = parseLocalDate(vacation.startDate);
    const end = parseLocalDate(vacation.endDate);

    if (today < start) return 'قادمة';
    if (today > end) return 'منتهية';
    return 'حالية';
}

function updateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function resetFormFields() {
    document.querySelectorAll('.form-input').forEach(input => {
        if (input.type === 'number') {
            input.value = input.min || '';
        } else {
            input.value = '';
        }
    });

    document.querySelectorAll('[id$="EndDate"]').forEach(span => {
        if (span.tagName === 'SPAN') {
            span.textContent = 'سيتم حسابها تلقائياً';
        }
    });

    updateVacationStatusOptions();
}

function resetVacationForm() {
    editingId = null;
    document.getElementById('noTypeSelected').style.display = 'block';
    document.getElementById('commonFields').classList.add('hidden');
    document.getElementById('formFieldsContainer').innerHTML = '';
    document.getElementById('vacationType').value = '';
    document.getElementById('vacationForm').reset();

    const submitBtn = document.querySelector('#vacationForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-plus-circle ml-2"></i>إضافة إجازة';
    }
}

function deepMerge(target, source, depth = 0) {
    if (depth > 10) {
        console.warn('Max merge depth reached, stopping to prevent stack overflow');
        return target;
    }
    
    for (const key in source) {
        if (source[key] === undefined || source[key] === null) continue;
        
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            if (!target[key]) target[key] = {};
            deepMerge(target[key], source[key], depth + 1);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

// ============================
// وظائف الواجهة المساعدة
// ============================
function showLoadingSpinner() {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) {
        spinner.classList.remove('hidden');
    }
}

function hideLoadingSpinner() {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) {
        spinner.classList.add('hidden');
    }
}

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="flex items-center">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'} ml-2"></i>
            <span>${message}</span>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}



// Virtual scrolling implementation for better performance with long lists
let virtualScrollObserver = null;
let currentVacationIndex = 0;
const VACATIONS_PER_BATCH = 20;

function setupVirtualScrolling() {
    if (!('IntersectionObserver' in window)) {
        console.log('Intersection Observer not supported, skipping virtual scrolling');
        return;
    }
    
    // Clear any existing observer
    if (virtualScrollObserver) {
        virtualScrollObserver.disconnect();
    }
    
    virtualScrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Load more vacations
                loadMoreVacations();
            }
        });
    }, { threshold: 0.1 });
    
    // Create sentinel element
    const sentinel = document.getElementById('scroll-sentinel') || document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    sentinel.style.height = '20px';
    
    const container = document.getElementById('vacationsList');
    if (container) {
        // Remove existing sentinel if any
        const existingSentinel = container.querySelector('#scroll-sentinel');
        if (existingSentinel) {
            existingSentinel.remove();
        }
        
        container.appendChild(sentinel);
        virtualScrollObserver.observe(sentinel);
    }
}

function loadMoreVacations() {
    const container = document.getElementById('vacationsList');
    if (!container) return;
    
    const filterType = document.getElementById('filterType')?.value || 'all';
    const filterYear = document.getElementById('filterYear')?.value || 'all';

    let filteredVacations = [...appData.vacations]; // Create a copy to avoid modifying original

    if (filterType !== 'all') {
        filteredVacations = filteredVacations.filter(v => v.type === filterType);
    }

    if (filterYear !== 'all') {
        filteredVacations = filteredVacations.filter(v => {
            return new Date(v.startDate).getFullYear() === parseInt(filterYear);
        });
    }

    filteredVacations.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    
    // Only append new vacations if we have more to show
    const remainingVacations = filteredVacations.slice(currentVacationIndex, currentVacationIndex + VACATIONS_PER_BATCH);
    
    if (remainingVacations.length === 0) {
        // No more vacations to load, disconnect the observer
        if (virtualScrollObserver) {
            virtualScrollObserver.disconnect();
        }
        return;
    }
    
    // Append new vacation cards to the container
    const newVacationHTML = remainingVacations.map(vacation => createVacationCard(vacation)).join('');
    
    // Create a temporary container to hold new elements
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newVacationHTML;
    
    // Append each vacation card individually to avoid breaking event delegation
    while (tempDiv.firstChild) {
        container.insertBefore(tempDiv.firstChild, document.getElementById('scroll-sentinel'));
    }
    
    currentVacationIndex += remainingVacations.length;
    
    // Check if we've reached the end
    if (currentVacationIndex >= filteredVacations.length) {
        // No more vacations to load, disconnect the observer
        if (virtualScrollObserver) {
            virtualScrollObserver.disconnect();
        }
    }
}

// Reset virtual scrolling when updating the list
function resetVirtualScrolling() {
    currentVacationIndex = 0;
    
    if (virtualScrollObserver) {
        virtualScrollObserver.disconnect();
    }
    
    // Clear the vacation list but keep the sentinel if it exists
    const container = document.getElementById('vacationsList');
    if (container) {
        const sentinel = container.querySelector('#scroll-sentinel');
        container.innerHTML = '';
        if (sentinel) {
            container.appendChild(sentinel);
        }
    }
}

// Clean up on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
    // Clear all scheduled timeouts
    clearScheduledNotifications();
    
    // Clear any pending update queue
    updateQueue = [];
    isProcessingQueue = false;
    
    // Disconnect virtual scroll observer
    if (virtualScrollObserver) {
        virtualScrollObserver.disconnect();
    }
    
    console.log('Cleaned up resources before page unload');
});

// Also clean up on page hide
window.addEventListener('pagehide', () => {
    clearScheduledNotifications();
    updateQueue = [];
    isProcessingQueue = false;
    
    // Disconnect virtual scroll observer
    if (virtualScrollObserver) {
        virtualScrollObserver.disconnect();
    }
});

// Function to trigger background sync for service worker notifications
function triggerBackgroundSync() {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(function(registration) {
            if (registration.sync) {
                registration.sync.register('send-vacation-notifications')
                    .then(function() {
                        console.log('Background sync registered for notifications');
                    })
                    .catch(function(error) {
                        console.error('Background sync registration failed:', error);
                    });
            }
        });
    }
}

// ============================
// معالجة الأخطاء
// ============================
window.addEventListener('error', function (e) {
    console.error('Global error:', e.error);
});

window.addEventListener('unhandledrejection', function (e) {
    console.error('Unhandled promise rejection:', e.reason);
});

// ============================
// استقبال رسائل من Service Worker
// ============================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        console.log('Message from Service Worker:', event.data);
        
        const { type, count } = event.data;
        
        if (type === 'NOTIFICATIONS_SENT' && count > 0) {
            // تحديث UI
            updateNotificationUI();
            
            // التحقق من الإشعارات المستحقة
            if (notificationManager) {
                notificationManager.checkDueNotifications();
            }
        }
    });
}