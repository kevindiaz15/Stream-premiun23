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
  metodo_pago text default '',
  comprobante_url text default '',
  codigo text,
  stock_descontado boolean not null default false,
  fecha_cierre timestamptz,
  fecha_garantia timestamptz,
  estado text default 'nueva' constraint solicitudes_estado_check check (estado in ('nueva','vista','atendida','garantia','cerrada')),
  created_at timestamptz default now()
);

-- Columnas nuevas de esta versión (seguro si la tabla ya existía de antes)
alter table public.solicitudes add column if not exists metodo_pago text default '';
alter table public.solicitudes add column if not exists comprobante_url text default '';
alter table public.solicitudes add column if not exists codigo text;
alter table public.solicitudes add column if not exists stock_descontado boolean not null default false;
alter table public.solicitudes add column if not exists fecha_cierre timestamptz;
alter table public.solicitudes add column if not exists fecha_garantia timestamptz;

-- Estado ampliado con 'garantia' (reemplaza el constraint viejo si existía)
alter table public.solicitudes drop constraint if exists solicitudes_estado_check;
alter table public.solicitudes add constraint solicitudes_estado_check check (estado in ('nueva','vista','atendida','garantia','cerrada'));

-- Código de compra único (para seguimiento y garantías)
create unique index if not exists solicitudes_codigo_uidx on public.solicitudes (codigo) where codigo is not null;

-- Índice para listar por estado y fecha
create index if not exists solicitudes_idx on public.solicitudes (estado, created_at desc);

-- Índice para filtrar pedidos por método de pago
create index if not exists solicitudes_metodo_idx on public.solicitudes (metodo_pago);

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

-- 6.5) CÓDIGO DE COMPRA (SP-XXXXXX), STOCK Y CONSULTA

-- Asigna automáticamente un código único a cada pedido al crearlo
create or replace function public.solicitudes_generar_codigo()
returns trigger
language plpgsql
as $$
declare c text;
begin
  if new.codigo is null or trim(new.codigo) = '' then
    loop
      c := 'SP-' || lpad((floor(random()*900000)+100000)::int::text, 6, '0');
      exit when not exists (select 1 from public.solicitudes where codigo = c);
    end loop;
    new.codigo := c;
  else
    new.codigo := upper(trim(new.codigo));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_solicitudes_codigo on public.solicitudes;
create trigger trg_solicitudes_codigo
  before insert on public.solicitudes
  for each row execute function public.solicitudes_generar_codigo();

-- Cierra la venta: descuenta stock UNA sola vez y la marca atendida.
-- Solo puede ejecutarla el admin autenticado.
create or replace function public.cerrar_venta(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.solicitudes%rowtype;
  it jsonb;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado';
  end if;

  select * into s from public.solicitudes where id = p_id;
  if not found then
    raise exception 'Pedido no encontrado';
  end if;

  if s.stock_descontado then
    return false;
  end if;

  -- Descuenta stock por cada cuenta vendida
  for it in select value from jsonb_array_elements(coalesce(s.detalles -> 'items', '[]'::jsonb)) loop
    if (it ->> 'id') is not null and (it ->> 'cantidad') is not null then
      update public.stream_accounts
         set stock = greatest(coalesce(stock, 0) - (it ->> 'cantidad')::int, 0)
       where id = (it ->> 'id')::uuid;
    end if;
  end loop;

  update public.solicitudes
     set estado = 'atendida',
         fecha_cierre = coalesce(s.fecha_cierre, now()),
         stock_descontado = true
   where id = p_id;

  return true;
end;
$$;

revoke all on function public.cerrar_venta(uuid) from public;
grant execute on function public.cerrar_venta(uuid) to authenticated;

-- Consulta pública de estado por código (NO expone contacto ni comprobante)
create or replace function public.consultar_pedido(p_codigo text)
returns table (
  codigo text,
  estado text,
  creado timestamptz,
  fecha_cierre timestamptz,
  fecha_garantia timestamptz,
  metodo_pago text,
  total integer,
  items jsonb,
  stock_descontado boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_codigo is null or trim(p_codigo) = '' then
    return;
  end if;
  return query
    select s.codigo, s.estado, s.created_at, s.fecha_cierre, s.fecha_garantia,
           s.metodo_pago, (s.detalles ->> 'total')::int, s.detalles -> 'items',
           s.stock_descontado
    from public.solicitudes s
    where s.codigo = upper(trim(p_codigo));
end;
$$;

grant execute on function public.consultar_pedido(text) to anon, authenticated;

-- Crea un pedido desde la tienda y DEVUELVE la fila completa (incluye el
-- código de seguimiento generado por el trigger).
-- Se usa security definer para que el cliente anon pueda recibir el codigo
-- sin depender de la política de SELECT de solicitudes (que es solo admin).
create or replace function public.crear_pedido(
  p_nombre text,
  p_whatsapp text default '',
  p_correo text default '',
  p_detalles jsonb default '{}'::jsonb,
  p_mensaje_wa text default '',
  p_metodo_pago text default '',
  p_comprobante_url text default ''
)
returns public.solicitudes
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.solicitudes;
begin
  insert into public.solicitudes
    (tipo, nombre, whatsapp, correo, detalles, mensaje_wa, metodo_pago, comprobante_url, estado)
  values
    ('pedido',
     p_nombre,
     coalesce(p_whatsapp, ''),
     coalesce(p_correo, ''),
     coalesce(p_detalles, '{}'::jsonb),
     coalesce(p_mensaje_wa, ''),
     coalesce(p_metodo_pago, ''),
     coalesce(p_comprobante_url, ''),
     'nueva')
  returning * into r;

  return r;
end;
$$;

revoke all on function public.crear_pedido(text, text, text, jsonb, text, text, text) from public;
grant execute on function public.crear_pedido(text, text, text, jsonb, text, text, text) to anon, authenticated;

-- Backfill: asigna código a pedidos creados antes de esta versión
do $$
declare r record;
declare c text;
begin
  for r in select id from public.solicitudes where codigo is null or trim(codigo) = '' loop
    loop
      c := 'SP-' || lpad((floor(random()*900000)+100000)::int::text, 6, '0');
      exit when not exists (select 1 from public.solicitudes where codigo = c);
    end loop;
    update public.solicitudes set codigo = c where id = r.id;
  end loop;
end $$;

-- ================================================================
-- 7) BANNERS PUBLICITARIOS (carrusel de la parte superior)
-- ================================================================

-- Tabla de banners
create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  titulo text default '',
  subtitulo text default '',
  imagen_url text default '',
  enlace text default '',
  orden integer default 0,
  activo boolean default true,
  created_at timestamptz default now()
);

