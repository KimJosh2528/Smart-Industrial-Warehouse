import assert from "node:assert/strict";
import { canAccessProtectedRouteDuringMaintenance, canBypassMaintenance, isMaintenanceEnabled, maintenanceDestination, requestDestination } from "../src/lib/maintenance-access.mjs";

assert.equal(isMaintenanceEnabled("true"), true);
assert.equal(isMaintenanceEnabled("false"), false);

const cases = [
  ["father_admin", true],
  ["system_admin", false],
  ["staff", false],
  ["driver", false],
  [null, false],
];

const protectedPaths = ["/", "/dashboard", "/admin/system-admins", "/settings", "/access-logs", "/staff", "/fleet"];

for (const [role, allowed] of cases) {
  assert.equal(canBypassMaintenance(role), allowed, `${String(role)} bypass decision`);
  for (const pathname of protectedPaths) {
    assert.equal(canAccessProtectedRouteDuringMaintenance({ authenticated: true, role }), allowed, `${String(role)} ${pathname} decision`);
    assert.equal(maintenanceDestination({ authenticated: true, role }), allowed ? "application" : "maintenance", `${String(role)} destination`);
    assert.equal(requestDestination({ pathname, authenticated: true, role }), allowed ? "application" : "maintenance", `${String(role)} ${pathname} request destination`);
  }
}

assert.equal(canAccessProtectedRouteDuringMaintenance({ authenticated: false, role: "father_admin" }), false, "unauthenticated access decision");
assert.equal(maintenanceDestination({ authenticated: false, role: null }), "login", "unauthenticated destination");
assert.equal(requestDestination({ pathname: "/maintenance", authenticated: true, role: "system_admin" }), "maintenance", "maintenance refresh destination");
assert.equal(requestDestination({ pathname: "/maintenance", authenticated: false, role: null }), "maintenance", "public maintenance destination");
assert.equal(requestDestination({ pathname: "/login", authenticated: true, role: "system_admin" }), "login", "back to login destination");
assert.equal(requestDestination({ pathname: "/", authenticated: false, role: null }), "login", "unauthenticated protected route destination");
console.log("Maintenance access regression checks passed for father_admin, system_admin, staff, driver, and unauthenticated requests.");
