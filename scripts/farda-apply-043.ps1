# سیمراکس — نصب ترجمهٔ کامل فارسی (CORE-042) و دستیار هوشمند (CORE-043)
# این فایل را در پوشهٔ scripts پروژه بگذارید و از پوشهٔ اصلی پروژه اجرا کنید:
#   powershell -ExecutionPolicy Bypass -File .\scripts\farda-apply-043.ps1
# کار اسکریپت:
#   ۱) از فایل‌هایی که عوض می‌شوند نسخهٔ پشتیبان می‌گیرد (پوشهٔ backups)
#   ۲) نسخهٔ جدید فایل‌ها را از مخزن گیت‌هاب می‌گیرد و درستی هر فایل را با اثر انگشت SHA256 بررسی می‌کند
#   ۳) به‌روزرسانی کامل را اجرا می‌کند (ساخت ایمیج + migrate + ترجمه‌ها) — حدود ۵۰ دقیقه
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Test-Path ".\docker-compose.yml") -or -not (Test-Path ".\erpnext\hooks.py") -or -not (Test-Path ".\scripts\farda-update.ps1")) {
    throw "این اسکریپت باید داخل پوشهٔ scripts پروژهٔ سیمراکس باشد (کنار farda-update.ps1)"
}

$commit = "67c58689a0939bf333b9be5eda14e1437a155881"
$base = "https://raw.githubusercontent.com/engsaeedsajjadi/FardaERP/$commit/"
$files = @(
    @{ p = "docs/CORE-CHANGES.md"; h = "799380207DB6E64A3C0D8E83B6B40E1AA07F8BB9CAF84A4A6D9C93DAD6DF214F" },
    @{ p = "erpnext/farda_iran/assistant/__init__.py"; h = "9982CBEEAFC715C6FD24D90102C8A1CD9A43157EADBD0F634986CB8D6AABEE45" },
    @{ p = "erpnext/farda_iran/assistant/guides.py"; h = "F0027A0277FB6F93D5B0D7715A737F81814CD8EDC79B074368A785417095AF36" },
    @{ p = "erpnext/farda_iran/assistant/llm.py"; h = "B1F9A6542680EE3BBD0F32947E9F731AA5C7AEE23E398D46D44ACC6724FA991A" },
    @{ p = "erpnext/farda_iran/assistant/service.py"; h = "3D4F412BC20AD506C3D7A536EBFCC46774569C3ACC183B19BFB02EA87F9B5E6A" },
    @{ p = "erpnext/farda_iran/doctype/farda_assistant_settings/__init__.py"; h = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855" },
    @{ p = "erpnext/farda_iran/doctype/farda_assistant_settings/farda_assistant_settings.js"; h = "ABA74C6FB5AA07D4094369B4EC3DDB38EAD6DA403DEBE13BE85D171BDE19F626" },
    @{ p = "erpnext/farda_iran/doctype/farda_assistant_settings/farda_assistant_settings.json"; h = "7822C801312FE58311118AB8BFC0579A4CA8EEC2335D12205E2908234DA967C0" },
    @{ p = "erpnext/farda_iran/doctype/farda_assistant_settings/farda_assistant_settings.py"; h = "44869B2F7CCAA4E037D96ACE20F83359FDBE709B9B5C87A8B50912EB52662793" },
    @{ p = "erpnext/farda_iran/page/farda_home/farda_home.css"; h = "6042E9E77742CF79753EDC63B072C517729466D6F22EC53A47D0CF8832DD3955" },
    @{ p = "erpnext/farda_iran/page/farda_home/farda_home.json"; h = "8C09EAFD4C30FC9434969BDE535D451CFD0314F7F64171880D485DD440871E90" },
    @{ p = "erpnext/farda_iran/page/farda_visitor/farda_visitor.json"; h = "A781506BE5D0500141E410A1AB606B0F395679DE33E47A942AAB468891EE896E" },
    @{ p = "erpnext/farda_iran/setup/install.py"; h = "FC464325A71BD3AE171D06A2F889D57A4F6F1CA742AB28E0B43F75275B568B9C" },
    @{ p = "erpnext/farda_iran/tests/run_unit_tests.py"; h = "6FE71C618532A7EA91FF0F5FCE04787C5A89A448C457B4388A270104456FE5C5" },
    @{ p = "erpnext/farda_iran/tests/test_assistant_core.py"; h = "10F1013326CBE48B5AB1B3EFC663570D670E1C421F8AE167F61AF2F2D88F87B8" },
    @{ p = "erpnext/hooks.py"; h = "175074C767FB2FDE365546D9A2940A2F506A73C84A374DF106498CB507AB1223" },
    @{ p = "erpnext/locale/fa.po"; h = "21AA429DD7DC6C1A9367F7CA1D85E68EE115D27992A89AA523BAB187DF1A006A" },
    @{ p = "erpnext/public/farda_iran/js/farda_assistant.js"; h = "6CD748F8CFD3FA6AF5F888EE23E1932D3DB00A59CF854F28C7DE500E6944964C" },
    @{ p = "erpnext/public/farda_iran/js/farda_ui.js"; h = "E3C6E28806E09F7286DAE3BBD521434D02E42E15DA0FD89E0F030A6BCCB6897A" }
)

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path (Get-Location) "backups\core043-$stamp"
$tmp = Join-Path $env:TEMP "simorax-core043-$stamp"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host "1/3 دریافت $($files.Count) فایل از مخزن..." -ForegroundColor Cyan
foreach ($f in $files) {
    $dest = Join-Path $tmp ($f.p -replace "/", "\")
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    $ok = $false
    foreach ($try in 1..3) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri ($base + $f.p) -OutFile $dest -TimeoutSec 60
            $ok = $true; break
        } catch {
            Write-Host "  دریافت $($f.p) ناموفق بود؛ تلاش دوباره $try از 3 ..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }
    if (-not $ok) { throw "دریافت $($f.p) ممکن نشد؛ اتصال اینترنت را بررسی کنید. هیچ فایلی در پروژه تغییر نکرده است." }
    if (-not (Test-Path $dest)) { New-Item -ItemType File -Path $dest | Out-Null }
    $h = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash
    if ($h -ne $f.h) { throw "فایل $($f.p) سالم دریافت نشد (اثر انگشت نادرست). هیچ فایلی در پروژه تغییر نکرده است." }
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
Write-Host "  نسخهٔ قبلی فایل‌ها در $backup ذخیره شد." -ForegroundColor Green

Write-Host "3/3 به‌روزرسانی کامل برنامه (حدود ۵۰ دقیقه)..." -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File .\scripts\farda-update.ps1
if ($LASTEXITCODE -ne 0) { throw "به‌روزرسانی کامل ناموفق بود؛ خروجی بالا را بفرستید" }

Write-Host ""
Write-Host "نصب شد. مرورگر را با Ctrl+F5 تازه کنید:" -ForegroundColor Green
Write-Host "  - منوها و صفحه‌ها کامل فارسی هستند"
Write-Host "  - دکمهٔ «دستیار» پایین صفحه است"
Write-Host "  - تنظیمات دستیار: تنظیمات ← تنظیمات دستیار"
