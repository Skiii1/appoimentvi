const {
  applyCors,
  buildTelegramMessage,
  enforceOrigin,
  enforceRateLimit,
  readBody,
  sanitizePayload,
  saveLead,
  sendJson,
  sendTelegram
} = require("./_shared");

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Metodo no permitido." });
    return;
  }

  if (!enforceOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, "notify")) return;

  try {
    const body = await readBody(req);
    const result = sanitizePayload(body);

    if (!result.ok) {
      sendJson(res, 400, { ok: false, error: result.reason });
      return;
    }

    let telegram = { sent: false, skipped: true };
    const telegramMessage = buildTelegramMessage(result.payload);

    if (telegramMessage) {
      try {
        telegram = await sendTelegram(telegramMessage);
      } catch (error) {
        console.error(error);
        telegram = { sent: false, skipped: false, error: "telegram_failed" };
      }
    }

    let lead = null;
    let storage = { saved: false, skipped: false };

    try {
      lead = await saveLead(result.payload, req);
      storage = { saved: true, skipped: false };
    } catch (error) {
      if (error.message === "Missing Supabase configuration") {
        storage = { saved: false, skipped: true, reason: "supabase_not_configured" };
      } else {
        throw error;
      }
    }

    sendJson(res, 200, {
      ok: true,
      leadId: lead && lead.id ? lead.id : null,
      storage,
      telegram
    });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error(error);
    }
    const message = status === 413 ? error.message : "No se pudo guardar la solicitud.";
    sendJson(res, status, { ok: false, error: message });
  }
};