import assert from "node:assert/strict";
import { canAccessProtectedRouteDuringMaintenance, canBypassMaintenance, isMaintenanceEnabled } from "../src/lib/maintenance-access.mjs";

assert.equal(isMaintenanceEnabled("true"), true);
assert.equal(isMaintenanceEnabled("false"), false);

const cases = [
  ["father_admin", true],
  ["system_admin", false],
  ["staff", false],
  ["driver", false],
  [null, false],
];

for (const [role, allowed] of cases) {
  assert.equal(canBypassMaintenance(role), allowed, `${String(role)} bypass decision`);
  assert.equal(canAccessProtectedRouteDuringMaintenance({ authenticated: true, role }), allowed, `${String(role)} protected-route decision`);
}

assert.equal(canAccessProtectedRouteDuringMaintenance({ authenticated: false, role: "father_admin" }), false, "unauthenticated access decision");
console.log("Maintenance access regression checks passed for father_admin, system_admin, staff, driver, and unauthenticated requests.");
