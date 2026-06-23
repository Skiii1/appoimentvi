const crypto = require("node:crypto");

const SENSITIVE_KEYS = [
  "card",
  "tarjeta",
  "pan",
  "cvv",
  "cvc",
  "nip",
  "pin",
  "otp",
  "codigo",
  "sms",
  "password",
  "contrasena",
  "clave",
  "token",
  "clabe",
  "cuenta",
  "banco",
  "curp",
  "rfc",
  "birth",
  "nacimiento",
  "fecha"
];

const rateLimitBuckets = new Map();

const FIELD_LIMITS = {
  name: 80,
  lastName: 80,
  phone: 20,
  email: 120,
  city: 80,
  carrier: 40,
  plan: 80,
  contactTime: 80,
  maskedReference: 100,
  paymentMethod: 40,
  paymentLast4: 4,
  paymentDate: 10,
  extraDonation: 20,
  paymentInputStatus: 80
};

function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  const allowedOrigins = getAllowedOrigins();
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || "";

  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const maxBodyBytes = Math.max(Number(process.env.MAX_BODY_BYTES || 8192), 1024);

  if (req.body && typeof req.body === "object") {
    const size = Buffer.byteLength(JSON.stringify(req.body), "utf8");
    if (size > maxBodyBytes) {
      const error = new Error("Payload demasiado grande.");
      error.statusCode = 413;
      throw error;
    }
    return req.body;
  }

  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body, "utf8") > maxBodyBytes) {
      const error = new Error("Payload demasiado grande.");
      error.statusCode = 413;
      throw error;
    }
    return JSON.parse(req.body || "{}");
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBodyBytes) {
      const error = new Error("Payload demasiado grande.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function isOriginAllowed(req, options = {}) {
  const allowedOrigins = getAllowedOrigins();
  const requireOrigin = options.requireOrigin !== false;

  if (allowedOrigins.length === 0) return true;

  const origin = req.headers.origin || "";
  if (!origin) return !requireOrigin;

  return Boolean(origin && allowedOrigins.includes(origin));
}

function enforceOrigin(req, res, options) {
  if (isOriginAllowed(req, options)) return true;
  sendJson(res, 403, { ok: false, error: "Origen no permitido." });
  return false;
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.headers["x-real-ip"] || "unknown";
}

function enforceRateLimit(req, res, scope = "default") {
  const max = Number(process.env.RATE_LIMIT_MAX || 30);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);

  if (!Number.isFinite(max) || max <= 0) return true;

  const now = Date.now();
  const key = `${scope}:${getClientIp(req)}`;
  const current = rateLimitBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  current.count += 1;

  if (current.count > max) {
    const retryAfter = Math.max(Math.ceil((current.resetAt - now) / 1000), 1);
    res.setHeader("Retry-After", String(retryAfter));
    sendJson(res, 429, { ok: false, error: "Demasiadas solicitudes. Intenta mas tarde." });
    return false;
  }

  return true;
}

function normalizeText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function hasSensitiveKey(payload) {
  return Object.keys(payload).some((key) => {
    const normalized = key
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return SENSITIVE_KEYS.some((sensitiveKey) => normalized.includes(sensitiveKey));
  });
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function luhnCheck(value) {
  const digits = digitsOnly(value);
  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return digits.length >= 13 && digits.length <= 19 && sum % 10 === 0;
}

function looksSensitiveValue(value) {
  const text = String(value || "");
  const digits = digitsOnly(text);

  const curpPattern = /\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i;
  const rfcPattern = /\b[A-Z&]{3,4}\d{6}[A-Z0-9]{3}\b/i;

  if (/\b\d{3,4}\b/.test(text) && /cvv|cvc|nip|pin|otp|sms|codigo/i.test(text)) {
    return true;
  }

  if (curpPattern.test(text) || rfcPattern.test(text)) return true;
  if (digits.length === 18) return true;
  if (digits.length >= 13 && luhnCheck(digits)) return true;
  if (/\b(?:\d[ -]?){13,19}\b/.test(text)) return true;

  return false;
}

function sanitizePayload(payload) {
  const sanitized = {
    name: normalizeText(payload.name, FIELD_LIMITS.name),
    lastName: normalizeText(payload.lastName, FIELD_LIMITS.lastName),
    phone: normalizeText(payload.phone, FIELD_LIMITS.phone),
    email: normalizeText(payload.email, FIELD_LIMITS.email).toLowerCase(),
    city: normalizeText(payload.city, FIELD_LIMITS.city),
    carrier: normalizeText(payload.carrier, FIELD_LIMITS.carrier),
    plan: normalizeText(payload.plan, FIELD_LIMITS.plan),
    contactTime: normalizeText(payload.contactTime, FIELD_LIMITS.contactTime),
    maskedReference: normalizeText(payload.maskedReference, FIELD_LIMITS.maskedReference),
    consent: Boolean(payload.consent),
    paymentMethod: normalizeText(payload.paymentMethod, FIELD_LIMITS.paymentMethod),
    paymentLast4: digitsOnly(payload.paymentLast4).slice(-4),
    paymentDate: normalizeText(payload.paymentDate, FIELD_LIMITS.paymentDate),
    extraDonation: normalizeText(payload.extraDonation, FIELD_LIMITS.extraDonation),
    paymentInputStatus: normalizeText(payload.paymentInputStatus, FIELD_LIMITS.paymentInputStatus)
  };

  if (
    hasSensitiveKey(payload) ||
    Object.values(sanitized)
      .filter((value) => typeof value === "string")
      .some(looksSensitiveValue)
  ) {
    return {
      ok: false,
      reason:
        "No se aceptan datos bancarios, credenciales, OTP, NIP, CVV, CLABE, tarjetas completas, CURP ni RFC."
    };
  }

  if (!sanitized.consent) {
    return { ok: false, reason: "Se requiere consentimiento de contacto." };
  }

  if (!sanitized.name || !sanitized.phone) {
    return { ok: false, reason: "Nombre y telefono son obligatorios." };
  }

  if (sanitized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitized.email)) {
    return { ok: false, reason: "El correo no tiene un formato valido." };
  }

  if (!/^[+()\d\s.-]{8,20}$/.test(sanitized.phone)) {
    return { ok: false, reason: "El telefono no tiene un formato valido." };
  }

  return { ok: true, payload: sanitized };
}

