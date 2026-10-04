$ErrorActionPreference = "Stop"

$endpoint = "https://odavmzgciaoahebanpmy.supabase.co/functions/v1/phase16-apikey-diagnostic"
$expectedSupabaseUrl = "https://odavmzgciaoahebanpmy.supabase.co"
$deviceUid = "dev_028eaedec2ec3249a5fa76c2"
$fixturePath = "C:\Users\kim joshua\Downloads\car with plate number test.jpg"

$supabaseUrl = $env:SUPABASE_URL
$serviceKey = $env:SUPABASE_SERVICE_ROLE_KEY
$testSecret = $env:TEST_DEVICE_HMAC_SECRET

$missing = @()
if ([string]::IsNullOrEmpty($supabaseUrl)) { $missing += "SUPABASE_URL" }
if ([string]::IsNullOrEmpty($serviceKey)) { $missing += "SUPABASE_SERVICE_ROLE_KEY" }
if ([string]::IsNullOrEmpty($testSecret)) { $missing += "TEST_DEVICE_HMAC_SECRET" }
if ($missing.Count -gt 0) {
    Write-Output ("Missing environment variable(s): " + ($missing -join ", "))
    exit 2
}

if ($supabaseUrl.TrimEnd("/") -ne $expectedSupabaseUrl) {
    Write-Output "SUPABASE_URL does not match the expected project URL."
    exit 3
}

if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
    Write-Output "Fixture file is missing."
    exit 4
}

$body = [System.IO.File]::ReadAllBytes($fixturePath)
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString([Globalization.CultureInfo]::InvariantCulture)
$timestampBytes = [Text.Encoding]::UTF8.GetBytes($timestamp + ".")
$message = New-Object byte[] ($timestampBytes.Length + $body.Length)
[Buffer]::BlockCopy($timestampBytes, 0, $message, 0, $timestampBytes.Length)
[Buffer]::BlockCopy($body, 0, $message, $timestampBytes.Length, $body.Length)

$hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($testSecret))
try {
    $signature = (($hmac.ComputeHash($message) | ForEach-Object { $_.ToString("x2") }) -join "")
}
finally {
    $hmac.Dispose()
}

Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, $endpoint)
$content = [Net.Http.ByteArrayContent]::new($body)
$content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new("image/jpeg")
$request.Headers.TryAddWithoutValidation("apikey", $serviceKey) | Out-Null
$request.Headers.TryAddWithoutValidation("X-Device-UID", $deviceUid) | Out-Null
$request.Headers.TryAddWithoutValidation("X-Timestamp", $timestamp) | Out-Null
$request.Headers.TryAddWithoutValidation("X-Signature", $signature) | Out-Null
$request.Content = $content

try {
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    Write-Output "endpoint: $endpoint"
    Write-Output "device_uid: $deviceUid"
    Write-Output "timestamp: $timestamp"
    Write-Output "body_length: $($body.Length)"
    Write-Output "signature_length: $($signature.Length)"
    Write-Output "http_status: $([int]$response.StatusCode)"
    Write-Output "response_body: $responseBody"
}
finally {
    $request.Dispose()
    $client.Dispose()
}
