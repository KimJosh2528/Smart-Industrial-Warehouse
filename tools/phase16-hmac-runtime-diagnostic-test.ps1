param(
  [string] $Endpoint = "https://odavmzgciaoahebanpmy.supabase.co/functions/v1/phase16-hmac-runtime-diagnostic",
  [string] $FixturePath = "C:\Users\kim joshua\Downloads\car with plate number test.jpg"
)

$ErrorActionPreference = "Stop"
$secret = $env:TEST_DEVICE_HMAC_SECRET
if ([string]::IsNullOrEmpty($secret)) { throw "TEST_DEVICE_HMAC_SECRET is not loaded." }
if (-not (Test-Path -LiteralPath $FixturePath -PathType Leaf)) { throw "JPEG fixture was not found." }

$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$body = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $FixturePath))
$prefix = [System.Text.Encoding]::UTF8.GetBytes("$timestamp.")
$message = New-Object byte[] ($prefix.Length + $body.Length)
[Array]::Copy($prefix, 0, $message, 0, $prefix.Length)
[Array]::Copy($body, 0, $message, $prefix.Length, $body.Length)
$hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($secret))
try { $signature = ([BitConverter]::ToString($hmac.ComputeHash($message)) -replace '-', '').ToLowerInvariant() } finally { $hmac.Dispose() }

Invoke-WebRequest -UseBasicParsing -Method Post -Uri $Endpoint -InFile $FixturePath -ContentType "image/jpeg" -Headers @{
  "X-Device-UID" = "dev_028eaedec2ec3249a5fa76c2"
  "X-Timestamp" = "$timestamp"
  "X-Signature" = $signature
} | Select-Object -ExpandProperty Content
