const BASE_URL = "https://odavmzgciaoahebanpmy.supabase.co";
const DEVICE_UID = "dev_028eaedec2ec3249a5fa76c2";
const EXPECTED_WAREHOUSE_ID = "8e2693ee-96a0-4d5a-b3a7-e5687eb6b245";
const EXPECTED_AREA_ID = "eb5c5563-63ba-476d-87dd-3e8e2e69a276";
const EXPECTED_PHASE16_PLATE = "NEW9007";

function env(name: string): string {
  const value = Deno.env.get(name) ?? "";
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

const supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const testRfid = env("PHASE17_TEST_TRUCK_RFID");
if (supabaseUrl !== BASE_URL) throw new Error("unexpected_supabase_url");
if (!/^[0-9a-f]+$/i.test(testRfid) || testRfid.length % 2 !== 0) {
  throw new Error("test_rfid_must_be_even_length_hex");
}

interface DeviceRow {
  id: string;
  device_uid: string;
  warehouse_id: string;
  is_active: boolean;
}
interface AreaRow {
  id: string;
  area_type_code: string;
}
interface TruckRow {
  id: string;
  warehouse_id: string;
  identity_label: string;
  plate_number: string;
  is_active: boolean;
}
interface PermissionRow {
  id: string;
  warehouse_id: string;
  area_id: string;
  staff_member_id: string | null;
  truck_id: string | null;
}
interface CredentialRow {
  id: string;
  warehouse_id: string;
  credential_type: string;
  staff_member_id: string | null;
  truck_id: string | null;
  is_active: boolean;
  credential_hash?: string;
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: serviceKey, ...(init.headers ?? {}) },
  });
}

async function selectRows<T>(
  table: string,
  query: Record<string, string>,
  select: string,
): Promise<T[]> {
  const params = new URLSearchParams({ ...query, select });
  const response = await request(`${table}?${params}`);
  if (!response.ok) throw new Error(`read_${table}_${response.status}`);
  return await response.json() as T[];
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value).buffer,
    ),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const deviceRows = await selectRows<DeviceRow>("devices", {
  device_uid: `eq.${DEVICE_UID}`,
}, "id,device_uid,warehouse_id,is_active");
if (deviceRows.length !== 1) {
  throw new Error("canonical_device_not_found_or_not_unique");
}
const device = deviceRows[0];
if (device.warehouse_id !== EXPECTED_WAREHOUSE_ID || !device.is_active) {
  throw new Error("canonical_device_not_active_or_wrong_warehouse");
}

const areas = await selectRows<AreaRow>("warehouse_areas", {
  warehouse_id: `eq.${device.warehouse_id}`,
}, "id,area_type_code");
const truckEntrance = areas.find((area) =>
  area.area_type_code === "truck_entrance"
);
if (!truckEntrance || truckEntrance.id !== EXPECTED_AREA_ID) {
  throw new Error("truck_entrance_not_verified");
}

const trucks = await selectRows<TruckRow>("trucks", {
  warehouse_id: `eq.${device.warehouse_id}`,
}, "id,warehouse_id,identity_label,plate_number,is_active");
const permissions = await selectRows<PermissionRow>("access_permissions", {
  warehouse_id: `eq.${device.warehouse_id}`,
  area_id: `eq.${truckEntrance.id}`,
}, "id,warehouse_id,area_id,staff_member_id,truck_id");
const authorizedTruckIds = new Set(
  permissions.filter((permission) =>
    permission.staff_member_id === null && permission.truck_id !== null
  ).map((permission) => permission.truck_id),
);
const phase16Candidates = trucks.filter((truck) =>
  truck.is_active && authorizedTruckIds.has(truck.id) &&
  truck.plate_number === EXPECTED_PHASE16_PLATE
);
if (phase16Candidates.length === 0) {
  throw new Error("phase16_new9007_authorized_truck_not_found");
}
if (phase16Candidates.length > 1) {
  console.log(JSON.stringify(
    {
      status: "phase16_truck_selection_ambiguous",
      candidates: phase16Candidates.map((candidate) => ({
        truck_id: candidate.id,
        identity_label: candidate.identity_label,
        plate_number: candidate.plate_number,
        is_active: candidate.is_active,
        truck_entrance_permission: authorizedTruckIds.has(candidate.id),
      })),
    },
    null,
    2,
  ));
  throw new Error("phase16_new9007_authorized_truck_not_unique");
}
const truck = phase16Candidates[0];
if (
  truck.warehouse_id !== device.warehouse_id ||
  !authorizedTruckIds.has(truck.id)
) throw new Error("selected_truck_permission_not_verified");

