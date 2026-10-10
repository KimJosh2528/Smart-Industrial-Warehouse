"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createRfidPoolUid(formData: FormData) {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const uid = String(formData.get("uidLabel") ?? "").trim();
  const scope = String(formData.get("scope") ?? "");
  if (!warehouseId || !uid || !scope) return;
  const client = await createClient();
  await client.rpc("create_rfid_pool_uid", { p_warehouse_id: warehouseId, p_uid_label: uid, p_scope: scope });
  revalidatePath("/credentials");
  revalidatePath("/member-applications");
}
