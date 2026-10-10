# دليل إعداد Render بعد رفع مشروع مكتب معجم إلى GitHub

## الهدف من هذا الملف

بعد فك ضغط ملف المشروع ورفع مجلد `مكتب_معجم_حزمة` إلى GitHub، يجب إنشاء أو تعديل خدمة Web Service في Render حتى يعرف Render:

- مستودع GitHub الذي سيقرأ منه المشروع.
- أمر تثبيت المكتبات.
- أمر تشغيل السيرفر.
- منفذ الخدمة.
- رابط فحص الصحة.
- متغيرات MongoDB والمصادقة.
- رابط الواجهة المسموح له بالاتصال بالسيرفر.

المشروع الحالي يعمل كسيرفر واحد يخدم:

```text
واجهة HTML من مجلد public
API من server/src/server.js
MongoDB Atlas كقاعدة بيانات
```

---

# 1. شكل المستودع الصحيح في GitHub

يجب أن تكون ملفات المشروع داخل المستودع بهذا الشكل:

```text
mojam-office/
├── public/
│   ├── index.html
│   └── واجهة_مكتب_معجم.html
├── server/
│   ├── src/
│   │   └── server.js
│   ├── scripts/
│   │   └── seed-admin.js
│   ├── package.json
│   ├── package-lock.json
│   └── .env.example
├── mongodb/
│   └── init.js
├── render.yaml
├── README_AR.md
├── دليل_الربط_والتعديل_المستقبلي.md
└── .gitignore
```

## تنبيه مهم

لا ترفع مجلدًا إضافيًا حول المشروع بالخطأ، مثل:

```text
mojam-office/مكتب_معجم_حزمة/public/index.html
```

إذا كان هذا هو الشكل الموجود في GitHub، فعلى المطور ضبط `Root Directory` في Render إلى:

```text
مكتب_معجم_حزمة
```

أما إذا كانت `public` و`server` في جذر المستودع مباشرة، فيترك `Root Directory` فارغًا.

---

# 2. قبل فتح Render

يجب أن يتأكد المطور من الأمور التالية:

```text
[ ] تم رفع public وserver وmongodb إلى GitHub
[ ] يوجد server/package.json
[ ] يوجد server/src/server.js
[ ] يوجد render.yaml
[ ] تم أخذ نسخة احتياطية من قاعدة MongoDB الموجودة
[ ] لديه MongoDB Connection String
[ ] يعرف اسم قاعدة البيانات
[ ] لديه كلمة مرور مدير قوية
```

يجب ألا يوجد في GitHub:

```text
.env
MONGODB_URI الحقيقي
كلمة مرور MongoDB
ADMIN_PASSWORD الحقيقي
JWT_SECRET الحقيقي
AI_PROVIDER_KEY
SMS_PROVIDER_TOKEN
```

---

# 3. إنشاء الخدمة في Render باستخدام Blueprint

هذه الطريقة مناسبة إذا كان ملف `render.yaml` موجودًا في جذر المستودع.

## الخطوات

1. افتح لوحة Render.
2. اضغط **New**.
3. اختر **Blueprint**.
4. اربط حساب GitHub إذا لم يكن مربوطًا.
5. اختر مستودع المشروع.
6. اختر الفرع، غالبًا:

```text
main
```

7. راجع الخدمة التي قرأها Render من `render.yaml`.
8. اضغط **Apply** أو **Create Blueprint Instance**.
9. أدخل القيم التي عليها `sync: false`.
10. انتظر انتهاء Build وDeploy.

ملف `render.yaml` الموجود في الحزمة يضبط افتراضيًا:

```yaml
runtime: node
rootDir: .
buildCommand: cd server && npm install
startCommand: node server/src/server.js
healthCheckPath: /api/health
port: 10000
```

إذا كان مجلد المشروع داخل مجلد إضافي، غيّر:

```yaml
rootDir: .
```

إلى مسار المجلد الفعلي، مثل:

```yaml
rootDir: مكتب_معجم_حزمة
```

---

# 4. إنشاء Web Service يدويًا