const credentials = await selectRows<CredentialRow>(
  "access_credentials",
  {},
  "id,warehouse_id,credential_type,staff_member_id,truck_id,is_active,credential_hash",
);
const credentialHash = await sha256Hex(testRfid.toLowerCase());
if (
  credentials.some((credential) =>
    credential.warehouse_id === truck.warehouse_id &&
    credential.credential_type === "truck_rfid" &&
    credential.credential_hash === credentialHash
  )
) {
  throw new Error("temporary_credential_already_exists");
}

const before = {
  trucks: trucks.length,
  credentials: credentials.length,
  permissions: permissions.length,
  warehouse_areas: areas.length,
};

console.log(JSON.stringify(
  {
    status: "READY TO PROVISION",
    device_uid: DEVICE_UID,
    device_id: device.id,
    warehouse_id: device.warehouse_id,
    truck_entrance_area_id: truckEntrance.id,
    selected_truck_id: truck.id,
    selected_truck_identity_label: truck.identity_label,
    selected_truck_active: truck.is_active,
    truck_entrance_permission_verified: true,
    before_counts: before,
  },
  null,
  2,
));

const confirmation = prompt(
  "Type PROVISION to insert exactly one temporary truck RFID credential:",
);
if (confirmation !== "PROVISION") {
  console.log(JSON.stringify({ status: "cancelled", inserted: false }));
  Deno.exit(0);
}

const insertResponse = await request("access_credentials", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Prefer: "return=representation",
  },
  body: JSON.stringify({
    warehouse_id: truck.warehouse_id,
    credential_type: "truck_rfid",
    credential_hash: credentialHash,
    truck_id: truck.id,
    staff_member_id: null,
    is_active: true,
  }),
});
if (!insertResponse.ok) {
  throw new Error(`credential_insert_failed_${insertResponse.status}`);
}
const insertedRows = await insertResponse.json() as CredentialRow[];
if (insertedRows.length !== 1 || !insertedRows[0]?.id) {
  throw new Error("credential_insert_return_invalid");
}
const insertedId = insertedRows[0].id;

try {
  const afterCredentials = await selectRows<CredentialRow>(
    "access_credentials",
    { id: `eq.${insertedId}` },
    "id,warehouse_id,credential_type,staff_member_id,truck_id,is_active",
  );
  const afterTrucks = await selectRows<{ id: string }>("trucks", {}, "id");
  const afterPermissions = await selectRows<{ id: string }>(
    "access_permissions",
    {},
    "id",
  );
  const afterAreas = await selectRows<{ id: string }>(
    "warehouse_areas",
    {},
    "id",
  );
  const row = afterCredentials.length === 1 ? afterCredentials[0] : null;
  const verified = row?.warehouse_id === truck.warehouse_id &&
    row.credential_type === "truck_rfid" &&
    row.truck_id === truck.id &&
    row.staff_member_id === null &&
    row.is_active === true &&
    afterTrucks.length === before.trucks &&
    afterPermissions.length === before.permissions &&
    afterAreas.length === before.warehouse_areas;
  if (!verified) throw new Error("post_insert_verification_failed");
  console.log(JSON.stringify(
    {
      status: "temporary truck RFID credential created",
      credential_id: insertedId,
      credential_type: row.credential_type,
      truck_id: row.truck_id,
      staff_member_id: row.staff_member_id,
      warehouse_id: row.warehouse_id,
      is_active: row.is_active,
      after_counts: {
        trucks: afterTrucks.length,
        credentials: before.credentials + 1,
        permissions: afterPermissions.length,
        warehouse_areas: afterAreas.length,
      },
    },
    null,
    2,
  ));
} catch (error) {
  const rollback = await request(
    `access_credentials?id=eq.${encodeURIComponent(insertedId)}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
  if (!rollback.ok) {
    throw new Error(
      `post_insert_verification_failed_and_rollback_failed_${rollback.status}`,
    );
  }
  throw error;
}
