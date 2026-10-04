import { authenticateDeviceRequest, DeviceAuthError } from "./deviceAuth.ts";
import { jsonResponse, methodNotAllowed } from "./response.ts";

export function authenticatedHandler(method: string, endpoint: string, req: Request): Promise<Response> {
  if (req.method !== method) return Promise.resolve(methodNotAllowed([method]));
  return req.text().then(async (rawBody) => {
    try {
      const auth = await authenticateDeviceRequest(req, rawBody);
      return jsonResponse({ status: "accepted", endpoint, device_id: auth.device.id });
    } catch (error) {
      if (error instanceof DeviceAuthError) return jsonResponse({ status: "error", message: "authentication_failed" }, 401);
      return jsonResponse({ status: "error", message: "internal_server_error" }, 500);
    }
  });
}