إذا لم يرغب المطور باستخدام Blueprint:

1. افتح Render.
2. اضغط **New**.
3. اختر **Web Service**.
4. اختر **Build and deploy from a Git repository**.
5. اختر مستودع GitHub.
6. اختر الفرع `main`.
7. اضبط الإعدادات التالية.

## الإعدادات إذا كانت ملفات المشروع في جذر GitHub

```text
Name:
mojam-office

Region:
اختَر أقرب منطقة للمستخدمين أو اتركها كما هي

Runtime:
Node

Root Directory:
اتركه فارغًا

Build Command:
cd server && npm install

Start Command:
node server/src/server.js

Health Check Path:
/api/health
```

## الإعدادات إذا كان المشروع داخل مجلد فرعي

إذا كان شكل GitHub هكذا:

```text
repository/
└── مكتب_معجم_حزمة/
    ├── public/
    ├── server/
    └── render.yaml
```

استخدم:

```text
Root Directory:
مكتب_معجم_حزمة

Build Command:
cd server && npm install

Start Command:
node server/src/server.js

Health Check Path:
/api/health
```

## لا تستخدم هذه الأوامر في الحالة الحالية

لا تضع:

```text
npm start
```

إذا كان `Root Directory` هو جذر المستودع، لأن `package.json` موجود داخل `server` وليس في الجذر.

ولا تضع:

```text
node src/server.js
```

إلا إذا كان `Root Directory` مضبوطًا على `server`.

---

# 5. متغيرات البيئة في Render

من صفحة الخدمة:

```text
Environment → Add Environment Variable
```

أضف المتغيرات التالية.

## المتغيرات المطلوبة

```text
MONGODB_URI
MONGODB_DB
JWT_SECRET
ADMIN_EMPLOYEE_CODE
ADMIN_PASSWORD
CLIENT_ORIGIN
PORT
```

## القيم المقترحة

```text
MONGODB_URI=mongodb+srv://اسم_المستخدم:كلمة_المرور@اسم_cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=mojam_office
JWT_SECRET=قيمة عشوائية طويلة جدًا
ADMIN_EMPLOYEE_CODE=admin
ADMIN_PASSWORD=كلمة مرور قوية لا تقل عن 10 أحرف
CLIENT_ORIGIN=https://اسم-الخدمة.onrender.com
PORT=10000
```

## ملاحظات على القيم

### `MONGODB_URI`

يأخذه المطور من MongoDB Atlas من:

```text
Database → Connect → Drivers → Node.js
```

إذا كانت كلمة المرور تحتوي رموزًا مثل:

```text
@ # ? / : %
```

يجب عمل URL Encoding لها، أو إنشاء كلمة مرور لا تحتوي رموزًا تسبب مشاكل في الرابط.

### `MONGODB_DB`

يجب أن يكون اسم قاعدة البيانات نفسها التي سيستخدمها المشروع، مثل:

```text
mojam_office
```

### `JWT_SECRET`

هذه القيمة تستخدم لتوقيع جلسات الدخول. يجب ألا تتغير بعد التشغيل الإنتاجي، إلا إذا كان المطور يقصد إلغاء كل التوكنات والجلسات.

يمكن إنشاء قيمة عشوائية من Termux:

```bash
openssl rand -hex 48
```

أو:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### `ADMIN_PASSWORD`

هذه كلمة مرور المدير الأول فقط. لا يكتبها المطور داخل GitHub أو داخل ملفات المشروع.

### `CLIENT_ORIGIN`

إذا كانت الواجهة والسيرفر من نفس خدمة Render، تكون:

```text
https://اسم-الخدمة.onrender.com
```

لا تضف `/` في نهاية الرابط.

إذا كانت الواجهة مستضافة في نطاق آخر، اكتب نطاقها بدل رابط Render، ويمكن وضع أكثر من نطاق مفصولًا بفاصلة إذا كان السيرفر يدعم ذلك.

### `PORT`

استخدم:

```text
10000
```

والسيرفر يستمع على `0.0.0.0`، وهذا مطلوب لكي يصل Render إلى الخدمة.

---

