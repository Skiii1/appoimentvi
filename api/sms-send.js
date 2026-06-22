const crypto = require("node:crypto");
const {
  applyCors,
  enforceOrigin,
  enforceRateLimit,
  readBody,
  sendJson
} = require("./_shared");
const {
  ensureStopText,
  getField,
  isAuthorized,
  normalizePhone,
  redactPhone,
  renderTemplate,
  sendTelnyxSms,
  validateHeaders
} = require("../lib/sms");

function safeTokenEqual(value, expected) {
  const left = Buffer.from(String(value || ""), "utf8");
  const right = Buffer.from(String(expected || ""), "utf8");

  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireSmsAuth(req) {
  const expected = process.env.SMS_SEND_TOKEN || "";
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!expected) {
    return { ok: false, status: 500, error: "Falta configurar SMS_SEND_TOKEN." };
  }

  if (!safeTokenEqual(bearerToken, expected)) {
    return { ok: false, status: 401, error: "No autorizado." };
  }

  return { ok: true };
}

function getBatchLimit() {
  const configured = Number(process.env.SMS_BATCH_LIMIT || 10);
  if (!Number.isFinite(configured) || configured <= 0) return 10;
  return Math.min(configured, 25);
}

function getCampaignLink() {
  return String(process.env.CAMPAIGN_LINK || "").trim();
}

function getTemplate(body) {
  return String(
    body.messageTemplate ||
    process.env.SMS_TEMPLATE ||
    "Hola {{name}}, tu beneficio Telcel ya esta disponible. Registra tu linea aqui: {{link}}."
  );
}

function normalizeContact(contact, index) {
  if (!contact || typeof contact !== "object" || Array.isArray(contact)) {
    throw new Error(`Contacto invalido en posicion ${index + 1}.`);
  }

  validateHeaders(Object.keys(contact).map((key) => key.toLowerCase()));

  return {
    ...contact,
    _row: contact._row || index + 1
  };
}

async function sendBatch(body) {
  const link = getCampaignLink();
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  const batchLimit = getBatchLimit();
  const dryRun = body.dryRun !== false;
  const appendStop = body.appendStop !== false;
  const countryCode = process.env.SMS_DEFAULT_COUNTRY_CODE || "+52";
  const template = getTemplate(body);

  if (!link) {
    return { ok: false, status: 500, error: "Falta configurar CAMPAIGN_LINK." };
  }

  if (contacts.length === 0) {
    return { ok: false, status: 400, error: "El lote debe incluir contacts." };
  }

  if (contacts.length > batchLimit) {
    return { ok: false, status: 400, error: `Lote demasiado grande. Maximo ${batchLimit} contactos.` };
  }

  if (!dryRun && process.env.SMS_SEND_ENABLED !== "true") {
    return { ok: false, status: 403, error: "Envio real bloqueado. Configura SMS_SEND_ENABLED=true." };
  }

  const seen = new Set();
  const results = [];

  for (let index = 0; index < contacts.length; index += 1) {
    const contact = normalizeContact(contacts[index], index);
    const rawPhone = getField(contact, ["phone", "telefono", "tel\u00e9fono"]);
    const phone = normalizePhone(rawPhone, countryCode);
    const name = getField(contact, ["name", "nombre"]);
    const message = ensureStopText(renderTemplate(template, contact, link), appendStop);
    const result = {
      row: contact._row,
      phone: redactPhone(phone || rawPhone),
      name: name || "",
      provider: "telnyx",
      status: "",
      providerId: "",
      errorCode: "",
      error: "",
      message
    };

    if (!phone) {
      result.status = "skipped_invalid_phone";
      result.error = "Telefono invalido o no normalizable a E.164.";
    } else if (seen.has(phone)) {
      result.status = "skipped_duplicate";
      result.error = "Telefono duplicado.";
    } else if (!isAuthorized(contact)) {
      result.status = "skipped_no_authorization";
      result.error = "Falta autorizacion/consentimiento verdadero.";
    } else if (dryRun) {
      seen.add(phone);
      result.status = "dry_run";
    } else {
      seen.add(phone);
      const sent = await sendTelnyxSms(phone, message);
      result.status = sent.ok ? sent.status || "queued" : "failed";
      result.providerId = sent.providerId;
      result.errorCode = sent.errorCode;
      result.error = sent.error;
    }

    results.push(result);
  }

  return {
    ok: true,
    dryRun,
    provider: "telnyx",
    total: results.length,
    summary: results.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {}),
    results
  };
}

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

  if (!enforceOrigin(req, res, { requireOrigin: false })) return;
  if (!enforceRateLimit(req, res, "sms-send")) return;

  const auth = requireSmsAuth(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, error: auth.error });
    return;
  }

  try {
    const body = await readBody(req);
    const result = await sendBatch(body);

    if (!result.ok) {
      sendJson(res, result.status || 400, { ok: false, error: result.error });
      return;
    }

    sendJson(res, 200, result);
  } catch (error) {
    const status = error.statusCode || 400;
    sendJson(res, status, { ok: false, error: error.message || "No se pudo procesar el lote SMS." });
  }
};
