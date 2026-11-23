# سیمراکس — اصلاح سریع: باز شدن مستقیم صفحه‌ها، دانلود فایل‌های خصوصی، «ریال» و راهنمای فیلترها
# اجرا از پوشهٔ اصلی پروژه:   powershell -ExecutionPolicy Bypass -File .\scripts\farda-quick-047.ps1
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location (Join-Path $PSScriptRoot "..")
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not (Test-Path ".\docker-compose.yml") -or -not (Test-Path ".\erpnext\hooks.py")) { throw "این اسکریپت باید داخل پوشهٔ scripts پروژهٔ سیمراکس باشد" }

$commit = "e8de7dfd057d298ecc6ed28889df1ba26d75b1c6"
$base = "https://raw.githubusercontent.com/engsaeedsajjadi/FardaERP/$commit/"
$files = @(
    @{ p = "erpnext/public/farda_iran/js/farda_ui.js"; h = "35A7B00FE2D28B071ADDB3B902E604016FD7B7C88CE69A613B1453A9F8344767" },
    @{ p = "docker/nginx/default.conf.template"; h = "0D387AA12E055A05188066FABA7B928BE839D1880DD7A94BD8952951A35D1C3A" },
    @{ p = "erpnext/farda_iran/report/farda_seasonal_transactions/farda_seasonal_transactions.py"; h = "428CE4326C1C9C3541EF08344EF7D6BD5EFF6CFF0BF55DBDB5A1B4997D29952D" }
)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path (Get-Location) "backups\core047-$stamp"
$tmp = Join-Path $env:TEMP "simorax-core047-$stamp"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host "1/3 دریافت $($files.Count) فایل..." -ForegroundColor Cyan
foreach ($f in $files) {
    $dest = Join-Path $tmp ($f.p -replace "/", "\")
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    $ok = $false
    foreach ($try in 1..3) {
        try { Invoke-WebRequest -UseBasicParsing -Uri ($base + $f.p) -OutFile $dest -TimeoutSec 60; $ok = $true; break }
        catch { Start-Sleep -Seconds 5 }
    }
    if (-not $ok) { throw "دریافت $($f.p) ممکن نشد؛ هیچ فایلی تغییر نکرده است." }
    if ((Get-FileHash -Algorithm SHA256 -Path $dest).Hash -ne $f.h) { throw "فایل $($f.p) سالم دریافت نشد؛ هیچ فایلی تغییر نکرده است." }
}

Write-Host "2/3 پشتیبان‌گیری و جایگزینی..." -ForegroundColor Cyan
foreach ($f in $files) {
    $rel = $f.p -replace "/", "\"
    if (Test-Path $rel) { $b = Join-Path $backup $rel; New-Item -ItemType Directory -Force -Path (Split-Path $b) | Out-Null; Copy-Item $rel $b -Force }
    Copy-Item (Join-Path $tmp $rel) $rel -Force
}
Remove-Item $tmp -Recurse -Force

Write-Host "3/3 اعمال روی برنامهٔ در حال اجرا..." -ForegroundColor Cyan
docker compose cp .\erpnext\public\farda_iran\js\farda_ui.js frontend:/usr/share/nginx/html/assets/erpnext/farda_iran/js/farda_ui.js
if ($LASTEXITCODE -ne 0) { throw "کپی farda_ui.js ناموفق بود" }
docker compose cp .\erpnext\public\farda_iran\js\farda_ui.js backend:/home/frappe/frappe-bench/apps/erpnext/erpnext/public/farda_iran/js/farda_ui.js
docker compose cp .\docker\nginx\default.conf.template frontend:/etc/nginx/templates/default.conf.template
if ($LASTEXITCODE -ne 0) { throw "کپی تنظیمات وب‌سرور ناموفق بود" }
docker compose cp .\erpnext\farda_iran\report\farda_seasonal_transactions\farda_seasonal_transactions.py backend:/home/frappe/frappe-bench/apps/erpnext/erpnext/farda_iran/report/farda_seasonal_transactions/farda_seasonal_transactions.py
docker compose restart frontend backend
Write-Host "تمام شد. مرورگر را با Ctrl+F5 تازه کنید." -ForegroundColor Green
