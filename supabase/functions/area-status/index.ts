import { authenticatedHandler } from "../_shared/handler.ts";

Deno.serve((req) => authenticatedHandler("POST", "area-status", req));
