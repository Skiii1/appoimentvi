# Campana Telco Segura

Plantilla para una campana digital autorizada con frontend estatico y API serverless independiente para guardar leads, exportarlos en CSV y notificar leads no sensibles a Telegram.

Esta base evita recolectar datos bancarios, credenciales, OTP, NIP, CVV, CLABE o numeros completos de tarjeta. Si una persona intenta enviar ese tipo de informacion, la API rechaza o redacta el contenido antes de notificar.

## Estructura

```text
campana-telco-segura/
  frontend/
    index.html
    styles.css
    app.js
  api/
    _shared.js
    export.csv.js
    notify.js
  supabase/
    schema.sql
  .env.example
  package.json
  vercel.json
```

## Configuracion

1. Copia `.env.example` a `.env.local` en el entorno donde despliegues la API.
2. Configura:
   - `TELEGRAM_BOT_TOKEN`: token del bot de Telegram.
   - `TELEGRAM_CHAT_ID`: chat o canal donde quieres recibir avisos.
   - `ALLOWED_ORIGINS`: origenes permitidos separados por coma, por ejemplo `https://registratelcel.vercel.app,http://localhost:8080`.
   - `SUPABASE_URL`: URL del proyecto Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY`: service role key de Supabase, solo en la API.
   - `LEADS_EXPORT_TOKEN`: token largo para proteger la descarga CSV.
3. Ejecuta `supabase/schema.sql` en el SQL editor de Supabase.
4. En el frontend estatico, configura `window.CAMPAIGN_API_ENDPOINT` con la URL publica de la API.
5. Cambia el texto de marca solo si tienes autorizacion para usar esa marca.

## Desarrollo local

Frontend estatico:

```powershell
cd frontend
python -m http.server 8080
```

API serverless local con Vercel:

```powershell
npm install
npx vercel dev
```

## Exportar CSV

Durante una prueba interna puedes dejar el export apagado con:

```text
ENABLE_CSV_EXPORT=false
```

Cuando finalice la prueba y quieras habilitar descarga CSV, cambia:

```text
ENABLE_CSV_EXPORT=true
```

Luego usa:

```text
https://tu-api.vercel.app/api/export.csv?token=TU_LEADS_EXPORT_TOKEN
```

Tambien puedes usar header:

```text
Authorization: Bearer TU_LEADS_EXPORT_TOKEN
```

El CSV incluye fecha, nombre, telefono, correo, ciudad, paquete, horario, referencia enmascarada y consentimiento.

## Despliegue sugerido

- Frontend: Netlify, Cloudflare Pages, GitHub Pages, S3 o cualquier hosting estatico.
- API: Vercel Serverless Functions con las variables de entorno anteriores.
- Base de datos: Supabase con `supabase/schema.sql`.

## Seguridad

Ver `docs/SECURITY.md` para controles activos y variables recomendadas de piloto/produccion.

## Piloto WIM/eSIM

Para una prueba con linea/eSIM WIM dedicada, usa el flujo sin Twilio:

```powershell
npm run wim:prepare
```

Tambien puedes pasar tu propio archivo:

```powershell
node scripts\prepare-esim-pilot.js --provider wim --sender-label WIM --input contactos-it.csv --batch-size 50 --link https://tu-link
```

El script genera lotes CSV/TXT y HTML con enlaces `sms:` para abrir mensajes prellenados desde el telefono. No envia SMS automaticamente.

## Envio SMS recomendado: Telnyx

Para preservar trazabilidad, privacidad y control operativo, la integracion recomendada es Telnyx. SMS8 puede servir para pruebas con SIM/eSIM, pero depende de un telefono fisico y es mas fragil para una campana formal.

Variables principales:

```text
SMS_PROVIDER=telnyx
SMS_SEND_TOKEN=token_largo_para_autorizar_lotes
SMS_SEND_ENABLED=false
SMS_BATCH_LIMIT=10
TELNYX_API_KEY=...
TELNYX_FROM_NUMBER=+52...
CAMPAIGN_LINK=https://registratelcel.vercel.app/telcel
```

Endpoint serverless:

```text
POST /api/sms-send
Authorization: Bearer SMS_SEND_TOKEN
Content-Type: application/json
```

Ejemplo seguro en modo prueba:

```json
{
  "dryRun": true,
  "contacts": [
    { "phone": "5512345678", "name": "IT", "authorized": "si" }
  ]
}
```

Para envio real cambia `SMS_SEND_ENABLED=true` en Vercel y manda `"dryRun": false`. El endpoint no guarda el lote, no devuelve telefonos completos y rechaza columnas sensibles como tarjeta, CVV, NIP, OTP, CLABE, CURP o RFC.

Tambien puedes usar el script local:

```powershell
node scripts\send-sms-campaign.js --provider telnyx --csv sms\contacts-template.csv
node scripts\send-sms-campaign.js --provider telnyx --csv contactos-it.csv --send --limit 20
```

### Webhook inbound Telnyx

En el Quickstart de Telnyx, en `Inbound settings`, usa:

```text
Webhook URL: https://registratelcel.vercel.app/api/telnyx-webhook
Webhook Failover URL: dejar vacio
```

El webhook recibe respuestas y estados de entrega. No guarda texto libre ni telefonos completos; solo devuelve y notifica resumen enmascarado cuando hay baja, ayuda o fallo de entrega.

Para produccion, copia la public key de Telnyx desde `Keys & Credentials -> Public Key` y configura:

```text
TELNYX_PUBLIC_KEY=...
TELNYX_REQUIRE_WEBHOOK_SIGNATURE=true
```

Telnyx procesa automaticamente palabras estandar como `STOP`, `UNSUBSCRIBE`, `CANCEL`, `END` y `QUIT`. Si quieres que tambien reconozca `BAJA`, configuralo en Advanced Opt-In/Out del Messaging Profile.

## Campos permitidos

La plantilla solo envia:

- nombre
- telefono
- correo
- ciudad
- paquete seleccionado
- horario de contacto
- folio o referencia comercial enmascarada, si aplica
- aceptacion de consentimiento

No agregues campos para tarjeta, banca, password, codigo SMS, OTP, NIP, CVV, CLABE o credenciales.
