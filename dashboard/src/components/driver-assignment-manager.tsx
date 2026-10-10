"use client";

import { useActionState } from "react";
import { assignDriverToTruck, unassignDriverFromTruck, type DriverAssignmentState } from "@/app/drivers/actions";
import type { AvailableTruck, DriverListItem } from "@/lib/drivers-data";

const initialState: DriverAssignmentState = { success: false, message: "" };

export function DriverAssignmentManager({ driver }: { driver: DriverListItem }) {
  const [assignState, assignAction, assigning] = useActionState(assignDriverToTruck, initialState);
  const [unassignState, unassignAction, unassigning] = useActionState(unassignDriverFromTruck, initialState);
  const state = assignState.message ? assignState : unassignState;

  if (driver.truck) return <div className="mt-2 space-y-2 text-[11px]">
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-2.5"><p className="font-medium text-white">{driver.truck.identity_label}</p><p className="mt-1 text-slate-400">Plate: {driver.truck.plate_number}</p><p className="mt-1 text-slate-500">Truck Entrance · Plate only</p></div>
    <form action={unassignAction}><input type="hidden" name="driverId" value={driver.id} /><input type="hidden" name="truckId" value={driver.truck.id} /><button type="submit" disabled={unassigning} className="rounded-md border border-rose-300/20 px-2 py-1 text-rose-200 hover:bg-rose-400/10 disabled:opacity-60">{unassigning ? "Unassigning..." : "Unassign Truck"}</button></form>
  </div>;

  return <div className="mt-2 space-y-2">
    {driver.available_trucks.length ? <form action={assignAction} className="space-y-2"><input type="hidden" name="driverId" value={driver.id} /><select name="truckId" defaultValue="" required disabled={assigning} className="w-full rounded-md border border-white/10 bg-[#0b1d34] px-2 py-1.5 text-[11px] text-white outline-none focus:border-cyan-300"><option value="">Select available truck</option>{driver.available_trucks.map((truck) => <option key={truck.id} value={truck.id}>{truck.identity_label} — {truck.plate_number}</option>)}</select><button type="submit" disabled={assigning} className="rounded-md border border-cyan-300/25 px-2 py-1 text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-60">{assigning ? "Assigning..." : "Assign Truck"}</button></form> : <span className="text-slate-500">No available active trucks</span>}
    {state.message && <p className={state.success ? "text-emerald-300" : "text-rose-300"}>{state.message}</p>}
  </div>;
}
