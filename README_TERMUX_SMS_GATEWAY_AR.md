# ربط هاتف Android وشريحته ببوابة SMS لمكتب معجم

نعم، يمكن أن يكون هاتفك هو مزوّد الرسائل باستخدام الشريحة نفسها. أضفت مسارًا يجعل الخادم يحفظ الرسائل الواردة، ويطلب من الهاتف إرسال الرسائل الصادرة من طابور آمن. يعمل **Termux** على الهاتف كعامل خلفي؛ إغلاق صفحة المتجر لا يوقفه ما دام Termux يعمل والهاتف متصلًا بالشبكة.

## ما الذي يتطلبه هذا الحل؟

- هاتف Android يعمل، وشريحة فعّالة فيها رصيد/باقة SMS.
- تطبيقا **Termux** و **Termux:API** من مصدر التثبيت نفسه، مع أذونات SMS المطلوبة.
- تثبيت Termux:Boot اختياريًا للتشغيل بعد إعادة تشغيل الهاتف.
- اتصال إنترنت على الهاتف؛ يستطلع العامل الخادم كل 15 ثانية افتراضيًا.
- إعفاء Termux من تحسين البطارية، والسماح بالإشعارات/التشغيل في الخلفية حسب إصدار Android.

> لا تستطيع صفحة الويب وحدها استقبال الرسائل أو إرسالها بعد إغلاقها. الذي يبقى عاملًا هو Termux، وليس المتصفح. ولا يضمن Android بقاء أي تطبيق حيًا إذا أوقفه النظام أو أُغلقت صلاحياته.

## 1) إعداد متغير الخادم في Render

1. أنشئ رمزًا عشوائيًا قويًا على الهاتف، مثلًا داخل Termux:
   ```sh
   openssl rand -hex 32
   ```
2. أضف متغير Render التالي، مستخدمًا الرمز الذي أنشأته محليًا:
   ```text
   SMS_GATEWAY_TOKEN = الرمز_العشوائي_الذي_أنشأته
   ```
3. أعد نشر خدمة Render بعد حفظ المتغير.
4. لا ترسل الرمز في المحادثات ولا تضعه في GitHub. إذا فُقد الهاتف أو انكشف الرمز، غيّره في Render وفي ملف الهاتف ثم أعد النشر.

## 2) تثبيت أدوات Termux

ثبّت تطبيق Termux:API المتوافق مع مصدر Termux المثبت لديك، ثم نفّذ في Termux:

```sh
pkg update -y
pkg install nodejs-lts termux-api -y
```

تحقق أن الأوامر متاحة:

```sh
command -v node
command -v termux-sms-list
command -v termux-sms-send
```

افتح Termux:API/Termux وامنح أذونات قراءة الرسائل وإرسالها عند طلبها. إذا أردت اختيار SIM slot صراحةً، امنح إذن حالة الهاتف أيضًا؛ أمر Termux الرسمي يذكر أن تحديد الشريحة قد يفشل بصمت إذا كان رقم الخانة غير صحيح أو لم يتوفر إذن READ_PHONE_STATE [2]. أسماء الشاشات تختلف باختلاف إصدار Android والشركة المصنّعة.

## 3) إنشاء إعداد خاص على الهاتف

من جذر نسخة المشروع في Termux:

```sh
cd ~/projects/mojam/مكتب_معجم_حزمة/server/scripts || exit 1
cp termux-sms-gateway.env.example .env
nano .env
chmod 600 .env
```

ضع الرمز نفسه الذي أضفته في Render مكان القيمة التجريبية في `SMS_GATEWAY_TOKEN`. أبقِ `MOJAM_SERVER_URL` كما هو، وغيّر `SIM_SLOT=0` فقط إذا كانت شريحتك المطلوبة في خانة أخرى. ملف `.env` محلي وسري؛ لا تضفه إلى Git ولا ترسله لأحد.

## 4) اختبار البوابة

شغّلها يدويًا أولًا:

```sh
node termux-sms-gateway.js
```

اترك Termux مفتوحًا مؤقتًا، وأرسل رسالة اختبار إلى رقم الشريحة. تحقق من ظهورها في محادثات مكتب معجم. ثم أرسل ردًا يدويًا من التطبيق؛ يجب أن يظهر بحالة «بانتظار الإرسال»، وبعد أن يسحبه الهاتف تصبح حالته «تم الإرسال» أو «فشل الإرسال».

نجاح الأمر المحلي يعني أن Android قبل طلب الإرسال؛ **لا يعني بالضرورة أن شركة الاتصالات أكدت وصول SMS**. قد تُحسب الرسائل الصادرة على باقة/رصيد الشريحة.

## 5) تشغيل مستمر بعد إغلاق واجهة المتجر

اترك عملية Termux تعمل في الخلفية؛ لا تستخدم زر **Force stop** ولا تمسحها من التطبيقات الحديثة إن كانت الشركة المصنّعة تقتل العمليات. يبقي `termux-wake-lock` الجهاز مستيقظًا نسبيًا أثناء التشغيل، لكنه يزيد استهلاك البطارية.

