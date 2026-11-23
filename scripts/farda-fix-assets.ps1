# سیمراکس — اصلاح فوری: هماهنگ کردن فهرست فایل‌های ظاهر برنامه (صفحه‌های بی‌ظاهر)
# اجرا از پوشهٔ اصلی پروژه:   powershell -ExecutionPolicy Bypass -File .\scripts\farda-fix-assets.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path ".\docker-compose.yml")) { throw "این اسکریپت باید داخل پوشهٔ scripts پروژهٔ سیمراکس باشد" }
$line = Select-String -Path ".env" -Pattern '^\s*SITE_NAME\s*=\s*(.+)$' | Select-Object -First 1
$site = $line.Matches[0].Groups[1].Value.Trim().Trim('"')
$tmp = Join-Path $env:TEMP ("simorax-assets-" + (Get-Date -Format "yyyyMMddHHmmss"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host "1/2 برداشتن فهرست فایل‌های ظاهر از نسخهٔ فعلی برنامه..." -ForegroundColor Cyan
foreach ($f in @("assets.json", "assets-rtl.json")) {
    docker compose cp "frontend:/usr/share/nginx/html/assets/$f" (Join-Path $tmp $f)
    if ($LASTEXITCODE -ne 0) { throw "خواندن $f ناموفق بود" }
}
Write-Host "2/2 جایگزینی فهرست قدیمی روی سرور..." -ForegroundColor Cyan
foreach ($f in @("assets.json", "assets-rtl.json")) {
    docker compose cp (Join-Path $tmp $f) "backend:/home/frappe/frappe-bench/sites/assets/$f"
    if ($LASTEXITCODE -ne 0) { throw "نوشتن $f ناموفق بود" }
}
Remove-Item $tmp -Recurse -Force
docker compose exec -T backend bench --site $site clear-cache
docker compose restart backend
Write-Host "تمام شد. مرورگر را با Ctrl+F5 تازه کنید." -ForegroundColor Green
