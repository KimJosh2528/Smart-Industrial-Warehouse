import { authenticateDeviceRequest, DeviceAuthError } from "../_shared/deviceAuth.ts";
import { validateJpegStructure } from "../_shared/jpeg.ts";
import { normalizePlateCandidate } from "../_shared/plateNormalization.ts";
import { readRequestBodyWithinLimit } from "../_shared/requestBody.ts";
import { insertRow, selectRows, SupabaseAdminError } from "../_shared/supabaseAdmin.ts";
import { jsonResponse, methodNotAllowed } from "../_shared/response.ts";

const PROVIDER_URL = "https://api.platerecognizer.com/v1/plate-reader/";
const PROVIDER_TIMEOUT_MS = 12000;

interface AreaRow { id: string; area_type_code: string; }
interface TruckRow { id: string; normalized_plate: string; is_active: boolean; }
interface PermissionRow { id: string; }

interface PlateCandidate {
  plate: string;
  score: number | null;
  region: string | null;
  regionScore: number | null;
}

class ProviderError extends Error {}

function finiteScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

function parseRegion(value: unknown): { code: string | null; score: number | null } {
  if (typeof value === "string") return { code: value.trim() || null, score: null };
  if (!value || typeof value !== "object") return { code: null, score: null };
  const region = value as Record<string, unknown>;
  return {
    code: typeof region.code === "string" && region.code.trim() ? region.code.trim() : null,
    score: finiteScore(region.score),
  };
}

function parseCandidates(payload: unknown): PlateCandidate[] {
  if (!payload || typeof payload !== "object") return [];
  const results = (payload as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((item): PlateCandidate[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.plate !== "string" || !row.plate.trim()) return [];
    const score = finiteScore(row.score);
    if (score === null) return [];
    const region = parseRegion(row.region);
    if (region.code === null || !/^[a-z]{2}(?:-[a-z0-9]+)*$/i.test(region.code)) return [];
    const rawRegionScore = region.score ?? row.region_score;
    if (rawRegionScore !== undefined && rawRegionScore !== null && finiteScore(rawRegionScore) === null) return [];
    const regionScore = region.score ?? finiteScore(row.region_score);
    return [{
      plate: row.plate,
      score,
      region: region.code,
      regionScore,
    }];
  });
}

async function recognize(bytes: Uint8Array): Promise<PlateCandidate[]> {
  const token = Deno.env.get("PLATE_RECOGNIZER_API_TOKEN") ?? "";
  if (!token) throw new ProviderError("provider_not_configured");

  const form = new FormData();
  const imageBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(imageBuffer).set(bytes);
  form.append("upload", new Blob([imageBuffer], { type: "image/jpeg" }), "capture.jpg");
  form.append("regions", "ph");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(PROVIDER_URL, {
      method: "POST",
      headers: { Authorization: `Token ${token}` },
      body: form,
      signal: controller.signal,
    });
  } catch {
    throw new ProviderError("provider_unavailable");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new ProviderError("provider_rejected");
  try {
    return parseCandidates(await response.json());
  } catch {
    throw new ProviderError("provider_malformed_response");
  }
}

async function findTruckEntrance(warehouseId: string): Promise<AreaRow | null> {
  const areas = await selectRows<AreaRow>(
    "warehouse_areas",
    { warehouse_id: `eq.${warehouseId}`, area_type_code: "eq.truck_entrance" },
    "id,area_type_code",
  );
  return areas.length === 1 ? areas[0] : null;
}

