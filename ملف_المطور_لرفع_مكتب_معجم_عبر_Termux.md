# ملف المطور — رفع وتشغيل مكتب معجم عبر Termux وRender

## 1. الهدف

هذا الملف موجه للمطور الذي لديه:

- هاتف Android عليه Termux.
- حساب Render ومشروع سابق.
- قاعدة MongoDB Atlas سحابية.
- خبرة سابقة في رفع المشاريع.

المطلوب منه هو أخذ ملف ZIP من مجلد تنزيلات الهاتف، فك ضغطه، رفع محتوياته إلى GitHub أو المستودع المرتبط بـ Render، ثم ضبط متغيرات البيئة وتشغيل السيرفر.

> لا يحتاج المطور إلى إعادة بناء الواجهة من الصفر. الحزمة تحتوي على الواجهة، كود السيرفر، ملفات MongoDB، إعداد Render، والأدلة.

---

## 2. الملف المطلوب

اسم الملف:

```text
مكتب_معجم_حزمة_جاهزة_للرفع.zip
```

يفترض أن يكون موجودًا في مجلد التنزيلات في الهاتف:

```text
/storage/emulated/0/Download/
```

أو يظهر داخل Termux بعد السماح بالتخزين في:

```text
~/storage/downloads/
```

---

## 3. تجهيز Termux

افتح Termux ونفذ الأوامر التالية:

```bash
pkg update -y
pkg upgrade -y
pkg install -y git unzip curl nodejs-lts nano
termux-setup-storage
```

بعد تنفيذ `termux-setup-storage` سيظهر طلب صلاحية Android. اضغط **Allow / سماح**.

تحقق من الملف:

```bash
ls -lh ~/storage/downloads/
```

إذا كان اسم الملف عربيًا، استخدم:

```bash
find ~/storage/downloads -maxdepth 1 -type f -iname '*.zip' -print
```

---

## 4. نسخ ملف ZIP من الهاتف إلى مساحة Termux

أنشئ مجلد عمل:

```bash
mkdir -p ~/projects/mojam
cd ~/projects/mojam
```

انسخ الملف من مجلد التنزيلات:

```bash
cp ~/storage/downloads/مكتب_معجم_حزمة_جاهزة_للرفع.zip .
```

إذا واجهت مشكلة بسبب الاسم العربي، استخدم النسخ التلقائي:

```bash
cp "$(find ~/storage/downloads -maxdepth 1 -type f -iname '*.zip' | head -n 1)" ./mojam-package.zip
```

تحقق من وجوده:

```bash
ls -lh
file ./*.zip
```

يجب أن يظهر كملف ZIP صالح.

---

## 5. فك الضغط

إذا كان الملف بالاسم العربي:

```bash
unzip -q "مكتب_معجم_حزمة_جاهزة_للرفع.zip"
```

أو إذا تم تغيير اسمه:

```bash
unzip -q mojam-package.zip
```

اعرض الملفات:

```bash
find مكتب_معجم_حزمة -maxdepth 3 -type f | sort
```

المجلد المتوقع:

```text
مكتب_معجم_حزمة/
├── public/
│   ├── index.html
│   └── واجهة_مكتب_معجم.html
├── server/
│   ├── src/server.js
│   ├── scripts/seed-admin.js
│   ├── package.json
│   └── .env.example
├── mongodb/init.js
├── render.yaml
├── README_AR.md
├── دليل_الربط_والتعديل_المستقبلي.md
└── .gitignore
```

ادخل إلى المجلد:

```bash
cd ~/projects/mojam/مكتب_معجم_حزمة
```

---

## 6. فحص الملفات قبل الرفع

لا تبدأ الرفع قبل تنفيذ الفحوصات التالية:

```bash
test -f public/index.html && echo 'واجهة HTML موجودة'
test -f server/src/server.js && echo 'كود السيرفر موجود'
test -f server/package.json && echo 'package.json موجود'
test -f mongodb/init.js && echo 'ملف MongoDB موجود'
test -f render.yaml && echo 'ملف Render موجود'
```

فحص صياغة JavaScript:

```bash
cd server
npm install
node --check src/server.js
node --check scripts/seed-admin.js
cd ..
```

إذا ظهر أي خطأ في `node --check` يجب إصلاحه قبل الرفع.

---

## 7. استخدام قاعدة MongoDB السحابية الموجودة

إذا كانت لديه قاعدة MongoDB Atlas جاهزة، لا ينشئ Cluster جديدًا. يحتاج فقط إلى:

1. إنشاء Database User لديه صلاحية على قاعدة المشروع.
2. التأكد من Network Access.
3. نسخ MongoDB Connection String.
4. اختيار اسم Database، مثل:

```text
mojam_office
```

شكل الرابط يكون تقريبًا:

```text
mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
```

### تشغيل ملف الكلكشنات والفهارس

