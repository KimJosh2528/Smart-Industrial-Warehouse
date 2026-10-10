import { authenticateDeviceRequest, DeviceAuthError } from "../_shared/deviceAuth.ts";
import { insertRow, selectRows, SupabaseAdminError } from "../_shared/supabaseAdmin.ts";
import { jsonResponse, methodNotAllowed } from "../_shared/response.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LABEL = 128;

type CameraMethod = "staff_face" | "truck_plate";
interface AreaRow { id: string; area_type_code: string; }
interface FaceMapping { id: string; staff_member_id: string; face_label: string; }
interface StaffRow { id: string; is_active: boolean; member_type: "staff" | "guard"; }
interface TruckRow { id: string; normalized_plate: string; is_active: boolean; }

function normalizePlate(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return normalized && normalized.length <= MAX_LABEL && /^[A-Z0-9 .-]+$/.test(normalized) ? normalized : null;
}

async function logDecision(
  warehouseId: string, areaId: string, deviceId: string, method: CameraMethod,
  result: "success" | "denied", reason: string, staffMemberId: string | null, truckId: string | null,
  metadata: Record<string, unknown>,
) {
  await insertRow("access_logs", {
    warehouse_id: warehouseId, area_id: areaId, device_id: deviceId,
    credential_id: null, staff_member_id: staffMemberId, truck_id: truckId,
    event_type: `${method === "staff_face" ? "STAFF_FACE" : "TRUCK_PLATE"}_${result === "success" ? "SUCCESS" : "DENIED"}`,
    authentication_method: method, result, metadata: { reason, ...metadata },
  });
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
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const areaId = typeof body.area_id === "string" ? body.area_id.trim() : "";
    const method = body.method === "staff_face" || body.method === "truck_plate" ? body.method as CameraMethod : null;
    const observed = typeof body.observed === "string" ? body.observed.trim() : "";
    const score = typeof body.score === "number" && Number.isFinite(body.score) ? body.score : null;
    const validObserved = method === "staff_face"
      ? /^[A-Za-z0-9][A-Za-z0-9 .-]{0,127}$/.test(observed)
      : normalizePlate(observed) !== null;
    if (!UUID.test(areaId) || !method || !validObserved || (score !== null && (score < 0 || score > 1))) {
      return jsonResponse({ status: "error", message: "invalid_request" }, 400);
    }

    const areas = await selectRows<AreaRow>("warehouse_areas", { id: `eq.${areaId}`, warehouse_id: `eq.${auth.device.warehouse_id}` }, "id,area_type_code");
    if (areas.length !== 1) return jsonResponse({ status: "error", message: "invalid_request" }, 400);
    const area = areas[0];

    if (method === "staff_face") {
      if (area.area_type_code !== "staff_entrance") {
        await logDecision(auth.device.warehouse_id, areaId, auth.device.id, method, "denied", "wrong_area_type", null, null, { score });
        return jsonResponse({ status: "denied", reason: "wrong_area_type" }, 200);
      }
      const mappings = await selectRows<FaceMapping>("camera_face_mappings", {
        warehouse_id: `eq.${auth.device.warehouse_id}`, face_label: `ilike.${observed}`, is_active: "eq.true",
      }, "id,staff_member_id,face_label");
      const mapping = mappings.length === 1 ? mappings[0] : null;
      const staff = mapping ? (await selectRows<StaffRow>("staff_members", {
        id: `eq.${mapping.staff_member_id}`, warehouse_id: `eq.${auth.device.warehouse_id}`, is_active: "eq.true",
      }, "id,is_active,member_type"))[0] : null;
      if (!mapping || !staff || !["staff", "guard"].includes(staff.member_type)) {
        await logDecision(auth.device.warehouse_id, areaId, auth.device.id, method, "denied", "unapproved_face", mapping?.staff_member_id ?? null, null, { observed, score });
        return jsonResponse({ status: "denied", reason: "unapproved_face" }, 200);
      }
      const permissions = await selectRows<{ id: string }>("access_permissions", {
        warehouse_id: `eq.${auth.device.warehouse_id}`, area_id: `eq.${areaId}`, staff_member_id: `eq.${staff.id}`, truck_id: "is.null",
      }, "id");
      if (permissions.length !== 1) {
        await logDecision(auth.device.warehouse_id, areaId, auth.device.id, method, "denied", "area_not_permitted", staff.id, null, { observed, score });
        return jsonResponse({ status: "denied", reason: "area_not_permitted" }, 200);
      }
      await logDecision(auth.device.warehouse_id, areaId, auth.device.id, method, "success", "authorized", staff.id, null, { observed, score });
      return jsonResponse({ status: "authorized", staff_member_id: staff.id }, 200);
    }

    const normalized = normalizePlate(observed);
    if (!normalized || area.area_type_code !== "truck_entrance") {
      await logDecision(auth.device.warehouse_id, areaId, auth.device.id, method, "denied", "plate_or_area_invalid", null, null, { observed, score });
      return jsonResponse({ status: "denied", reason: "plate_or_area_invalid" }, 200);
    }
    const trucks = await selectRows<TruckRow>("trucks", {
      warehouse_id: `eq.${auth.device.warehouse_id}`, normalized_plate: `ilike.${normalized}`, is_active: "eq.true",
    }, "id,normalized_plate,is_active");
    const truck = trucks.length === 1 ? trucks[0] : null;
    if (!truck) {
      await logDecision(auth.device.warehouse_id, areaId, auth.device.id, method, "denied", "unknown_or_inactive_truck", null, null, { observed: normalized, score });
      return jsonResponse({ status: "denied", reason: "unknown_or_inactive_truck" }, 200);
    }
    await logDecision(auth.device.warehouse_id, areaId, auth.device.id, method, "success", "authorized", null, truck.id, { observed: normalized, score });
    return jsonResponse({ status: "authorized", truck_id: truck.id }, 200);
  } catch (error) {
    if (error instanceof SyntaxError) return jsonResponse({ status: "error", message: "invalid_json" }, 400);
    if (error instanceof SupabaseAdminError) return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
    return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
  }
});
