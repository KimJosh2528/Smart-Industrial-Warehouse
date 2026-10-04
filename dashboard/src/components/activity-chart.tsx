"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function ActivityChart({ data }: { data: { label: string; authorized: number; denied: number }[] }) {
  const hasData = data.some((item) => item.authorized || item.denied);
  return <div className="relative h-[240px] w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><defs><linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.25} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#20344e" vertical={false} /><XAxis dataKey="label" tick={{ fill: "#8ca1bb", fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fill: "#8ca1bb", fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "#10233d", border: "1px solid #28415f", borderRadius: 12, color: "#fff" }} />{hasData && <Area type="monotone" dataKey="authorized" stroke="#22d3ee" strokeWidth={2} fill="url(#activityFill)" dot={{ r: 3, fill: "#34d399", strokeWidth: 0 }} />}{hasData && <Area type="monotone" dataKey="denied" stroke="#fb5262" strokeWidth={2} fill="none" dot={{ r: 3, fill: "#fb5262", strokeWidth: 0 }} />}</AreaChart></ResponsiveContainer>{!hasData && <div className="pointer-events-none absolute inset-0 flex items-center justify-center pt-5 text-sm text-slate-500">No access activity in the last 7 days</div>}</div>;
}