async function logDecision(
  warehouseId: string,
  areaId: string | null,
  deviceId: string,
  truckId: string | null,
  result: "success" | "denied",
  reason: string,
  candidate: PlateCandidate | null,
): Promise<void> {
  await insertRow("access_logs", {
    warehouse_id: warehouseId,
    area_id: areaId,
    device_id: deviceId,
    credential_id: null,
    staff_member_id: null,
    truck_id: truckId,
    event_type: result === "success" ? "TRUCK_PLATE_SUCCESS" : "TRUCK_PLATE_DENIED",
    authentication_method: "truck_plate",
    result,
    metadata: {
      reason,
      score: candidate?.score ?? null,
      region: candidate?.region ?? null,
      region_score: candidate?.regionScore ?? null,
    },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const bodyResult = await readRequestBodyWithinLimit(req);
  if (bodyResult.status === "invalid_content_length") {
    return jsonResponse({ status: "error", message: "invalid_content_length" }, 400);
  }
  if (bodyResult.status === "too_large") {
    return jsonResponse({ status: "error", message: "image_too_large" }, 413);
  }
  if (bodyResult.status === "read_error") {
    return jsonResponse({ status: "error", message: "invalid_request_body" }, 400);
  }
  const rawBody = bodyResult.body;

  let auth;
  try {
    auth = await authenticateDeviceRequest(req, rawBody);
  } catch (error) {
    if (error instanceof DeviceAuthError) return jsonResponse({ status: "error", message: "authentication_failed" }, 401);
    return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
  }

  const contentType = (req.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "image/jpeg") return jsonResponse({ status: "error", message: "invalid_content_type" }, 415);
  if (rawBody.length === 0 || !validateJpegStructure(rawBody)) {
    return jsonResponse({ status: "error", message: "invalid_image" }, 400);
  }

  try {
    const area = await findTruckEntrance(auth.device.warehouse_id);
    if (!area) return jsonResponse({ status: "error", message: "truck_entrance_not_configured" }, 500);

    let candidates: PlateCandidate[];
    try {
      candidates = await recognize(rawBody);
    } catch (error) {
      if (error instanceof ProviderError) {
        await logDecision(auth.device.warehouse_id, area.id, auth.device.id, null, "denied", error.message, null);
        return jsonResponse({ status: "denied", reason: "plate_recognition_unavailable" }, 200);
      }
      throw error;
    }

    const candidate = candidates
      .map((item) => ({ item, normalized: normalizePlateCandidate(item.plate) }))
      .filter((item): item is { item: PlateCandidate; normalized: string } => item.normalized !== null)
      .sort((left, right) => (right.item.score ?? -1) - (left.item.score ?? -1))[0];

    if (!candidate) {
      await logDecision(auth.device.warehouse_id, area.id, auth.device.id, null, "denied", "plate_not_recognized", null);
      return jsonResponse({ status: "denied", reason: "plate_not_recognized" }, 200);
    }

    const trucks = await selectRows<TruckRow>(
      "trucks",
      {
        warehouse_id: `eq.${auth.device.warehouse_id}`,
        normalized_plate: `eq.${candidate.normalized}`,
        is_active: "eq.true",
      },
      "id,normalized_plate,is_active",
    );
    const truck = trucks.length === 1 ? trucks[0] : null;
    if (!truck) {
      await logDecision(auth.device.warehouse_id, area.id, auth.device.id, null, "denied", "unknown_or_inactive_truck", candidate.item);
      return jsonResponse({ status: "denied", reason: "unknown_or_inactive_truck", recognition: { score: candidate.item.score, region: candidate.item.region } }, 200);
    }

    const permissions = await selectRows<PermissionRow>(
      "access_permissions",
      {
        warehouse_id: `eq.${auth.device.warehouse_id}`,
        area_id: `eq.${area.id}`,
        truck_id: `eq.${truck.id}`,
        staff_member_id: "is.null",
      },
      "id",
    );
    if (permissions.length !== 1) {
      await logDecision(auth.device.warehouse_id, area.id, auth.device.id, truck.id, "denied", "area_not_permitted", candidate.item);
      return jsonResponse({ status: "denied", reason: "area_not_permitted", recognition: { score: candidate.item.score, region: candidate.item.region } }, 200);
    }

    await logDecision(auth.device.warehouse_id, area.id, auth.device.id, truck.id, "success", "authorized", candidate.item);
    return jsonResponse({ status: "authorized", recognition: { score: candidate.item.score, region: candidate.item.region } }, 200);
  } catch (error) {
    if (error instanceof SupabaseAdminError) return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
    return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
  }
});
