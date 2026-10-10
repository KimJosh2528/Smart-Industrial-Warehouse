import { KeyRound, LayoutDashboard, Logs, Monitor, Shield, Thermometer, Truck, Users, type LucideIcon } from "lucide-react";
import type { PlatformRole } from "./warehouse-scope";

export type DashboardNavigationItem = {
  section: string;
  label: string;
  href: string;
  icon: LucideIcon;
  fatherAdminOnly?: boolean;
  pending?: boolean;
  systemAdminOnly?: boolean;
  roles?: Exclude<PlatformRole, null>[];
};

export const dashboardNavigation: DashboardNavigationItem[] = [
  { section: "DASHBOARD", label: "Overview", href: "/", icon: LayoutDashboard, fatherAdminOnly: true },
  { section: "DASHBOARD", label: "Overview", href: "/", icon: LayoutDashboard, roles: ["system_admin", "staff", "guard", "driver"] },
  { section: "ACTIVITY & EVENTS", label: "Access Logs", href: "/access-logs", icon: Logs, roles: ["system_admin", "staff", "driver"] },
  { section: "ACTIVITY & EVENTS", label: "Sensor Logs", href: "/sensor-readings", icon: Thermometer, roles: ["system_admin", "staff", "driver"] },
  { section: "MY ACCESS", label: "My Truck", href: "/my-truck", icon: Truck, roles: ["driver"] },
  { section: "WAREHOUSE SETUP", label: "Warehouse Areas", href: "/areas", icon: Shield, systemAdminOnly: true },
  { section: "WAREHOUSE SETUP", label: "Room Sensor Settings", href: "/room-settings", icon: Thermometer, systemAdminOnly: true },
  { section: "WAREHOUSE SETUP", label: "Credential Management", href: "/credentials", icon: KeyRound, systemAdminOnly: true },
  { section: "WAREHOUSE MANAGEMENT", label: "Staff", href: "/staff", icon: Users, systemAdminOnly: true },
  { section: "WAREHOUSE MANAGEMENT", label: "Drivers", href: "/drivers", icon: Truck, systemAdminOnly: true },
  { section: "WAREHOUSE MANAGEMENT", label: "Trucks", href: "/trucks", icon: Truck, systemAdminOnly: true },
  { section: "WAREHOUSE MANAGEMENT", label: "Member Applications", href: "/member-applications", icon: Users, systemAdminOnly: true },
  { section: "MY ACCOUNT", label: "Account Settings", href: "/settings", icon: Users },
  { section: "FATHER ADMIN", label: "System Admin Applications", href: "/admin/system-admins/applications", icon: Users, fatherAdminOnly: true },
  { section: "FATHER ADMIN", label: "Device Inventory", href: "/admin/system-admins/devices", icon: Monitor, fatherAdminOnly: true },
  { section: "FATHER ADMIN", label: "Current Assignments", href: "/admin/system-admins/assignments", icon: Shield, fatherAdminOnly: true },
];
