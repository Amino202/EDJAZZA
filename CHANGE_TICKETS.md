# CHANGE_TICKETS

## CHG-006 — توحيد مصدر حساب الأرصدة وإبطال كاش الإحصاءات

- **الحالة:** IMPLEMENTED
- **المالك:** أبو هارون
- **النطاق:** `app.js` و`stats-worker.js` والتوثيق المطلوب لهذه التذكرة فقط
- **Push:** لم يُنفذ

### المواصفة المعتمدة

1. حساب `shortBalance` من `appData.vacations` من الصفر مثل `annualBalance` و`splitBalance`.
2. إبقاء التجديد الدوري الطبيعي للرصيد القصير، مع تصحيح رصيد حذف/تعديل الإجازة القصيرة فورًا.
3. توحيد `stats-worker.js` مع `app.js` باستخدام `APP_CONFIG.DEFAULT_VACATION_BALANCE` الممررة من المسار الرئيسي، دون أرقام افتراضية مستقلة.
4. توسيع `getVacationsHash` و`getCachedStatsKey` ليشملا الأيام والنوع والحالة وما يلزم من الإعدادات حتى يبطل تغييرها الكاش.
5. جعل `revertVacationImpact` يعيد أثر `short` و`annual` و`split` وفق حدود المصدر الافتراضي.

### خارج النطاق

لم تُعدّل قواعد التحقق من صحة الإجازة أو فحص التداخل، ولم يُوحّد منطق التقويم أو التواريخ، ولم يُعدّل `backend/server.js`.

### معايير القبول

- **AC1:** إضافة ثم حذف `short` و`annual` و`split` و`private` يعيد الرصيد/العداد المتأثر إلى قيمته الأصلية.
- **AC2:** نتائج الحساب للمجموعة نفسها تتطابق بين المسار الرئيسي و`stats-worker.js`.
- **AC3:** تغيير عدد أيام إجازة موجودة دون تغيير العدد أو التواريخ يغيّر الرصيد فورًا ولا يعيد قيمة كاش قديمة.

### دليل الإنجاز E1–E5

#### E1 — مسوّغ التغيير والسبب الجذري

كان `shortBalance` لغير المستخدم المستمر محفوظًا من القيمة السابقة بدل اشتقاقه من السجل، وكان `stats-worker.js` يستخدم القيم الثابتة 30 بدل مصدر الإعدادات، كما أن مفاتيح الكاش لم تكن تشمل الأيام والنوع والحالة. وكان `revertVacationImpact` يعيد أثر `split` فقط، مع فرعين فارغين لـ`short` و`annual`.

#### E2 — الآلية المنفذة

أزيل النقص اليدوي في `addVacation`، وأصبح الحساب الرئيسي يشتق الرصيد القصير من السجلات. أُعيد ضبط تاريخ الإجازة القصيرة الأحدث بعد حذفها، وأصبح `revertVacationImpact` يعيد `short` و`annual` و`split` مع حدود `APP_CONFIG.DEFAULT_VACATION_BALANCE`. وُسعت بصمة الإجازات لتضم المعرّف والتاريخين والأيام والنوع والحالة، ووُسع مفتاح الكاش ليضم البصمة ونوع المستخدم والإعدادات والفترات. يمرر المسار الرئيسي `APP_CONFIG.DEFAULT_VACATION_BALANCE` إلى العامل، ويستخدم العامل المصدر نفسه بدل الأرقام المكتوبة يدويًا.

#### E3 — الملفات المتأثرة

الملفات المتأثرة كاملةً:

- `app.js`
- `stats-worker.js`
- `CHANGE_TICKETS.md`
- `PROJECT_MAP.md`

معرّف الالتزام المحلي لتنفيذ الكود والتوثيق الأولي: `caf09067bd200cb2c9b427f35ec7ec8e081ad43e`.

#### E4 — دليل التغطية والاختبار الفعلي

الأداة المؤقتة خارج المستودع هي `/tmp/chg006_acceptance_test.js`، والأمر القابل لإعادة التنفيذ هو:

```text
node /tmp/chg006_acceptance_test.js
```