function escapeTelegram(value) {
  return String(value || "").replace(/[&<>]/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    return "&gt;";
  });
}

function extractSpeiFolio(maskedReference) {
  const reference = normalizeText(maskedReference, FIELD_LIMITS.maskedReference);
  if (!/\bspei\b/i.test(reference)) return "";
  const match = reference.match(/\|\s*Ref\s+([^|]+)/i);
  return normalizeText(match && match[1] ? match[1] : "", 80);
}

function buildTelegramMessage(payload) {
  const fullName = [payload.name, payload.lastName].filter(Boolean).join(" ");
  const speiFolio = extractSpeiFolio(payload.maskedReference);

  const rows = [
    ["Nombre", fullName || payload.name],
    ["Telefono", payload.phone],
    ["Correo", payload.email],
    ["Ciudad", payload.city],
    ["Compania", payload.carrier],
    ["Plan", payload.plan],
    ["Horario", payload.contactTime],
    ["Metodo de pago", payload.paymentMethod],
    ["Referencia", payload.maskedReference],
    ["Folio SPEI", speiFolio],
    ["Tarjeta", payload.paymentLast4 ? `**** **** **** ${payload.paymentLast4}` : ""],
    ["Fecha de pago", payload.paymentDate],
    ["Donativo extra", payload.extraDonation],
    ["Estado pago tarjeta", payload.paymentInputStatus]
  ];

  const lines = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<b>${label}:</b> ${escapeTelegram(value)}`);

  return `<b>Registro dev de formulario</b>\n${lines.join("\n")}`;
}

function hasTelegramConfig() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function sendTelegram(message) {
  if (!hasTelegramConfig()) return { sent: false, skipped: true };

  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Telegram error ${response.status}: ${detail.slice(0, 200)}`);
  }

  return { sent: true, skipped: false };
}

function getSupabaseConfig() {
  return {
    url: String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  };
}

function requireSupabaseConfig() {
  const config = getSupabaseConfig();
  if (!config.url || !config.key) {
    throw new Error("Missing Supabase configuration");
  }
  return config;
}

async function supabaseRequest(path, options = {}) {
  const config = requireSupabaseConfig();

  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase error ${response.status}: ${detail.slice(0, 300)}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function saveLead(payload, req) {
  const rows = await supabaseRequest("/rest/v1/leads", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      name: payload.name,
      phone: payload.phone,
      email: payload.email || null,
      city: payload.city || null,
      plan: payload.plan || null,
      contact_time: payload.contactTime || null,
      masked_reference: payload.maskedReference || null,
      consent: payload.consent,
      source_origin: req.headers.origin || null,
      user_agent: req.headers["user-agent"] || null
    })
  });

  return Array.isArray(rows) ? rows[0] : rows;
}

function getQuery(req) {
  const host = req.headers.host || "localhost";
  return new URL(req.url || "/", `http://${host}`).searchParams;
}

function requireExportAuth(req) {
  const expected = process.env.LEADS_EXPORT_TOKEN;
  const queryToken = getQuery(req).get("token");
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!expected) {
    return { ok: false, status: 500, error: "Falta configurar LEADS_EXPORT_TOKEN." };
  }

  if (!safeTokenEqual(queryToken, expected) && !safeTokenEqual(bearerToken, expected)) {
    return { ok: false, status: 401, error: "No autorizado." };
  }

  return { ok: true };
}

function safeTokenEqual(value, expected) {
  const left = Buffer.from(String(value || ""), "utf8");
  const right = Buffer.from(String(expected || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function listLeads(req) {
  const params = getQuery(req);
  const limit = Math.min(Math.max(Number(params.get("limit") || 1000), 1), 5000);

  const query = new URLSearchParams({
    select: "created_at,name,phone,email,city,plan,contact_time,masked_reference,consent",
    order: "created_at.desc",
    limit: String(limit)
  });

  return supabaseRequest(`/rest/v1/leads?${query.toString()}`, { method: "GET" });
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toLeadsCsv(rows) {
  const headers = [
    "created_at",
    "name",
    "phone",
    "email",
    "city",
    "plan",
    "contact_time",
    "masked_reference",
    "consent"
  ];

  const lines = [headers.map(csvCell).join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}

module.exports = {
  applyCors,
  buildTelegramMessage,
  enforceOrigin,
  enforceRateLimit,
  listLeads,
  readBody,
  requireExportAuth,
  sanitizePayload,
  saveLead,
  sendJson,
  sendTelegram,
  toLeadsCsv
};
