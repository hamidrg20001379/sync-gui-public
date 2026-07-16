# سینک گرافیکی

[ENGLISH](README.md) | **فارسی**

Sync GUI یک رابط محلی برای مدیریت سینک فایل‌ها و پوشه‌ها بین پروژه‌ها و مقصدهای مختلف است. وقتی یک پروژه چند مقصد مثل production و staging دارد و هر مقصد دسته‌بندی‌ها و مسیرهای خودش را دارد، این ابزار کمک می‌کند همه چیز مرتب و قابل تکرار بماند.

![نمایش Sync GUI با داده نمونه](docs/demo.gif)

## امکانات

- مدیریت پروژه‌ها، ریموت‌ها، دسته‌بندی‌ها و mappingها از داخل یک UI.
- هر ریموت داخل پروژه دسته‌بندی‌های مستقل خودش را دارد.
- امکان استفاده دوباره از اطلاعات اتصال بین چند ریموت پروژه.
- سینک یک mapping، یک دسته‌بندی کامل، یا کل یک ریموت.
- پشتیبانی از SSH، مسیر محلی، و مسیرهای network share.
- دارای GitHub Actions برای build و release.
- خروجی release شامل فایل portable ویندوز، installer ویندوز، آرشیو Linux، آرشیو macOS، فایل DMG برای macOS، و AppImage برای Linux است.
- بررسی نسخه‌های جدید از GitHub Releases و سوال از کاربر قبل از دانلود.

## حریم خصوصی

این نسخه عمومی هیچ کانفیگ واقعی، credential، مسیر سرور، IP، یا اطلاعات پروژه خصوصی ندارد.

فایل‌های واقعی خودتان را فقط به صورت local نگه دارید:

- `sync-projects.json`
- `.env`

این فایل‌ها در `.gitignore` قرار دارند. برای شروع از فایل‌های نمونه استفاده کنید:

```powershell
Copy-Item sync-projects.example.json sync-projects.json
Copy-Item .env.example .env
```

## اجرای سریع

```powershell
npm install
Copy-Item sync-projects.example.json sync-projects.json
Copy-Item .env.example .env
npm run dev
```

بعد آدرس محلی Next.js را که در ترمینال نمایش داده می‌شود باز کنید.

برای اجرای نسخه Electron:

```powershell
npm run electron
```

## ساخت خروجی

```powershell
npm run build
npm run dist
```

برای ساخت فایل نصب یا بسته تک‌فایلی، بعد از ساخت نسخه portable:

```powershell
npm run installer:win
npm run installer:mac
npm run installer:linux
```

ساخت installer ویندوز به Inno Setup نیاز دارد. خروجی macOS به صورت `.dmg` و خروجی Linux به صورت `.AppImage` ساخته می‌شود.

## به‌روزرسانی

برنامه در هر session یک بار GitHub Releases را بررسی می‌کند و همچنین دکمه `Check updates` دارد. اگر نسخه جدیدتری وجود داشته باشد، قبل از باز کردن لینک دانلود از کاربر سوال می‌پرسد.

این روش update را بی‌صدا نصب نمی‌کند؛ فقط فایل مناسب سیستم‌عامل را برای دانلود باز می‌کند.

## پیکربندی

فایل `sync-projects.example.json` ساختار امن نمونه را نشان می‌دهد:

- `projects[]` ریشه‌های محلی پروژه‌ها را تعریف می‌کند.
- `remotes[]` اطلاعات اتصال قابل استفاده مجدد را تعریف می‌کند.
- هر ریموت داخل پروژه می‌تواند با `remoteId` به یک ریموت قابل استفاده مجدد وصل شود.
- هر ریموت داخل پروژه `categories[]` مستقل خودش را دارد.

اطلاعات اتصال می‌تواند از `.env` خوانده شود، مثلا:

```json
{
  "hostEnv": "SERVER_HOST",
  "usernameEnv": "SERVER_USERNAME",
  "passwordEnv": "SERVER_PASSWORD"
}
```
