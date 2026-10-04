"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const { error } = await createClient().auth.signOut();
    if (error) { setBusy(false); return; }
    router.replace("/login");
    router.refresh();
  }

  return <button type="button" onClick={signOut} disabled={busy} className="mt-2 w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/10 disabled:opacity-60">{busy ? "Signing out..." : "Sign out"}</button>;
}