# 6. ضبط MongoDB Atlas للسماح لـ Render

من MongoDB Atlas:

1. افتح المشروع.
2. افتح **Network Access**.
3. أضف عنوان IP يسمح لـ Render بالاتصال.

لأن عناوين Render قد تتغير، يستخدم بعض المطورين مؤقتًا:

```text
0.0.0.0/0
```

لكن هذا يفتح الاتصال من أي مكان، ولذلك يجب حماية قاعدة البيانات بكلمة مرور قوية جدًا ومستخدم محدود الصلاحيات.

الأفضل أمنيًا هو استخدام طريقة وصول مقيّدة أو Private Networking إذا كانت متاحة في خطة الاستضافة.

من **Database Access**:

- أنشئ مستخدمًا خاصًا بالمشروع.
- لا تستخدم مستخدم Atlas الرئيسي.
- أعطه صلاحية على قاعدة `mojam_office` فقط، مثل `readWrite`.

---

# 7. أول Deploy

بعد حفظ الإعدادات، يبدأ Render في:

```text
Clone من GitHub
→ تنفيذ cd server && npm install
→ تشغيل node server/src/server.js
→ فحص /api/health
```

افتح:

```text
Logs → Deploy Logs
```

ثم:

```text
Logs → Runtime Logs
```

رسالة النجاح المتوقعة:

```text
Mojam server listening on 10000
```

إذا ظهرت رسالة:

```text
MONGODB_URI is required
```

فهذا يعني أن المتغير غير موجود أو اسمه مكتوب خطأ.

إذا ظهرت:

```text
MongoServerSelectionError
```

راجع MongoDB Network Access واسم المستخدم وكلمة المرور والرابط.

---

# 8. اختبار الصحة

بعد انتهاء Deploy، انسخ رابط الخدمة، مثل:

```text
https://mojam-office.onrender.com
```

افتح في المتصفح:

```text
https://mojam-office.onrender.com/api/health
```

أو من Termux:

```bash
curl -i https://mojam-office.onrender.com/api/health
```

النتيجة المطلوبة:

```json
{
  "success": true,
  "status": "ok",
  "database": "connected"
}
```

إذا ظهر `database: disconnected`، لا يكمل المطور قبل إصلاح اتصال MongoDB.

---

# 9. تشغيل MongoDB Collections وIndexes

ملف قاعدة البيانات هو:

```text
mongodb/init.js
```

إذا كان `mongosh` موجودًا على جهاز المطور:

```bash
cd ~/projects/mojam/مكتب_معجم_حزمة
mongosh "$MONGODB_URI/mojam_office" mongodb/init.js
```

أو باستخدام الرابط مباشرة:

```bash
mongosh "mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/mojam_office" mongodb/init.js
```

يفضل عدم كتابة الرابط الحقيقي في سجل الطرفية إذا كان يحتوي كلمة مرور.

إذا لم يكن `mongosh` موجودًا، افتح MongoDB Atlas ثم استخدم **Mongosh / Atlas Shell** والصق محتوى `mongodb/init.js` بعد اختيار قاعدة البيانات.

الكود ينشئ الفهارس والكلكشنات، ومنها:

```text
users
access_requests
user_sessions
customers
suppliers
shipment_cards
shipment_lines
invoices
invoice_items
sms_messages
conversations
ai_models
sync_queue
audit_logs
```

يأخذ المطور نسخة Backup قبل التشغيل على قاعدة إنتاجية.

---

# 10. إنشاء المدير الأول

بعد نجاح Deploy واتصال MongoDB، يجب إنشاء حساب المدير.

## من Render Shell

إذا كانت الخدمة تستخدم جذر المستودع:

```bash
npm --prefix server run seed-admin
```

إذا كان `Root Directory` مضبوطًا على `server`:

```bash
npm run seed-admin
```

## من جهاز المطور

```bash
cd server
npm install
npm run seed-admin
```

لكن يجب أن تكون متغيرات البيئة موجودة في جلسة Termux، أو يستخدم ملف `.env` محليًا غير مرفوع إلى GitHub.

