# حزمة مكتب معجم — تشغيل ورفع السيرفر

## محتويات الحزمة

```text
public/index.html                         واجهة HTML الرئيسية
public/واجهة_مكتب_معجم.html                نسخة الواجهة باسم عربي
server/src/server.js                       كود Node/Express
server/package.json                        المكتبات وأوامر التشغيل
server/.env.example                        متغيرات البيئة
server/scripts/seed-admin.js               إنشاء المدير الأول
mongodb/init.js                            الكلكشنات والفهارس
render.yaml                               إعداد خدمة Render
دليل_الربط_والتعديل_المستقبلي.md          دليل المطور والتعديل
```

## المتطلبات

- حساب MongoDB Atlas.
- حساب Render.
- Node.js 20 أو أحدث للتشغيل المحلي.
- رابط MongoDB يبدأ عادة بـ `mongodb+srv://`.

## إعداد MongoDB Atlas

1. أنشئ Cluster جديدًا.
2. أنشئ Database باسم `mojam_office`.
3. أنشئ Database User.
4. أضف عنوان Render إلى Network Access، أو استخدم `0.0.0.0/0` مؤقتًا مع كلمة مرور قوية.
5. شغّل ملف `mongodb/init.js` من جهاز يحتوي على `mongosh`:

```bash
mongosh "$MONGODB_URI/mojam_office" mongodb/init.js
```

الملف ينشئ الكلكشنات والفهارس، منها:

```text
accounts
users
customers
suppliers
shipment_cards
shipment_lines
invoices
invoice_items
sms_messages
conversations
ai_models
training_rules
sync_queue
audit_logs
```

## تشغيل السيرفر محليًا

```bash
cd server
cp .env.example .env
# عدّل MONGODB_URI وJWT_SECRET وبيانات المدير
npm install
npm run seed-admin
npm start
```

يفتح السيرفر على:

```text
http://localhost:10000
```

وفحص الصحة:

```text
http://localhost:10000/api/health
```

## رفعه على Render

1. ارفع مجلد `مكتب_معجم_حزمة` إلى GitHub.
2. في Render اختر **New Blueprint**.
3. اختر المستودع.
4. سيقرأ Render ملف `render.yaml`.
5. أدخل القيم السرية:

```text
MONGODB_URI
ADMIN_EMPLOYEE_CODE
ADMIN_PASSWORD
CLIENT_ORIGIN
```

6. اترك Render يولّد `JWT_SECRET` تلقائيًا.
7. بعد التشغيل اختبر:

```text
https://YOUR-SERVICE.onrender.com/api/health
```

## فتح الواجهة

واجهة HTML تخدم من نفس السيرفر:

```text
https://YOUR-SERVICE.onrender.com/
```

إذا كانت الواجهة على استضافة أخرى، عدّل متغير السيرفر في الواجهة أو استخدم:

```javascript
window.MOJAM_MESSAGES_SERVER_URL = 'https://YOUR-SERVICE.onrender.com';
```

ولا تضع مفتاح MongoDB أو مفتاح النموذج داخل HTML.

## المدير الأول

يتم إنشاء المدير من متغيري Render:

```text
ADMIN_EMPLOYEE_CODE=admin
ADMIN_PASSWORD=ضع_كلمة_قوية_طويلة
```

ثم شغّل مرة واحدة:

```bash
npm run seed-admin
```

في Render يمكن تنفيذ الأمر من Shell، أو إضافة Job مؤقت. بعد نجاحه يمكن حذف كلمة مرور المدير من السجل وعدم كتابتها داخل الكود.

## فحص المسارات

```text
GET  /api/health
POST /api/auth/login
GET  /api/auth/me
GET  /api/zoe
POST /api/zoe
GET  /api/sms/messages?limit=100
GET  /api/conversations/771234567
GET  /api/ai/models
GET  /api/automation
GET  /api/sync/day?date=2026-10-08
PUT  /api/sync/day
```

## ملاحظات مهمة

- هذا السيرفر مجهز بالبنية الأساسية ويستخدم الرد المحلي الاحتياطي للنموذج.
- يجب ربط مزود SMS الحقيقي داخل `server/src/server.js` قبل الإرسال الإنتاجي.
- يجب ربط مزود الذكاء الحقيقي داخل `/api/chat` قبل الاعتماد على الردود الذكية.
- المفتاح السري لا يعاد أبدًا إلى المتصفح.
- لا تستخدم `0.0.0.0/0` في MongoDB Atlas إلا عند الحاجة، ويفضل تقييد الوصول لاحقًا.


## تسجيل العامل والموافقة والحظر

واجهة الدخول موجودة داخل `public/index.html` وتظهر قبل فتح النظام.

### طلب تسجيل العامل

```text
POST /api/auth/request-access
```

البيانات:

```json
{
  "fullName": "اسم العامل",
  "phone": "771234567",
  "employeeCode": "EMP-004",
  "password": "كلمة مرور طويلة"
}
```

يرجع السيرفر `requestId` فقط، ويحفظ كود الموافقة مشفرًا داخل `access_requests`.

### إصدار رمز الموافقة يدويًا

بعد دخول المدير:

```text
GET  /api/admin/users
POST /api/admin/users/{id}/issue-code
```

يعرض السيرفر الرمز للمدير مرة واحدة. يقوم المدير بإرساله للعامل يدويًا عبر الهاتف أو أي وسيلة موثوقة.

### تفعيل العامل

```text
POST /api/auth/activate
```

```json
{
  "requestId": "رقم الطلب",
  "approvalCode": "123456"
}
```

### الحظر ورفع الحظر

```text
POST /api/admin/users/{id}/block
POST /api/admin/users/{id}/unblock
POST /api/admin/users/{id}/revoke-sessions
```

الحظر يغيّر حالة المستخدم ويلغي جميع جلساته والتوكنات الخاصة به، بينما رفع الحظر يعيد الحساب إلى `active` ويحتاج العامل إلى تسجيل الدخول من جديد.


## لوحة الإدارة المستقلة

تمت إضافة ملف واجهة مستقل:

```text
public/admin.html
```

ويفتح من:

```text
https://YOUR-SERVICE.onrender.com/admin
```

اللوحة مستقلة عن `public/index.html`، وتحتوي على:

- دخول المدير.
- إحصاءات قاعدة MongoDB.
- عرض العاملين وطلبات الوصول.
- قبول وتفعيل العامل.
- إصدار رمز موافقة.
- تحديد الدور.
- تحديد الصلاحيات التفصيلية.
- حظر العامل ورفع الحظر.
- إلغاء جلساته من مسار الحظر.

المسارات الجديدة:

```text
GET /admin
GET /api/admin/overview
PUT /api/admin/users/{id}/access
```

يجب أن يكون الحساب المستخدم في `/admin` ذا دور `admin` أو `owner`.
