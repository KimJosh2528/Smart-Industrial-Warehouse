param(
  [Parameter(Mandatory = $true)] [string] $Endpoint,
  [Parameter(Mandatory = $true)] [string] $FixturePath,
  [Parameter(Mandatory = $true)] [string] $DeviceUid,
  [long] $Timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
)

$ErrorActionPreference = "Stop"
$secret = $env:TEST_DEVICE_HMAC_SECRET
if ([string]::IsNullOrEmpty($secret)) {
  throw "Set TEST_DEVICE_HMAC_SECRET in the private test environment first."
}
if (-not (Test-Path -LiteralPath $FixturePath -PathType Leaf)) {
  throw "JPEG fixture was not found: $FixturePath"
}

$body = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $FixturePath))
$prefix = [System.Text.Encoding]::UTF8.GetBytes("$Timestamp.")
$message = New-Object byte[] ($prefix.Length + $body.Length)
[Array]::Copy($prefix, 0, $message, 0, $prefix.Length)
[Array]::Copy($body, 0, $message, $prefix.Length, $body.Length)
$hmac = [System.Security.Cryptography.HMACSHA256]::new(
  [System.Text.Encoding]::UTF8.GetBytes($secret))
try {
  $signature = ([BitConverter]::ToString($hmac.ComputeHash($message)) -replace '-', '').ToLowerInvariant()
} finally {
  $hmac.Dispose()
}

Invoke-WebRequest -UseBasicParsing -Method Post -Uri $Endpoint -InFile $FixturePath -ContentType "image/jpeg" `
  -Headers @{
    "X-Device-UID" = $DeviceUid
    "X-Timestamp" = "$Timestamp"
    "X-Signature" = $signature
  }

