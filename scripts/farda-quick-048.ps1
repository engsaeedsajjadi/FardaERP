# سیمراکس — تاریخ شمسی در نمودارها، گزارش‌های دوره‌ای، چاپ، PDF و ایمیل (CORE-048)
# اجرا از پوشهٔ اصلی پروژه:   powershell -ExecutionPolicy Bypass -File .\scripts\farda-quick-048.ps1
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location (Join-Path $PSScriptRoot "..")
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not (Test-Path ".\docker-compose.yml") -or -not (Test-Path ".\erpnext\hooks.py")) { throw "این اسکریپت باید داخل پوشهٔ scripts پروژهٔ سیمراکس باشد" }

$commit = "8e4e702423de26244d8194c20c0bdc22a7fe5d6d"
$base = "https://raw.githubusercontent.com/engsaeedsajjadi/FardaERP/$commit/"
$files = @(
    @{ p = "erpnext/public/farda_iran/js/farda_ui.js"; h = "09D2A1824B2005A4E9AF6A26AF824C3FD890BBC71EA678659B96B7DF2C91EA87" },
    @{ p = "erpnext/farda_iran/compat/jalali_format.py"; h = "23A288D158A2969FB34019CCEEEB3806198C9BE9F6CD3240E9F0BFE86AEA9638" },
    @{ p = "erpnext/hooks.py"; h = "F049FB601764B6B18AEDB527ABBB12F7CE126B2F3B068F04EC05FA9604674086" }
)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path (Get-Location) "backups\core048-$stamp"
$tmp = Join-Path $env:TEMP "simorax-core048-$stamp"
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
    New-Item -ItemType Directory -Force -Path (Split-Path $rel) | Out-Null
    Copy-Item (Join-Path $tmp $rel) $rel -Force
}
Remove-Item $tmp -Recurse -Force

Write-Host "3/3 اعمال روی برنامهٔ در حال اجرا..." -ForegroundColor Cyan
docker compose cp .\erpnext\public\farda_iran\js\farda_ui.js frontend:/usr/share/nginx/html/assets/erpnext/farda_iran/js/farda_ui.js
if ($LASTEXITCODE -ne 0) { throw "کپی farda_ui.js ناموفق بود" }
foreach ($svc in @("backend", "workers", "scheduler")) {
    docker compose cp .\erpnext\public\farda_iran\js\farda_ui.js "$($svc):/home/frappe/frappe-bench/apps/erpnext/erpnext/public/farda_iran/js/farda_ui.js"
    docker compose cp .\erpnext\farda_iran\compat\jalali_format.py "$($svc):/home/frappe/frappe-bench/apps/erpnext/erpnext/farda_iran/compat/jalali_format.py"
    docker compose cp .\erpnext\hooks.py "$($svc):/home/frappe/frappe-bench/apps/erpnext/erpnext/hooks.py"
    if ($LASTEXITCODE -ne 0) { throw "کپی در سرویس $svc ناموفق بود" }
}
$line = Select-String -Path ".env" -Pattern '^\s*SITE_NAME\s*=\s*(.+)$' | Select-Object -First 1
$site = $line.Matches[0].Groups[1].Value.Trim().Trim('"')
docker compose exec -T backend bench --site $site clear-cache
docker compose restart frontend backend workers scheduler
Write-Host "تمام شد. مرورگر را با Ctrl+F5 تازه کنید." -ForegroundColor Green
