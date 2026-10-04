export const MAINTENANCE_BYPASS_ROLE = "father_admin";

export function isMaintenanceEnabled(value) {
  return ["1", "true", "on"].includes(String(value ?? "").toLowerCase());
}

export function canBypassMaintenance(role) {
  return role === MAINTENANCE_BYPASS_ROLE;
}

export function canAccessProtectedRouteDuringMaintenance({ authenticated, role }) {
  return authenticated && canBypassMaintenance(role);
}
