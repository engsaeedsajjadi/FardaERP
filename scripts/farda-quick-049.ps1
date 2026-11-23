# سیمراکس — تکمیل تاریخ شمسی (قیف فروش، جذب مشتری، سه‌ماهه‌ها، شروع هفته از شنبه)
# اجرا از پوشهٔ اصلی پروژه:   powershell -ExecutionPolicy Bypass -File .\scripts\farda-quick-049.ps1
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location (Join-Path $PSScriptRoot "..")
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not (Test-Path ".\docker-compose.yml") -or -not (Test-Path ".\erpnext\hooks.py")) { throw "این اسکریپت باید داخل پوشهٔ scripts پروژهٔ سیمراکس باشد" }
$line = Select-String -Path ".env" -Pattern '^\s*SITE_NAME\s*=\s*(.+)$' | Select-Object -First 1
$site = $line.Matches[0].Groups[1].Value.Trim().Trim('"')

$commit = "6a076171715df6d63fd8bd0c545dbca68d7ce4ea"
$base = "https://raw.githubusercontent.com/engsaeedsajjadi/FardaERP/$commit/"
$files = @(
    @{ p = "erpnext/public/farda_iran/js/farda_ui.js"; h = "AAAA7A1FBB4626AB0CEFB9B1FD585FF8DA74F211CB35148493D467DAE7DD99EC" },
    @{ p = "erpnext/selling/page/sales_funnel/sales_funnel.js"; h = "5B40AC4029C95BBDD30F37038D4BA55AD7A0EAFD3B4CFEA723090CF62AF35BD0" },
    @{ p = "erpnext/selling/report/customer_acquisition_and_loyalty/customer_acquisition_and_loyalty.py"; h = "E0314E92F1D362EEC0BA75C06D9BA37DCA71F40B70A2C254A0BDD6C28A9BAAE4" },
    @{ p = "erpnext/farda_iran/setup/install.py"; h = "8726B3942158326EAD646A4486F0F18AF0E20819141E22BFBFEB1AB79FC0C568" }
)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path (Get-Location) "backups\core049-$stamp"
$tmp = Join-Path $env:TEMP "simorax-core049-$stamp"
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
$app = "/home/frappe/frappe-bench/apps/erpnext/erpnext"
docker compose cp .\erpnext\public\farda_iran\js\farda_ui.js frontend:/usr/share/nginx/html/assets/erpnext/farda_iran/js/farda_ui.js
if ($LASTEXITCODE -ne 0) { throw "کپی farda_ui.js ناموفق بود" }
foreach ($svc in @("backend", "workers", "scheduler")) {
    docker compose cp .\erpnext\public\farda_iran\js\farda_ui.js "$($svc):$app/public/farda_iran/js/farda_ui.js"
    docker compose cp .\erpnext\selling\page\sales_funnel\sales_funnel.js "$($svc):$app/selling/page/sales_funnel/sales_funnel.js"
    docker compose cp .\erpnext\selling\report\customer_acquisition_and_loyalty\customer_acquisition_and_loyalty.py "$($svc):$app/selling/report/customer_acquisition_and_loyalty/customer_acquisition_and_loyalty.py"
    docker compose cp .\erpnext\farda_iran\setup\install.py "$($svc):$app/farda_iran/setup/install.py"
    if ($LASTEXITCODE -ne 0) { throw "کپی در سرویس $svc ناموفق بود" }
}
docker compose restart backend workers scheduler frontend
Start-Sleep -Seconds 15
docker compose exec -T backend bench --site $site execute erpnext.farda_iran.setup.install.ensure_week_start
docker compose exec -T backend bench --site $site clear-cache
Write-Host "تمام شد. مرورگر را با Ctrl+F5 تازه کنید." -ForegroundColor Green
