# CheckWork — منصّة إدارة الأعمال والإنجاز

منصة مصغّرة لإدارة الأعمال، تعمل بالكامل على **Cloudflare** (Pages + Workers + D1).
الواجهة عربية بالكامل (RTL)، والتسجيل ذاتي عبر **اسم مستخدم وكلمة مرور** فقط.

🌐 **الرابط الرسمي:** https://checkwork-buy.pages.dev

---

## كيف تعمل المنصّة

### 1. التسجيل الذاتي
أي شخص يُنشئ حسابه بنفسه — بلا مدير وبلا انتظار موافقة. عند التسجيل تُنشأ له
**بيئة عمل خاصة** يكون صاحبها تلقائياً.

### 2. بيئات العمل (متعددة)
- كل حساب يستطيع إنشاء **عدة بيئات عمل** والتبديل بينها من مبدّل في الشريط الجانبي.
- **المدير لا يُنشئ حسابات.** هو يدعو فقط.

### 3. الدعوة عبر اسم المستخدم
```
المدير يكتب username  ──►  العضو يرى إشعار دعوة  ──►  يقبل  ──►  يصبح عضواً
```
- الدعوة تبقى `pending` حتى يوافق العضو بنفسه.
- وقبل الموافقة لا يستطيع العضو الدخول لبيئة العمل ولا رؤية مهامها.
- عند القبول تصبح الجلسة نشطة في تلك البيئة تلقائياً.

### 4. الرتب داخل بيئة العمل
| الرتبة | الصلاحيات |
|---|---|
| `owner` صاحب البيئة | كل شيء + ترقية الأعضاء إلى مشرفين + حذف البيئة |
| `admin` مشرف | إدارة المهام والأعضاء والتقارير والإعدادات |
| `member` موظف | sees مهامه فقط، ويدير قوائم TODO الخاصة به |

### 5. المهمات
- المشرف يكتب **عنوان المهمة + التفاصيل (الإضافات)** ويحدد الأولوية والاستحقاق.
- يمكن إسناد المهمة **لأكثر من عضو** (تُنشأ نسخة لكل واحد).
- دورة الحالة: `جديد ← مقروء ← منجز` مع إمكانية الإلغاء.
- الموظف يفتح المهمة ← **يعلّمها كمقروء** ← يكتب وصف ما أنجز ← **ينجزها**.
- المشرف يرى **سجل الإنجاز** لكل عضو مع ملاحظات الإنجاز وتواريخها.

### 6. قوائم TODO (لكل الأدوار)
| النوع | المرئية لـ |
|---|---|
| **خاصة** 🔒 | صاحبها فقط — حتى لو كانا في نفس بيئة العمل |
| **عامة** 🌐 | كل أعضاء بيئة العمل |

مع: أولوية، تاريخ استحقاق، تعليم كمنجز، تبديل بين خاص/عام، مسح المنجَز، وشريط تقدّم.

---

## المزايا

**إدارة الأعمال**
- لوحة تحكم بإحصاءات مباشرة وتوزيع الحالات وأداء الفريق
- سجل إنجاز كامل لكل عضو
- تقارير أداء: نسبة الإنجاز، الالتزام بالوقت، متوسط مدة الإنجاز، المهام المتأخرة
- تصفية وبحث وترتيب متعدد المعايير
- سجل نشاط لكل عملية
- تصدير CSV (UTF-8 + BOM لدعم العربية في Excel) للمهام والتقارير
- معاينة طباعة

**الحسابات والأمان**
- تسجيل ذاتي، PBKDF2-SHA256 (100,000 دورة) لتجزئة كلمات المرور
- جلسات JWT موقّعة (HS256) + جدول جلسات في D1 مع إلغاء فوري
- إبطال كل الجلسات عند تغيير كلمة المرور
- قفل الحساب مؤقتاً بعد محاولات دخول فاشلة
- حماية CSRF مزدوجة (Double-Submit) + التحقق من `Origin`
- CSP و HSTS و `X-Frame-Options: DENY` وترويسات أخرى
- تقييد الأدوار على مستوى كل مسار في الـ API

