const crypto = require("node:crypto");
const {
  applyCors,
  enforceRateLimit,
  sendJson,
  sendTelegram
} = require("./_shared");
const { redactPhone } = require("../lib/sms");

const STOP_WORDS = new Set(["stop", "stopall", "stop all", "unsubscribe", "cancel", "end", "quit", "baja", "cancelar"]);
const HELP_WORDS = new Set(["help", "ayuda"]);

async function readRawBody(req) {
  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }

  if (typeof req.body === "string") {
    return req.body;
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(rawBody) {
  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    error.statusCode = 400;
    error.message = "JSON invalido.";
    throw error;
  }
}

function getEd25519PublicKey(value) {
  const publicKey = String(value || "").trim();

  if (!publicKey) return null;
  if (publicKey.includes("BEGIN PUBLIC KEY")) return crypto.createPublicKey(publicKey);

  const raw = Buffer.from(publicKey, "base64");

  if (raw.length === 32) {
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    return crypto.createPublicKey({
      key: Buffer.concat([spkiPrefix, raw]),
      format: "der",
      type: "spki"
    });
  }

  return crypto.createPublicKey({ key: raw, format: "der", type: "spki" });
}

function verifyTelnyxSignature(req, rawBody) {
  const publicKeyValue = process.env.TELNYX_PUBLIC_KEY || "";
  const requireSignature = process.env.TELNYX_REQUIRE_WEBHOOK_SIGNATURE === "true";

  if (!publicKeyValue && !requireSignature) {
    return { ok: true, verified: false, skipped: true };
  }

  if (!publicKeyValue) {
    return { ok: false, status: 500, error: "Falta configurar TELNYX_PUBLIC_KEY." };
  }

  const signature = req.headers["telnyx-signature-ed25519"];
  const timestamp = req.headers["telnyx-timestamp"];

  if (!signature || !timestamp) {
    return { ok: false, status: 403, error: "Firma Telnyx faltante." };
  }

  const signedAt = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(signedAt) || Math.abs(now - signedAt) > 300) {
    return { ok: false, status: 403, error: "Timestamp Telnyx fuera de ventana." };
  }

  try {
    const key = getEd25519PublicKey(publicKeyValue);
    const payload = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
    const decodedSignature = Buffer.from(String(signature), "base64");
    const verified = crypto.verify(null, payload, key, decodedSignature);

    if (!verified) {
      return { ok: false, status: 403, error: "Firma Telnyx invalida." };
    }

    return { ok: true, verified: true, skipped: false };
  } catch (error) {
    return { ok: false, status: 403, error: "No se pudo validar la firma Telnyx." };
  }
}

function normalizeKeyword(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function classifyInboundText(text) {
  const keyword = normalizeKeyword(text);

  if (STOP_WORDS.has(keyword)) return "opt_out";
  if (HELP_WORDS.has(keyword)) return "help";
  if (keyword === "start" || keyword === "unstop" || keyword === "alta") return "opt_in";
  return "reply";
}

function getPhone(payload, side) {
  if (side === "from") {
    return payload && payload.from ? payload.from.phone_number || "" : "";
  }

  if (payload && Array.isArray(payload.to) && payload.to[0]) {
    return payload.to[0].phone_number || "";
  }

  return "";
}

function buildWebhookSummary(event, signatureResult) {
  const data = event.data || {};
  const payload = data.payload || {};
  const eventType = data.event_type || "unknown";
  const from = redactPhone(getPhone(payload, "from"));
  const to = redactPhone(getPhone(payload, "to"));
  const status = payload.to && payload.to[0] ? payload.to[0].status || "" : "";
  const inboundAction = eventType === "message.received" ? classifyInboundText(payload.text) : "";

  return {
    eventId: data.id || "",
    eventType,
    messageId: payload.id || "",
    from,
    to,
    status,
    inboundAction,
    verified: Boolean(signatureResult.verified)
  };
}

async function maybeNotify(summary) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return { sent: false, skipped: true };
  }

  const important =
    summary.inboundAction === "opt_out" ||
    summary.inboundAction === "help" ||
    summary.status === "delivery_failed" ||
    summary.status === "sending_failed";

  if (!important) {
    return { sent: false, skipped: true };
  }

  const lines = [
    "<b>Evento Telnyx SMS</b>",
    `<b>Tipo:</b> ${summary.eventType}`,
    `<b>Accion:</b> ${summary.inboundAction || "estado"}`,
    `<b>De:</b> ${summary.from || "No disponible"}`,
    `<b>Para:</b> ${summary.to || "No disponible"}`,
    `<b>Status:</b> ${summary.status || "No disponible"}`,
    `<b>Firma:</b> ${summary.verified ? "verificada" : "sin verificar"}`
  ];

  return sendTelegram(lines.join("\n"));
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

  if (!enforceRateLimit(req, res, "telnyx-webhook")) return;

  try {
    const rawBody = await readRawBody(req);
    const signature = verifyTelnyxSignature(req, rawBody);

    if (!signature.ok) {
      sendJson(res, signature.status || 403, { ok: false, error: signature.error });
      return;
    }

    const event = parseJson(rawBody);
    const summary = buildWebhookSummary(event, signature);
    let telegram = { sent: false, skipped: true };

    try {
      telegram = await maybeNotify(summary);
    } catch (error) {
      console.error(error);
      telegram = { sent: false, skipped: false, error: "telegram_failed" };
    }

    sendJson(res, 200, { ok: true, summary, telegram });
  } catch (error) {
    const status = error.statusCode || 400;
    sendJson(res, status, { ok: false, error: error.message || "No se pudo procesar webhook Telnyx." });
  }
};
