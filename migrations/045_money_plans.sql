-- Módulo money · catálogo de planes (pantalla 32). No hay compra: Premium Conductor es «Propuesta» y Membresía «no disponible».
-- Los textos son los de la lámina aprobada; el estado cambia solo con una decisión de producto aprobada.

create table plans(
  code text primary key check (code in ('free','premium_driver','membership')),
  position integer not null unique,
  name text not null,
  tagline text not null,
  status text not null check (status in ('active','proposal','unavailable')),
  features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  economics_title text,
  economics_detail text,
  availability_note text,
  -- NULL = «Por definir».
  price_cents integer check (price_cents is null or price_cents >= 0),
  updated_at timestamptz not null default now()
);

insert into plans(code, position, name, tagline, status, features, economics_title, economics_detail, availability_note, price_cents) values
  ('free', 1, 'Cuenta gratuita', 'Uso ocasional', 'active',
   '["Buscar y reservar plazas","Guardar destinos y rutina","Mensajería con otros usuarios","Gestionar tus viajes básicos"]'::jsonb,
   null, null, null, 0),
  ('premium_driver', 2, 'Premium Conductor', 'Para rutas regulares', 'proposal',
   '["Gestionar tus plazas semanales","Visibilidad en rutas frecuentes","Historial de viajes y pasajeros","Liquidación mensual de trayectos","Soporte prioritario"]'::jsonb,
   'Cuota y comisiones por definir', 'Propuesta en fase de estudio.', null, null),
  ('membership', 3, 'Membresía', 'Próximamente', 'unavailable',
   '[]'::jsonb,
   null, null, 'Más opciones y ventajas para usuarios frecuentes. Esta funcionalidad no está disponible por el momento.', null);
