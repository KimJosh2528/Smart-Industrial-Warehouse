import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function normalize(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function plateFileCandidates() {
  const cwd = process.cwd();
  return [path.resolve(cwd, "../camera-server/plates.txt"), path.resolve(cwd, "camera-server/plates.txt")];
}

async function resolvePlateFile() {
  for (const candidate of plateFileCandidates()) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Try the other workspace layout.
    }
  }
  return plateFileCandidates()[0];
}

export async function syncCameraPlateRecord({ plate, truckName, driverName }: { plate: string; truckName: string; driverName?: string | null }) {
  const normalizedPlate = normalize(plate);
  if (!normalizedPlate || !truckName.trim()) throw new Error("invalid_plate_record");

  const cameraTunnelUrl = process.env.CAMERA_TUNNEL_URL?.trim().replace(/\/$/, "");
  const syncSecret = process.env.CAMERA_PLATE_SYNC_SECRET?.trim();
  if (cameraTunnelUrl) {
    if (!syncSecret) throw new Error("camera_plate_sync_not_configured");
    const response = await fetch(`${cameraTunnelUrl}/sync-plate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${syncSecret}`,
      },
      body: JSON.stringify({
        plate: plate.trim(),
        truck_name: truckName.trim(),
        driver_name: driverName?.trim() || null,
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("camera_plate_sync_failed");
    return;
  }

  // Local development fallback. A deployed Vercel process cannot write the
  // computer's camera-server/plates.txt filesystem.
  if (process.env.VERCEL === "1") throw new Error("camera_plate_sync_not_configured");

  const file = await resolvePlateFile();
  const current = await readFile(file, "utf8").catch(() => "");
  const lines = current.split(/\r?\n/).filter(Boolean);
  const nextLine = `${plate.trim()},${truckName.trim()} - ${driverName?.trim() || "(waiting)"}`;
  const next = lines.filter((line) => normalize(line.split(",", 1)[0] ?? "") !== normalizedPlate);
  next.push(nextLine);
  await writeFile(file, `${next.join("\n")}\n`, "utf8");
}