المخرجات الفعلية:

```text
AC1 PASS
AC2 PASS {"main":{"shortBalance":6,"annualBalance":27,"splitBalance":28,"privateCount":1,"completedPrivateCount":1,"totalUsed":6},"worker":{"totalUsed":6,"annualBalance":27,"splitBalance":28,"privateCount":1,"completedPrivateCount":1,"shortBalance":6}
AC3 PASS {"beforeDays":29,"afterDays":25,"hash":"[{\"id\":\"cache\",\"startDate\":\"2026-06-01\",\"endDate\":\"2026-06-01\",\"days\":5,\"type\":\"annual\",\"status\":\"completed\"}]"}
```

كما نجح فحص الصياغة:

```text
node --check app.js
node --check stats-worker.js
git diff --check
```

#### E5 — حالة المشروع والحدود

حُدّث `PROJECT_MAP.md` إلى `IMPLEMENTED` وسُجل هذا الدليل داخل `CHANGE_TICKETS.md`. لم تُعدّل قواعد التحقق أو التداخل، ولم يُوحّد التقويم أو التواريخ، ولم يُعدّل `backend/server.js`. لم يُنفذ push.

الالتزام المحلي الأساسي للتنفيذ هو `caf09067bd200cb2c9b427f35ec7ec8e081ad43e`، ويُضاف أي التزام لاحق فقط لاستكمال مرجع التوثيق.

---

## CHG-007 — تشديد قواعد التحقق من صحة الإجازات

- **الحالة:** IMPLEMENTED
- **المواصفة:** معتمدة من المالك؛ تُنفذ بنود المواصفة الأربعة فقط.
- **النطاق المنفذ:** `app.js` وقِطع دليل التنفيذ في هذه الوثيقة و`PROJECT_MAP.md`.
- **Push:** لم يُنفذ.

### المواصفة المعتمدة

1. قبول أنواع الإجازات الأربعة المعتمدة فقط: `short` و`annual` و`split` و`private`، ورفض أي نوع آخر.
2. منع تداخل أي إجازة مع أي إجازة موجودة من أي نوع، بما في ذلك `private`، مع استثناء الإجازة الجاري تعديلها نفسها عبر `editingId`.
3. إزالة التحقق المكرر للفترة القصيرة بحيث يوجد مسار تحقق واحد فقط.
4. إبقاء فحوص الرصيد القائمة للأنواع التي لها رصيد، دون اختراع قاعدة رصيد جديدة لنوع `private`.

### خارج النطاق

لم تُغيّر قواعد العمل غير المذكورة في المواصفة، ولم يُعدّل `backend/server.js` أو `stats-worker.js` أو Service Worker أو منظومة الإشعارات. لم تُحذف مكونات ولم تُغيّر قواعد التقويم أو مصدر إعدادات الفترات خارج ما يلزم لإزالة التكرار المحدد. لم يُنفذ push.

### معايير القبول

- **AC1:** النوع غير المعروف يُرفض ولا تُضاف إجازة إلى السجل.
- **AC2:** التداخل يُرفض في الاتجاهين: `private` مع إجازة أخرى، وأي نوع آخر مع `private`، وكذلك التداخل بين الإجازات الأخرى.
- **AC3:** يوجد فحص واحد فقط للفترة القصيرة في دالة التحقق.
- **AC4:** فحوص الرصيد الحالية لـ`short` و`annual`، وفحص التداخل لـ`split`، تستمر في الرفض عند تحقق شروطها.

### دليل الإنجاز E1–E5

#### E1 — مسوّغ التغيير والسبب الجذري

كانت دالة `validateVacationRules` تسمح عمليًا بمرور نوع غير معروف ما دام لم يصطدم بفحص آخر، وكان فحص التداخل العام يحتاج إلى تغطية صريحة للإجازة الخاصة، كما بقي فحص منفصل خاص بـ`split` بعد فحص التداخل العام، وظهر فحص الفترة القصيرة في مسار قابل للتكرار. عالج التغيير هذه المسارات داخل نقطة التحقق نفسها دون تعديل منظومة الإشعارات أو الحسابات.

