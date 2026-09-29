-- Tablas de la app Pagos Abuela en Supabase.
-- Pégalo en Supabase → SQL Editor → Run. Se puede correr varias veces sin romper nada.

create table if not exists pagos (
  id         text primary key,          -- uid generado en el celular (evita duplicados)
  direccion  text not null check (direccion in ('recibido', 'dado')),
  monto      numeric not null check (monto > 0),
  moneda     text not null,
  referencia text not null,
  fecha      date,
  hora       text,
  nota       text,
  foto       text,
  creado     timestamptz not null default now()
);

-- Intentos fallidos de PIN por IP: tras 5 PIN incorrectos esa IP queda bloqueada 15 minutos.
create table if not exists intentos_pin (
  ip              text primary key,
  fallidos        integer not null default 0,
  bloqueado_hasta timestamptz
);

-- Solo las funciones de api/ (con la service key) pueden leer y escribir.
alter table pagos enable row level security;
alter table intentos_pin enable row level security;

-- Las fotos van en el bucket de Storage "foto" (Storage → New bucket → nombre: foto).
