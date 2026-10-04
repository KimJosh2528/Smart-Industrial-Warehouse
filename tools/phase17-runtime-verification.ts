const BASE_URL = "https://odavmzgciaoahebanpmy.supabase.co";
const DEVICE_UID = "dev_028eaedec2ec3249a5fa76c2";
const ACCESS_EVENT_URL = `${BASE_URL}/functions/v1/access-event`;

function env(name: string): string {
  const value = Deno.env.get(name) ?? "";
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const testSecret = env("TEST_DEVICE_HMAC_SECRET");

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
interface CredentialRow {
  id: string;
  warehouse_id: string;
  credential_type: "staff_rfid" | "staff_pin" | "truck_rfid";
  credential_hash: string;
  staff_member_id: string | null;
  truck_id: string | null;
  is_active: boolean;
}
interface TruckRow {
  id: string;
  warehouse_id: string;
  is_active: boolean;
}
interface PermissionRow {
  id: string;
  warehouse_id: string;
  area_id: string;
  staff_member_id: string | null;
  truck_id: string | null;
}

async function rows<T>(
  table: string,
  query: Record<string, string>,
  select: string,
): Promise<T[]> {
  const params = new URLSearchParams({ ...query, select });
  const response = await fetch(`${BASE_URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: serviceKey },
  });
  if (!response.ok) throw new Error(`read_${table}_${response.status}`);
  return await response.json() as T[];
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function hmacHex(
  secret: string,
  timestamp: string,
  body: Uint8Array,
): Promise<string> {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix);
  message.set(body, prefix.length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function safeBody(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return { status: value.status, reason: value.reason };
  } catch {
    return { response_json: false };
  }
}

function permissionFor(
  permissions: PermissionRow[],
  areaId: string,
  truckId: string,
): boolean {
  return permissions.some((permission) =>
    permission.area_id === areaId && permission.truck_id === truckId &&
    permission.staff_member_id === null
  );
}

const deviceRows = await rows<DeviceRow>("devices", {
  device_uid: `eq.${DEVICE_UID}`,
}, "id,device_uid,warehouse_id,is_active");
if (deviceRows.length !== 1) {
  throw new Error("canonical_device_not_found_or_not_unique");
}
const device = deviceRows[0];

const areas = await rows<AreaRow>("warehouse_areas", {
  warehouse_id: `eq.${device.warehouse_id}`,
}, "id,area_type_code");
const truckEntrance = areas.find((area) =>
  area.area_type_code === "truck_entrance"
);
if (!truckEntrance) throw new Error("truck_entrance_not_found");
const staffArea = areas.find((area) =>
  area.area_type_code !== "truck_entrance"
);

const credentials = await rows<CredentialRow>(
  "access_credentials",
  {},
  "id,warehouse_id,credential_type,credential_hash,staff_member_id,truck_id,is_active",
);
const trucks = await rows<TruckRow>("trucks", {}, "id,warehouse_id,is_active");
const permissions = await rows<PermissionRow>(
  "access_permissions",
  {},
  "id,warehouse_id,area_id,staff_member_id,truck_id",
);
const truckById = new Map(trucks.map((truck) => [truck.id, truck]));
const activeTruckCredentials = credentials.filter((credential) =>
  credential.credential_type === "truck_rfid" && credential.is_active &&
  credential.truck_id
);
const localTruckCredentials = activeTruckCredentials.filter((credential) =>
  credential.warehouse_id === device.warehouse_id
);
const staffRfidCredentials = credentials.filter((credential) =>
  credential.credential_type === "staff_rfid" && credential.is_active &&
  credential.warehouse_id === device.warehouse_id
);

const validTruckCredential = localTruckCredentials.find((credential) => {
  const truck = truckById.get(credential.truck_id!);
  return truck?.warehouse_id === device.warehouse_id && truck.is_active &&
    permissionFor(permissions, truckEntrance.id, truck.id);
});
const inactiveTruckCredential = localTruckCredentials.find((credential) =>
  truckById.get(credential.truck_id!)?.is_active === false
);
const noPermissionCredential = localTruckCredentials.find((credential) => {
  const truck = truckById.get(credential.truck_id!);
  return truck?.warehouse_id === device.warehouse_id && truck.is_active &&
    !permissionFor(permissions, truckEntrance.id, truck.id);
});
const crossWarehouseCredential = activeTruckCredentials.find((credential) =>
  truckById.get(credential.truck_id!)?.warehouse_id !== device.warehouse_id
);

const beforeCounts = {
  trucks: trucks.length,
  credentials: credentials.length,
  permissions: permissions.length,
};
const runStartedAt = new Date().toISOString();
let previousRequestTimestamp: number | null = null;

async function nextRequestTimestamp(): Promise<string> {
  let timestamp = Math.floor(Date.now() / 1000);
  if (
    previousRequestTimestamp !== null && timestamp <= previousRequestTimestamp
  ) {
    const waitMilliseconds = (previousRequestTimestamp + 1) * 1000 - Date.now();
    if (waitMilliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMilliseconds));
    }
    do {
      timestamp = Math.floor(Date.now() / 1000);
      if (timestamp <= previousRequestTimestamp) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } while (timestamp <= previousRequestTimestamp);
  }
  previousRequestTimestamp = timestamp;
  return String(timestamp);
}

async function accessEvent(
  name: string,
  areaId: string,
  credentialType: string,
  credentialHash: string,
): Promise<Record<string, unknown>> {
  const timestamp = await nextRequestTimestamp();
  const bodyText = JSON.stringify({
    area_id: areaId,
    credential_type: credentialType,
    credential_hash: credentialHash,
  });
  const body = new TextEncoder().encode(bodyText);
  const signature = await hmacHex(testSecret, timestamp, body);
  const response = await fetch(ACCESS_EVENT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-UID": DEVICE_UID,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
    },
    body,
  });
  const responseText = await response.text();
  return { test: name, http: response.status, ...safeBody(responseText) };
}

const unknownHash = await sha256Hex(
  new TextEncoder().encode("phase17-unknown-credential"),
);
const tests: Record<string, unknown>[] = [];
tests.push(
  await accessEvent(
    "A valid truck RFID",
    truckEntrance.id,
    "truck_rfid",
    validTruckCredential?.credential_hash ?? unknownHash,
  ),
);
tests.push(
  await accessEvent(
    "B unknown credential",
    truckEntrance.id,
    "truck_rfid",
    unknownHash,
  ),
);
if (inactiveTruckCredential) {
  tests.push(
    await accessEvent(
      "C inactive truck",
      truckEntrance.id,
      "truck_rfid",
      inactiveTruckCredential.credential_hash,
    ),
  );
}
if (noPermissionCredential) {
  tests.push(
    await accessEvent(
      "D no permission",
      truckEntrance.id,
      "truck_rfid",
      noPermissionCredential.credential_hash,
    ),
  );
}
if (staffRfidCredentials[0]) {
  tests.push(
    await accessEvent(
      "E staff RFID as truck_rfid",
      truckEntrance.id,
      "truck_rfid",
      staffRfidCredentials[0].credential_hash,
    ),
  );
}
if (validTruckCredential && staffArea) {
  tests.push(
    await accessEvent(
      "F truck RFID as staff_rfid",
      staffArea.id,
      "staff_rfid",
      validTruckCredential.credential_hash,
    ),
  );
}
if (crossWarehouseCredential) {
  tests.push(
    await accessEvent(
      "G cross-warehouse truck",
      truckEntrance.id,
      "truck_rfid",
      crossWarehouseCredential.credential_hash,
    ),
  );
}

async function validStaffCredential(
  type: "staff_rfid" | "staff_pin",
): Promise<CredentialRow | undefined> {
  if (!staffArea) return undefined;
  return credentials.find((credential) =>
    credential.credential_type === type && credential.is_active &&
    credential.warehouse_id === device.warehouse_id &&
    credential.staff_member_id &&
    permissions.some((permission) =>
      permission.area_id === staffArea.id &&
      permission.staff_member_id === credential.staff_member_id &&
      permission.truck_id === null
    )
  );
}
const validStaffRfid = await validStaffCredential("staff_rfid");
const validStaffPin = await validStaffCredential("staff_pin");
if (validStaffRfid) {
  tests.push(
    await accessEvent(
      "staff RFID regression",
      staffArea!.id,
      "staff_rfid",
      validStaffRfid.credential_hash,
    ),
  );
}
if (validStaffPin) {
  tests.push(
    await accessEvent(
      "staff PIN regression",
      staffArea!.id,
      "staff_pin",
      validStaffPin.credential_hash,
    ),
  );
}

const logs = await rows<Record<string, unknown>>("access_logs", {
  device_id: `eq.${device.id}`,
  occurred_at: `gte.${runStartedAt}`,
}, "event_type,authentication_method,result,truck_id,device_id,warehouse_id");
const afterCounts = {
  trucks: (await rows<{ id: string }>("trucks", {}, "id")).length,
  credentials:
    (await rows<{ id: string }>("access_credentials", {}, "id")).length,
  permissions:
    (await rows<{ id: string }>("access_permissions", {}, "id")).length,
};

console.log(JSON.stringify(
  {
    precheck: {
      service_key: "PRESENT",
      test_hmac_secret: "PRESENT",
    },
    inspected_data: {
      device_uid: DEVICE_UID,
      warehouse_id: device.warehouse_id,
      truck_entrance_area_id: truckEntrance.id,
      active_truck_rfid_available: Boolean(validTruckCredential),
      inactive_truck_rfid_available: Boolean(inactiveTruckCredential),
      active_truck_without_permission_available: Boolean(
        noPermissionCredential,
      ),
      staff_rfid_available: Boolean(staffRfidCredentials[0]),
      cross_warehouse_truck_rfid_available: Boolean(crossWarehouseCredential),
    },
    tests,
    access_logs: logs.map((log) => ({
      event_type: log.event_type,
      authentication_method: log.authentication_method,
      result: log.result,
      truck_id: log.truck_id,
      device_id: log.device_id,
      warehouse_id: log.warehouse_id,
    })),
    database_counts_before: beforeCounts,
    database_counts_after: afterCounts,
    unexpected_record_count_changes:
      JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts),
    phase16:
      "run_existing_supabase/functions/truck-plate/test-request.ps1_separately",
  },
  null,
  2,
));
