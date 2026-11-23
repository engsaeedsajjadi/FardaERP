# سیمراکس — نصب سریع مرحلهٔ ۱ سازمانی (CORE-044 تا CORE-046) بدون ساخت دوبارهٔ ایمیج
# اجرا از پوشهٔ اصلی پروژه:
#   powershell -ExecutionPolicy Bypass -File .\scripts\farda-quick-046.ps1
# ۱) فایل‌های جدید را از مخزن می‌گیرد و اثر انگشت هرکدام را بررسی می‌کند
# ۲) از فایل‌های فعلی پشتیبان می‌گیرد و جایگزین می‌کند (در پوشهٔ پروژه، دائمی)
# ۳) کد را داخل برنامهٔ در حال اجرا کپی و پایگاه داده را به‌روز می‌کند (چند دقیقه)
# تغییر ظاهری «ریال» و راهنمای فیلترها با به‌روزرسانی کامل بعدی (farda-update) دیده می‌شود.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location (Join-Path $PSScriptRoot "..")
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Test-Path ".\docker-compose.yml") -or -not (Test-Path ".\erpnext\hooks.py")) {
    throw "این اسکریپت باید داخل پوشهٔ scripts پروژهٔ سیمراکس باشد"
}
$line = Select-String -Path ".env" -Pattern '^\s*SITE_NAME\s*=\s*(.+)$' | Select-Object -First 1
if (-not $line) { throw "SITE_NAME در فایل .env پیدا نشد" }
$site = $line.Matches[0].Groups[1].Value.Trim().Trim('"')

