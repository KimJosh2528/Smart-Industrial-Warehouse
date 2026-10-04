export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function methodNotAllowed(allowed: string[]): Response {
  return jsonResponse({ status: "error", message: "method_not_allowed", allowed }, 405);
}
