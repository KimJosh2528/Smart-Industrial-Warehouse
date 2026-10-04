import { LayoutDashboard, Logs, Monitor, Shield, ShieldAlert, Truck, Users, type LucideIcon } from "lucide-react";

export type DashboardNavigationItem = {
  section: string;
  label: string;
  href: string;
  icon: LucideIcon;
  fatherAdminOnly?: boolean;
  pending?: boolean;
};

export const dashboardNavigation: DashboardNavigationItem[] = [
  { section: "DASHBOARD", label: "Overview", href: "/", icon: LayoutDashboard },
  { section: "ACTIVITY & EVENTS", label: "Access Logs", href: "/access-logs", icon: Logs },
  { section: "ACTIVITY & EVENTS", label: "Safety & Emergency Logs", href: "/safety-emergency", icon: ShieldAlert },
  { section: "WAREHOUSE SETUP", label: "Warehouse Areas", href: "/areas", icon: Shield },
  { section: "WAREHOUSE SETUP", label: "IoT Devices", href: "/devices", icon: Monitor },
  { section: "WAREHOUSE MANAGEMENT", label: "Staff", href: "/staff", icon: Users },
  { section: "WAREHOUSE MANAGEMENT", label: "Drivers", href: "/drivers", icon: Truck },
  { section: "WAREHOUSE MANAGEMENT", label: "Trucks", href: "/trucks", icon: Truck },
  { section: "MY ACCOUNT", label: "Account Settings", href: "/settings", icon: Users },
  { section: "ADMINISTRATION", label: "System Admin Provisioning", href: "/admin/system-admins", icon: Users, fatherAdminOnly: true },
];