#### E2 — الآلية المنفذة

أضيفت قائمة الأنواع المدعومة صراحةً داخل `validateVacationRules`، مع رفض النوع غير الموجود وإظهار رسالة `نوع الإجازة غير معروف`. أصبح فحص `hasOverlap` العام يختبر كل السجلات دون استثناء النوع، مع استثناء سجل التعديل نفسه فقط. أُبقي فحص الرصيد الحالي للأنواع `short` و`annual` وفحص التداخل الخاص بـ`split` كما هو ضمن حدود التذكرة، وجُعل فحص الفترة القصيرة موحدًا في كتلة واحدة.

#### E3 — الملفات المتأثرة

الملفات المتأثرة كاملةً:

- `app.js`
- `CHANGE_TICKETS.md`
- `PROJECT_MAP.md`

لا يحتوي مستودع البيئة الحالية على مجلد `.git`، لذلك تعذر استخراج معرّف commit جديد أو إنشاء commit محلي دون إعادة إنشاء تاريخ Git وفقدان التاريخ السابق. لم أُنشئ مستودعًا بديلًا ولم أُعد كتابة التاريخ. يجب استكمال commit CHG-007 بعد استعادة نسخة المستودع التي تحتوي على تاريخ Git.

#### E4 — دليل التغطية والاختبار الفعلي

أداة الاختبار المؤقتة خارج المستودع هي `/tmp/chg007_acceptance_test.js`، والأمر القابل لإعادة التنفيذ هو:

```text
node /tmp/chg007_acceptance_test.js
```

المخرجات الفعلية:

```text
AC1 PASS {"unknown":{"accepted":false,"messages":[{"message":"نوع الإجازة غير معروف","level":"error"}]},"vacationsAfterUnknown":0}
AC2 PASS {"privateAgainstAnnual":{"accepted":false,"messages":[{"message":"لا يمكن إضافة إجازة في فترة تتداخل مع إجازة أخرى موجودة","level":"error"}]},"annualAgainstPrivate":{"accepted":false,"messages":[{"message":"لا يمكن إضافة إجازة في فترة تتداخل مع إجازة أخرى موجودة","level":"error"}]}}
AC3 PASS {"exactShortPeriodChecks":1}
AC4 PASS {"shortInsufficient":{"accepted":false,"messages":[{"message":"ليس لديك رصيد كافٍ من الإجازة القصيرة","level":"error"}]},"annualInsufficient":{"accepted":false,"messages":[{"message":"ليس لديك رصيد كافٍ من العطلة السنوية","level":"error"}]},"splitOverlap":{"accepted":false,"messages":[{"message":"لا يمكن تداخل تواريخ العطلة المقسمة مع إجازة مقسمة أخرى","level":"error"}]}}
```

وفحوص الصياغة المنفذة:

```text
node --check /home/ubuntu/repos/EDJAZZA/app.js
```

نجح الفحص. أما `git diff --check` فلم يكن قابلاً للتنفيذ في النسخة المستعادة لأن `.git` غير موجود.

#### E5 — حالة المشروع والحدود

حُدّث `PROJECT_MAP.md` إلى `IMPLEMENTED` وسُجل هذا الدليل داخل `CHANGE_TICKETS.md`. لا يُعلن هذا الدليل حالة `VERIFIED` أو `CLOSED`؛ المراجعة المستقلة وإغلاق المالك لاحقان وفق المنهجية. الحد التشغيلي الحالي هو غياب تاريخ Git من البيئة المستعادة، ولذلك لا يوجد commit جديد ولا diff تاريخي قابل للاستخراج. لم يتغير هذا الحد إلى إجراء بديل، ولم يُدفع أي شيء إلى remote.

---

## CHG-008 — توحيد تحليل التواريخ

- **الحالة:** IMPLEMENTED
- **المواصفة:** APPROVED
- **النطاق المنفذ:** `app.js`، `CHANGE_TICKETS.md`، `PROJECT_MAP.md`
- **Push:** لم يُنفذ.

