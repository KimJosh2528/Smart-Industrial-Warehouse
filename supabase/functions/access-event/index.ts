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

interface AreaRow {
  id: string;
  area_type_code: string;
}
interface CredentialRow {
  id: string;
  warehouse_id: string;
  credential_type: "staff_rfid" | "staff_pin" | "staff_face" | "truck_rfid" | "truck_pin";
  staff_member_id: string | null;
  truck_id: string | null;
}
interface StaffRow {
  id: string;
  is_active: boolean;
}
interface TruckRow {
  id: string;
  warehouse_id: string;
  is_active: boolean;
}
interface PermissionRow {
  id: string;
}

async function logDecision(
  authDevice: { id: string; warehouse_id: string },
  areaId: string,
  credentialId: string | null,
  staffMemberId: string | null,
  truckId: string | null,
  credentialType: "staff_rfid" | "staff_pin" | "staff_face" | "truck_rfid" | "truck_pin",
  result: "success" | "denied",
  reason: string,
): Promise<void> {
  const eventPrefix = credentialType === "staff_pin"
    ? "STAFF_PIN"
    : credentialType === "staff_face"
    ? "STAFF_FACE"
    : credentialType === "staff_rfid"
    ? "STAFF_RFID"
    : credentialType === "truck_pin"
    ? "TRUCK_PIN"
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

async function findTruckEntrance(warehouseId: string): Promise<AreaRow | null> {
  const areas = await selectRows<AreaRow>(
    "warehouse_areas",
    { warehouse_id: `eq.${warehouseId}`, area_type_code: "eq.truck_entrance" },
    "id,area_type_code",
  );
  return areas.length === 1 ? areas[0] : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const rawBody = await req.text();

  let auth;
  try {
    auth = await authenticateDeviceRequest(req, rawBody);
  } catch (error) {
    if (error instanceof DeviceAuthError) {
      return jsonResponse(
        { status: "error", message: "authentication_failed" },
        401,
      );
    }
    return jsonResponse(
      { status: "error", message: "internal_server_error" },
      500,
    );
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
    const credentialType = body.credential_type === "staff_pin" ||
        body.credential_type === "staff_rfid" ||
        body.credential_type === "staff_face" ||
        body.credential_type === "truck_rfid" ||
        body.credential_type === "truck_pin"
      ? body.credential_type
      : "";
    const credentialHash = typeof body.credential_hash === "string"
      ? body.credential_hash.trim().toLowerCase()
      : "";
    if (
      !UUID_PATTERN.test(areaId) || !credentialType ||
      !HASH_PATTERN.test(credentialHash)
    ) {
      return jsonResponse({ status: "error", message: "invalid_request" }, 400);
    }

    const areas = await selectRows<AreaRow>(
      "warehouse_areas",
      { id: `eq.${areaId}`, warehouse_id: `eq.${auth.device.warehouse_id}` },
      "id,area_type_code",
    );
    if (areas.length !== 1) {
      return jsonResponse({ status: "error", message: "invalid_request" }, 400);
    }
    if (
      credentialType !== "truck_rfid" && credentialType !== "truck_pin" &&
      areas[0].area_type_code === "truck_entrance"
    ) {
      await logDecision(
        auth.device,
        areaId,
        null,
        null,
        null,
        credentialType,
        "denied",
        `${credentialType}_not_supported_for_area`,
      );
      return jsonResponse({
        status: "denied",
        reason: `${credentialType}_not_supported_for_area`,
      }, 200);
    }

    if (credentialType === "truck_rfid" || credentialType === "truck_pin") {
      const truckEntrance = await findTruckEntrance(auth.device.warehouse_id);
      if (!truckEntrance) {
        return jsonResponse({
          status: "error",
          message: "truck_entrance_not_configured",
        }, 500);
      }
      if (truckEntrance.id !== areaId) {
        await logDecision(
          auth.device,
          truckEntrance.id,
          null,
          null,
          null,
          credentialType,
          "denied",
          "area_not_permitted",
        );
        return jsonResponse(
          { status: "denied", reason: "area_not_permitted" },
          200,
        );
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

      if (!credential || !credential.truck_id) {
        const sameHashCredentials = await selectRows<CredentialRow>(
          "access_credentials",
          { credential_hash: `eq.${credentialHash}`, is_active: "eq.true" },
          "id,warehouse_id,credential_type,staff_member_id,truck_id",
        );
        const staffCredential = sameHashCredentials.find((row) =>
          row.warehouse_id === auth.device.warehouse_id &&
          (row.credential_type === "staff_rfid" ||
            row.credential_type === "staff_pin" ||
            row.credential_type === "staff_face")
        );
        if (staffCredential) {
          await logDecision(
            auth.device,
            truckEntrance.id,
            staffCredential.id,
            null,
            null,
            credentialType,
            "denied",
            "credential_type_mismatch",
          );
          return jsonResponse({
            status: "denied",
            reason: "credential_type_mismatch",
          }, 200);
        }
        const otherWarehouseTruck = sameHashCredentials.find((row) =>
          (row.credential_type === "truck_rfid" ||
            row.credential_type === "truck_pin") && row.truck_id &&
          row.warehouse_id !== auth.device.warehouse_id
        );
        if (otherWarehouseTruck) {
          await logDecision(
            auth.device,
            truckEntrance.id,
            null,
            null,
            null,
            credentialType,
            "denied",
            "truck_not_in_device_warehouse",
          );
          return jsonResponse({
            status: "denied",
            reason: "truck_not_in_device_warehouse",
          }, 200);
        }
        await logDecision(
          auth.device,
          truckEntrance.id,
          null,
          null,
          null,
          credentialType,
          "denied",
          "unknown_credential",
        );
        return jsonResponse(
          { status: "denied", reason: "unknown_credential" },
          200,
        );
      }

      const trucks = await selectRows<TruckRow>(
        "trucks",
        { id: `eq.${credential.truck_id}` },
        "id,warehouse_id,is_active",
      );
      const truck = trucks.length === 1 ? trucks[0] : null;
      if (!truck || truck.warehouse_id !== auth.device.warehouse_id) {
        await logDecision(
          auth.device,
          truckEntrance.id,
          credential.id,
          null,
          truck?.id ?? null,
          credentialType,
          "denied",
          "truck_not_in_device_warehouse",
        );
        return jsonResponse({
          status: "denied",
          reason: "truck_not_in_device_warehouse",
        }, 200);
      }
      if (!truck.is_active) {
        await logDecision(
          auth.device,
          truckEntrance.id,
          credential.id,
          null,
          truck.id,
          credentialType,
          "denied",
          "inactive_truck",
        );
        return jsonResponse(
          { status: "denied", reason: "inactive_truck" },
          200,
        );
      }

      const permissions = await selectRows<PermissionRow>(
        "access_permissions",
        {
          warehouse_id: `eq.${auth.device.warehouse_id}`,
          area_id: `eq.${truckEntrance.id}`,
          staff_member_id: "is.null",
          truck_id: `eq.${truck.id}`,
        },
        "id",
      );
      if (permissions.length !== 1) {
        await logDecision(
          auth.device,
          truckEntrance.id,
          credential.id,
          null,
          truck.id,
          credentialType,
          "denied",
          "area_not_permitted",
        );
        return jsonResponse(
          { status: "denied", reason: "area_not_permitted" },
          200,
        );
      }

      await logDecision(
        auth.device,
        truckEntrance.id,
        credential.id,
        null,
        truck.id,
        credentialType,
        "success",
        "authorized",
      );
      return jsonResponse({ status: "authorized" }, 200);
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
    const credential = credentials[0];
    if (!credential || !credential.staff_member_id) {
      const truckCredential = await selectRows<CredentialRow>(
        "access_credentials",
        {
          warehouse_id: `eq.${auth.device.warehouse_id}`,
          credential_type: "in.(truck_rfid,truck_pin)",
          credential_hash: `eq.${credentialHash}`,
          is_active: "eq.true",
        },
        "id,warehouse_id,credential_type,staff_member_id,truck_id",
      );
      if (truckCredential.length === 1) {
        await logDecision(
          auth.device,
          areaId,
          truckCredential[0].id,
          null,
          null,
          credentialType,
          "denied",
          "credential_type_mismatch",
        );
        return jsonResponse({
          status: "denied",
          reason: "credential_type_mismatch",
        }, 200);
      }
      await logDecision(
        auth.device,
        areaId,
        credential?.id ?? null,
        null,
        null,
        credentialType,
        "denied",
        "unknown_credential",
      );
      return jsonResponse(
        { status: "denied", reason: "unknown_credential" },
        200,
      );
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
      await logDecision(
        auth.device,
        areaId,
        credential.id,
        credential.staff_member_id,
        null,
        credentialType,
        "denied",
        "inactive_staff_member",
      );
      return jsonResponse(
        { status: "denied", reason: "inactive_staff_member" },
        200,
      );
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
      await logDecision(
        auth.device,
        areaId,
        credential.id,
        credential.staff_member_id,
        null,
        credentialType,
        "denied",
        "area_not_permitted",
      );
      return jsonResponse(
        { status: "denied", reason: "area_not_permitted" },
        200,
      );
    }

    await logDecision(
      auth.device,
      areaId,
      credential.id,
      credential.staff_member_id,
      null,
      credentialType,
      "success",
      "authorized",
    );
    return jsonResponse({ status: "authorized" }, 200);
  } catch (error) {
    if (error instanceof SupabaseAdminError) {
      return jsonResponse(
        { status: "error", message: "internal_server_error" },
        500,
      );
    }
    return jsonResponse(
      { status: "error", message: "internal_server_error" },
      500,
    );
  }
});
