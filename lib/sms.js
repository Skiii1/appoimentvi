const BLOCKED_HEADERS = [
  "tarjeta",
  "card",
  "pan",
  "cvv",
  "cvc",
  "nip",
  "pin",
  "otp",
  "password",
  "contrasena",
  "clabe",
  "cuenta",
  "banco",
  "curp",
  "rfc"
];

const TRUTHY = new Set(["1", "true", "yes", "si", "s\u00ed", "autorizado", "authorized", "opt-in", "optin"]);

function normalizeText(value, maxLength = 500) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted && char === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);

  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  validateHeaders(headers);

  return rows.slice(1).map((values, index) => {
    const record = { _row: index + 2 };

    headers.forEach((header, columnIndex) => {
      record[header] = (values[columnIndex] || "").trim();
    });

    return record;
  });
}

function parseTxt(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      const parts = line.split(/[,\t]/).map((part) => part.trim());

      return {
        _row: index + 1,
        phone: parts[0] || "",
        name: parts.slice(1).join(" ") || "",
        authorized: "si",
        notes: "TXT piloto con autorizacion asumida"
      };
    });
}

function validateHeaders(headers) {
  const blocked = headers.filter((header) => BLOCKED_HEADERS.some((word) => header.includes(word)));

  if (blocked.length > 0) {
    throw new Error(`El archivo contiene columnas no permitidas: ${blocked.join(", ")}`);
  }

  if (!headers.includes("phone") && !headers.includes("telefono") && !headers.includes("tel\u00e9fono")) {
    throw new Error("El CSV debe incluir una columna phone o telefono.");
  }
}

function getField(record, names) {
  for (const name of names) {
    if (record[name]) return record[name];
  }

  return "";
}

function normalizePhone(raw, countryCode = "+52") {
  const value = String(raw || "").trim();

  if (value.startsWith("+")) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : "";
  }

  const digits = value.replace(/\D/g, "");
  const countryDigits = String(countryCode || "").replace(/\D/g, "");

  if (countryDigits && digits.startsWith(countryDigits) && digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }

  if (digits.length === 10 && countryCode) {
    return `${countryCode}${digits}`;
  }

  return "";
}

function isAuthorized(record) {
  const value = getField(record, ["authorized", "autorizado", "consent", "consentimiento", "opt_in", "optin"]);
  return TRUTHY.has(String(value || "").trim().toLowerCase());
}

function renderTemplate(template, record, link) {
  const name = getField(record, ["name", "nombre"]) || "cliente";
  const body = normalizeText(template, 1000)
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{nombre\}\}/g, name)
    .replace(/\{\{phone\}\}/g, getField(record, ["phone", "telefono", "tel\u00e9fono"]))
    .replace(/\{\{link\}\}/g, link);

  return normalizeText(body, 500);
}

function ensureStopText(message, appendStop = true) {
  if (!appendStop) return message;
  if (/\b(stop|baja|cancelar|unsubscribe)\b/i.test(message)) return message;
  return `${message} Responde STOP para dejar de recibir mensajes.`;
}

function redactPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `***${digits.slice(-4)}`;
}

function requireTelnyxConfig() {
  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER || process.env.TELNYX_FROM;
  const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID || "";

  if (!apiKey) {
    throw new Error("Falta TELNYX_API_KEY.");
  }

  if (!from && !messagingProfileId) {
    throw new Error("Configura TELNYX_FROM_NUMBER o TELNYX_MESSAGING_PROFILE_ID.");
  }

  return { apiKey, from, messagingProfileId };
}

async function sendTelnyxSms(to, text, options = {}) {
  const config = requireTelnyxConfig();
  const payload = {
    to,
    text,
    type: "SMS",
    use_profile_webhooks: true
  };

  if (config.from) {
    payload.from = config.from;
  }

  if (config.messagingProfileId) {
    payload.messaging_profile_id = config.messagingProfileId;
  }

  if (options.webhookUrl) {
    payload.webhook_url = options.webhookUrl;
  }

  const response = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      providerId: "",
      status: "failed",
      errorCode: data.errors && data.errors[0] ? data.errors[0].code : response.status,
      error: data.errors && data.errors[0] ? data.errors[0].detail || data.errors[0].title : `HTTP ${response.status}`
    };
  }

  return {
    ok: true,
    providerId: data.data && data.data.id ? data.data.id : "",
    status: data.data && data.data.to && data.data.to[0] ? data.data.to[0].status || "queued" : "queued",
    errorCode: "",
    error: ""
  };
}

function csvCell(value) {
  return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
}

function resultsToCsv(results) {
  const headers = ["row", "phone", "name", "status", "provider", "provider_id", "error_code", "error", "message"];
  const lines = [headers.map(csvCell).join(",")];

  for (const result of results) {
    lines.push(headers.map((header) => csvCell(result[header])).join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}

module.exports = {
  ensureStopText,
  getField,
  isAuthorized,
  normalizePhone,
  parseCsv,
  parseTxt,
  redactPhone,
  renderTemplate,
  resultsToCsv,
  sendTelnyxSms,
  validateHeaders
};