### المواصفة المعتمدة

استُبدلت قراءات تواريخ الإجازات المخزنة التي كانت تستخدم `new Date(...)` باستخدام `parseLocalDate(...)` في المواضع المحددة بالمواصفة، مع حواجز `null` للتواريخ التالفة. لم يُعدّل `backend/server.js` ولم تُغيّر قواعد الرصيد أو التحقق.

### E1 — مسوّغ التغيير والسبب الجذري

كان تحليل النصوص `YYYY-MM-DD` عبر `new Date(dateString)` يفسر النص كنقطة زمنية UTC، بينما يفسره `parseLocalDate` كتاريخ محلي عند منتصف الليل بعد التحقق من صحته. أدى ذلك إلى اختلاف اليوم المحلي، خصوصًا في المناطق الزمنية السالبة، وإلى احتمال اختلاف التداخل والفرز والتصفية والإحصاءات بين المسارات.

### E2 — الآلية المنفذة

استُبدلت قراءات `startDate` و`endDate` المخزنة في `scheduleAllNotifications` و`updateNotificationUI` و`shareVacation` و`copyVacationToClipboard` و`updateVacationStatusOptions` و`validateVacationData` و`validateVacationRules` و`performDeleteVacation` و`updateStats` و`updateVacationsList` و`loadMoreVacations` بـ`parseLocalDate`.

أضيفت الحواجز التالية: تجاهل الإجازة ذات التاريخ التالف في جدولة الإشعارات وواجهة الإشعارات والتداخل؛ رفض التاريخ التالف في `validateVacationData` بالرسالة القائمة `التاريخ المدخل غير صحيح`؛ تجاهل التاريخ التالف في فحص الحالة؛ عدم عدّ الإجازة الخاصة ذات البداية التالفة؛ واستعمال ترتيب آمن يضع السجلات ذات التاريخ الصالح قبل السجلات ذات التاريخ التالف. كما استُخدم `parseLocalDate` في مواضع إنشاء نهايات الإجازات من `data.startDate` حتى يحقق فحص AC1 صفرًا لكل الأنماط المحددة.

### E3 — الملفات المتأثرة

- `app.js`
- `CHANGE_TICKETS.md`
- `PROJECT_MAP.md`

لم يُعدّل `backend/server.js`، ولم تُلمس مواضعا `new Date().toISOString()` فيه. لم يُنشأ commit بعد في هذه اللحظة؛ سيُسجل معرّف الالتزام بعد تنفيذ الالتزام المحلي.

### E4 — دليل التغطية والاختبار الفعلي

#### AC1 — فحص بقاء الأنماط الممنوعة

الأمر:

```text
grep -n -E 'new Date\\((v|vacation|data)\\.(startDate|endDate)|new Date\\((v|vacation)\\.endDate' app.js
```

المخرجات الفعلية: فارغة، أي صفر مطابقات.

#### AC2 — الاختبار في منطقتين زمنيتين

الأمر المستخدم:

```text
TZ=Etc/GMT-3 node /tmp/chg008_acceptance_test.js
TZ=Etc/GMT+5 node /tmp/chg008_acceptance_test.js
```

المخرجات الفعلية:

```text
{"TZ":"Etc/GMT-3","input":"2026-01-15","parsedDay":15,"parsedMonth":1,"parsedYear":2026,"invalidDateIsNull":true,"overlapRejected":true}
{"TZ":"Etc/GMT+5","input":"2026-01-15","parsedDay":15,"parsedMonth":1,"parsedYear":2026,"invalidDateIsNull":true,"overlapRejected":true}
```

#### AC3 — عدم كسر سلوك التحقق السابق

شُغّلت نسخة اختبار CHG-007 المكيّفة لتضمين اعتماد `parseLocalDate`:

```text
node /tmp/chg007_acceptance_test_chg008.js
```

والنتيجة الفعلية:

