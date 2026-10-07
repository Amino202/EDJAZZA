# PROJECT_MAP

## الحالة الحالية

- **المشروع:** EDJAZZA
- **آخر تغيير موثق:** CHG-007 — تشديد قواعد التحقق من صحة الإجازات
- **الحالة:** IMPLEMENTED
- **الالتزام الأساسي السابق:** `caf09067bd200cb2c9b427f35ec7ec8e081ad43e`
- **التزام CHG-007:** غير منشأ في البيئة الحالية لأن نسخة المستودع المستعادة لا تحتوي على `.git`; لم تُنشأ نسخة Git بديلة ولم يُعاد كتابة التاريخ.

## نطاق CHG-006 المنفذ

أصبح `shortBalance` مشتقًا من سجل الإجازات، ووُحّد حساب `stats-worker.js` مع مصدر `APP_CONFIG.DEFAULT_VACATION_BALANCE`، ووُسعت بصمات الكاش لتشمل الأيام والنوع والحالة، وأصبح حذف/تعديل الإجازة القصيرة يعيد الحساب فورًا. عولج `revertVacationImpact` للأنواع `short` و`annual` و`split`.

## خريطة مسارات الاستخدام (CHG-005)

| المكوّن | الحالة | الدليل المثبت |
|---|---|---|
| `server.js` (الجذر) | يتيم مؤكّد محليًا | لا يظهر في Procfile أو railway.toml؛ النشر يستخدم backend/server.js حصرًا |
| `backend/server.js` | مستخدَم فعليًا (الخادم الحي) | Procfile وrailway.toml يدخلان backend قبل npm start |
| `pwabuilder-sw.js` | يتيم مؤكّد محليًا | لا تسجيل له في app.js أو index.html أو manifest.json |
| `sw.js` | مستخدَم فعليًا | navigator.serviceWorker.register('./sw.js') في app.js |
| `stats-worker.js` | مستخدَم فعليًا | new Worker('./stats-worker.js') في app.js |
| `notification-manager.js` | يحتاج قرارًا؛ مؤجّل لـCHG-009/010 | موجود لكن غير محمَّل حاليًا في index.html |

## حدود CHG-006

لم تُعدّل قواعد التحقق من صحة الإجازة أو فحص التداخل، ولم يُوحّد منطق التقويم أو التواريخ، ولم يُعدّل `backend/server.js`. لم يُنفذ push.

## نطاق CHG-007 المنفذ

- `validateVacationRules` يرفض الأنواع غير الموجودة في القائمة المعتمدة: `short`, `annual`, `split`, `private`.
- فحص التداخل العام يشمل جميع الأنواع، بما فيها `private`، ويستثني سجل الإجازة الجاري تعديله فقط.
- فحص الفترة القصيرة موجود في مسار تحقق واحد.
- فحوص الرصيد القائمة لـ`short` و`annual` وفحص التداخل القائم لـ`split` ما زالت تعمل.

## دليل التحقق القابل لإعادة التنفيذ لـCHG-007

```text
node /tmp/chg007_acceptance_test.js
node --check /home/ubuntu/repos/EDJAZZA/app.js
```

نتيجة اختبار القبول: `AC1 PASS`, `AC2 PASS`, `AC3 PASS`, `AC4 PASS`.

## حدود CHG-007

لم تُعدّل منظومة الإشعارات أو `backend/server.js` أو `stats-worker.js` أو Service Worker، ولم يُنفذ push. لا تُعلن هذه الخريطة حالة `VERIFIED` أو `CLOSED`. يلزم استعادة مستودع Git ذي التاريخ السابق قبل إنشاء commit CHG-007؛ تجنبًا لكسر شرط حفظ التاريخ، لم يُنشأ مستودع بديل.


## CHG-008 — توحيد تحليل التواريخ

- **الحالة:** IMPLEMENTED
- **الملفات السلوكية:** `app.js`
- **ملفات التوثيق:** `CHANGE_TICKETS.md` و`PROJECT_MAP.md`
- **المنفذ:** استُبدلت قراءات تواريخ الإجازات المخزنة في المواضع المحددة بـ`parseLocalDate`، مع حواجز للتواريخ التالفة في التحقق والتداخل والفرز والتصفية والإحصاءات وواجهة الإشعارات.
- **التحقق:** صفر مطابقات لأنماط `new Date` المحددة في AC1؛ نجح اختبار `2026-01-15` في `TZ=Etc/GMT-3` و`TZ=Etc/GMT+5` مع `parsedDay:15` في البيئتين؛ نجح اختبار CHG-007 المكيّف وفحص الصياغة؛ أما `npm test` فغير متاح على `main` الحالي لأن `package.json` لا يحتوي script باسم `test`.
- **الحدود:** لم يُعدّل `backend/server.js`، ولم تُغيّر قواعد الرصيد أو التحقق الوظيفية، ولم يُنفذ push. الحالة `IMPLEMENTED` وليست `VERIFIED` أو `CLOSED`.

## نموذج الإشعار (CHG-010)

تستخدم منظومة الإشعارات قاعدة IndexedDB باسم `VacationNotificationsDB` وبإصدار `1`، وبها جدول واحد باسم `notifications`. حقول سجل الإشعار هي: `vacationId`, `type`, `title`, `body`, `scheduledTime`, `createdAt`, `status`, `sent`, و`data`، مع معرّف `id` ينشئه IndexedDB تلقائيًا. حالات السجل الثلاث هي `scheduled` و`sent` و`cancelled`.

قاعدة الجدولة المعتمدة في CHG-010 هي **إلغاء الإشعارات السابقة قبل إعادة الجدولة**: تستدعي `scheduleVacationNotifications(vacation, settings)` أولًا `cancelVacationNotifications(vacation.id)`، ثم تنشئ السجلات الجديدة. لا تُعدّل دالة الإلغاء نفسها؛ وتحافظ على السجلات السابقة بحالة `cancelled` بدل حذفها.

تحذير تشغيلي: مخطط قاعدة البيانات معرّف بشكل مستقل ومكرر في كل من `notification-manager.js` و`sw.js`، بما في ذلك `DB_NAME` و`DB_VERSION` والفهارس. يجب أن يُطبّق أي تعديل مستقبلي على المخطط في الملفين معًا، وإلا قد تتعطل القراءة والكتابة بينهما. لم يُوحّد هذا التكرار ضمن CHG-010.


## CHG-009-A — جدولة وإرسال التذكيرات من الخادم

- **الحالة:** IMPLEMENTED
- **الملفات السلوكية:** `backend/server.js`
- **اختبار القبول الدائم:** `backend/tests/chg009a.test.js`
- **المسار:** `process.env.DB_PATH || 'subscriptions.db'`، مع جدول `scheduled_pushes`، وupsert للاشتراكات حسب `endpoint`، ونقطة `PUT /api/schedule`، ومجدول داخلي كل 60 ثانية يبدأ بعد `app.listen`.
- **التحقق:** الأمر `node --test backend/tests/*.test.js` نجح: AC1 وAC2 وAC3 وAC4 وAC5 وارتداد CHG-003، بإجمالي 6 اختبارات ناجحة و0 فاشلة.
- **الحدود:** لم تتغير `app.js` أو `sw.js` أو `notification-manager.js` أو `index.html` أو `backend/package.json`، ولم يُرسل Push حقيقي. الأمر `node --test backend/tests/` غير مدعوم كمسار مجلد في Node.js 22؛ استُخدم نمط ملفات الاختبار الصريح أعلاه.
