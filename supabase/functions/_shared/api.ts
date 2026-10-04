export type AccessAuthenticationMethod =
  | "staff_rfid"
  | "staff_pin"
  | "staff_face"
  | "truck_plate"
  | "truck_rfid"
  | "truck_pin"
  | "unknown";

export type AccessResult = "success" | "failure" | "denied";
export type LogicalAreaState = "locked" | "unlocked" | "emergency_release";

export interface AccessEventRequest {
  area_id: string;
  credential_type: "staff_rfid" | "staff_pin" | "staff_face" | "truck_rfid" | "truck_pin";
  credential_hash: string;
}

export interface SensorReadingRequest {
  temperature_c: number;
  humidity_pct: number;
  smoke_value?: number;
}

export interface SafetyEventRequest {
  area_id?: string;
  device_id?: string;
  event_type: string;
  severity: "info" | "warning" | "critical";
  status?: "open" | "acknowledged" | "resolved";
  emergency_state?: "normal" | "emergency_release";
  occurred_at?: string;
  resolved_at?: string;
  metadata?: Record<string, unknown>;
}

export interface AreaStatusRequest {
  area_id: string;
  state: LogicalAreaState;
}
