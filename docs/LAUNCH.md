# Lanzamiento

## 1. Base de datos

1. Crea un proyecto en Supabase.
2. Abre SQL Editor.
3. Ejecuta `supabase/schema.sql`.
4. Copia `SUPABASE_URL`.
5. Copia `SUPABASE_SERVICE_ROLE_KEY` desde Project Settings > API.

La `service_role_key` solo va en el backend. No la pongas en el frontend.

## 2. API serverless

Despliega `campana-telco-segura` en Vercel y configura estas variables:

```text
ALLOWED_ORIGINS=https://tu-dominio.com,http://localhost:8082
MAX_BODY_BYTES=8192
RATE_LIMIT_MAX=30
RATE_LIMIT_WINDOW_MS=60000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
LEADS_EXPORT_TOKEN=un-token-largo-aleatorio
ENABLE_CSV_EXPORT=false
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

`TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` son opcionales para guardar leads. Si faltan, el lead se guarda y solo se omite Telegram.

## 3. Frontend

En la carpeta de la pagina estatica, crea un archivo `config.js` junto a `reducida-segura.html`:

```js
window.CAMPAIGN_API_ENDPOINT = "https://tu-api.vercel.app/api/notify";
```

Incluye ese archivo antes de `reducida-segura.js`.

## 4. CSV

Para la prueba interna, deja el CSV deshabilitado:

```text
ENABLE_CSV_EXPORT=false
```

Cuando termine el piloto y quieras exportar leads, cambia:

```text
ENABLE_CSV_EXPORT=true
```

Descarga leads:

```text
https://tu-api.vercel.app/api/export.csv?token=TU_LEADS_EXPORT_TOKEN
```

Columnas:

```text
created_at,name,phone,email,city,plan,contact_time,masked_reference,consent
```

## 5. Datos permitidos

Permitido:

- telefono
- nombre
- correo
- ciudad
- horario de contacto
- metodo de pago
- ultimos 4 digitos enmascarados
- folio de aclaracion

No permitido:

- tarjeta completa
- fecha de vencimiento
- CVV/CVC
- NIP/PIN
- OTP/codigo SMS
- CURP/RFC
- CLABE/cuenta bancaria
- contrasenas

## 6. Envio por SMS

Usa `docs/TWILIO_SMS.md` para preparar el CSV autorizado y enviar por Twilio.

Flujo recomendado:

1. Exporta del CRM una lista con `phone,name,authorized`.
2. Corre dry-run.
3. Revisa `outputs/sms-results-*.csv`.
4. Ejecuta envio real con `--send`.

Durante el piloto entre companeros puedes omitir el paso de export CSV. Los registros quedan en Supabase y la descarga se habilita despues cambiando `ENABLE_CSV_EXPORT=true`.

## 7. Seguridad

Revisa `docs/SECURITY.md` antes de pasar de piloto a produccion.

## 8. Piloto eSIM

Para el piloto de IT con una linea/eSIM corporativa, usa `docs/ESIM_PILOT.md`.
