# Pagos Abuela

Registro de los pagos recibidos y realizados, con referencia de 4 números, foto del
comprobante y saldo por moneda. Funciona como PWA en el celular.

## Configuración

1. **Supabase**: en SQL Editor pega `supabase.sql` y pulsa **Run**. En Storage crea el
   bucket `foto` si no existe.
2. **Vercel** → Settings → Environment Variables:
   - `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` (clave **service_role**).
   - `APP_PIN` — el PIN para entrar. **Es obligatorio**: sin él la app no deja entrar.
     Usa uno de 6 números o más.
3. Redeploy para que tome las variables.

## Cómo funciona

- `index.html`: la app. Cada pago se guarda primero en el celular (IndexedDB) y luego se
  sube; si no hay internet queda "por subir" y se envía solo cuando vuelve la conexión.
  Cada pago lleva un código único, así que reintentar nunca lo duplica.
- `api/pagar.js`: guarda un pago (y su foto en Storage).
- `api/pagos.js`: lista todos los pagos con sus totales, y borra un pago.
- `api/_lib.js`: verificación del PIN (header `X-Pin`) con bloqueo de 15 minutos por IP
  tras 5 intentos fallidos.
