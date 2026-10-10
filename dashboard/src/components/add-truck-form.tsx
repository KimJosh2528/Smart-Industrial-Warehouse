import { AddTruckFormClient } from "./add-truck-form-client";

export async function AddTruckForm({ warehouseName }: { warehouseName: string | null }) {
  return <AddTruckFormClient warehouseName={warehouseName} />;
}
