const ALLOWED_ORIGINS = new Set([
  "https://nickebel.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787"
]);

function corsHeaders(origin) {
  const headers = {
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Max-Age"] = "86400";
  }

  return headers;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed" }, 403, null);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      let database = "not_configured";

      if (env.DB) {
        try {
          await env.DB.prepare("SELECT 1 AS ok").first();
          database = "connected";
        } catch (error) {
          console.error("D1 health check failed:", error);
          database = "error";
        }
      }

      return json({
        application: "ponto-eletronico-api",
        status: "development_only",
        database,
        message: "API inicial. Ainda não habilitada para registros oficiais de jornada."
      }, 200, origin);
    }

    return json({ error: "Not found" }, 404, origin);
  }
};