-- Índice de orden (el carrusel de la tienda ordena por esto)
create index if not exists banners_orden_idx on public.banners (orden, created_at);

-- Seguridad: RLS
alter table public.banners enable row level security;

-- Lectura pública: cualquiera puede ver los banners (la tienda)
drop policy if exists "banners_lectura_publica" on public.banners;
create policy "banners_lectura_publica"
  on public.banners for select
  using (true);

-- Solo el admin autenticado puede crear banners
drop policy if exists "banners_admin_insert" on public.banners;
create policy "banners_admin_insert"
  on public.banners for insert
  with check (auth.role() = 'authenticated');

-- Solo el admin autenticado puede editar banners
drop policy if exists "banners_admin_update" on public.banners;
create policy "banners_admin_update"
  on public.banners for update
  using (auth.role() = 'authenticated');

-- Solo el admin autenticado puede eliminar banners
drop policy if exists "banners_admin_delete" on public.banners;
create policy "banners_admin_delete"
  on public.banners for delete
  using (auth.role() = 'authenticated');

-- 8) Storage: bucket público para imágenes de banners (solo admin sube)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

drop policy if exists "storage_banners_lectura" on storage.objects;
create policy "storage_banners_lectura"
  on storage.objects for select
  using (bucket_id = 'banners');

drop policy if exists "storage_banners_insert" on storage.objects;
create policy "storage_banners_insert"
  on storage.objects for insert
  with check (bucket_id = 'banners' and auth.role() = 'authenticated');

drop policy if exists "storage_banners_update" on storage.objects;
create policy "storage_banners_update"
  on storage.objects for update
  using (bucket_id = 'banners' and auth.role() = 'authenticated');

drop policy if exists "storage_banners_delete" on storage.objects;
create policy "storage_banners_delete"
  on storage.objects for delete
  using (bucket_id = 'banners' and auth.role() = 'authenticated');

-- 9) Storage: bucket público para comprobantes de pago
-- Cualquier cliente puede SUBIR su captura (el insert es público y anónimo),
-- pero solo el admin autenticado puede borrarlas (evita spam de eliminación).
-- Los archivos se suben con nombre UUID (no adivinable).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Lectura pública: necesaria para mostrar el comprobante en la tienda y en el admin
drop policy if exists "storage_comprobantes_lectura" on storage.objects;
create policy "storage_comprobantes_lectura"
  on storage.objects for select
  using (bucket_id = 'comprobantes');

-- Insert público y anónimo: el cliente sube su captura de pago en el formulario
drop policy if exists "storage_comprobantes_insert_publico" on storage.objects;
create policy "storage_comprobantes_insert_publico"
  on storage.objects for insert
  with check (bucket_id = 'comprobantes');

-- Solo el admin autenticado puede modificar/eliminar comprobantes
drop policy if exists "storage_comprobantes_update" on storage.objects;
create policy "storage_comprobantes_update"
  on storage.objects for update
  using (bucket_id = 'comprobantes' and auth.role() = 'authenticated');

drop policy if exists "storage_comprobantes_delete" on storage.objects;
create policy "storage_comprobantes_delete"
  on storage.objects for delete
  using (bucket_id = 'comprobantes' and auth.role() = 'authenticated');

-- ================================================================
-- Siguiente paso manual:
--   Authentication → Users → Add user (email + contraseña del admin)
-- Luego entra a tuweb.com/admin.html y sube tus cuentas y fotos.
-- ================================================================