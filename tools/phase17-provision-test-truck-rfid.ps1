$ErrorActionPreference = "Stop"

$required = @("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    Write-Output "$name=MISSING"
    exit 1
  }
  Write-Output "$name=PRESENT"
}

$secureValue = Read-Host -Prompt "Enter a synthetic even-length hexadecimal test RFID UID" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
try {
  $enteredRfid = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $secureValue.Dispose()
}

if ([string]::IsNullOrWhiteSpace($enteredRfid) -or
    $enteredRfid -notmatch '^[0-9a-fA-F]+$' -or
    ($enteredRfid.Length % 2 -ne 0)) {
  Write-Output "PHASE17_TEST_TRUCK_RFID=INVALID"
  exit 1
}

$env:PHASE17_TEST_TRUCK_RFID = $enteredRfid
if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("PHASE17_TEST_TRUCK_RFID"))) {
  Write-Output "PHASE17_TEST_TRUCK_RFID=NOT_SET"
  exit 1
}

deno run --allow-env --allow-net tools/phase17-provision-test-truck-rfid.ts
