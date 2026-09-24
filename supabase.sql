-- ================================================================
-- STREAM PREMIUM23 · Configuración de Supabase
-- Pega este script completo en: Dashboard → SQL Editor → New query → Run
-- Es RE-EJECUTABLE (no da error si ya correste antes).
-- Luego crea tu usuario admin en Dashboard → Authentication → Users → Add user
-- ================================================================

-- 1) Extensión para generar UUIDs
create extension if not exists pgcrypto;

-- 2) Tabla de cuentas (productos)
create table if not exists public.stream_accounts (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text not null default 'netflix',
  descripcion text default '',
  stock integer default 1,
  precio integer,
  garantia text default '',
  foto_url text default '',
  etiqueta text default '',
  orden integer default 0,
  activo boolean default true,
  descuento_porcentaje numeric default 0,
  etiqueta_promo text default '',
  promo_inicio date,
  promo_fin date,
  created_at timestamptz default now()
);

-- Índice de orden (la tienda ordena por esto)
create index if not exists stream_accounts_orden_idx on public.stream_accounts (orden, created_at);

-- 3) Seguridad: RLS
alter table public.stream_accounts enable row level security;

-- Lectura pública: cualquiera puede ver las cuentas (la tienda)
drop policy if exists "stream_accounts_lectura_publica" on public.stream_accounts;
create policy "stream_accounts_lectura_publica"
  on public.stream_accounts for select
  using (true);

-- Solo el admin autenticado puede crear
drop policy if exists "stream_accounts_admin_insert" on public.stream_accounts;
create policy "stream_accounts_admin_insert"
  on public.stream_accounts for insert
  with check (auth.role() = 'authenticated');

-- Solo el admin autenticado puede editar
drop policy if exists "stream_accounts_admin_update" on public.stream_accounts;
create policy "stream_accounts_admin_update"
  on public.stream_accounts for update
  using (auth.role() = 'authenticated');

-- Solo el admin autenticado puede eliminar
drop policy if exists "stream_accounts_admin_delete" on public.stream_accounts;
create policy "stream_accounts_admin_delete"
  on public.stream_accounts for delete
  using (auth.role() = 'authenticated');

-- 4) Storage: bucket público para las fotos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cuentas', 'cuentas', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Fotos: todos pueden verlas
drop policy if exists "storage_cuentas_lectura" on storage.objects;
create policy "storage_cuentas_lectura"
  on storage.objects for select
  using (bucket_id = 'cuentas');

-- Fotos: solo el admin autenticado puede subir
drop policy if exists "storage_cuentas_insert" on storage.objects;
create policy "storage_cuentas_insert"
  on storage.objects for insert
  with check (bucket_id = 'cuentas' and auth.role() = 'authenticated');

-- Fotos: solo el admin autenticado puede modificar
drop policy if exists "storage_cuentas_update" on storage.objects;
create policy "storage_cuentas_update"
  on storage.objects for update
  using (bucket_id = 'cuentas' and auth.role() = 'authenticated');

-- Fotos: solo el admin autenticado puede eliminar
drop policy if exists "storage_cuentas_delete" on storage.objects;
create policy "storage_cuentas_delete"
  on storage.objects for delete
  using (bucket_id = 'cuentas' and auth.role() = 'authenticated');

-- ================================================================
-- 5) PEDIDOS (solicitudes recibidas desde la tienda)
-- ================================================================

-- Tabla de pedidos
create table if not exists public.solicitudes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('pedido')),
  nombre text not null,
  whatsapp text default '',
  correo text default '',
  detalles jsonb default '{}'::jsonb,
  mensaje_wa text default '',
  estado text default 'nueva' check (estado in ('nueva','vista','atendida','cerrada')),
  created_at timestamptz default now()
);

-- Índice para listar por estado y fecha
create index if not exists solicitudes_idx on public.solicitudes (estado, created_at desc);

-- Seguridad: RLS
alter table public.solicitudes enable row level security;

-- INSERT público: los clientes de la tienda envían su pedido
-- (solo puede crearse como 'nueva' y con tipo 'pedido')
drop policy if exists "solicitudes_insert_publico" on public.solicitudes;
create policy "solicitudes_insert_publico"
  on public.solicitudes for insert
  with check (tipo = 'pedido' and estado = 'nueva' and nombre <> '');

-- SELECT: solo el admin autenticado
drop policy if exists "solicitudes_admin_select" on public.solicitudes;
create policy "solicitudes_admin_select"
  on public.solicitudes for select
  using (auth.role() = 'authenticated');

-- UPDATE: solo el admin autenticado (para cambiar el estado)
drop policy if exists "solicitudes_admin_update" on public.solicitudes;
create policy "solicitudes_admin_update"
  on public.solicitudes for update
  using (auth.role() = 'authenticated');

-- DELETE: solo el admin autenticado
drop policy if exists "solicitudes_admin_delete" on public.solicitudes;
create policy "solicitudes_admin_delete"
  on public.solicitudes for delete
  using (auth.role() = 'authenticated');

-- 6) CONTROL DE SPAM (refuerzo a nivel de base de datos)
-- Rechaza solicitudes con datos sospechosos o ráfagas de bots.
create or replace function public.solicitudes_anti_spam()
returns trigger
language plpgsql
as $$
begin
  -- Toda solicitud real de la tienda genera su mensaje de WhatsApp
  if new.mensaje_wa is null or length(trim(new.mensaje_wa)) < 20 then
    raise exception 'Solicitud no válida';
  end if;
  -- Nombre mínimo y sin HTML/URLs
  if new.nombre is null or length(trim(new.nombre)) < 2 then
    raise exception 'Nombre no válido';
  end if;
  if position('<' in new.nombre) > 0 or position('http' in lower(new.nombre)) > 0 then
    raise exception 'Nombre no válido';
  end if;
  -- Límite de ráfaga: máximo 12 solicitudes en la última hora
  if (select count(*) from public.solicitudes where created_at > now() - interval '1 hour') >= 12 then
    raise exception 'Demasiadas solicitudes en poco tiempo';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_solicitudes_anti_spam on public.solicitudes;
create trigger trg_solicitudes_anti_spam
  before insert on public.solicitudes
  for each row execute function public.solicitudes_anti_spam();

-- ================================================================
-- Siguiente paso manual:
--   Authentication → Users → Add user (email + contraseña del admin)
-- Luego entra a tuweb.com/admin.html y sube tus cuentas y fotos.
-- ================================================================