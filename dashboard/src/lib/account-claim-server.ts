import { createHash } from "node:crypto";

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function registrationOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
