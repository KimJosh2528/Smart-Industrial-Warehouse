import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

function roleLabel(role: string | null) {
  if (role === "father_admin") return "Father Admin";
  if (role === "system_admin") return "System Admin";
  return "Personal account";
}

export default async function AccountSettingsPage() {
  let client;
  try {
    client = await createClient();
  } catch {
    return <ErrorState message="Account information is not configured." />;
  }

  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return <ErrorState message="Your account information could not be loaded." />;

  const userId = authData.user.id;
  const [{ data: profile, error: profileError }, { data: staff }, { data: driver }, { data: assignedWarehouse }] = await Promise.all([
    client.from("profiles").select("display_name,role").eq("id", userId).maybeSingle(),
    client.from("staff_members").select("display_name,employee_code").eq("profile_id", userId).maybeSingle(),
    client.from("drivers").select("display_name,driver_code").eq("profile_id", userId).maybeSingle(),
    client.from("warehouses").select("name").eq("system_admin_id", userId).maybeSingle(),
  ]);

  if (profileError) return <ErrorState message="Your profile information could not be loaded." />;

  const role = profile?.role ?? null;
  const context = role === "father_admin"
    ? "Platform Administrator / Father Admin"
    : role === "system_admin"
      ? assignedWarehouse?.name ? `System Administrator · ${assignedWarehouse.name}` : "System Administrator · Not assigned"
      : staff ? "Staff account" : driver ? "Driver account" : "Personal account";

  return (
    <>
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">My Account</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Account Settings</h1>
        <p className="mt-2 text-sm text-slate-400">View the account information associated with your signed-in identity.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-2xl border border-white/10 bg-[#0b1d34] p-5 sm:p-6">
          <h2 className="font-semibold text-white">Account Information</h2>
          <dl className="mt-5 divide-y divide-white/[0.06]">
            <InfoRow label="Email" value={authData.user.email ?? "Not available"} />
            <InfoRow label="Display Name" value={profile?.display_name ?? "Not available"} />
            <InfoRow label="Role" value={roleLabel(role)} />
            <InfoRow label="Account Context" value={context} />
          </dl>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0b1d34] p-5 sm:p-6">
          <h2 className="font-semibold text-white">Security</h2>
          <p className="mt-3 text-sm text-slate-400">Your password and authentication credentials are managed securely by Supabase Auth and are not displayed here.</p>
          <div className="mt-5 border-t border-white/[0.06] pt-4"><SignOutButton /></div>
        </section>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"><dt className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</dt><dd className="break-words text-sm text-slate-200 sm:text-right">{value}</dd></div>;
}

function ErrorState({ message }: { message: string }) {
  return <section className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-5 py-6 text-sm text-rose-200">{message}</section>;
}