بعد نجاح الأمر، استخدم:

```text
ADMIN_EMPLOYEE_CODE
ADMIN_PASSWORD
```

لتسجيل الدخول إلى النظام.

---

# 11. فتح الواجهة

الواجهة تخدم من نفس السيرفر، لذلك افتح:

```text
https://mojam-office.onrender.com/
```

يجب أن تظهر شاشة:

```text
تسجيل الدخول
تسجيل عامل
تفعيل برمز
```

إذا ظهرت صفحة بيضاء:

1. افتح Runtime Logs.
2. افتح أدوات المطور في المتصفح.
3. تحقق من عدم وجود JavaScript Error.
4. تحقق أن `public/index.html` موجود في المكان الصحيح.
5. راجع Root Directory.

---

# 12. اختبار تسجيل المدير

من شاشة الدخول أو باستخدام Termux:

```bash
curl -X POST https://mojam-office.onrender.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"employeeCode":"admin","password":"كلمة_مرور_المدير"}'
```

النتيجة يجب أن تحتوي:

```json
{
  "success": true,
  "accessToken": "...",
  "user": {
    "status": "active",
    "roles": ["owner", "admin"]
  }
}
```

يحفظ المطور `accessToken` للاختبار فقط، ولا يضعه في GitHub.

---

# 13. اختبار تسجيل العامل والموافقة

من الواجهة:

1. اضغط **تسجيل عامل**.
2. أدخل الاسم ورقم الهاتف ورقم الموظف وكلمة المرور.
3. اضغط **إرسال طلب الموافقة**.
4. يحتفظ العامل بـ `requestId`.
5. يدخل المدير إلى لوحة إدارة العاملين.
6. يضغط **رمز موافقة**.
7. يرسل الرمز يدويًا للعامل.
8. يدخل العامل إلى **تفعيل برمز**.
9. يدخل `requestId` والرمز.
10. يسجل الدخول بعد ظهور رسالة نجاح التفعيل.

اختبار المسارات:

```text
POST /api/auth/request-access
POST /api/auth/activate
GET  /api/admin/users
POST /api/admin/users/{id}/issue-code
```

---

# 14. اختبار الحظر ورفع الحظر

من لوحة المدير:

1. اختر العامل.
2. اضغط **حظر**.
3. تحقق أن حالته أصبحت `blocked`.
4. حاول الدخول بحساب العامل.
5. يجب أن يفشل الدخول.
6. تحقق أن جلساته ألغيت.
7. اضغط **رفع الحظر**.
8. حاول تسجيل الدخول من جديد.
9. يجب أن ينجح بعد رفع الحظر.

المسارات:

```text
POST /api/admin/users/{id}/block
POST /api/admin/users/{id}/unblock
POST /api/admin/users/{id}/revoke-sessions
```

---

# 15. ربط مستودع GitHub بالنشر التلقائي

من Render:

```text
Settings → Build & Deploy → Auto-Deploy
```

اضبطه على:

```text
Yes
```

بعد ذلك، كل تحديث صحيح على الفرع المرتبط سيؤدي إلى Deploy جديد.

دورة التحديث:

```bash
git pull origin main
# تعديل الملفات
git add .
git commit -m "Update Mojam Office"
git push origin main
```

ثم يراقب المطور Render من:

```text
Events
Deploy Logs
Runtime Logs
```

إذا كان المشروع حساسًا، استخدم Pull Request بدل الدفع المباشر إلى `main`.

---

# 16. إذا فشل Deploy بعد تحديث GitHub

يتبع المطور الخطوات التالية:

```text
1. افتح Deploy Logs
2. اقرأ أول Error حقيقي وليس آخر سطر فقط
3. تحقق من Commit الذي استخدمه Render
4. تحقق من Root Directory
5. تحقق من Build Command
6. تحقق من Start Command
7. تحقق من متغيرات البيئة
8. نفذ node --check محليًا
9. أصلح المشكلة وادفع Commit جديدًا
```

أخطاء شائعة:

| الخطأ | السبب المحتمل | الحل |
|---|---|---|
| `MONGODB_URI is required` | المتغير غير موجود | أضفه في Environment |
| `Cannot find module` | لم يتم تثبيت المكتبات | راجع Build Command |
| `Cannot find server/src/server.js` | Root Directory خاطئ | صحح مسار الجذر |
| `MongoServerSelectionError` | منع MongoDB اتصال Render | راجع Network Access |
| `EADDRINUSE` | تشغيل أكثر من سيرفر محليًا | أوقف العملية القديمة |
| `Health check failed` | السيرفر لا يستمع على Render Port | استخدم `process.env.PORT` و`0.0.0.0` |
| صفحة بيضاء | ملف الواجهة غير موجود في `public` | راجع بنية المستودع |
| CORS error | CLIENT_ORIGIN خاطئ | ضع رابط الواجهة الصحيح |

---

# 17. إعداد خدمة Render موجودة مسبقًا

إذا كان لدى المطور Web Service قديم:

## إذا كان يريد استبدال المشروع القديم

1. يأخذ نسخة من إعدادات الخدمة القديمة.
2. يتأكد أن المشروع القديم غير مطلوب.
3. يغير Repository أو يرفع الملفات في نفس المستودع.
4. يضبط Root Directory وBuild وStart كما في هذا الملف.
5. يحتفظ بنفس `MONGODB_URI` فقط إذا كانت القاعدة هي المطلوبة.
6. لا يغير `JWT_SECRET` دون سبب.
7. ينفذ Deploy يدويًا.

## إذا كان يريد إبقاء المشروع القديم

ينشئ Web Service جديدة باسم مختلف:

```text
mojam-office-api
```

ولا يربطها بنفس مسار API أو نفس الخدمة إلا بعد التأكد من عدم وجود تعارض.

إذا استخدم قاعدة MongoDB نفسها، يجب أن يتأكد أن أسماء الكلكشنات لا تتعارض مع المشروع القديم، أو يستخدم Database منفصلة:

```text
mojam_office
```

---

# 18. ما الذي لا يتم عمله

لا يقوم المطور بالآتي:

```text
لا يرفع .env إلى GitHub
لا يضع MONGODB_URI في index.html
لا يضع كلمة مرور المدير في server.js
لا يحذف قاعدة MongoDB القديمة بلا Backup
لا يشغل init.js قبل فهم قاعدة البيانات المستهدفة
لا يغير JWT_SECRET عشوائيًا بعد دخول المستخدمين
لا يستخدم Start Command غير مطابق لمسار المشروع
لا يعتبر نجاح Build دليلًا على نجاح اتصال MongoDB
```

---

# 19. قائمة التسليم النهائية

```text
[ ] GitHub يحتوي public وserver وmongodb
[ ] Root Directory صحيح
[ ] Build Command صحيح
[ ] Start Command صحيح
[ ] Health Check Path هو /api/health
[ ] MONGODB_URI مضبوط
[ ] MONGODB_DB مضبوط
[ ] JWT_SECRET مضبوط
[ ] ADMIN_EMPLOYEE_CODE مضبوط
[ ] ADMIN_PASSWORD مضبوط
[ ] CLIENT_ORIGIN مضبوط
[ ] MongoDB يسمح باتصال Render
[ ] init.js نفذ أو تم التحقق من الكلكشنات
[ ] Deploy نجح
[ ] /api/health يعرض database connected
[ ] شاشة الدخول تظهر
[ ] المدير يستطيع الدخول
[ ] تسجيل العامل يعمل
[ ] إصدار رمز الموافقة يعمل
[ ] تفعيل العامل يعمل
[ ] الحظر يعمل
[ ] رفع الحظر يعمل
[ ] لا توجد أسرار في GitHub
[ ] تم حفظ رابط Render النهائي
```

## النتيجة المطلوبة

بعد إتمام هذه الخطوات يجب أن يكون الرابط:

```text
https://اسم-الخدمة.onrender.com/
```

هو رابط النظام الذي يفتح الواجهة، ويقدم API، ويتصل بقاعدة MongoDB السحابية من خلال متغيرات Render الآمنة.
