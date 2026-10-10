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

export function maintenanceDestination({ authenticated, role }) {
  if (!authenticated) return "login";
  return canBypassMaintenance(role) ? "application" : "maintenance";
}

export function requestDestination({ pathname, authenticated, role }) {
  if (pathname === "/maintenance") return "maintenance";
  if (pathname === "/login") return "login";
  return maintenanceDestination({ authenticated, role });
}
