# سیمراکس — بازگرداندن پشتیبان (همهٔ اطلاعات فعلی سایت جایگزین می‌شود)
# اجرا از پوشهٔ اصلی پروژه:
#   powershell -ExecutionPolicy Bypass -File .\scripts\farda-restore.ps1 -BackupFolder .\backups\site-20261123-233000
# قبل از بازگرداندن، از وضعیت فعلی خودکار یک پشتیبان گرفته می‌شود.
param([Parameter(Mandatory = $true)][string]$BackupFolder)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path ".\docker-compose.yml")) { throw "این اسکریپت باید داخل پوشهٔ scripts پروژهٔ سیمراکس باشد" }
$BackupFolder = (Resolve-Path $BackupFolder).Path

function EnvValue($key) {
    $l = Select-String -Path ".env" -Pattern ("^\s*" + $key + "\s*=\s*(.+)$") | Select-Object -First 1
    if ($l) { return $l.Matches[0].Groups[1].Value.Trim().Trim('"') }
    return $null
}
$site = EnvValue "SITE_NAME"
$rootPw = EnvValue "DB_ROOT_PASSWORD"
if (-not $site -or -not $rootPw) { throw "SITE_NAME یا DB_ROOT_PASSWORD در فایل .env نیست" }

$db = Get-ChildItem $BackupFolder -Filter "*-database.sql.gz" | Select-Object -First 1
if (-not $db) { throw "در این پوشه فایل *-database.sql.gz پیدا نشد" }
$pub = Get-ChildItem $BackupFolder -Filter "*-files.tar" | Where-Object { $_.Name -notmatch "private" } | Select-Object -First 1
$priv = Get-ChildItem $BackupFolder -Filter "*-private-files.tar" | Select-Object -First 1
$sums = Join-Path $BackupFolder "SHA256SUMS.txt"
if (Test-Path $sums) {
    foreach ($row in Get-Content $sums) {
        $h, $size, $name = $row -split "\s+", 3
        $f = Join-Path $BackupFolder $name
        if ((Test-Path $f) -and (Get-FileHash $f -Algorithm SHA256).Hash -ne $h) { throw "فایل $name خراب است (اثر انگشت نمی‌خواند)" }
    }
    Write-Host "سالم بودن فایل‌های پشتیبان تأیید شد." -ForegroundColor Green
}

Write-Host ""
Write-Host "هشدار: همهٔ اطلاعات فعلی سایت «$site» با پشتیبان $($db.Name) جایگزین می‌شود." -ForegroundColor Red
$answer = Read-Host "برای ادامه، نام سایت ($site) را دقیقاً تایپ کنید"
if ($answer -ne $site) { Write-Host "لغو شد؛ چیزی تغییر نکرد."; exit 1 }

Write-Host "1/4 پشتیبان از وضعیت فعلی (برای احتیاط)..." -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\farda-backup.ps1"
if ($LASTEXITCODE -ne 0) { throw "پشتیبان احتیاطی ناموفق بود؛ بازگردانی انجام نشد" }

Write-Host "2/4 انتقال فایل‌های پشتیبان به برنامه..." -ForegroundColor Cyan
$in = "/home/frappe/frappe-bench/sites/$site/private/restore-in"
docker compose exec -T backend mkdir -p $in
foreach ($f in @($db, $pub, $priv) | Where-Object { $_ }) {
    docker compose cp $f.FullName "backend:$in/$($f.Name)"
    if ($LASTEXITCODE -ne 0) { throw "کپی $($f.Name) ناموفق بود" }
}

Write-Host "3/4 بازگردانی پایگاه داده و فایل‌ها..." -ForegroundColor Cyan
$args2 = "bench --site '$site' restore '$in/$($db.Name)' --db-root-username root --db-root-password `"`$DB_ROOT_PASSWORD`""
if ($pub) { $args2 += " --with-public-files '$in/$($pub.Name)'" }
if ($priv) { $args2 += " --with-private-files '$in/$($priv.Name)'" }
$env:DB_ROOT_PASSWORD = $rootPw
docker compose exec -T -e DB_ROOT_PASSWORD backend bash -c $args2
$code = $LASTEXITCODE
Remove-Item Env:\DB_ROOT_PASSWORD
docker compose exec -T backend rm -rf $in
if ($code -ne 0) { throw "بازگردانی ناموفق بود؛ خروجی بالا را بفرستید. پشتیبان احتیاطی در پوشهٔ backups هست." }

Write-Host "4/4 به‌روزرسانی پایگاه داده و راه‌اندازی دوباره..." -ForegroundColor Cyan
docker compose exec -T backend bench --site $site migrate
docker compose exec -T backend bench --site $site clear-cache
docker compose restart backend workers scheduler
Write-Host "بازگردانی تمام شد. مرورگر را با Ctrl+F5 تازه کنید و وارد شوید." -ForegroundColor Green
