const {
  applyCors,
  enforceOrigin,
  enforceRateLimit,
  listLeads,
  requireExportAuth,
  sendJson,
  toLeadsCsv
} = require("./_shared");

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Metodo no permitido." });
    return;
  }

  if (!enforceOrigin(req, res, { requireOrigin: false })) return;
  if (!enforceRateLimit(req, res, "export")) return;

  if (process.env.ENABLE_CSV_EXPORT !== "true") {
    sendJson(res, 404, { ok: false, error: "Export CSV deshabilitado." });
    return;
  }

  const auth = requireExportAuth(req);

  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, error: auth.error });
    return;
  }

  try {
    const rows = await listLeads(req);
    const csv = toLeadsCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="leads-${stamp}.csv"`);
    res.end(csv);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: "No se pudo exportar el CSV." });
  }
};
