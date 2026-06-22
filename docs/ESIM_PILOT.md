# Piloto con WIM/eSIM para area IT

Este flujo es para preparar lotes manuales de SMS desde una linea/eSIM corporativa, por ejemplo WIM. No automatiza el envio ni usa Twilio.

WIM funciona como linea telefonica en el equipo. No se usa como API serverless; el script genera archivos listos para revisar y abrir mensajes manualmente desde el telefono.

## Alcance recomendado

- 10-20 personas para primera prueba.
- Hasta 500 empleados IT en lotes controlados.
- No usar para campana masiva de 600,000.

## Entrada TXT para piloto

```text
5512345678
+525512345679
5551234567
```

Comando:

```powershell
node scripts\prepare-esim-pilot.js --provider wim --sender-label WIM --input sms\phones-pilot-template.txt --assume-authorized-txt --batch-size 50 --link https://tu-link
```

## Entrada CSV recomendada

```csv
phone,name,authorized,notes
5512345678,Maria Lopez,si,IT piloto
+525512345679,Juan Perez,si,IT piloto
```

Comando:

```powershell
node scripts\prepare-esim-pilot.js --provider wim --sender-label WIM --input contactos-it.csv --batch-size 50 --link https://tu-link
```

## Salidas

El script genera una carpeta `outputs/esim-pilot-*` con:

- `contacts-normalized.csv`: telefonos normalizados, rechazados y motivos.
- `ready-phones.txt`: telefonos listos.
- `batch-001.csv`, `batch-002.csv`, etc.
- `batch-001.txt`, `batch-002.txt`, etc. con `telefono | mensaje`.
- `batch-001.html`, `batch-002.html`, etc. con enlaces `sms:` para abrir Mensajes en iPhone/Android.
- `index.html`: indice de lotes HTML.
- `summary.json`: conteos y numero de lotes.

## Operacion sugerida para 500 IT

1. Activa la eSIM WIM en el equipo y confirma que puede enviar SMS.
2. En iPhone, revisa que Mensajes use la linea WIM para SMS salientes.
3. Genera lotes de 50.
4. Envia lote 1 a 10-20 personas primero.
5. Espera confirmacion de recepcion y que el link cargue.
6. Continua con lotes de 50.
7. Registra manualmente errores o respuestas STOP.

## Prueba por Vercel si no estas en el mismo WiFi

La pagina `frontend/wim-test.html` permite hacer una prueba desde el iPhone sin subir tu numero a un archivo publico.
El numero se escribe en Safari y no se guarda.

Despliega el proyecto en Vercel y abre:

```text
https://TU-PROYECTO.vercel.app/wim-test
```

El proyecto incluye `.vercelignore` para no subir `outputs/`, `.env*` ni archivos locales `sms/*.txt` o `sms/*.csv` con telefonos.

Desde el iPhone:

1. Escribe tu numero destino.
2. Revisa el mensaje.
3. Toca `Abrir iPhone`.
4. En Mensajes confirma que la linea seleccionada sea WIM/eSIM.
5. Envia el SMS manualmente.

## Lotes de 20 desde el iPhone

Para la prueba interna de IT, usa:

```text
https://campana-telco-segura.vercel.app/wim-batch
```

Pega hasta 20 numeros, toca `Preparar lote` y envia uno por uno desde los botones `iPhone`.
La pagina permite marcar `Enviado` o `Error` y copiar pendientes. No manda mensajes automaticamente ni sube los numeros al servidor.

Si generas lotes desde archivo local:

```powershell
node scripts\prepare-esim-pilot.js --provider wim --sender-label WIM --input contactos-it.csv --batch-size 20 --link https://campana-telco-segura.vercel.app
```

## Mensaje

Default:

```text
Hola {{name}}, prueba interna IT: registra tu linea aqui {{link}}. Responde STOP para baja.
```

Puedes personalizarlo:

```powershell
node scripts\prepare-esim-pilot.js --provider wim --input contactos-it.csv --template "Hola {{name}}, prueba IT autorizada: {{link}}" --link https://tu-link
```

Mantener el mensaje debajo de 160 caracteres ayuda a evitar multiples segmentos SMS.

## Limitaciones

- Una eSIM/linea normal puede ser bloqueada si se usa como canal masivo.
- No hay delivery report confiable como en un proveedor empresarial.
- No hay opt-out automatizado.
- No usar automatizadores de SIM/eSIM para envio masivo.
- Los enlaces HTML solo abren el mensaje prellenado; el envio sigue siendo manual.

Para produccion usa Telcel Mensajeria Masiva Empresarial o un proveedor enterprise.
