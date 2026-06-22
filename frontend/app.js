const API_ENDPOINT = "http://localhost:3000/api/notify";

const SENSITIVE_WORDS = [
  "tarjeta",
  "cvv",
  "cvc",
  "nip",
  "pin",
  "otp",
  "codigo sms",
  "contrasena",
  "password",
  "clabe",
  "cuenta bancaria",
  "banco",
  "curp",
  "rfc",
  "fecha de nacimiento"
];

function normalizeValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function hasSensitiveContent(formData) {
  const values = Array.from(formData.values()).map(String).join(" ").toLowerCase();
  const digits = digitsOnly(values);
  const curpPattern = /\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i;
  const rfcPattern = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/i;

  if (SENSITIVE_WORDS.some((word) => values.includes(word))) return true;
  if (curpPattern.test(values) || rfcPattern.test(values)) return true;
  if (digits.length === 18) return true;
  if (/\b(?:\d[ -]?){13,19}\b/.test(values)) return true;

  return false;
}

function setStatus(message, tone = "") {
  const status = document.querySelector("#formStatus");
  status.textContent = message;

  if (tone) {
    status.dataset.tone = tone;
  } else {
    delete status.dataset.tone;
  }
}

function payloadFromForm(form) {
  const data = new FormData(form);

  return {
    name: normalizeValue(data.get("name")),
    phone: normalizeValue(data.get("phone")),
    email: normalizeValue(data.get("email")),
    city: normalizeValue(data.get("city")),
    plan: normalizeValue(data.get("plan")),
    contactTime: normalizeValue(data.get("contactTime")),
    maskedReference: normalizeValue(data.get("maskedReference")),
    consent: data.get("consent") === "on"
  };
}

document.querySelector("#leadForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const formData = new FormData(form);

  if (!form.reportValidity()) return;

  if (hasSensitiveContent(formData)) {
    setStatus("No envies datos bancarios, tarjetas, CLABE, NIP, CVV, codigos SMS, CURP, RFC ni contrasenas.", "error");
    return;
  }

  submitButton.disabled = true;
  setStatus("Enviando solicitud...");

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFromForm(form))
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "No se pudo registrar la solicitud.");
    }

    form.reset();
    setStatus("Solicitud registrada. Un asesor autorizado podra contactarte.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});
