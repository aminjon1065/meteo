import type { MetadataRoute } from "next";

/** robots.txt: публичные разделы индексируются; админка, auth‑API и iframe‑виджеты — нет. */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const privatePaths = ["/admin", "/embed", "/api/auth", "/api/admin"];
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: privatePaths.flatMap((p) => [p, `/ru${p}`, `/en${p}`]),
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