من جهاز يحتوي على `mongosh`:

```bash
mongosh "$MONGODB_URI/mojam_office" mongodb/init.js
```

إذا لم يكن `mongosh` مثبتًا داخل Termux، يمكن تشغيل `mongodb/init.js` من MongoDB Atlas Shell أو من جهاز المطور الرئيسي.

ملف `init.js` ينشئ الكلكشنات والفهارس، ولا يحذف البيانات القديمة لأنه يستخدم `createCollection` و`createIndex` فقط.

قبل تشغيله على قاعدة إنتاجية، يجب أخذ Backup.

---

## 8. رفع الملفات إلى GitHub

يفضل رفع المشروع إلى GitHub لأن Render يستطيع النشر منه تلقائيًا.

### إنشاء مستودع جديد

ينشئ المطور مستودعًا فارغًا في GitHub، مثل:

```text
mojam-office
```

ثم من Termux:

```bash
cd ~/projects/mojam/مكتب_معجم_حزمة
git init
git branch -M main
git add .
git status
git commit -m "Initial Mojam Office package"
git remote add origin https://github.com/USERNAME/mojam-office.git
git push -u origin main
```

سيطلب GitHub تسجيل الدخول أو Token. لا يضع Token داخل ملف أو يرسله لأحد.

### إذا كان لديه مستودع Render موجود مسبقًا

لا ينشئ مستودعًا ثانيًا. يأخذ رابط المستودع الحالي ثم ينفذ:

```bash
cd ~/projects/mojam/مكتب_معجم_حزمة
git init
git remote add origin https://github.com/USERNAME/EXISTING-REPOSITORY.git
git fetch origin
git checkout -B main
```

إذا كان المستودع يحتوي مشروعًا مهمًا، لا يستبدله مباشرة. الأفضل إنشاء Branch:

```bash
git checkout -b mojam-integration
git add .
git commit -m "Add Mojam Office interface and API"
git push -u origin mojam-integration
```

ثم يراجع المطور الفرق قبل الدمج.

---

## 9. إذا كان Render مرتبطًا بالمستودع الموجود

من لوحة Render:

1. افتح Web Service الموجود.
2. افتح **Settings**.
3. تحقق من Repository وBranch.
4. إذا كان المشروع الجديد هو المستودع نفسه، يكفي Push إلى الفرع الصحيح.
5. إذا كان مشروعًا منفصلًا، اختر **New Web Service** أو عدل Repository.
6. تأكد أن إعدادات البناء هي:

```text
Build Command:
cd server && npm install

Start Command:
node server/src/server.js

Health Check Path:
/api/health
```

ملف `render.yaml` موجود أيضًا، ويمكن استخدام **Blueprint** إذا كان يريد إنشاء الخدمة من الملف.

---

## 10. متغيرات البيئة في Render

من Render افتح:

```text
Service → Environment → Add Environment Variable
```

أضف:

```text
MONGODB_URI=mongodb+srv://...
MONGODB_DB=mojam_office
JWT_SECRET=قيمة طويلة عشوائية
ADMIN_EMPLOYEE_CODE=admin
ADMIN_PASSWORD=كلمة مرور قوية وطويلة
CLIENT_ORIGIN=https://اسم-الخدمة.onrender.com
PORT=10000
```

لا يرفع المطور ملف `.env` إلى GitHub.

ملف `.env.example` نموذج فقط، وليس ملف أسرار.

### مفاتيح مستقبلية اختيارية

عند ربط مزود SMS أو الذكاء:

```text
SMS_PROVIDER_URL
SMS_PROVIDER_TOKEN
AI_PROVIDER_URL
AI_PROVIDER_KEY
```

تدخل من Render Environment فقط، ولا تدخل في `index.html` أو `server.js` مباشرة.

---

## 11. إنشاء المدير الأول

بعد أول Deploy ونجاح اتصال MongoDB، ينفذ المطور من Render Shell أو من جهازه:

```bash
cd server
npm install
npm run seed-admin
```

في Render، إذا كانت Root Directory هي المشروع الرئيسي، يكون الأمر:

```bash
npm --prefix server run seed-admin
```

تأكد أن متغيرات البيئة موجودة قبل التنفيذ:

```text
MONGODB_URI
MONGODB_DB
ADMIN_EMPLOYEE_CODE
ADMIN_PASSWORD
```

بعد إنشاء المدير:

- لا يشارك المطور كلمة المرور.
- يغير المدير كلمة المرور عند الحاجة.
- لا يحذف `JWT_SECRET`.
- لا يحفظ كلمة المرور في Git.

---

## 12. اختبار السيرفر بعد Deploy

بعد ظهور رابط Render:

```bash
curl -i https://YOUR-SERVICE.onrender.com/api/health
```

يجب أن تكون النتيجة تقريبًا:

```json
{
  "success": true,
  "status": "ok",
  "database": "connected"
}
```

