import { authenticatedHandler } from "../_shared/handler.ts";

Deno.serve((req) => authenticatedHandler("GET", "device-config", req));
