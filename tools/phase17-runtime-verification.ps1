$ErrorActionPreference = "Stop"

$required = @(
  "SUPABASE_SERVICE_ROLE_KEY",
  "TEST_DEVICE_HMAC_SECRET"
)
foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    Write-Output "$name=MISSING"
    exit 1
  }
  Write-Output "$name=PRESENT"
}

$runner = Join-Path $PSScriptRoot "phase17-runtime-verification.ts"
deno run --allow-env --allow-net --allow-read $runner
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$phase16 = Join-Path $PSScriptRoot "..\supabase\functions\truck-plate\test-request.ps1"
$fixture = "C:\Users\kim joshua\Downloads\car with plate number test.jpg"
$endpoint = "https://odavmzgciaoahebanpmy.supabase.co/functions/v1/truck-plate"
$deviceUid = "dev_028eaedec2ec3249a5fa76c2"
try {
  $response = & $phase16 -Endpoint $endpoint -FixturePath $fixture -DeviceUid $deviceUid
  Write-Output "PHASE16_RESPONSE=$($response.Content)"
  Write-Output "PHASE16_STATUS=$($response.StatusCode)"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Output "PHASE16_STATUS=$status"
  Write-Output "PHASE16_REQUEST_FAILED"
  exit 1
}
