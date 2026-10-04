import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hashClaimToken } from "@/lib/account-claim-server";
import { AccountRegistrationForm } from "@/components/account-registration-form";

export const dynamic = "force-dynamic";

export default async function DriverRegistrationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const client = await createClient();
  const { data, error } = await client.rpc("get_account_claim", { p_token_hash: hashClaimToken(token) });
  const claim = data?.[0];
  if (error || !claim || claim.claim_kind !== "driver") notFound();

  return <main className="flex min-h-screen items-center justify-center bg-[#061223] px-5 text-slate-100"><section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1d34] p-6 shadow-2xl"><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">WareGuard</p><h1 className="mt-2 text-2xl font-semibold text-white">Driver account registration</h1><p className="mt-2 text-sm text-slate-400">Create the personal account for <span className="text-slate-200">{claim.display_name}</span> in <span className="text-slate-200">{claim.warehouse_name}</span>.</p>{claim.truck_plate_number && <p className="mt-2 text-xs text-slate-500">Current truck assignment: {claim.truck_plate_number}{claim.truck_division ? ` · ${claim.truck_division}` : ""}</p>}<div className="mt-6"><AccountRegistrationForm token={token} kind="driver" /></div></section></main>;
}