```text
AC1 PASS {"unknown":{"accepted":false,"messages":[{"message":"نوع الإجازة غير معروف","level":"error"}]},"vacationsAfterUnknown":0}
AC2 PASS {"privateAgainstAnnual":{"accepted":false,"messages":[{"message":"لا يمكن إضافة إجازة في فترة تتداخل مع إجازة أخرى موجودة","level":"error"}]},"annualAgainstPrivate":{"accepted":false,"messages":[{"message":"لا يمكن إضافة إجازة في فترة تتداخل مع إجازة أخرى موجودة","level":"error"}]}}
AC3 PASS {"exactShortPeriodChecks":1}
AC4 PASS {"shortInsufficient":{"accepted":false,"messages":[{"message":"ليس لديك رصيد كافٍ من الإجازة القصيرة","level":"error"}]},"annualInsufficient":{"accepted":false,"messages":[{"message":"ليس لديك رصيد كافٍ من العطلة السنوية","level":"error"}]},"splitOverlap":{"accepted":false,"messages":[{"message":"لا يمكن تداخل تواريخ العطلة المقسمة مع إجازة مقسمة أخرى","level":"error"}]}}
```

نجح فحص الصياغة التالي:

```text
node --check app.js
```

أما `npm test` ففشل في البيئة الحالية لأن `package.json` على `main` لا يحتوي script باسم `test`:

```text
npm error Missing script: "test"
```

لا يُنسب هذا الفشل إلى تغيير CHG-008؛ لم يُعدّل `package.json` ضمن هذه التذكرة.

#### E5 — الحدود والحالة

لم يُعدّل `backend/server.js`، ولم تُغيّر قواعد الأرصدة أو قواعد التحقق الوظيفية، ولم يُنفذ push. أداة `/tmp/chg008_acceptance_test.js` وأداة `/tmp/chg007_acceptance_test_chg008.js` مؤقتتان وخارج المستودع. الحالة التنفيذية هي `IMPLEMENTED` فقط، وليست `VERIFIED` أو `CLOSED`.

---
## CHG-010 — تثبيت نموذج الإشعار والجدولة

- **الحالة:** IMPLEMENTED
- **المواصفة:** APPROVED
- **النطاق المنفذ:** `notification-manager.js` و`PROJECT_MAP.md` و`CHANGE_TICKETS.md`
- **Push:** يُنفذ مباشرة بعد الالتزام وفق قاعدة المالك.

### E1 — مسوّغ التغيير والسبب الجذري

كانت `scheduleVacationNotifications(vacation, settings)` تنشئ سجلات جدولة جديدة مباشرة، بينما كانت الجدولات السابقة لنفس `vacationId` تبقى في قاعدة الإشعارات بحالة `scheduled`. يؤدي تكرار الجدولة، خصوصًا بعد التعديل، إلى بقاء جدولة قديمة نشطة إلى جانب الجديدة.

### E2 — الآلية المنفذة

أُضيف الاستدعاء التالي في بداية `scheduleVacationNotifications` بعد التحقق من وجود `vacation` و`settings` وقبل إنشاء أي إشعار جديد:

```javascript
await this.cancelVacationNotifications(vacation.id);
```

لم تُعدّل `cancelVacationNotifications` أو منطقها الداخلي. وُثّق في `PROJECT_MAP.md` اسم قاعدة البيانات والجدول والحقول والحالات وقاعدة الإلغاء قبل إعادة الجدولة، مع تحذير إبقاء مخطط `notification-manager.js` و`sw.js` متزامنًا مستقبلًا دون توحيدهما الآن.

### E3 — الملفات المتأثرة

- `notification-manager.js`
- `PROJECT_MAP.md`
- `CHANGE_TICKETS.md`

خارج الملفات المتأثرة: `backend/server.js` و`sw.js` و`app.js`.

### E4 — دليل التغطية والاختبار الفعلي

#### AC1 — إعادة الجدولة لنفس الإجازة

شُغّل اختبار محاكاة فعلي في Node باستخدام كائن IndexedDB وهمي ينفذ معاملات `readwrite` و`objectStore` وفهرس `vacationId` وعمليات `add` و`openCursor` و`update`. استُخرجت `NotificationManager` من `notification-manager.js`، ثم استُدعيت `scheduleVacationNotifications` مرتين لنفس `vacationId`.

