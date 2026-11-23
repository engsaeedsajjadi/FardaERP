# سیمراکس — نصب تازه برای مشتری (روی سیستم یا سرور مشتری، با اطلاعات خالی)
# پیش‌نیاز: Docker Desktop نصب و روشن باشد؛ کد پروژه در همین پوشه باشد.
# اجرا از پوشهٔ اصلی پروژه:
#   powershell -ExecutionPolicy Bypass -File .\scripts\farda-new-site.ps1
# این اسکریپت فقط روی سیستمی اجرا شود که سایت سیمراکس ندارد.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path ".\docker-compose.yml")) { throw "این اسکریپت باید داخل پوشهٔ scripts پروژهٔ سیمراکس باشد" }

function EnvValue($key) {
    $l = Select-String -Path ".env" -Pattern ("^\s*" + $key + "\s*=\s*(.*)$") | Select-Object -First 1
    if ($l) { return $l.Matches[0].Groups[1].Value.Trim().Trim('"') }
    return $null
}
function RandomHex($n) { $b = New-Object byte[] $n; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { "{0:x2}" -f $_ }) }

Write-Host "1/6 آماده‌سازی فایل تنظیمات (.env)..." -ForegroundColor Cyan
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    $site = Read-Host "نام سایت (مثلاً erp.company.ir یا localhost)"
    $port = Read-Host "پورت وب (مثلاً 80 یا 8090)"
    (Get-Content ".env") `
        -replace '^SITE_NAME=.*', "SITE_NAME=$site" `
        -replace '^HTTP_PORT=.*', "HTTP_PORT=$port" `
        -replace '^DB_ROOT_PASSWORD=.*', ("DB_ROOT_PASSWORD=" + (RandomHex 24)) `
        -replace '^DB_PASSWORD=.*', ("DB_PASSWORD=" + (RandomHex 24)) `
        -replace '^FARDA_OTP_PEPPER=.*', ("FARDA_OTP_PEPPER=" + (RandomHex 32)) |
        Set-Content -Encoding UTF8 ".env"
    Write-Host "  رمزهای پایگاه داده به‌صورت تصادفی ساخته و در .env ذخیره شد. این فایل را محرمانه نگه دارید." -ForegroundColor Yellow
}
$site = EnvValue "SITE_NAME"
if ((Get-Content ".env" -Raw) -match "__CHANGE_ME__") { throw "در فایل .env هنوز مقدار __CHANGE_ME__ هست؛ آن را پر کنید" }
New-Item -ItemType Directory -Force -Path ".\secrets\moadian" | Out-Null

Write-Host "2/6 ساخت ایمیج برنامه (بار اول طولانی است)..." -ForegroundColor Cyan
docker compose build
if ($LASTEXITCODE -ne 0) { throw "ساخت ایمیج ناموفق بود" }

Write-Host "3/6 راه‌اندازی سرویس‌ها..." -ForegroundColor Cyan
docker compose up -d mariadb redis-cache redis-queue
Start-Sleep -Seconds 20
docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "راه‌اندازی ناموفق بود" }
Start-Sleep -Seconds 30

$exists = docker compose exec -T backend sh -c "test -f sites/$site/site_config.json && echo yes || echo no"
if ($exists -match "yes") { throw "سایت $site از قبل وجود دارد؛ این اسکریپت فقط برای نصب تازه است" }

Write-Host "4/6 ساخت سایت تازه..." -ForegroundColor Cyan
$sec = Read-Host "رمز مدیر سیستم (Administrator) را وارد کنید؛ حداقل ۱۲ حرف، و جایی نفرستید" -AsSecureString
$adminPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ($adminPw.Length -lt 12) { throw "رمز کوتاه است؛ حداقل ۱۲ حرف" }
$env:DB_ROOT_PASSWORD = EnvValue "DB_ROOT_PASSWORD"
$env:DB_PASSWORD = EnvValue "DB_PASSWORD"
$env:ADMIN_PASSWORD = $adminPw
docker compose exec -T -e DB_ROOT_PASSWORD -e DB_PASSWORD -e ADMIN_PASSWORD backend bash -c "bench new-site '$site' --db-root-username root --mariadb-user-host-login-scope=% --db-root-password `"`$DB_ROOT_PASSWORD`" --db-password `"`$DB_PASSWORD`" --admin-password `"`$ADMIN_PASSWORD`" --install-app erpnext --install-app hrms"
$code = $LASTEXITCODE
Remove-Item Env:\DB_ROOT_PASSWORD, Env:\DB_PASSWORD, Env:\ADMIN_PASSWORD
$adminPw = $null
if ($code -ne 0) { throw "ساخت سایت ناموفق بود؛ خروجی بالا را بفرستید" }

Write-Host "5/6 زبان فارسی و تنظیمات ایران..." -ForegroundColor Cyan
docker compose exec -T backend bench --site $site migrate
docker compose exec -T backend bench compile-po-to-mo --app erpnext --locale fa --force
docker compose exec -T backend bench --site $site clear-cache
docker compose restart frontend backend workers scheduler

Write-Host "6/6 تمام شد." -ForegroundColor Green
$port = EnvValue "HTTP_PORT"
Write-Host "حالا مرورگر را باز کنید: http://localhost:$port  (یا آدرس سرور)"
Write-Host "با Administrator وارد شوید و «راه‌اندازی اولیه» را کامل کنید:"
Write-Host "  - زبان: فارسی | کشور: Iran | منطقهٔ زمانی: Asia/Tehran | ارز: IRR"
Write-Host "  - شروع سال مالی: ۱ فروردین (۲۱ مارس) — نام سال مالی خودکار «۱۴۰۵» می‌شود"
Write-Host "بعد از آن پشتیبان روزانه را فعال کنید:  .\scripts\farda-backup.ps1 -Schedule"
