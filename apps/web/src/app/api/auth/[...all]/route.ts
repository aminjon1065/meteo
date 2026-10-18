import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const { GET, POST } = toNextJsHandler((request: Request) => getAuth().handler(request));
