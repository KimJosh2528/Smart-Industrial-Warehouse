import { createClient } from "@/lib/supabase/server";
import { getAuthorizedWarehouses } from "@/lib/warehouse-scope";
import { CredentialManagementWorkspace, type CredentialPerson, type CredentialTruck } from "@/components/credential-management-workspace";

export default async function CredentialManagementPage() {
  const client = await createClient();
  const scope = await getAuthorizedWarehouses(client);
  const warehouseIds = scope.warehouses.map((warehouse) => warehouse.id);
  const [{ data: staff }, { data: trucks }, { data: rfidPool }] = await Promise.all([
    warehouseIds.length ? client.from("staff_members").select("id,display_name").in("warehouse_id", warehouseIds).order("display_name") : Promise.resolve({ data: [] }),
    warehouseIds.length ? client.from("trucks").select("id,identity_label,plate_number").in("warehouse_id", warehouseIds).order("identity_label") : Promise.resolve({ data: [] }),
    client.rpc("list_rfid_pool_uids"),
  ]);
  return <CredentialManagementWorkspace staff={(staff ?? []) as CredentialPerson[]} trucks={(trucks ?? []) as CredentialTruck[]} warehouses={scope.warehouses} rfidPool={(rfidPool ?? []) as { id: string; warehouse_id: string; uid_label: string; credential_scope: "staff" | "guard" | "truck"; status: "vacant" | "reserved" | "assigned" }[]} />;
}