اختبار تسجيل الدخول:

```bash
curl -X POST https://YOUR-SERVICE.onrender.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"employeeCode":"admin","password":"PASSWORD"}'
```

إذا أعاد `accessToken` فهذا يعني أن قاعدة البيانات والمصادقة تعملان.

اختبار الواجهة:

```text
https://YOUR-SERVICE.onrender.com/
```

---

## 13. دورة العامل والموافقة

### طلب العامل

```text
POST /api/auth/request-access
```

العامل يدخل من شاشة **تسجيل عامل**:

```text
الاسم
رقم الهاتف
رقم الموظف
كلمة المرور
```

يحفظ السيرفر الحساب بحالة `pending` وينشئ طلبًا في `access_requests`.

### إصدار الرمز من المدير

```text
GET  /api/admin/users
POST /api/admin/users/{id}/issue-code
```

يظهر الرمز للمدير مرة واحدة، ويرسله للعامل يدويًا.

### تفعيل العامل

```text
POST /api/auth/activate
```

العامل يدخل `requestId` و`approvalCode`، ثم تصبح حالة الحساب `active`.

### حظر العامل

```text
POST /api/admin/users/{id}/block
```

الحظر يلغي:

```text
الجلسات
Access Tokens
الطلبات المعلقة
إمكانية فتح API
```

### رفع الحظر

```text
POST /api/admin/users/{id}/unblock
```

بعد رفع الحظر يسجل العامل الدخول من جديد.

---

## 14. الأخطاء الشائعة وحلولها

### MongoDB لا يتصل

راجع:

```text
MONGODB_URI
اسم المستخدم وكلمة المرور
Network Access في Atlas
صلاحية المستخدم على قاعدة البيانات
```

### Render يعطي Build Failed

نفذ محليًا:

```bash
cd server
npm install
node --check src/server.js
```

ثم راجع Build Command:

```text
cd server && npm install
```

### Render يعطي Start Failed

يجب أن يكون Start Command:

```text
node server/src/server.js
```

ولا تستخدم:

```text
npm start
```

إلا إذا كان Render يعمل من داخل مجلد `server`.

### الواجهة لا تتصل بالسيرفر

تأكد أن عنوان الواجهة يستخدم:

```javascript
window.MOJAM_API_BASE = 'https://YOUR-SERVICE.onrender.com';
```

وتأكد من `CLIENT_ORIGIN` وCORS.

### المدير لا يستطيع الدخول

نفذ:

```bash
npm --prefix server run seed-admin
```

وتأكد من أن `ADMIN_PASSWORD` طوله 10 أحرف على الأقل.

### الملف العربي لا يفك الضغط

أعد تسميته داخل Termux:

```bash
mv "مكتب_معجم_حزمة_جاهزة_للرفع.zip" mojam.zip
unzip mojam.zip
```

---

## 15. ماذا يفعل المطور بعد أول تشغيل؟

1. يتأكد من `/api/health`.
2. يتأكد من اتصال MongoDB.
3. يشغل `mongodb/init.js` مرة واحدة.
4. ينشئ المدير الأول.
5. يختبر شاشة الدخول.
6. يختبر تسجيل عامل جديد.
7. يصدر رمز موافقة يدويًا.
8. يختبر تفعيل العامل.
9. يختبر الحظر.
10. يختبر رفع الحظر.
11. يختبر الفاتورة والشحنة والمزامنة.
12. يربط SMS الحقيقي لاحقًا فقط بعد اختبار الصلاحيات.

---

## 16. قائمة تسليم نهائية للمطور

لا يعتبر المشروع جاهزًا إلا إذا تحقق من:

```text
[ ] ZIP تم فك ضغطه بنجاح
[ ] الملفات موجودة
[ ] node --check ناجح
[ ] npm install ناجح
[ ] MongoDB متصل
[ ] init.js نفذ بدون أخطاء
[ ] /api/health يعيد database connected
[ ] المدير يستطيع الدخول
[ ] العامل يستطيع إرسال طلب
[ ] المدير يستطيع إصدار رمز
[ ] العامل يستطيع التفعيل
[ ] المدير يستطيع الحظر
[ ] المدير يستطيع رفع الحظر
[ ] الجلسة تلغى بعد الحظر
[ ] الواجهة تفتح من Render
[ ] لا توجد أسرار داخل GitHub
[ ] تم أخذ نسخة احتياطية قبل البيانات الإنتاجية
```

## 17. قاعدة أمان نهائية

لا يرسل المطور في الرسائل أو GitHub:

```text
MONGODB_URI
كلمة مرور MongoDB
JWT_SECRET
ADMIN_PASSWORD
AI_PROVIDER_KEY
SMS_PROVIDER_TOKEN
```

هذه القيم تدخل فقط في Render Environment أو مدير أسرار آمن.