الأمر:

```text
node /tmp/chg010_acceptance_test.js
```

النتيجة الفعلية:

```text
AC1 PASS {"firstScheduled":3,"secondScheduled":3,"cancelledAfterReschedule":3,"scheduledForVacation":3}
```

تعني النتيجة أن الاستدعاء الأول أنشأ 3 سجلات `scheduled`، وأن الاستدعاء الثاني ألغى السجلات الثلاثة السابقة ثم أنشأ 3 سجلات جديدة؛ لذلك بقي عدد السجلات `scheduled` لنفس الإجازة مساويًا لما ينتجه استدعاء واحد.

#### AC2 — عدم تغيير الخادم أو نقاط Push الفعلية

الأوامر المستخدمة:

```text
git diff -- backend/server.js
sha256sum backend/server.js
```

كان `git diff -- backend/server.js` فارغًا قبل التغيير وبعده، ولم يُعدّل `backend/server.js`. لم تُضف أو تُعدّل نقاط Push الفعلية، ولم يُنفذ Push حقيقي أو تغيير في `sw.js`.

### E5 — الحدود والحالة

لم تُعدّل دالة `cancelVacationNotifications`، ولم يُوحّد مخطط قاعدة البيانات بين `notification-manager.js` و`sw.js`، ولم يُحمّل `notification-manager.js` في `index.html`، ولم يُعدّل `backend/server.js` أو `sw.js`. هذا التغيير يختبر جدولة IndexedDB عبر محاكاة محلية فقط، ولا يختبر إرسال Push حقيقي؛ تفعيل واختبار الإرسال الفعلي خارج نطاق CHG-010 ومؤجل لـCHG-009. الحالة الحالية `IMPLEMENTED`، وسيُسجل معرّف الالتزام بعد الالتزام المحلي ثم يُدفع مباشرة وفق المواصفة.

---
## CHG-009-A — الخادم يرسل التذكيرات في وقتها

- **الحالة:** IMPLEMENTED
- **المواصفة:** APPROVED
- **النطاق المنفذ:** `backend/server.js` و`backend/tests/chg009a.test.js` وملفات التوثيق
- **الملفات خارج النطاق:** `app.js` و`sw.js` و`notification-manager.js` و`index.html` و`backend/package.json`

### E1 — مسوّغ التغيير والسبب الجذري

كان الخادم يسجل كل اشتراك جديد باستخدام `Date.now()` دون upsert أو فهرس فريد على `endpoint`، ولم يكن لديه جدول لجدولة التذكيرات أو دورة إرسال داخلية. لذلك لم يكن هناك مسار خادمي يحوّل قائمة التذكيرات إلى Push في وقتها، وكانت التكرارات والجدولات القديمة ممكنة.

### E2 — الآلية المنفذة

- استُخدم مسار قاعدة البيانات `process.env.DB_PATH || 'subscriptions.db'`.
- عند بدء الخادم، تُزال التكرارات ويُبقى أحدث صف لكل `endpoint`، ثم يُنشأ فهرس فريد عليه.
- `/api/subscribe` أصبح upsert حسب `endpoint`، ويحدّث `auth` و`p256dh` ويعيد المعرّف نفسه، أو ينشئ معرّفًا عبر `crypto.randomUUID()`.
- أُنشئ جدول `scheduled_pushes` بالحقول والحالات والفهارس المحددة في المواصفة.
- أضيفت `PUT /api/schedule`: يتحقق من المدخلات، يحدّ الطلب إلى 120 تذكيرًا، يتجاهل `sendAt <= الآن`، ويحذف الصفوف `scheduled` للهاتف داخل معاملة واحدة ثم يدرج القائمة الجديدة عبر `INSERT OR IGNORE`، مع إبقاء الصفوف `sent`.
- أضيف `processScheduledPushes` قابل للاستيراد في الاختبار، ومجدول `setInterval` كل 60 ثانية يبدأ داخل callback الخاص بـ`app.listen` فقط.
- الصف المتأخر أكثر من 24 ساعة يصبح `expired`، والصف المستحق يُرسل عبر `web-push` بحمولة `title/body/tag/data` ثم يصبح `sent`. الفشل المؤقت يزيد `attempts` ويصبح `failed` عند المحاولة الخامسة. ردّا 404 و410 يحذفان الاشتراك وكل صفوفه.
- أضيف تنظيف يومي للصفوف النهائية الأقدم من 30 يومًا.
- `/api/unsubscribe` يحذف صفوف `scheduled_pushes` المرتبطة أيضًا.
- بقيت نقاط `/api/send-notification` و`/api/broadcast-notification` موجودة دون تغيير وظيفي مقصود، وحافظت طبقة CHG-003 على Origin وحد الجسم وحد المعدل والردود العامة.
- جُعل إرسال `web-push` قابلًا للاستبدال عبر `setWebPushSender`/المعامل `sendPush` في الاختبار.