**التجربة**
- واجهة عربية RTL متجاوبة (جوال / لوحي / سطح مكتب)
- وضع ليلي، مبدّل بيئات عمل، تنقّل بالروابط (#/todos …)
- اختصارات: `/` للبحث، `Ctrl/⌘+K` للإضافة السريعة، `Esc` للإغلاق
- تطبيق ويب (PWA manifest)

---

## البنية التقنية

```
checkwork-buy.pages.dev        Cloudflare Pages (وضع متقدّم)
├── dist/_worker.js            حزمة واحدة: العامل + الأصول الساكنة base64
├── src/
│   ├── handler.js             المنطق المشترك: ترويسات الأمان، CSRF، توجيه
│   ├── api.js                 جميع مسارات الـ API (39 مساراً)
│   ├── auth.js                PBKDF2، JWT، الجلسات، الكوكيز
│   ├── db.js                  تحويل صفوف القاعدة إلى صيغة العميل
│   ├── util.js                التحقق من المدخلات، تنسيق التواريخ
│   ├── static.js              خدمة الأصول المدمجة + SPA fallback
│   ├── pages-worker.js        نقطة دخول Pages
│   ├── worker.js              نقطة دخول Workers (نشر بديل)
│   └── assets.generated.js    مولَّد: خريطة base64 للأصول
├── public/                    HTML / CSS / JS / الأيقونات
├── scripts/build-pages.mjs    البناء: توليد الأصول + esbuild
├── schema.sql                 مخطط D1 (8 جداول)
├── test/
│   ├── smoke.mjs              163 اختباراً للـ API
│   └── ui.mjs                 29 اختباراً للواجهة (jsdom)
└── wrangler.pages.toml        إعدادات النشر
```

**قاعدة البيانات (D1 / SQLite):**
`users` · `workspaces` · `members` · `tasks` · `todos` · `task_notes` · `sessions` · `activity`

---

## التشغيل محلياً

```bash
npm install
npx wrangler d1 execute checkwork-db --local --file=./schema.sql
npm run build:pages
npx wrangler pages dev dist          # أو: npm run dev
```

## النشر

```bash
# 1) متغيّرات البيئة
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...

# 2) مفتاح توقيع الجلسات
echo "$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)" \
  | npx wrangler pages secret put SESSION_SECRET --project-name checkwork

# 3) البناء والنشر
npm run build:pages
npx wrangler pages deploy dist --project-name checkwork --branch main
```

> ربط D1 ومتغيّرات `SESSION_DAYS` و `LOGIN_MAX_ATTEMPTS` و `LOGIN_LOCK_MINUTES`
> يُضبط من لوحة Cloudflare أو عبر API لمشروع Pages.

### النشر على Workers (بديل)
```bash
npm install
npx wrangler d1 execute checkwork-db --remote --file=./schema.sql
echo "$(openssl rand -base64 48)" | npx wrangler secret put SESSION_SECRET
npx wrangler deploy          # wrangler.toml: workers_dev = false
```

---

## الاختبارات

```bash
BASE=https://checkwork-buy.pages.dev npm test              # 163 اختبار API
BASE=https://checkwork-buy.pages.dev npm run test:ui       # 29 اختبار واجهة
```

يغطيان: التسجيل والدخول، التحقق من المدخلات، CSRF و `Origin`، الدعوات وقبولها
ورفضها، دورة حياة المهمة كاملة، عزل المهام والبيانات بين البيئات، قوائم TODO
الخاصة والعامة وحراستها، الرتب والصلاحيات، قفل الحساب، التقارير و CSV، سجل النشاط،
وتشغيل الواجهة فعلياً (تسجيل ← تنقّل ← إنشاء مهمة/TODO ← نوافذ ← خروج).

---

## نقاط_endpoint الرئيسية

| الطريقة | المسار | الوصف |
|---|---|---|
| `POST` | `/api/auth/register` | تسجيل ذاتي (ينشئ بيئة خاصة) |
| `POST` | `/api/auth/login` | الدخول |
| `GET` | `/api/auth/me` | الجلسة + بيئة العمل + الشارات |
| `POST` | `/api/auth/password` | تغيير كلمة المرور (يُبطل الجلسات) |
| `GET` | `/api/auth/check-username` | فحص توفّر اسم المستخدم |
| `GET/POST` | `/api/workspaces` | بيئات العمل |
| `PATCH/DELETE` | `/api/workspaces/:id` | تعديل/حذف بيئة (للمشرف/المالك) |
| `POST` | `/api/workspaces/:id/switch` | تبديل البيئة النشطة |
| `GET/POST` | `/api/members` | الأعضاء / الدعوة عبر username |
| `PATCH/DELETE` | `/api/members/:id` | الرتبة / إزالة عضو |
| `GET` | `/api/invites` · `POST /api/invites/:id/accept\|decline` | الدعوات |
| `GET/POST` | `/api/tasks` | المهمات |
| `GET/PATCH/DELETE` | `/api/tasks/:id` | تفاصيل/تعديل/حذف مهمة |
| `POST` | `/api/tasks/:id/notes` | التعليقات |
| `GET/POST` | `/api/todos` | قوائم TODO |
| `PATCH/DELETE` | `/api/todos/:id` | تعديل/حذف عنصر |
| `GET` | `/api/stats` · `/api/reports` · `/api/activity` | التقارير |
| `GET` | `/api/export/tasks.csv` · `/api/reports.csv` | تصدير CSV |

---

## الرخصة

MIT