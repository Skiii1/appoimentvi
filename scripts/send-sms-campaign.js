#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ensureStopText,
  getField,
  isAuthorized,
  normalizePhone,
  parseCsv,
  parseTxt,
  redactPhone,
  renderTemplate,
  resultsToCsv,
  sendTelnyxSms
} = require("../lib/sms");

function parseArgs(argv) {
  const args = {
    csv: "",
    output: "",
    send: false,
    provider: process.env.SMS_PROVIDER || "telnyx",
    limit: 0,
    offset: 0,
    maxSend: Number(process.env.SMS_MAX_SEND || 500),
    delayMs: Number(process.env.SMS_DELAY_MS || 500),
    countryCode: process.env.SMS_DEFAULT_COUNTRY_CODE || "+52",
    link: process.env.CAMPAIGN_LINK || "",
    template: process.env.SMS_TEMPLATE || "",
    templateFile: "",
    appendStop: true,
    assumeAuthorizedTxt: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const next = argv[i + 1];

    if (item === "--csv") {
      args.csv = next || "";
      i += 1;
    } else if (item === "--output") {
      args.output = next || "";
      i += 1;
    } else if (item === "--send") {
      args.send = true;
    } else if (item === "--provider") {
      args.provider = (next || "").toLowerCase();
      i += 1;
    } else if (item === "--limit") {
      args.limit = Number(next || 0);
      i += 1;
    } else if (item === "--offset") {
      args.offset = Number(next || 0);
      i += 1;
    } else if (item === "--max-send") {
      args.maxSend = Number(next || 0);
      i += 1;
    } else if (item === "--delay-ms") {
      args.delayMs = Number(next || 0);
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
    } else if (item === "--no-append-stop") {
      args.appendStop = false;
    } else if (item === "--assume-authorized-txt") {
      args.assumeAuthorizedTxt = true;
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
  node scripts/send-sms-campaign.js --csv sms/contacts-template.csv
  node scripts/send-sms-campaign.js --csv contactos.csv --send

Opciones:
  --csv <archivo>             CSV con phone,name,authorized
  --send                      Envia SMS reales. Sin esto solo hace dry-run.
  --provider <telnyx|twilio>  Proveedor SMS. Default: telnyx.
  --link <url>                Link de la campana. Tambien CAMPAIGN_LINK.
  --template <texto>          Template con {{name}} y {{link}}.
  --template-file <archivo>   Template desde archivo.
  --country-code <+52>        Codigo para telefonos locales de 10 digitos.
  --delay-ms <500>            Pausa entre envios reales.
  --limit <n>                 Limita cantidad procesada.
  --offset <n>                Salta las primeras n filas/contactos.
  --max-send <500>            Tope de destinatarios para envio real.
  --output <archivo>          CSV de resultados.
  --assume-authorized-txt     Permite TXT de telefonos para piloto.
  --no-append-stop            No agrega texto STOP automaticamente.
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken) {
    throw new Error("Faltan TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN.");
  }

  if (!messagingServiceSid && !from) {
    throw new Error("Configura TWILIO_MESSAGING_SERVICE_SID o TWILIO_FROM_NUMBER.");
  }

  return { accountSid, authToken, messagingServiceSid, from };
}

async function sendTwilioSms(to, body) {
  const config = requireTwilioConfig();
  const params = new URLSearchParams({
    To: to,
    Body: body
  });

  if (config.messagingServiceSid) {
    params.set("MessagingServiceSid", config.messagingServiceSid);
  } else {
    params.set("From", config.from);
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      sid: "",
      errorCode: data.code || response.status,
      error: data.message || `HTTP ${response.status}`
    };
  }

  return { ok: true, sid: data.sid || "", errorCode: "", error: "" };
}

