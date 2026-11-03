import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { isBlockedAuthPath } from "@/lib/auth-paths";

export const dynamic = "force-dynamic";

export const { GET, POST } = toNextJsHandler(async (request: Request) => {
  // /api/auth/admin/* — только через auth.api.* на сервере (см. lib/auth-paths.ts).
  if (isBlockedAuthPath(new URL(request.url).pathname)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return getAuth().handler(request);
});
