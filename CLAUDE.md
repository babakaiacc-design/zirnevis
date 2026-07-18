# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

برای شرح کامل امکانات و راهنمای دیپلوی به [README.md](README.md) مراجعه کنید. این فایل خلاصهٔ معماری برای کار سریع روی کد است.

## این پروژه چیست

وب‌اپلیکیشن ترجمهٔ فایل زیرنویس `.srt` با Claude API — شماره و تایم‌کد هر خط دست‌نخورده می‌مانند و فقط متن ترجمه می‌شود. **بدون هیچ وابستگی npm** (فقط Node.js ≥ 18، بدون فریمورک).

## معماری

```
server.js      # سرور HTTP خام (بدون فریمورک) + استریم پیشرفت لحظه‌ای با SSE
srt.js         # پارس و بازسازی فایل SRT — تضمین حفظ شمارهٔ خط و تایم‌کد
translate.js   # موتور ترجمه: دسته‌بندی پاراگراف‌ها و فراخوانی Claude API (سه لحن: کوچه‌بازاری/شیک/رسمی-حقوقی)
public/        # رابط کاربری استاتیک (HTML/CSS/JS)، آپلود با drag&drop
```

## اجرای محلی

کلید API فقط از env خوانده می‌شود — هرگز در کد ننویسید:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:ACCESS_CODE = "یک-کد-دلخواه"   # اختیاری، برای محافظت از اعتبار API
node server.js
# http://localhost:3000
```

## متغیرهای محیطی مهم

| متغیر | نقش |
| --- | --- |
| `ANTHROPIC_API_KEY` | الزامی |
| `ACCESS_CODE` | اختیاری؛ اگر ست شود کاربر باید واردش کند |
| `TRANSLATE_MODEL` | پیش‌فرض `claude-sonnet-5` |
| `MAX_CUES` | سقف تعداد پاراگراف در هر فایل (پیش‌فرض ۳۰۰۰) |
| `PORT` | پیش‌فرض ۳۰۰۰ |

## دیپلوی

روی Render با `render.yaml` (Blueprint) یا دستی: Build = `npm install`، Start = `node server.js`. کلید API فقط در Environment تنظیمات Render قرار می‌گیرد، هرگز در کد یا کامیت.

⚠️ این پروژه یک ریپوی گیت مقداردهی‌شده دارد (`.git/`) — قبل از commit مطمئن شوید `config.json`/کلید API در کامیت نمی‌رود (`.gitignore` این را پوشش می‌دهد).