### E3 — الملفات المتأثرة

- `backend/server.js`
- `backend/tests/chg009a.test.js`
- `CHANGE_TICKETS.md`
- `PROJECT_MAP.md`

لم تُعدّل `backend/package.json` أو أي ملف آخر خارج القائمة المعتمدة.

### E4 — دليل التغطية والاختبار الفعلي

أُنشئ الاختبار الدائم داخل المستودع في `backend/tests/chg009a.test.js`، ويستخدم قاعدة SQLite مؤقتة وإرسال `web-push` وهميًا.

الأمر الصريح المطلوب لتشغيل اختبارات backend هو:

```text
node --test backend/tests/*.test.js
```

جُرّب أيضًا الأمر الحرفي `node --test backend/tests/`، لكن Node.js 22 في هذه البيئة لا يعامل مسار المجلد كمدخل test صالح وأعاد:

```text
Error: Cannot find module '/home/ubuntu/repos/EDJAZZA/backend/tests'
```

بعد ذلك شُغّل الأمر الصريح بصيغة ملفات الاختبار، وكانت المخرجات الفعلية:

```text
✓ قاعدة البيانات جاهزة
AC1 PASS {"idsEqual":true,"rows":1}
AC2 PASS {"first":{"scheduled":1,"skipped":0},"second":{"scheduled":1,"skipped":0},"rows":[{"vacation_id":"vac-2","status":"scheduled"}]}
AC3 PASS {"first":{"sent":1,"expired":0,"failed":0},"second":{"sent":0,"expired":0,"failed":0},"sends":1,"status":"sent"}
AC4 PASS {"result":{"sent":0,"expired":1,"failed":0},"sends":0,"status":"expired"}
AC5 PASS {"subscriptions":0,"scheduledPushes":0}
✔ AC1: same endpoint is upserted and keeps one id
✔ AC2: replacing a schedule leaves only the second list
✔ AC3: due reminder is sent once and second cycle does not resend
✔ AC4: reminder older than 24 hours expires without sending
✔ AC5: 410 removes subscription and all its scheduled pushes
CHG-003 PASS {"forbidden":403,"tooLarge":413,"invalid":400,"rateLimited":429}
✔ CHG-003 regression: 403, 413, 429 and generic validation response remain enforced
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

كما نجحت الفحوص:

```text
node --check backend/server.js
node --check backend/tests/chg009a.test.js
git diff --check
```

### E5 — الحالة والحدود

تم اختبار AC1 إلى AC5 فعليًا بقاعدة مؤقتة وإرسال وهمي، ولم يُرسل أي Push حقيقي إلى هاتف أو إلى بيئة إنتاج. لم تُعدّل واجهة العميل أو Service Worker أو مدير الإشعارات، ولم تُنفذ مصادقة جديدة أو معالجة تنبيه الرصيد القصير، ولم يُغيّر `trust proxy` أو منطق حد المعدل. لم يُعدّل `backend/package.json`؛ لذلك يبقى script الاختبار الفاشل عمدًا في نطاق CHG-013. الحالة التنفيذية `IMPLEMENTED`، وسيُسجل معرّف الالتزام بعد الالتزام ثم يُدفع فورًا وفق المواصفة.