function requireProviderConfig(provider) {
  if (provider === "telnyx") {
    if (!process.env.TELNYX_API_KEY) {
      throw new Error("Falta TELNYX_API_KEY.");
    }

    if (!process.env.TELNYX_FROM_NUMBER && !process.env.TELNYX_FROM && !process.env.TELNYX_MESSAGING_PROFILE_ID) {
      throw new Error("Configura TELNYX_FROM_NUMBER o TELNYX_MESSAGING_PROFILE_ID.");
    }

    return;
  }

  if (provider === "twilio") {
    requireTwilioConfig();
    return;
  }

  throw new Error(`Proveedor SMS no soportado: ${provider}. Usa telnyx o twilio.`);
}

async function sendSms(provider, to, body) {
  if (provider === "telnyx") {
    return sendTelnyxSms(to, body);
  }

  if (provider === "twilio") {
    const sent = await sendTwilioSms(to, body);
    return {
      ok: sent.ok,
      providerId: sent.sid,
      status: sent.ok ? "sent" : "failed",
      errorCode: sent.errorCode,
      error: sent.error
    };
  }

  throw new Error(`Proveedor SMS no soportado: ${provider}.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.csv) {
    throw new Error("Falta --csv <archivo>.");
  }

  if (!args.link) {
    throw new Error("Configura --link o CAMPAIGN_LINK.");
  }

  let template = args.template;

  if (args.templateFile) {
    template = await fs.readFile(args.templateFile, "utf8");
  }

  if (!template) {
    template = "Hola {{name}}, tu beneficio Telcel ya esta disponible. Registra tu linea aqui: {{link}}.";
  }

  const inputText = await fs.readFile(args.csv, "utf8");
  const extension = path.extname(args.csv).toLowerCase();
  const contacts = extension === ".txt" ? parseTxtInput(inputText, args) : parseCsv(inputText);
  const seen = new Set();
  const results = [];
  const start = Math.max(args.offset, 0);
  const end = args.limit > 0 ? start + args.limit : undefined;
  const selected = contacts.slice(start, end);

  if (args.send) {
    requireProviderConfig(args.provider);
    enforceSendCap(selected, args);
  }

  for (const contact of selected) {
    const rawPhone = getField(contact, ["phone", "telefono", "teléfono"]);
    const phone = normalizePhone(rawPhone, args.countryCode);
    const name = getField(contact, ["name", "nombre"]);
    const message = ensureStopText(renderTemplate(template, contact, args.link), args.appendStop);
    const result = {
      row: contact._row,
      phone: redactPhone(phone || rawPhone),
      name,
      status: "",
      provider: args.provider,
      provider_id: "",
      error_code: "",
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
      result.error = "Falta authorized/consent/opt_in verdadero.";
    } else if (!args.send) {
      result.status = "dry_run";
      seen.add(phone);
    } else {
      seen.add(phone);
      const sent = await sendSms(args.provider, phone, message);
      result.status = sent.ok ? sent.status || "sent" : "failed";
      result.provider_id = sent.providerId;
      result.error_code = sent.errorCode;
      result.error = sent.error;

      if (args.delayMs > 0) {
        await sleep(args.delayMs);
      }
    }

    results.push(result);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = args.output || path.join("outputs", `sms-results-${stamp}.csv`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, resultsToCsv(results), "utf8");

  const summary = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({ mode: args.send ? "send" : "dry-run", total: results.length, summary, output }, null, 2));
}

function parseTxtInput(text, args) {
  if (!args.assumeAuthorizedTxt) {
    throw new Error("Para usar TXT debes agregar --assume-authorized-txt. Para 600k empleados usa CSV con columna authorized.");
  }

  return parseTxt(text);
}

function enforceSendCap(contacts, args) {
  if (!Number.isFinite(args.maxSend) || args.maxSend <= 0) return;

  const unique = new Set();

  for (const contact of contacts) {
    const rawPhone = getField(contact, ["phone", "telefono", "teléfono"]);
    const phone = normalizePhone(rawPhone, args.countryCode);

    if (phone && isAuthorized(contact)) {
      unique.add(phone);
    }
  }

  if (unique.size > args.maxSend) {
    throw new Error(
      `Envio real bloqueado: ${unique.size} destinatarios supera --max-send ${args.maxSend}. ` +
      "Usa --limit/--offset para lotes o sube --max-send conscientemente."
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
