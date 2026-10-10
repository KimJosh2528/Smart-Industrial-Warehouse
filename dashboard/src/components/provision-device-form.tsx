"use client";

import { useActionState } from "react";
import { provisionDevice, type ProvisionDeviceState } from "@/app/admin/system-admins/actions";

export function ProvisionDeviceForm({ deviceId, rotate = false }: { deviceId: string; rotate?: boolean }) {
  const [state, action, pending] = useActionState<ProvisionDeviceState, FormData>(provisionDevice, { success: false, message: "" });
  return <div className="mt-3"><form action={action} className="flex items-center gap-2"><input type="hidden" name="deviceId" value={deviceId} /><input type="hidden" name="rotate" value={String(rotate)} /><button disabled={pending} className="rounded-lg border border-amber-300/30 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-50">{pending ? "Working..." : rotate ? "Rotate credentials" : "Provision device"}</button></form>{state.message && <p className={`mt-2 text-xs ${state.success ? "text-emerald-200" : "text-rose-200"}`}>{state.message}</p>}{state.success && state.deviceUid && state.deviceSecret && <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs"><p className="font-semibold text-amber-100">Copy once to local Arduino secrets.h</p><code className="mt-2 block break-all text-slate-300">#define DEVICE_UID "{state.deviceUid}"<br />#define DEVICE_SECRET "{state.deviceSecret}"</code></div>}</div>;
}
