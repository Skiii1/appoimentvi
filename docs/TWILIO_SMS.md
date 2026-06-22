# Envio SMS con Twilio

Este flujo envia el link de la campana a telefonos autorizados desde un CSV. El envio real solo ocurre con `--send`; sin esa bandera genera un dry-run y un CSV de resultados.

## Requisitos

Variables de entorno:

```text
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...
CAMPAIGN_LINK=https://tu-dominio.com/reducida-segura.html
SMS_DEFAULT_COUNTRY_CODE=+52
SMS_DELAY_MS=500
```

`TWILIO_MESSAGING_SERVICE_SID` es preferible a `TWILIO_FROM_NUMBER` porque el Messaging Service centraliza remitentes, compliance y opt-out.

## CSV

Formato recomendado para produccion o volumen alto:

```csv
phone,name,authorized,notes
5512345678,Maria Lopez,si,Cliente autorizo SMS en CRM
+525512345679,Juan Perez,si,Cliente autorizado
```

Columnas:

- `phone`: telefono. Puede venir en E.164 (`+5255...`) o local de 10 digitos si usas `SMS_DEFAULT_COUNTRY_CODE=+52`.
- `name`: nombre para personalizar.
- `authorized`: debe ser `si`, `true`, `1`, `yes`, `autorizado` u `authorized` para enviar.
- `notes`: opcional, no se envia.

No incluyas columnas de tarjeta, CVV, NIP, OTP, CURP, RFC, CLABE, cuenta bancaria ni contrasenas.

## TXT para piloto

Para una prueba interna pequena puedes usar TXT con un telefono por linea:

```text
5512345678
+525512345679
5551234567
```

Como TXT no trae columna de consentimiento, el script exige una confirmacion explicita:

```powershell
node scripts/send-sms-campaign.js --csv sms/phones-pilot-template.txt --assume-authorized-txt --link https://tu-dominio.com/reducida-segura.html
```

Para 600,000 empleados usa CSV, no TXT, para poder auditar autorizacion, segmento y origen del dato.

## Dry-run

```powershell
node scripts/send-sms-campaign.js --csv sms/contacts-template.csv --link https://tu-dominio.com/reducida-segura.html
```

## Envio real

```powershell
node scripts/send-sms-campaign.js --csv contactos.csv --send --link https://tu-dominio.com/reducida-segura.html
```

El envio real tiene un seguro por defecto de 500 destinatarios por corrida (`SMS_MAX_SEND=500`). Para lotes:

```powershell
node scripts/send-sms-campaign.js --csv contactos.csv --send --limit 500 --offset 0 --link https://tu-dominio.com/reducida-segura.html
node scripts/send-sms-campaign.js --csv contactos.csv --send --limit 500 --offset 500 --link https://tu-dominio.com/reducida-segura.html
```

Si necesitas subir el limite conscientemente:

```powershell
node scripts/send-sms-campaign.js --csv contactos.csv --send --limit 2000 --max-send 2000 --link https://tu-dominio.com/reducida-segura.html
```

## Mensaje

Default:

```text
Hola {{name}}, tu beneficio Telcel ya esta disponible. Registra tu linea aqui: {{link}}. Responde STOP para dejar de recibir mensajes.
```

Template personalizado:

```powershell
node scripts/send-sms-campaign.js --csv contactos.csv --template "Hola {{name}}, registra tu linea aqui: {{link}}." --send
```

El script agrega texto `STOP` automaticamente si el template no lo trae.

## Resultados

Cada ejecucion genera `outputs/sms-results-*.csv` con:

```text
row,phone,name,status,twilio_sid,error_code,error,message
```

Estados:

- `dry_run`
- `sent`
- `failed`
- `skipped_invalid_phone`
- `skipped_duplicate`
- `skipped_no_authorization`

## Compliance operativo

- Usa solo numeros con consentimiento verificable.
- Configura Advanced Opt-Out en el Messaging Service.
- Respeta STOP/UNSUBSCRIBE/CANCEL/END/QUIT y cualquier baja manual.
- Para SMS a Estados Unidos con 10DLC, registra A2P 10DLC antes de enviar.

## Rollout recomendado para una empresa grande

1. Piloto tecnico: 10-20 companeros.
2. Piloto ampliado: 100-500 empleados.
3. Validacion de soporte: revisar entregas, respuestas STOP y reportes.
4. Lotes controlados por area/region: 500-2,000 por corrida al inicio.
5. Escalamiento segun throughput real de Twilio y metricas de opt-out.

No hagas un blast unico a 600,000 numeros. Usa Messaging Service, controla MPS, monitorea resultados y coordina ventanas de envio con el equipo de comunicaciones.