للتشغيل التلقائي بعد إعادة تشغيل الهاتف، ثبّت Termux:Boot وافتحه مرة واحدة. ثم أنشئ ملف بدء تشغيل، مع تعديل مسار المشروع إذا كان مختلفًا لديك:

```sh
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/mojam-sms-gateway <<'SH'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd "$HOME/projects/mojam/مكتب_معجم_حزمة/server/scripts" || exit 1
nohup node termux-sms-gateway.js >> "$HOME/mojam-sms-gateway.log" 2>&1 &
SH
chmod 700 ~/.termux/boot/mojam-sms-gateway
```

أوقف العامل يدويًا من Termux عبر `Ctrl+C` عند تشغيله في المقدمة. ولإيقاف القفل بعد ذلك:

```sh
termux-wake-unlock
```

## 6) تشغيل Zoe في الخلفية

من واجهة المدير:

1. احفظ إعدادات الرد الآلي على الخادم.
2. فعّل **التوليد التلقائي**؛ عند تفعيله تُسجّل نقطة بدء، كي لا يرد النظام على الرسائل القديمة التي جرى أرشفتها سابقًا.
3. اختبر التوليد أولًا مع تعطيل الإرسال التلقائي؛ الردود المولدة تحفظ كمسودات في المحادثة.
4. بعد نجاح الاختبار، فعّل الإرسال التلقائي من إعدادات المدير فقط إذا أردت إرسال SMS حقيقية. احصر الأرقام المسموح بها عند الحاجة.

إذا كان الرمز ومفتاح Gemini موجودين والإعدادات محفوظة، فإن الرسائل الواردة الجديدة التي يزامنها الهاتف تُرسل للخادم، ويُغذّي الخادم Zoe ببيانات النشاط الحالية، ثم يضع الرد في طابور الهاتف. الهاتف يرسل الرسالة عبر الشريحة المختارة. عند إغلاق المتجر تبقى هذه العملية قائمة **ما دام Termux والهاتف والإنترنت والشريحة متاحين**.

## ملاحظات وتشخيص

- بعد تعديل الخادم، يلزم رفع الملفات إلى GitHub ثم انتظار إعادة نشر Render.
- إذا ظهرت `SMS_GATEWAY_NOT_CONFIGURED`، راجع متغير Render وأعد النشر.
- إذا لم يرسل الهاتف، راجع أذونات SMS، ورصيد الشريحة، وتوافق Termux:API، ورقم SIM slot، وسجل العامل:
  ```sh
  tail -n 80 ~/mojam-sms-gateway.log
  ```
- البوابة تستطلع الرسائل كل فترة، لذلك ليست لحظية تمامًا؛ الافتراضي 15 ثانية.
- تعطيل الإنترنت أو إيقاف Termux يوقف المزامنة والإرسال الخلفي. لا يُرسل النظام تلقائيًا إلى رقم رفضته قائمة الأرقام المسموح بها.
- زر الإرسال اليدوي من صفحة المتجر يضيف الرسالة إلى الطابور؛ تأكد أن البوابة متصلة قبل الاعتماد عليه.


## رفع التحديث إلى GitHub وRender

بعد تنزيل `mojam_phone_sms_gateway_update.zip` إلى مجلد التنزيلات في الهاتف، فك ضغطه فوق جذر المشروع. مثال Termux:

```sh
cd ~/projects/mojam/مكتب_معجم_حزمة || exit 1
unzip -o ~/storage/downloads/mojam_phone_sms_gateway_update.zip -d .

git add public/index.html public/invoice-manual-cards.js public/mojam-logo.svg \
  server/src/server.js server/src/business-context.js server/src/gemini.js \
  server/src/invoice-numbering.js server/package.json \
  server/scripts/.gitignore server/scripts/termux-sms-gateway.js \
  server/scripts/termux-sms-gateway.env.example README_TERMUX_SMS_GATEWAY_AR.md

git diff --cached --check || exit 1
git diff --cached --name-only
git commit -m "Add Android phone SMS gateway"
git push origin main
```

يجب ألا يظهر `server/scripts/.env` أو أي ملف `.env` في قائمة Git؛ ملف الإعداد الحقيقي يبقى على الهاتف فقط. بعد الدفع، انتظر أن ينتهي نشر Render، وأضف `SMS_GATEWAY_TOKEN` من صفحة **Environment** في Render قبل اختبار الرسائل.


## المراجع

[1] توثيق Termux:API يوضح أن الإضافة وتطبيق Termux يجب تثبيتهما من المصدر نفسه، وأن حزمة `termux-api` مطلوبة داخل Termux [1].

[1]: https://wiki.termux.com/wiki/Termux:API "Termux:API official wiki"
[2]: https://raw.githubusercontent.com/termux/termux-api-package/master/scripts/termux-sms-send.in "Termux SMS send command source"
[3]: https://wiki.termux.com/wiki/Termux-sms-list "Termux SMS list command documentation"
