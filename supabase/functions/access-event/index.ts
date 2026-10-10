import {
  authenticateDeviceRequest,
  DeviceAuthError,
} from "../_shared/deviceAuth.ts";
import {
  insertRow,
  selectRows,
  SupabaseAdminError,
} from "../_shared/supabaseAdmin.ts";
import { jsonResponse, methodNotAllowed } from "../_shared/response.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
type CredentialType = "staff_rfid" | "staff_face" | "truck_rfid";

interface CredentialRow {
  id: string;
  warehouse_id: string;
  credential_type: CredentialType;
  staff_member_id: string | null;
  truck_id: string | null;
  is_active?: boolean;
}
interface StaffRow { id: string; is_active: boolean; }
interface TruckRow { id: string; warehouse_id: string; is_active: boolean; }
interface PermissionRow { id: string; }

async function logDecision(
  authDevice: { id: string; warehouse_id: string },
  areaId: string,
  credentialId: string | null,
  staffMemberId: string | null,
  truckId: string | null,
  credentialType: CredentialType,
  result: "success" | "denied",
  reason: string,
): Promise<void> {
  const eventPrefix = credentialType === "staff_face"
    ? "STAFF_FACE"
    : credentialType === "staff_rfid"
    ? "STAFF_RFID"
    : "TRUCK_RFID";
  await insertRow("access_logs", {
    warehouse_id: authDevice.warehouse_id,
    area_id: areaId,
    device_id: authDevice.id,
    credential_id: credentialId,
    staff_member_id: staffMemberId,
    truck_id: truckId,
    event_type: `${eventPrefix}_${result === "success" ? "SUCCESS" : "DENIED"}`,
    authentication_method: credentialType,
    result,
    metadata: { reason },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const rawBody = await req.text();

  let auth;
  try {
    auth = await authenticateDeviceRequest(req, rawBody);
  } catch (error) {
    if (error instanceof DeviceAuthError) {
      return jsonResponse({ status: "error", message: "authentication_failed" }, 401);
    }
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
    const areaId = typeof body.area_id === "string" ? body.area_id.trim() : "";
    const credentialType: CredentialType = body.credential_type === "staff_face"
      ? "staff_face"
      : body.credential_type === "staff_rfid"
      ? "staff_rfid"
      : body.credential_type === "truck_rfid"
      ? "truck_rfid"
      : "" as CredentialType;
    const credentialHash = typeof body.credential_hash === "string"
      ? body.credential_hash.trim().toLowerCase()
      : "";

    if (!UUID_PATTERN.test(areaId) || !credentialType || !HASH_PATTERN.test(credentialHash)) {
      return jsonResponse({ status: "error", message: "invalid_request" }, 400);
    }

    const areas = await selectRows<{ id: string }>(
      "warehouse_areas",
      { id: `eq.${areaId}`, warehouse_id: `eq.${auth.device.warehouse_id}` },
      "id",
    );
    if (areas.length !== 1) {
      return jsonResponse({ status: "error", message: "invalid_request" }, 400);
    }

    const credentials = await selectRows<CredentialRow>(
      "access_credentials",
      {
        warehouse_id: `eq.${auth.device.warehouse_id}`,
        credential_type: `eq.${credentialType}`,
        credential_hash: `eq.${credentialHash}`,
        is_active: "eq.true",
      },
      "id,warehouse_id,credential_type,staff_member_id,truck_id",
    );
    const credential = credentials.length === 1 ? credentials[0] : null;

    if (credentialType === "truck_rfid") {
      if (!credential?.truck_id) {
        await logDecision(auth.device, areaId, credential?.id ?? null, null, null, credentialType, "denied", "unknown_credential");
        return jsonResponse({ status: "denied", reason: "unknown_credential" }, 200);
      }

      const trucks = await selectRows<TruckRow>(
        "trucks",
        { id: `eq.${credential.truck_id}` },
        "id,warehouse_id,is_active",
      );
      const truck = trucks.length === 1 ? trucks[0] : null;
      if (!truck || truck.warehouse_id !== auth.device.warehouse_id) {
        await logDecision(auth.device, areaId, credential.id, null, credential.truck_id, credentialType, "denied", "truck_not_in_device_warehouse");
        return jsonResponse({ status: "denied", reason: "truck_not_in_device_warehouse" }, 200);
      }
      if (!truck.is_active) {
        await logDecision(auth.device, areaId, credential.id, null, truck.id, credentialType, "denied", "inactive_truck");
        return jsonResponse({ status: "denied", reason: "inactive_truck" }, 200);
      }

      const permissions = await selectRows<PermissionRow>(
        "access_permissions",
        {
          warehouse_id: `eq.${auth.device.warehouse_id}`,
          area_id: `eq.${areaId}`,
          staff_member_id: "is.null",
          truck_id: `eq.${truck.id}`,
        },
        "id",
      );
      if (permissions.length !== 1) {
        await logDecision(auth.device, areaId, credential.id, null, truck.id, credentialType, "denied", "area_not_permitted");
        return jsonResponse({ status: "denied", reason: "area_not_permitted" }, 200);
      }

      await logDecision(auth.device, areaId, credential.id, null, truck.id, credentialType, "success", "authorized");
      return jsonResponse({ status: "authorized" }, 200);
    }

    if (!credential?.staff_member_id) {
      await logDecision(auth.device, areaId, credential?.id ?? null, null, null, credentialType, "denied", "unknown_credential");
      return jsonResponse({ status: "denied", reason: "unknown_credential" }, 200);
    }

    const staff = await selectRows<StaffRow>(
      "staff_members",
      {
        id: `eq.${credential.staff_member_id}`,
        warehouse_id: `eq.${auth.device.warehouse_id}`,
        is_active: "eq.true",
      },
      "id,is_active",
    );
    if (staff.length !== 1) {
      await logDecision(auth.device, areaId, credential.id, credential.staff_member_id, null, credentialType, "denied", "inactive_staff_member");
      return jsonResponse({ status: "denied", reason: "inactive_staff_member" }, 200);
    }

    const permissions = await selectRows<PermissionRow>(
      "access_permissions",
      {
        warehouse_id: `eq.${auth.device.warehouse_id}`,
        area_id: `eq.${areaId}`,
        staff_member_id: `eq.${credential.staff_member_id}`,
        truck_id: "is.null",
      },
      "id",
    );
    if (permissions.length !== 1) {
      await logDecision(auth.device, areaId, credential.id, credential.staff_member_id, null, credentialType, "denied", "area_not_permitted");
      return jsonResponse({ status: "denied", reason: "area_not_permitted" }, 200);
    }

    await logDecision(auth.device, areaId, credential.id, credential.staff_member_id, null, credentialType, "success", "authorized");
    return jsonResponse({ status: "authorized" }, 200);
  } catch (error) {
    if (error instanceof SupabaseAdminError) {
      return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
    }
    return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
  }
});
