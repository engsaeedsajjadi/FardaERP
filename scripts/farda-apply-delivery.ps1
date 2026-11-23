# سیمراکس — نصب همهٔ تغییرات تا نسخهٔ تحویل و به‌روزرسانی کامل (حدود ۶۰ دقیقه)
# اجرا از پوشهٔ اصلی پروژه:   powershell -ExecutionPolicy Bypass -File .\scripts\farda-apply-delivery.ps1
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location (Join-Path $PSScriptRoot "..")
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not (Test-Path ".\docker-compose.yml") -or -not (Test-Path ".\scripts\farda-update.ps1")) { throw "این اسکریپت باید داخل پوشهٔ scripts پروژهٔ سیمراکس باشد" }

$commit = "cc98bbfa60431d3daf0ae2a32d20e208188405e0"
$base = "https://raw.githubusercontent.com/engsaeedsajjadi/FardaERP/$commit/"
$files = @(
    @{ p = "docker/Dockerfile"; h = "EBB0D83CFB0C17603AF3F13214E27288B07C0C6EB0C0B3D4DFD11B43849C35D2" },
    @{ p = "docker/entrypoint.sh"; h = "9CADAC77FF07E8D9E6F0763243CB66BB242442F2AE5DD8EA43BEBDF534E2D94F" },
    @{ p = "docker/nginx/default.conf.template"; h = "0D387AA12E055A05188066FABA7B928BE839D1880DD7A94BD8952951A35D1C3A" },
    @{ p = "erpnext/farda_iran/api/namespaces_registry.py"; h = "1F5AAEE81C44D02ABE8DD3754C9C9A5E552ED3C1CDF6E45E1DE1FD0A344E4F64" },
    @{ p = "erpnext/farda_iran/assistant/guides.py"; h = "DEF1268A4A52B8735B9E35560006081989803108487A57EF7BFD853C97F502E8" },
    @{ p = "erpnext/farda_iran/banking/batch_formats.py"; h = "A6FDEFA256D478C92C9F5B569F92A9C11DF2B3424F6D4B31B8F16F24409EC5F6" },
    @{ p = "erpnext/farda_iran/compat/jalali_format.py"; h = "23A288D158A2969FB34019CCEEEB3806198C9BE9F6CD3240E9F0BFE86AEA9638" },
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
    @{ p = "erpnext/farda_iran/report/farda_seasonal_transactions/farda_seasonal_transactions.py"; h = "428CE4326C1C9C3541EF08344EF7D6BD5EFF6CFF0BF55DBDB5A1B4997D29952D" },
    @{ p = "erpnext/farda_iran/setup/fiscal_year.py"; h = "1C3F6F7D149EC8A9B530E7CECDD52E2D002BB1449311D7ADD0FA6FF401562E50" },
    @{ p = "erpnext/farda_iran/setup/install.py"; h = "596A2D611CC3B39450E91726F5424D5544D350F175BE117D7F8E0F037559F318" },
    @{ p = "erpnext/farda_iran/setup/workflows.py"; h = "AB5B817E00C99DDF26A494EE78C19138A4227FBDAED6F1A3AA861A20BE204326" },
    @{ p = "erpnext/farda_iran/tests/js/parity_test.js"; h = "E762BED5FBC3C541614967BA157111DD982DC3AD256830D5237C369955A2EF4D" },
    @{ p = "erpnext/farda_iran/tests/run_unit_tests.py"; h = "1682011517C9F09D6AE046FA8AB4C41710448B6BFD6B0EAE612EB5C16C00ED05" },
    @{ p = "erpnext/farda_iran/tests/test_jalali_format.py"; h = "58A13F93648C6C828E8B9721DB29884AE041E463E11C67F419D37E18905ADB5F" },
    @{ p = "erpnext/farda_iran/tests/test_phase1_core.py"; h = "0A5C2A510FD184CDE05D65349CD6010B2902F5B856F78340C52FCDD788C70214" },
    @{ p = "erpnext/hooks.py"; h = "431BBFA48BBDFC1103CB1FF0D34B687E904C4DDAC08F34E0BB7E0C0885F32381" },
    @{ p = "erpnext/public/farda_iran/js/farda_ui.js"; h = "CAE7773E2A64D6EBD725990A41A5B650BB00DFFF0EC8FB78CEA1B06A4F6FA585" },
    @{ p = "erpnext/selling/page/sales_funnel/sales_funnel.js"; h = "5B40AC4029C95BBDD30F37038D4BA55AD7A0EAFD3B4CFEA723090CF62AF35BD0" },
    @{ p = "erpnext/selling/report/customer_acquisition_and_loyalty/customer_acquisition_and_loyalty.py"; h = "E0314E92F1D362EEC0BA75C06D9BA37DCA71F40B70A2C254A0BDD6C28A9BAAE4" },
    @{ p = "scripts/farda-apply-043.ps1"; h = "7412E8A3171F658385B2A2E74AC0EA18F809E63A19A9625E9C9AB42B3E0BB9B1" },
    @{ p = "scripts/farda-backup.ps1"; h = "485D620D1CBEA248A2957C450FFE440B8B50C236971AEA92BCB8CDD2CF36A017" },
    @{ p = "scripts/farda-fix-assets.ps1"; h = "7FB039F3593AFC72995A0875F113434C142D8FBB95AF093D08621B861B6EA02A" },
    @{ p = "scripts/farda-new-site.ps1"; h = "8AB304A4ABEED2BD16CF5A418B0358FEDCF0054ACFCD70E507794C68C6352D18" },
    @{ p = "scripts/farda-quick-046.ps1"; h = "454E511A033332BDF8B32981F6A8A523D6DFD1EB8ACB00A41C423D2CBD948F7F" },
    @{ p = "scripts/farda-quick-047.ps1"; h = "FF07DDE92E18964CBE71685FA9430FB95BB0EF226CEEB986DF3CFC721535FBD8" },
    @{ p = "scripts/farda-quick-048.ps1"; h = "A3D3D2B47012C620A1360CE708A4D756DD60AF5823471F8D76245A5912CF2D47" },
    @{ p = "scripts/farda-quick-049.ps1"; h = "3081EF6B01E1FA4FA2EA30DB5398B052678C57B0C1283F10CF0EBD74EA0E3054" },
    @{ p = "scripts/farda-restore.ps1"; h = "5A1EE8502D240E109752727F1E9B3F2A45579A95688D3AA31092F34903205A5D" }
)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path (Get-Location) "backups\delivery-$stamp"
$tmp = Join-Path $env:TEMP "simorax-delivery-$stamp"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host "1/3 دریافت $($files.Count) فایل از مخزن..." -ForegroundColor Cyan
foreach ($f in $files) {
    $dest = Join-Path $tmp ($f.p -replace "/", "\")
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    $ok = $false
    foreach ($try in 1..3) {
        try { Invoke-WebRequest -UseBasicParsing -Uri ($base + $f.p) -OutFile $dest -TimeoutSec 60; $ok = $true; break }
        catch { Start-Sleep -Seconds 5 }
    }
    if (-not $ok) { throw "دریافت $($f.p) ممکن نشد؛ هیچ فایلی تغییر نکرده است." }
    if (-not (Test-Path $dest)) { New-Item -ItemType File -Path $dest | Out-Null }
    if ((Get-FileHash -Algorithm SHA256 -Path $dest).Hash -ne $f.h) { throw "فایل $($f.p) سالم دریافت نشد؛ هیچ فایلی تغییر نکرده است." }
}
Write-Host "  همهٔ فایل‌ها سالم دریافت شدند." -ForegroundColor Green

Write-Host "2/3 پشتیبان‌گیری و جایگزینی فایل‌ها..." -ForegroundColor Cyan
foreach ($f in $files) {
    $rel = $f.p -replace "/", "\"
    if (Test-Path $rel) { $b = Join-Path $backup $rel; New-Item -ItemType Directory -Force -Path (Split-Path $b) | Out-Null; Copy-Item $rel $b -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path $rel) | Out-Null
    Copy-Item (Join-Path $tmp $rel) $rel -Force
}
Remove-Item $tmp -Recurse -Force

Write-Host "3/3 به‌روزرسانی کامل (ساخت ایمیج + پایگاه داده)..." -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File .\scripts\farda-update.ps1
if ($LASTEXITCODE -ne 0) { throw "به‌روزرسانی کامل ناموفق بود؛ خروجی بالا را بفرستید" }
Write-Host "نسخهٔ تحویل نصب شد. مرورگر را با Ctrl+F5 تازه کنید." -ForegroundColor Green