$commit = "a8da598df7ccc33a037db4ac5ee347f218207bbf"
$base = "https://raw.githubusercontent.com/engsaeedsajjadi/FardaERP/$commit/"
$files = @(
    @{ p = "erpnext/farda_iran/api/namespaces_registry.py"; h = "1F5AAEE81C44D02ABE8DD3754C9C9A5E552ED3C1CDF6E45E1DE1FD0A344E4F64" },
    @{ p = "erpnext/farda_iran/assistant/guides.py"; h = "DEF1268A4A52B8735B9E35560006081989803108487A57EF7BFD853C97F502E8" },
    @{ p = "erpnext/farda_iran/banking/batch_formats.py"; h = "A6FDEFA256D478C92C9F5B569F92A9C11DF2B3424F6D4B31B8F16F24409EC5F6" },
    @{ p = "erpnext/farda_iran/compliance/__init__.py"; h = "A7EC81FBD482DD17E98EF84462349290379F5C5A940855295E6650015B39774E" },
    @{ p = "erpnext/farda_iran/compliance/books_data.py"; h = "68B1F644824214646269841DC72DFE50C20D1CCDB22EC849F289D02D1102CF7F" },
    @{ p = "erpnext/farda_iran/compliance/legal_books.py"; h = "5D3D3E9DFCCC04A100037C9CCB889F55B9C734C441ECC7FDDB1830707780FBC5" },
    @{ p = "erpnext/farda_iran/compliance/seasonal.py"; h = "24CE7D868AE7CFB8B277722B433B5199C0068BF074E2C6F0C2971BCA784B6047" },
    @{ p = "erpnext/farda_iran/doctype/farda_bank_payment_batch/__init__.py"; h = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855" },
    @{ p = "erpnext/farda_iran/doctype/farda_bank_payment_batch/farda_bank_payment_batch.js"; h = "44EC6263B7360B5FA3D16B8F54172E1B89BC5B8E30469F33859B0A2768FAB7A4" },
    @{ p = "erpnext/farda_iran/doctype/farda_bank_payment_batch/farda_bank_payment_batch.json"; h = "894C6A485AFCEF1482415C6F98A52FE5EB18E7B808B0903765EF0A44025EF8AD" },
    @{ p = "erpnext/farda_iran/doctype/farda_bank_payment_batch/farda_bank_payment_batch.py"; h = "7338D7CBD228E5C34726BCA464C7EEAA8A92EB538BA456BA7D50DFBA56E5FECB" },
    @{ p = "erpnext/farda_iran/doctype/farda_bank_payment_row/__init__.py"; h = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855" },
    @{ p = "erpnext/farda_iran/doctype/farda_bank_payment_row/farda_bank_payment_row.json"; h = "4385B9E2791461A7D80AA6FD3500B2B58DA5C96FC4652F68D37F5ADD20D8648D" },
    @{ p = "erpnext/farda_iran/doctype/farda_bank_payment_row/farda_bank_payment_row.py"; h = "0D9EC7B39F013BB61531E50D02FFD73D7A842B84AD7A45145B2AF663C23B1CE3" },
    @{ p = "erpnext/farda_iran/page/farda_home/farda_home.js"; h = "51ACE22F2661B05325219C50F924A0202064FB2AD3BBE061B08A065E6074DFC1" },
    @{ p = "erpnext/farda_iran/report/farda_legal_journal/__init__.py"; h = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855" },
    @{ p = "erpnext/farda_iran/report/farda_legal_journal/farda_legal_journal.js"; h = "D3780D0AFF927A2EA37D669844B045F1337C1EDC0C2FBB0A10100B73B61910C5" },
    @{ p = "erpnext/farda_iran/report/farda_legal_journal/farda_legal_journal.json"; h = "204A69C491114A615CBC9636796DA5AEB97CB39B433371D97C01FE3E22D0E334" },
    @{ p = "erpnext/farda_iran/report/farda_legal_journal/farda_legal_journal.py"; h = "129105C6C20A548EC9F29E800519233A5C8887CC95C522E8BBCE41A53ABFC1DD" },
    @{ p = "erpnext/farda_iran/report/farda_legal_ledger/__init__.py"; h = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855" },
    @{ p = "erpnext/farda_iran/report/farda_legal_ledger/farda_legal_ledger.js"; h = "F0F48262C0DD1D40617486B3209CD2FA87DC67CFB6DADF3CAFD823FA1FADFBF1" },
    @{ p = "erpnext/farda_iran/report/farda_legal_ledger/farda_legal_ledger.json"; h = "6916798051A94A5215932F080078A515AD7174E14B79332AB3A4DBF1D8E85FB7" },
    @{ p = "erpnext/farda_iran/report/farda_legal_ledger/farda_legal_ledger.py"; h = "BA09FF746F9F62335183FFD2D9A3131F7174C13FD67A25736968F34827FC6EC1" },
    @{ p = "erpnext/farda_iran/report/farda_seasonal_transactions/__init__.py"; h = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855" },
    @{ p = "erpnext/farda_iran/report/farda_seasonal_transactions/farda_seasonal_transactions.js"; h = "1D51323848090D5F56136049C371C81AADD918C102D8FF3447F15DD41905114E" },
    @{ p = "erpnext/farda_iran/report/farda_seasonal_transactions/farda_seasonal_transactions.json"; h = "E9168633E862CFD65127B346DE7815E9806B97C1389275CFF3C084C3FCB25A63" },
    @{ p = "erpnext/farda_iran/report/farda_seasonal_transactions/farda_seasonal_transactions.py"; h = "63EBA9E21DC9998E1ED4C269A5C5F4CDC3B0F8D527657240D93AE3514E89F5C5" },
    @{ p = "erpnext/farda_iran/setup/install.py"; h = "BF10C1E8A8BEA04327E045E5A9641A45DF3BDE13288C0B8D64F018EDB8788109" },
    @{ p = "erpnext/farda_iran/setup/workflows.py"; h = "AB5B817E00C99DDF26A494EE78C19138A4227FBDAED6F1A3AA861A20BE204326" },
    @{ p = "erpnext/farda_iran/tests/run_unit_tests.py"; h = "9659599AAC3C7E99EAE08DA322B58871DAF8FD21A172817347EC957A52AABEEE" },
    @{ p = "erpnext/farda_iran/tests/test_phase1_core.py"; h = "E0FE11B06676E7D64EFD8E775A4F0CAB6FE606917AF193D489339145CEC5B54C" },
    @{ p = "erpnext/public/farda_iran/js/farda_ui.js"; h = "30B6C8B5AD5F49AFB148ED63081B91FE10DF42536B57F7D386938F74D2FE3E7A" }
)

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path (Get-Location) "backups\core046-$stamp"
$tmp = Join-Path $env:TEMP "simorax-core046-$stamp"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host "1/3 دریافت $($files.Count) فایل از مخزن..." -ForegroundColor Cyan
foreach ($f in $files) {
    $dest = Join-Path $tmp ($f.p -replace "/", "\")
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    $ok = $false
    foreach ($try in 1..3) {
        try { Invoke-WebRequest -UseBasicParsing -Uri ($base + $f.p) -OutFile $dest -TimeoutSec 60; $ok = $true; break }
        catch { Write-Host "  دریافت $($f.p) ناموفق بود؛ تلاش دوباره $try از 3 ..." -ForegroundColor Yellow; Start-Sleep -Seconds 5 }
    }
    if (-not $ok) { throw "دریافت $($f.p) ممکن نشد؛ اینترنت را بررسی کنید. هیچ فایلی تغییر نکرده است." }
    if (-not (Test-Path $dest)) { New-Item -ItemType File -Path $dest | Out-Null }
    if ((Get-FileHash -Algorithm SHA256 -Path $dest).Hash -ne $f.h) { throw "فایل $($f.p) سالم دریافت نشد. هیچ فایلی تغییر نکرده است." }
}
Write-Host "  همهٔ فایل‌ها سالم دریافت شدند." -ForegroundColor Green

Write-Host "2/3 پشتیبان‌گیری و جایگزینی فایل‌ها..." -ForegroundColor Cyan
foreach ($f in $files) {
    $rel = $f.p -replace "/", "\"
    if (Test-Path $rel) {
        $b = Join-Path $backup $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $b) | Out-Null
        Copy-Item $rel $b -Force
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $rel) | Out-Null
    Copy-Item (Join-Path $tmp $rel) $rel -Force
}
Remove-Item $tmp -Recurse -Force
Write-Host "  نسخهٔ قبلی در $backup ذخیره شد." -ForegroundColor Green

Write-Host "3/3 اعمال روی برنامهٔ در حال اجرا..." -ForegroundColor Cyan
foreach ($svc in @("backend", "workers", "scheduler")) {
    docker compose cp .\erpnext\farda_iran "$($svc):/home/frappe/frappe-bench/apps/erpnext/erpnext/"
    if ($LASTEXITCODE -ne 0) { throw "کپی کد در سرویس $svc ناموفق بود" }
}
docker compose exec -T backend bench --site $site migrate
if ($LASTEXITCODE -ne 0) { throw "migrate ناموفق بود؛ خروجی بالا را بفرستید" }
docker compose exec -T backend bench --site $site clear-cache
docker compose restart backend workers scheduler

Write-Host ""
Write-Host "نصب شد. مرورگر را با Ctrl+F5 تازه کنید. موارد جدید:" -ForegroundColor Green
Write-Host "  - حسابداری: دفتر روزنامهٔ قانونی، دفتر کل قانونی"
Write-Host "  - مالیات بر ارزش افزوده: معاملات فصلی"
Write-Host "  - بانک و چک: پرداخت گروهی بانکی"
Write-Host "  - تنظیمات: گردش‌های تأیید (غیرفعال؛ هر وقت خواستید فعال کنید)"
