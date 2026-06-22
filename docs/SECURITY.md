# Seguridad del backend

Controles activos:

- CORS con allowlist por `ALLOWED_ORIGINS`.
- Rechazo de `POST /api/notify` si el `Origin` no esta permitido.
- Headers de seguridad en respuestas API.
- Limite de body por `MAX_BODY_BYTES`.
- Rate limit basico por IP con `RATE_LIMIT_MAX` y `RATE_LIMIT_WINDOW_MS`.
- Export CSV apagado por defecto con `ENABLE_CSV_EXPORT=false`.
- Token de export comparado con `timingSafeEqual`.
- Supabase service role solo en backend.
- Rechazo de campos o valores sensibles: tarjeta completa, CVV/CVC, NIP/PIN, OTP, CLABE, cuenta bancaria, CURP/RFC y contrasenas.
- Telegram opcional: si falla o no esta configurado, el lead guardado no se pierde.

Variables recomendadas para piloto:

```text
ALLOWED_ORIGINS=https://tu-preview.vercel.app,http://localhost:8082
MAX_BODY_BYTES=8192
RATE_LIMIT_MAX=30
RATE_LIMIT_WINDOW_MS=60000
ENABLE_CSV_EXPORT=false
```

Variables recomendadas para produccion:

```text
ALLOWED_ORIGINS=https://tu-dominio-autorizado.mx
MAX_BODY_BYTES=8192
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW_MS=60000
ENABLE_CSV_EXPORT=false
```

Cuando se habilite CSV:

```text
ENABLE_CSV_EXPORT=true
LEADS_EXPORT_TOKEN=<token-largo-aleatorio>
```

Pendientes opcionales antes de alto volumen:

- Cloudflare Turnstile o reCAPTCHA en el frontend.
- Rate limit persistente con Upstash/Redis.
- Web Application Firewall en Cloudflare o Vercel Firewall.
- Rotacion periodica de `LEADS_EXPORT_TOKEN`.
- Revision de logs de Twilio para opt-out y errores de entrega.
