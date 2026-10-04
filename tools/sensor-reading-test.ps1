param()

$ErrorActionPreference = "Stop"

$supabaseUrl = $env:SUPABASE_URL
$secret = $env:TEST_DEVICE_HMAC_SECRET

if ([string]::IsNullOrWhiteSpace($supabaseUrl)) {
  throw "SUPABASE_URL is missing from the current PowerShell environment."
}
if ([string]::IsNullOrWhiteSpace($secret)) {
  throw "TEST_DEVICE_HMAC_SECRET is missing from the current PowerShell environment."
}

$deviceUid = "dev_028eaedec2ec3249a5fa76c2"
$endpoint = "$($supabaseUrl.TrimEnd('/'))/functions/v1/sensor-reading"
$previousTimestamp = 0L

function Get-StrictlyIncreasingTimestamp {
  while ($true) {
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ($timestamp -gt $script:previousTimestamp) {
      $script:previousTimestamp = $timestamp
      return $timestamp
    }
    Start-Sleep -Milliseconds 250
  }
}

function Send-SensorCase {
  param(
    [Parameter(Mandatory = $true)] [string] $Name,
    [Parameter(Mandatory = $true)] [double] $TemperatureC,
    [Parameter(Mandatory = $true)] [double] $HumidityPct,
    [Parameter(Mandatory = $true)] [double] $SmokeValue
  )

  $body = [ordered]@{
    temperature_c = $TemperatureC
    humidity_pct = $HumidityPct
    smoke_value = $SmokeValue
  } | ConvertTo-Json -Compress

  $timestamp = Get-StrictlyIncreasingTimestamp
  $prefix = [System.Text.Encoding]::UTF8.GetBytes("$timestamp.")
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $message = New-Object byte[] ($prefix.Length + $bodyBytes.Length)
  [Array]::Copy($prefix, 0, $message, 0, $prefix.Length)
  [Array]::Copy($bodyBytes, 0, $message, $prefix.Length, $bodyBytes.Length)

  $hmac = [System.Security.Cryptography.HMACSHA256]::new(
    [System.Text.Encoding]::UTF8.GetBytes($secret))
  try {
    $signature = ([BitConverter]::ToString($hmac.ComputeHash($message)) -replace '-', '').ToLowerInvariant()
  } finally {
    $hmac.Dispose()
  }

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $endpoint `
      -ContentType "application/json" `
      -Headers @{
        "X-Device-UID" = $deviceUid
        "X-Timestamp" = "$timestamp"
        "X-Signature" = $signature
      } `
      -Body $body

    $statusCode = [int]$response.StatusCode
    $responseBody = $response.Content
  } catch {
    $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
    $responseBody = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
  }

  [pscustomobject]@{
    case = $Name
    timestamp = $timestamp
    http_status = $statusCode
    response_body = $responseBody
  } | ConvertTo-Json -Compress

  if ($statusCode -lt 200 -or $statusCode -ge 300) {
    throw "Sensor case '$Name' failed with HTTP status $statusCode."
  }
}

$cases = @(
  @{ Name = "NORMAL"; TemperatureC = 25; HumidityPct = 50; SmokeValue = 0 },
  @{ Name = "TEMPERATURE WARNING"; TemperatureC = 32; HumidityPct = 50; SmokeValue = 0 },
  @{ Name = "HUMIDITY WARNING"; TemperatureC = 25; HumidityPct = 75; SmokeValue = 0 },
  @{ Name = "SMOKE WARNING"; TemperatureC = 25; HumidityPct = 50; SmokeValue = 1800 },
  @{ Name = "HIGH TEMPERATURE WITHOUT DANGER SMOKE"; TemperatureC = 42; HumidityPct = 50; SmokeValue = 1000 },
  @{ Name = "COMBINED DANGER"; TemperatureC = 42; HumidityPct = 50; SmokeValue = 3000 },
  @{ Name = "RETURN TO NORMAL"; TemperatureC = 25; HumidityPct = 50; SmokeValue = 0 }
)

foreach ($case in $cases) {
  Send-SensorCase @case
}
