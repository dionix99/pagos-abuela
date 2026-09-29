import { randomBytes } from 'node:crypto';

import { SUPABASE_URL, sbHeaders, autorizar } from './_lib.js';

const BUCKET = 'foto';

function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function subirFoto(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(jpeg|png|webp);base64,(.+)$/i);
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const nombre = randomBytes(8).toString('hex') + '.' + ext;
  const buf = Buffer.from(m[2], 'base64');
  const ct = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;

  const r = await fetch(
    SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + nombre,
    { method: 'POST', headers: sbHeaders({ 'Content-Type': ct, 'x-upsert': 'true' }), body: buf }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error('storage HTTP ' + r.status + ' ' + t.slice(0, 150));
  }
  return SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + nombre;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'método no permitido' }); return; }

  if (!(await autorizar(req, res))) return;

  let datos;
  try { datos = await leerCuerpo(req); }
  catch (e) { res.status(400).json({ ok: false, error: 'JSON inválido o excede el tamaño' }); return; }

  if (!['recibido', 'dado'].includes(datos.direccion)) {
    res.status(400).json({ ok: false, error: 'direccion inválida' }); return;
  }
  const monto = Number(datos.monto);
  if (!(monto > 0)) { res.status(400).json({ ok: false, error: 'monto inválido' }); return; }
  if (!/^\d{4}$/.test(String(datos.referencia || '').trim())) {
    res.status(400).json({ ok: false, error: 'referencia debe ser de 4 números' }); return;
  }
  if (!['Bs', 'USD', 'COP', 'EUR'].includes(datos.moneda)) {
    res.status(400).json({ ok: false, error: 'moneda inválida' }); return;
  }

  const uid = String(datos.uid || '').trim();
  const id = /^[A-Za-z0-9_-]{6,64}$/.test(uid)
    ? uid
    : Date.now().toString(36) + '-' + randomBytes(3).toString('hex');

  try {
    const ex = await fetch(
      SUPABASE_URL + '/rest/v1/pagos?id=eq.' + encodeURIComponent(id) + '&select=id',
      { headers: sbHeaders() }
    );
    if (ex.ok) {
      const arr = await ex.json();
      if (Array.isArray(arr) && arr.length) {
        res.status(200).json({ ok: true, id, duplicado: true });
        return;
      }
    }

    let foto = null;
    if (datos.foto) {
      foto = await subirFoto(datos.foto);
      if (!foto) { res.status(400).json({ ok: false, error: 'foto no válida' }); return; }
    }

    const fila = {
      id,
      direccion: datos.direccion,
      monto,
      moneda: datos.moneda,
      referencia: String(datos.referencia).trim(),
      fecha: String(datos.fecha || '').slice(0, 10) || null,
      hora: String(datos.hora || '').slice(0, 5),
      nota: String(datos.nota || '').slice(0, 200),
      foto,
      creado: new Date().toISOString(),
    };

    const r = await fetch(
      SUPABASE_URL + '/rest/v1/pagos',
      {
        method: 'POST',
        headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify(fila),
      }
    );
    if (r.status === 409) {
      // Otro envío del mismo pago (mismo uid) llegó primero: ya está guardado.
      res.status(200).json({ ok: true, id, duplicado: true });
      return;
    }
    if (!r.ok) {
      const t = await r.text();
      throw new Error('guardado HTTP ' + r.status + ' ' + t.slice(0, 150));
    }
    res.status(200).json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
