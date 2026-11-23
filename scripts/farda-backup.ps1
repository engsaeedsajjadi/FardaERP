# سیمراکس — پشتیبان‌گیری کامل (پایگاه داده + فایل‌های عمومی و محرمانه + تنظیمات سایت)
# اجرا از پوشهٔ اصلی پروژه:
#   powershell -ExecutionPolicy Bypass -File .\scripts\farda-backup.ps1
# پشتیبان روزانهٔ خودکار ساعت ۲۳:۳۰ (یک بار، با PowerShell «Run as administrator»):
#   powershell -ExecutionPolicy Bypass -File .\scripts\farda-backup.ps1 -Schedule
# پشتیبان‌ها در پوشهٔ backups\site-<تاریخ> ذخیره می‌شوند؛ ۱۴ نسخهٔ آخر نگه داشته می‌شود.
# حتماً پوشهٔ backups را مرتب روی هارد خارجی یا جای دیگری هم کپی کنید.
param([switch]$Schedule, [int]$Keep = 14)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path ".\docker-compose.yml")) { throw "این اسکریپت باید داخل پوشهٔ scripts پروژهٔ سیمراکس باشد" }

if ($Schedule) {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$PSScriptRoot\farda-backup.ps1`"" -WorkingDirectory (Get-Location).Path
    $trigger = New-ScheduledTaskTrigger -Daily -At 23:30
    Register-ScheduledTask -TaskName "Simorax Daily Backup" -Action $action -Trigger $trigger -Description "پشتیبان روزانهٔ سیمراکس" -Force | Out-Null
    Write-Host "پشتیبان روزانهٔ خودکار ساعت ۲۳:۳۰ تنظیم شد (Task Scheduler: Simorax Daily Backup)." -ForegroundColor Green
    exit 0
}

$line = Select-String -Path ".env" -Pattern '^\s*SITE_NAME\s*=\s*(.+)$' | Select-Object -First 1
if (-not $line) { throw "SITE_NAME در فایل .env پیدا نشد" }
$site = $line.Matches[0].Groups[1].Value.Trim().Trim('"')

Write-Host "1/3 ساخت پشتیبان داخل برنامه..." -ForegroundColor Cyan
docker compose exec -T backend bench --site $site backup --with-files
if ($LASTEXITCODE -ne 0) { throw "پشتیبان‌گیری ناموفق بود" }

$list = docker compose exec -T backend sh -c "ls -1t sites/$site/private/backups"
$latest = ($list | Where-Object { $_ -match "-database\.sql\.gz$" } | Select-Object -First 1)
if (-not $latest) { throw "فایل پشتیبان پایگاه داده پیدا نشد" }
$prefix = $latest -replace "-database\.sql\.gz$", ""
$parts = $list | Where-Object { $_.StartsWith($prefix) }

Write-Host "2/3 کپی پشتیبان به پوشهٔ backups..." -ForegroundColor Cyan
$dest = Join-Path (Get-Location) ("backups\site-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach ($p in $parts) {
    docker compose cp "backend:/home/frappe/frappe-bench/sites/$site/private/backups/$p" (Join-Path $dest $p)
    if ($LASTEXITCODE -ne 0) { throw "کپی $p ناموفق بود" }
}
$manifest = foreach ($f in Get-ChildItem $dest -File) {
    if ($f.Length -le 0) { throw "فایل $($f.Name) خالی است" }
    "{0}  {1}  {2}" -f (Get-FileHash $f.FullName -Algorithm SHA256).Hash, $f.Length, $f.Name
}
$manifest | Set-Content -Encoding UTF8 (Join-Path $dest "SHA256SUMS.txt")
if (-not (Get-ChildItem $dest -Filter "*-database.sql.gz")) { throw "پشتیبان پایگاه داده در پوشهٔ مقصد نیست" }

Write-Host "3/3 حذف پشتیبان‌های قدیمی‌تر از $Keep نسخهٔ آخر..." -ForegroundColor Cyan
Get-ChildItem ".\backups" -Directory -Filter "site-*" | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item -Recurse -Force

Write-Host "پشتیبان آماده است: $dest" -ForegroundColor Green
$manifest | ForEach-Object { Write-Host "  $_" }
Write-Host "یادآوری: این پوشه را روی هارد خارجی یا فضای ابری هم کپی کنید." -ForegroundColor Yellow
