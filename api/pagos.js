const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_PIN = process.env.APP_PIN || '0505';
const BUCKET = 'foto';

function pinOk(req) {
  const header = req.headers['x-pin'] || '';
  const qs = req.url.split('?')[1] || '';
  const m = qs.match(/(?:^|&)pin=([^&]+)/);
  const qpin = m ? decodeURIComponent(m[1]) : '';
  return String(header) === String(APP_PIN) || String(qpin) === String(APP_PIN);
}

function sbHeaders(extra) {
  return Object.assign(
    { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    extra || {}
  );
}

function round2(x) { return Math.round(x * 100) / 100; }

function calcularTotales(pagos, moneda) {
  let recibido = 0, dado = 0, n = 0;
  for (const p of pagos) {
    if (p.moneda !== moneda) continue;
    n++;
    if (p.direccion === 'recibido') recibido += Number(p.monto) || 0;
    else dado += Number(p.monto) || 0;
  }
  return {
    moneda,
    recibido: round2(recibido),
    dado: round2(dado),
    saldo: round2(recibido - dado),
    pagos: n,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!pinOk(req)) {
    res.status(401).json({ ok: false, error: 'PIN incorrecto' });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ ok: false, error: 'falta configurar Supabase' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const r = await fetch(
        SUPABASE_URL + '/rest/v1/pagos?select=*&order=creado.desc',
        { headers: sbHeaders() }
      );
      if (!r.ok) throw new Error('consulta HTTP ' + r.status);
      const pagos = await r.json();
      const monedas = [...new Set(pagos.map((p) => p.moneda))];
      const totales = monedas.map((m) => calcularTotales(pagos, m));
      res.status(200).json({ ok: true, pagos, totales });
      return;
    }

    if (req.method === 'DELETE') {
      const qs = req.url.split('?')[1] || '';
      const m = qs.match(/(?:^|&)id=([^&]+)/);
      const id = m ? decodeURIComponent(m[1]) : '';
      if (!id) { res.status(400).json({ ok: false, error: 'falta id' }); return; }

      const g = await fetch(
        SUPABASE_URL + '/rest/v1/pagos?id=eq.' + encodeURIComponent(id) + '&select=foto',
        { headers: sbHeaders() }
      );
      const arr = g.ok ? await g.json() : [];
      const foto = arr && arr[0] && arr[0].foto ? arr[0].foto : null;

      const d = await fetch(
        SUPABASE_URL + '/rest/v1/pagos?id=eq.' + encodeURIComponent(id),
        { method: 'DELETE', headers: sbHeaders({ Prefer: 'return=minimal' }) }
      );
      if (!d.ok) throw new Error('borrado HTTP ' + d.status);

      if (foto) {
        const mm = String(foto).match(/\/object\/public\/([^/]+)\/(.+)$/);
        if (mm) {
          try {
            await fetch(
              SUPABASE_URL + '/storage/v1/object/' + mm[1] + '/' + mm[2],
              { method: 'DELETE', headers: sbHeaders() }
            );
          } catch (e) { /* la foto pudo no existir */ }
        }
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: 'método no permitido' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
