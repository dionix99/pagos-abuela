import { SUPABASE_URL, sbHeaders, autorizar } from './_lib.js';

const PAGINA = 1000;

// Supabase devuelve como máximo 1000 filas por consulta: se piden por páginas
// para que los totales incluyan todos los pagos.
async function todosLosPagos() {
  const pagos = [];
  for (let desde = 0; ; desde += PAGINA) {
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/pagos?select=*&order=creado.desc,id.desc',
      { headers: sbHeaders({ 'Range-Unit': 'items', Range: desde + '-' + (desde + PAGINA - 1) }) }
    );
    if (!r.ok) throw new Error('consulta HTTP ' + r.status);
    const pagina = await r.json();
    if (!Array.isArray(pagina)) break;
    pagos.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return pagos;
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

  if (!(await autorizar(req, res))) return;

  try {
    if (req.method === 'GET') {
      const pagos = await todosLosPagos();
      const monedas = [...new Set(pagos.map((p) => p.moneda))];
      const totales = monedas.map((m) => calcularTotales(pagos, m));
      res.status(200).json({ ok: true, pagos, totales });
      return;
    }

    if (req.method === 'DELETE') {
      const qs = req.url.split('?')[1] || '';
      const m = qs.match(/(?:^|&)id=([^&]+)/);
      let id = '';
      try { id = m ? decodeURIComponent(m[1]) : ''; } catch (e) {}
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
