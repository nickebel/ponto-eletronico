/**
 * Diagnóstico de disponibilidade. Não recebe nem grava dados de funcionários.
 */
export async function onRequestGet({ env }) {
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

  return Response.json(
    {
      application: "controle-de-jornada",
      status: "development_only",
      database,
      message: "Ambiente de desenvolvimento. Não utilizar para registro oficial de jornada."
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}
