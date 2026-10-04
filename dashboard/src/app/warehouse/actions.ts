"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RenameWarehouseState = { success: boolean; error: string | null };

export async function renameMyWarehouse(
  _previousState: RenameWarehouseState,
  formData: FormData,
): Promise<RenameWarehouseState> {
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const newName = String(formData.get("newName") ?? "");
  const client = await createClient();
  const { error } = await client.rpc("rename_my_warehouse", {
    target_warehouse_id: warehouseId,
    new_name: newName,
  });

  if (error) return { success: false, error: "Warehouse rename was rejected." };

  revalidatePath("/");
  revalidatePath("/admin/system-admins");
  return { success: true, error: null };
}
