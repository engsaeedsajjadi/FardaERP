# FardaERP — به‌روزرسانی دائمی (ساخت دوباره ایمیج + مهاجرت پایگاه داده)
# اجرا از پوشه اصلی پروژه:   powershell -ExecutionPolicy Bypass -File .\scripts\farda-update.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$line = Select-String -Path ".env" -Pattern '^\s*SITE_NAME\s*=\s*(.+)$' | Select-Object -First 1
if (-not $line) { throw "SITE_NAME در فایل .env پیدا نشد" }
$site = $line.Matches[0].Groups[1].Value.Trim().Trim('"')
Write-Host "سایت: $site" -ForegroundColor Cyan

# پوشه کلیدهای سامانه مودیان (فقط روی همین سیستم؛ وارد گیت و ایمیج نمی‌شود)
New-Item -ItemType Directory -Force -Path ".\secrets\moadian" | Out-Null

Write-Host "1/4 ساخت ایمیج (چند دقیقه طول می‌کشد)..." -ForegroundColor Cyan
$ok = $false
foreach ($try in 1..3) {
    docker compose build
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Write-Host "ساخت ایمیج ناموفق بود (احتمالاً قطعی اینترنت)؛ تلاش دوباره $try از 3 ..." -ForegroundColor Yellow
    Start-Sleep -Seconds 20
}
if (-not $ok) { throw "ساخت ایمیج سه بار ناموفق بود؛ اتصال اینترنت را بررسی کنید و اسکریپت را دوباره اجرا کنید" }

Write-Host "2/4 راه‌اندازی دوباره سرویس‌ها..." -ForegroundColor Cyan
docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "راه‌اندازی ناموفق بود" }
Start-Sleep -Seconds 20

Write-Host "3/4 به‌روزرسانی پایگاه داده (migrate)..." -ForegroundColor Cyan
docker compose exec -T backend bench --site $site migrate
if ($LASTEXITCODE -ne 0) { throw "migrate ناموفق بود" }

Write-Host "4/4 ترجمه‌ها و پاک‌کردن کش..." -ForegroundColor Cyan
docker compose exec -T backend bench compile-po-to-mo --app erpnext --locale fa --force
docker compose exec -T backend bench --site $site clear-cache
docker compose restart backend workers scheduler

Write-Host "تمام شد. صفحه را با Ctrl+F5 باز کنید." -ForegroundColor Green
