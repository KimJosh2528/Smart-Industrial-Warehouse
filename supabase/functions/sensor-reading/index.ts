import { authenticateDeviceRequest, DeviceAuthError } from "../_shared/deviceAuth.ts";
import { callRpc, SupabaseAdminError } from "../_shared/supabaseAdmin.ts";
import { jsonResponse, methodNotAllowed } from "../_shared/response.ts";

const MIN_TEMPERATURE_C = -40;
const MAX_TEMPERATURE_C = 80;
const MIN_HUMIDITY_PCT = 0;
const MAX_HUMIDITY_PCT = 100;

interface RecordedSensorResult {
  reading_id: string;
  environmental_state: "NORMAL" | "WARNING" | "DANGER" | null;
  previous_environmental_state: "NORMAL" | "WARNING" | "DANGER" | null;
  fire_state: "ON" | "OFF";
  trigger_reason: string | null;
  transition_created: boolean;
  configuration_status: "configured" | "missing";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const rawBody = await req.text();

  let auth;
  try {
    auth = await authenticateDeviceRequest(req, rawBody);
  } catch (error) {
    if (error instanceof DeviceAuthError) return jsonResponse({ status: "error", message: "authentication_failed" }, 401);
    return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
  }

  try {
    let input: unknown;
    try {
      input = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ status: "error", message: "invalid_json" }, 400);
    }

    if (!input || typeof input !== "object") {
      return jsonResponse({ status: "error", message: "invalid_request" }, 400);
    }

    const body = input as Record<string, unknown>;
    if (
      "device_id" in body ||
      "warehouse_id" in body ||
      "smoke_detected" in body ||
      "fire_detected" in body ||
      "environmental_state" in body ||
      "safety_state" in body ||
      "transition_type" in body ||
      "event_type" in body
    ) {
      return jsonResponse({ status: "error", message: "invalid_request" }, 400);
    }

    const areaId = typeof body.area_id === "string" ? body.area_id.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(areaId)) {
      return jsonResponse({ status: "error", message: "invalid_room" }, 400);
    }

    const temperatureC = body.temperature_c;
    const humidityPct = body.humidity_pct;
    const smokeValue = body.smoke_value;
    if (
      typeof temperatureC !== "number" ||
      typeof humidityPct !== "number" ||
      !Number.isFinite(temperatureC) ||
      !Number.isFinite(humidityPct) ||
      temperatureC < MIN_TEMPERATURE_C ||
      temperatureC > MAX_TEMPERATURE_C ||
      humidityPct < MIN_HUMIDITY_PCT ||
      humidityPct > MAX_HUMIDITY_PCT
    ) {
      return jsonResponse({ status: "error", message: "invalid_sensor_reading" }, 400);
    }

    if (
      smokeValue !== undefined &&
      (typeof smokeValue !== "number" ||
        !Number.isFinite(smokeValue) ||
        smokeValue < 0)
    ) {
      return jsonResponse({ status: "error", message: "invalid_sensor_reading" }, 400);
    }

    const result = await callRpc<RecordedSensorResult[]>("record_sensor_reading", {
      p_device_id: auth.device.id,
      p_area_id: areaId,
      p_temperature_c: temperatureC,
      p_humidity_pct: humidityPct,
      p_smoke_value: smokeValue === undefined ? null : smokeValue,
      p_metadata: {
        sensor_unit: "safety_sensor_unit",
        dht22: true,
        smoke_sensor: smokeValue !== undefined,
      },
    });
    const recorded = result[0];
    if (!recorded) throw new SupabaseAdminError("database_error");

    if (recorded.configuration_status === "missing") {
      return jsonResponse({
        status: "recorded",
        reading_id: recorded.reading_id,
        environmental_state: recorded.environmental_state,
        previous_environmental_state: recorded.previous_environmental_state,
        fire_state: recorded.fire_state,
        trigger_reason: recorded.trigger_reason,
        transition_created: recorded.transition_created,
        configuration_status: "missing",
      }, 503);
    }

    return jsonResponse({
      status: "recorded",
      reading_id: recorded.reading_id,
      environmental_state: recorded.environmental_state,
      previous_environmental_state: recorded.previous_environmental_state,
      fire_state: recorded.fire_state,
      trigger_reason: recorded.trigger_reason,
      transition_created: recorded.transition_created,
      configuration_status: "configured",
    }, 201);
  } catch (error) {
    if (error instanceof SupabaseAdminError) return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
    return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
  }
});
