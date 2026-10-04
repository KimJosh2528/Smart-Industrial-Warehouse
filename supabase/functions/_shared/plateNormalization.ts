// Phase 16 temporary canonicalization contract. This performs only stable
// text canonicalization; it does not infer Philippine plate formats.
export function normalizePlateCandidate(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > 64) return null;
  if (!/^[A-Z0-9 .-]+$/.test(normalized)) return null;
  return normalized;
}
