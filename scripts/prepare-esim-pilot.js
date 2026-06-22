#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

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

const TRUTHY = new Set(["1", "true", "yes", "si", "sí", "autorizado", "authorized", "opt-in", "optin"]);

function parseArgs(argv) {
  const args = {
    input: "",
    outputDir: "",
    provider: process.env.ESIM_PROVIDER || "wim",
    senderLabel: process.env.ESIM_SENDER_LABEL || "WIM",
    batchSize: Number(process.env.ESIM_BATCH_SIZE || 50),
    countryCode: process.env.SMS_DEFAULT_COUNTRY_CODE || "+52",
    link: process.env.CAMPAIGN_LINK || "",
    template: process.env.SMS_TEMPLATE || "",
    templateFile: "",
    assumeAuthorizedTxt: false,
    appendStop: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const next = argv[i + 1];

    if (item === "--input" || item === "--csv") {
      args.input = next || "";
      i += 1;
    } else if (item === "--output-dir") {
      args.outputDir = next || "";
      i += 1;
    } else if (item === "--provider") {
      args.provider = next || args.provider;
      i += 1;
    } else if (item === "--sender-label") {
      args.senderLabel = next || args.senderLabel;
      i += 1;
    } else if (item === "--batch-size") {
      args.batchSize = Number(next || 50);
      i += 1;
    } else if (item === "--country-code") {
      args.countryCode = next || args.countryCode;
      i += 1;
    } else if (item === "--link") {
      args.link = next || "";
      i += 1;
    } else if (item === "--template") {
      args.template = next || "";
      i += 1;
    } else if (item === "--template-file") {
      args.templateFile = next || "";
      i += 1;
    } else if (item === "--assume-authorized-txt") {
      args.assumeAuthorizedTxt = true;
    } else if (item === "--no-append-stop") {
      args.appendStop = false;
    } else if (item === "--help" || item === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Argumento no reconocido: ${item}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Uso:
  node scripts/prepare-esim-pilot.js --provider wim --input sms/phones-pilot-template.txt --assume-authorized-txt --link https://tu-link
  node scripts/prepare-esim-pilot.js --provider wim --input contactos-it.csv --batch-size 50 --link https://tu-link

Genera lotes para envio manual con eSIM. No envia SMS.

Opciones:
  --input, --csv <archivo>      CSV o TXT con telefonos.
  --output-dir <carpeta>        Carpeta destino.
  --provider <wim>              Etiqueta del proveedor/eSIM.
  --sender-label <WIM>          Nombre de la linea para instrucciones.
  --batch-size <50>             Contactos por lote.
  --link <url>                  Link de campana si el template usa {{link}}.
  --template <texto>            Template con {{name}} y {{link}}.
  --template-file <archivo>     Template desde archivo.
  --country-code <+52>          Codigo para telefonos locales.
  --assume-authorized-txt       Permite TXT de telefonos para piloto.
  --no-append-stop              No agrega texto STOP.
`);
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

  if (!headers.includes("phone") && !headers.includes("telefono") && !headers.includes("teléfono")) {
    throw new Error("El CSV debe incluir una columna phone o telefono.");
  }
}

function getField(record, names) {
  for (const name of names) {
    if (record[name]) return record[name];
  }

  return "";
}

function normalizePhone(raw, countryCode) {
  const value = String(raw || "").trim();

  if (value.startsWith("+")) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : "";
  }

  const digits = value.replace(/\D/g, "");
  const countryDigits = countryCode.replace(/\D/g, "");

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
  const name = getField(record, ["name", "nombre"]) || "equipo IT";
  return template
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{nombre\}\}/g, name)
    .replace(/\{\{phone\}\}/g, getField(record, ["phone", "telefono", "teléfono"]))
    .replace(/\{\{link\}\}/g, link)
    .replace(/\s+/g, " ")
    .trim();
}

function ensureStopText(message, appendStop) {
  if (!appendStop) return message;
  if (/\b(stop|baja|cancelar|unsubscribe)\b/i.test(message)) return message;
  return `${message} Responde STOP para baja.`;
}

function estimateSegments(message) {
  const isGsm7 = /^[\x0A\x0D\x20-\x7E¡£¥èéùìòÇØøÅåÆæÉÄÖÑÜ§¿äöñüà]*$/.test(message);
  const singleLimit = isGsm7 ? 160 : 70;
  const multiLimit = isGsm7 ? 153 : 67;

  if (message.length <= singleLimit) return 1;
  return Math.ceil(message.length / multiLimit);
}

function csvCell(value) {
  return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
}

function toCsv(rows, headers) {
  const lines = [headers.map(csvCell).join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}

function chunk(items, size) {
  const chunks = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function slug(value) {
  return String(value || "esim")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "esim";
}

function htmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function smsHref(phone, message, platform) {
  const encodedBody = encodeURIComponent(message);
  const separator = platform === "ios" ? "&" : "?";
  return `sms:${phone}${separator}body=${encodedBody}`;
}

function renderBatchHtml(batch, options) {
  const rows = batch.map((item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${htmlEscape(item.name || "Sin nombre")}</strong><br><span>${htmlEscape(item.phone)}</span></td>
          <td>${htmlEscape(item.message)}</td>
          <td class="actions">
            <a href="${htmlEscape(smsHref(item.phone, item.message, "ios"))}">Abrir iPhone</a>
            <a href="${htmlEscape(smsHref(item.phone, item.message, "android"))}">Abrir Android</a>
          </td>
        </tr>`).join("");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lote ${htmlEscape(options.batchName)} - ${htmlEscape(options.providerLabel)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #17212b; background: #f6f8fa; }
    main { max-width: 980px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d8dee4; }
    th, td { padding: 10px; border-bottom: 1px solid #d8dee4; text-align: left; vertical-align: top; }
    th { background: #eef2f6; font-size: 13px; }
    td:first-child { width: 48px; color: #57606a; }
    .note { background: #fff8c5; border: 1px solid #d4a72c; padding: 12px; margin: 16px 0; }
    .actions { width: 180px; }
    .actions a { display: block; margin-bottom: 8px; padding: 9px 10px; border-radius: 6px; background: #0969da; color: #fff; text-decoration: none; text-align: center; }
    span { color: #57606a; }
  </style>
</head>
<body>
  <main>
    <h1>Lote ${htmlEscape(options.batchName)} - ${htmlEscape(options.providerLabel)}</h1>
    <p>Envio manual desde la linea/eSIM ${htmlEscape(options.senderLabel)}. Antes de enviar, verifica en Mensajes que salga la linea correcta, no tu numero personal.</p>
    <div class="note">Este archivo no envia mensajes automaticamente. Cada enlace solo abre el SMS prellenado para revision y envio manual.</div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Contacto</th>
          <th>Mensaje</th>
          <th>Accion</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
  </main>
</body>
</html>
`;
}

function renderIndexHtml(batches, options) {
  const items = batches.map((batch, index) => {
    const batchName = String(index + 1).padStart(3, "0");
    return `<li><a href="batch-${batchName}.html">Lote ${batchName}</a> - ${batch.length} contactos</li>`;
  }).join("\n");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Piloto ${htmlEscape(options.providerLabel)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #17212b; background: #f6f8fa; }
    main { max-width: 760px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    a { color: #0969da; }
    li { margin: 10px 0; }
    .note { background: #fff8c5; border: 1px solid #d4a72c; padding: 12px; margin: 16px 0; }
  </style>
</head>
<body>
  <main>
    <h1>Piloto ${htmlEscape(options.providerLabel)}</h1>
    <p>Archivos para envio manual desde la linea/eSIM ${htmlEscape(options.senderLabel)}.</p>
    <div class="note">No automatiza envio. Usa primero un lote pequeno para confirmar recepcion y remitente.</div>
    <ul>
${items}
    </ul>
  </main>
</body>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input) {
    throw new Error("Falta --input <archivo>.");
  }

  if (!Number.isFinite(args.batchSize) || args.batchSize < 1 || args.batchSize > 100) {
    throw new Error("--batch-size debe estar entre 1 y 100.");
  }

  let template = args.template;

  if (args.templateFile) {
    template = await fs.readFile(args.templateFile, "utf8");
  }

  if (!template) {
    template = "Hola {{name}}, prueba interna IT: registra tu linea aqui {{link}}.";
  }

  if (template.includes("{{link}}") && !args.link) {
    throw new Error("Configura --link o CAMPAIGN_LINK porque el template usa {{link}}.");
  }

  const inputText = await fs.readFile(args.input, "utf8");
  const extension = path.extname(args.input).toLowerCase();

  if (extension === ".txt" && !args.assumeAuthorizedTxt) {
    throw new Error("Para usar TXT debes agregar --assume-authorized-txt.");
  }

  const contacts = extension === ".txt" ? parseTxt(inputText) : parseCsv(inputText);
  const seen = new Set();
  const accepted = [];
  const rejected = [];

  for (const contact of contacts) {
    const rawPhone = getField(contact, ["phone", "telefono", "teléfono"]);
    const phone = normalizePhone(rawPhone, args.countryCode);
    const name = getField(contact, ["name", "nombre"]);
    const message = ensureStopText(renderTemplate(template, contact, args.link), args.appendStop);
    const base = {
      row: contact._row,
      phone: phone || rawPhone,
      name,
      message,
      message_length: message.length,
      estimated_segments: estimateSegments(message)
    };

    if (!phone) {
      rejected.push({ ...base, status: "invalid_phone", reason: "Telefono invalido." });
    } else if (seen.has(phone)) {
      rejected.push({ ...base, status: "duplicate", reason: "Telefono duplicado." });
    } else if (!isAuthorized(contact)) {
      rejected.push({ ...base, status: "not_authorized", reason: "Falta autorizacion." });
    } else {
      seen.add(phone);
      accepted.push({ ...base, status: "ready", reason: "" });
    }
  }

  const provider = slug(args.provider);
  const providerLabel = args.provider.toUpperCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = args.outputDir || path.join("outputs", `${provider}-pilot-${stamp}`);
  await fs.mkdir(outputDir, { recursive: true });

  const headers = ["row", "phone", "name", "status", "reason", "message_length", "estimated_segments", "message"];
  await fs.writeFile(path.join(outputDir, "contacts-normalized.csv"), toCsv([...accepted, ...rejected], headers), "utf8");
  await fs.writeFile(path.join(outputDir, "ready-phones.txt"), accepted.map((item) => item.phone).join("\r\n") + "\r\n", "utf8");

  const batches = chunk(accepted, args.batchSize);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const batchName = String(index + 1).padStart(3, "0");
    const batchHeaders = ["phone", "name", "message_length", "estimated_segments", "message"];

    await fs.writeFile(path.join(outputDir, `batch-${batchName}.csv`), toCsv(batch, batchHeaders), "utf8");
    await fs.writeFile(
      path.join(outputDir, `batch-${batchName}.txt`),
      batch.map((item) => `${item.phone} | ${item.message}`).join("\r\n") + "\r\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(outputDir, `batch-${batchName}.html`),
      renderBatchHtml(batch, {
        batchName,
        providerLabel,
        senderLabel: args.senderLabel
      }),
      "utf8"
    );
  }

  await fs.writeFile(
    path.join(outputDir, "index.html"),
    renderIndexHtml(batches, {
      providerLabel,
      senderLabel: args.senderLabel
    }),
    "utf8"
  );

  const summary = {
    provider,
    senderLabel: args.senderLabel,
    total: contacts.length,
    ready: accepted.length,
    rejected: rejected.length,
    batches: batches.length,
    batchSize: args.batchSize,
    maxEstimatedSegments: accepted.reduce((max, item) => Math.max(max, item.estimated_segments), 0),
    outputDir,
    indexHtml: path.join(outputDir, "index.html")
  };

  await fs.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
