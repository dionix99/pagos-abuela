// Helpers compartidos por las funciones de api/ (Vercel no publica archivos que empiezan con "_").
import { createHash, timingSafeEqual } from 'node:crypto';

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_PIN = process.env.APP_PIN;

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

export function sbHeaders(extra) {
  return Object.assign(
    { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    extra || {}
  );
}

function ipDe(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || String(req.headers['x-real-ip'] || '') || 'desconocida';
}

function mismoPin(a, b) {
  // Se comparan hashes para que la comparación no dependa del largo del PIN.
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

// Registro de intentos fallidos por IP en la tabla intentos_pin (ver supabase.sql).
// Si la tabla no existe, el PIN se sigue verificando pero sin bloqueo.
async function leerIntentos(ip) {
  try {
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/intentos_pin?ip=eq.' + encodeURIComponent(ip) + '&select=fallidos,bloqueado_hasta',
      { headers: sbHeaders() }
    );
    if (!r.ok) return null;
    const arr = await r.json();
    return (Array.isArray(arr) && arr[0]) || { fallidos: 0, bloqueado_hasta: null };
  } catch (e) { return null; }
}

async function guardarIntentos(ip, fila) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/intentos_pin?on_conflict=ip', {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(Object.assign({ ip }, fila)),
    });
  } catch (e) {}
}

async function borrarIntentos(ip) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/intentos_pin?ip=eq.' + encodeURIComponent(ip), {
      method: 'DELETE',
      headers: sbHeaders({ Prefer: 'return=minimal' }),
    });
  } catch (e) {}
}

// Verifica configuración y PIN (solo por el header X-Pin). Si algo falla, responde
// y devuelve false; si todo está bien, devuelve true.
export async function autorizar(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ ok: false, error: 'falta configurar Supabase' });
    return false;
  }
  if (!APP_PIN) {
    res.status(500).json({ ok: false, error: 'falta configurar APP_PIN en Vercel' });
    return false;
  }

  const ip = ipDe(req);
  const reg = await leerIntentos(ip);
  if (reg && reg.bloqueado_hasta && new Date(reg.bloqueado_hasta).getTime() > Date.now()) {
    const min = Math.ceil((new Date(reg.bloqueado_hasta).getTime() - Date.now()) / 60000);
    res.status(429).json({ ok: false, error: 'Demasiados intentos. Espera ' + min + ' minuto' + (min === 1 ? '' : 's') });
    return false;
  }

  if (!mismoPin(req.headers['x-pin'] || '', APP_PIN)) {
    if (reg) {
      const fallidos = (Number(reg.fallidos) || 0) + 1;
      if (fallidos >= MAX_INTENTOS) {
        await guardarIntentos(ip, {
          fallidos: 0,
          bloqueado_hasta: new Date(Date.now() + MINUTOS_BLOQUEO * 60000).toISOString(),
        });
      } else {
        await guardarIntentos(ip, { fallidos, bloqueado_hasta: null });
      }
    }
    res.status(401).json({ ok: false, error: 'PIN incorrecto' });
    return false;
  }

  if (reg && (reg.fallidos || reg.bloqueado_hasta)) await borrarIntentos(ip);
  return true;
}
