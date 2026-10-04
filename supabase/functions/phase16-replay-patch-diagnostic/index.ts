const TARGET_DEVICE_UID = "dev_028eaedec2ec3249a5fa76c2";
const TARGET_DEVICE_ID = "d9351322-d29b-4f34-ab99-b0d9ca6a118e";

interface DeviceRow {
  id: string;
  device_uid: string;
  is_active: boolean;
  device_secret_encrypted: string | null;
  last_nonce_ts: number | null;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseResult(timestamp: number): Record<string, unknown> {
  return {
    device_uid: TARGET_DEVICE_UID,
    device_id: TARGET_DEVICE_ID,
    timestamp,
    device_resolution_http_status: null,
    device_resolution_returned_rows: null,
    patch_attempted: false,
    patch_http_status: null,
    patch_response_content_type: null,
    patch_response_body_length: null,
    patch_response_json_parse_success: false,
    patch_returned_row_count: null,
    exactly_one_canonical_row_returned: false,
    case: null,
    patch_error_code: null,
    patch_error_message: null,
    patch_error_details: null,
    patch_error_hint: null,
    error_category: null,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const timestamp = Math.floor(Date.now() / 1000);
  const result = baseResult(timestamp);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) {
    result.error_category = "server_configuration_error";
    return json(result, 200);
  }

  try {
    const lookupUrl = `${url}/rest/v1/devices?device_uid=eq.${encodeURIComponent(TARGET_DEVICE_UID)}&select=id,device_uid,is_active,device_secret_encrypted,last_nonce_ts`;
    const lookupResponse = await fetch(lookupUrl, { headers: { apikey: serviceKey } });
    result.device_resolution_http_status = lookupResponse.status;
    if (!lookupResponse.ok) {
      result.error_category = "device_resolution_non_2xx";
      return json(result, 200);
    }

    const deviceRows = await lookupResponse.json() as DeviceRow[];
    result.device_resolution_returned_rows = deviceRows.length;
    const device = deviceRows.length === 1 &&
      deviceRows[0].id === TARGET_DEVICE_ID &&
      deviceRows[0].device_uid === TARGET_DEVICE_UID
      ? deviceRows[0]
      : null;
    if (!device) {
      result.error_category = "canonical_device_resolution_mismatch";
      return json(result, 200);
    }

    const patchUrl = `${url}/rest/v1/devices?id=eq.${encodeURIComponent(device.id)}&or=(last_nonce_ts.is.null,last_nonce_ts.lt.${timestamp})`;
    const patchBody = JSON.stringify({
      last_nonce_ts: timestamp,
      last_seen_at: new Date().toISOString(),
    });
    result.patch_attempted = true;

    const patchResponse = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: patchBody,
    });
    const responseText = await patchResponse.text();
    result.patch_http_status = patchResponse.status;
    result.patch_response_content_type = patchResponse.headers.get("content-type");
    result.patch_response_body_length = new TextEncoder().encode(responseText).length;

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
      result.patch_response_json_parse_success = true;
    } catch {
      result.error_category = patchResponse.ok ? "success_non_json_response" : "non_2xx_non_json_response";
      return json(result, 200);
    }

    if (!patchResponse.ok) {
      const errorObject = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
      result.patch_error_code = typeof errorObject.code === "string" ? errorObject.code : null;
      result.patch_error_message = typeof errorObject.message === "string" ? errorObject.message : null;
      result.patch_error_details = typeof errorObject.details === "string" ? errorObject.details : null;
      result.patch_error_hint = typeof errorObject.hint === "string" ? errorObject.hint : null;
      result.error_category = "patch_non_2xx_json_response";
      return json(result, 200);
    }

    const rows = Array.isArray(parsed) ? parsed : [];
    result.patch_returned_row_count = rows.length;
    result.exactly_one_canonical_row_returned = rows.length === 1 &&
      String((rows[0] as Record<string, unknown>).id) === TARGET_DEVICE_ID;
    result.case = rows.length === 0 ? "B" : rows.length === 1 ? "A" : "C";
    return json(result, 200);
  } catch {
    result.error_category = result.patch_attempted ? "patch_transport_or_processing_error" : "device_resolution_transport_or_processing_error";
    return json(result, 200);
  }
});
