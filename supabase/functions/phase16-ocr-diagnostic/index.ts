const PROVIDER_URL = "https://api.platerecognizer.com/v1/plate-reader/";
const PROVIDER_TIMEOUT_MS = 12000;

interface OcrCandidate {
  plate: string;
  score: number;
  region: string;
  region_score?: number;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function finiteScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function parseCandidates(payload: unknown): OcrCandidate[] {
  if (!payload || typeof payload !== "object") return [];
  const results = (payload as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];

  return results.flatMap((item): OcrCandidate[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.plate !== "string" || !row.plate.trim()) return [];
    const score = finiteScore(row.score);
    if (score === null) return [];

    const regionValue = row.region;
    const region = typeof regionValue === "string"
      ? { code: regionValue.trim(), score: null }
      : regionValue && typeof regionValue === "object"
      ? {
        code: typeof (regionValue as Record<string, unknown>).code === "string"
          ? ((regionValue as Record<string, unknown>).code as string).trim()
          : "",
        score: finiteScore((regionValue as Record<string, unknown>).score),
      }
      : { code: "", score: null };
    if (!region.code) return [];

    const regionScore = region.score ?? finiteScore(row.region_score);
    return [{
      plate: row.plate,
      score,
      region: region.code,
      ...(regionScore === null ? {} : { region_score: regionScore }),
    }];
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const token = Deno.env.get("PLATE_RECOGNIZER_API_TOKEN") ?? "";
  if (!token) return json({ status: "diagnostic_error", reason: "provider_not_configured" }, 500);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return json({ status: "diagnostic_error", reason: "empty_body" }, 400);

  const imageBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(imageBuffer).set(bytes);
  const form = new FormData();
  form.append("upload", new Blob([imageBuffer], { type: "image/jpeg" }), "capture.jpg");
  form.append("regions", "ph");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(PROVIDER_URL, {
      method: "POST",
      headers: { Authorization: `Token ${token}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) return json({ status: "diagnostic_error", reason: "provider_rejected" }, 502);

    const candidates = parseCandidates(await response.json())
      .sort((left, right) => right.score - left.score);
    return json({ status: "ocr_result", candidates });
  } catch {
    return json({ status: "diagnostic_error", reason: "provider_unavailable" }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
