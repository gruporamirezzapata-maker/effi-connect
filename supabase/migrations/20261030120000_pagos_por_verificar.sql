-- 💸 Pagos por verificar: pedidos que Shopify marca como "pagado" (checkout con Bold) pero cuya plata puede no haber
-- llegado todavía. n8n los registra aquí y NO despacha nada sin recaudo hasta que el dueño o un socio confirme en el
-- panel que la plata llegó. "No ha llegado" deja el pedido frenado. Solo los ven y deciden el dueño y los socios.
-- Idempotente: se puede correr de nuevo sin romper nada.

create table if not exists public.pagos_por_verificar (
  cuenta text not null default 'GRUPO_RZ_CO',
  sucursal integer not null,
  orden_id integer not null,
  orden text not null,
  pedido text,
  tienda text,
  cliente text,
  telefono text,
  ciudad text,
  total numeric not null default 0,
  pasarela text,
  estado_shopify text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'llego', 'no_llego')),
  nota text,
  decidido_por text,
  decidido_en timestamptz,
  creado timestamptz not null default now(),
  primary key (cuenta, sucursal, orden_id)
);
create index if not exists pagos_por_verificar_estado on public.pagos_por_verificar (estado, creado desc);
alter table public.pagos_por_verificar enable row level security;
drop policy if exists pagos_por_verificar_leer on public.pagos_por_verificar;
create policy pagos_por_verificar_leer on public.pagos_por_verificar for select to authenticated using (
  exists (select 1 from public.app_usuarios u where u.user_id = (select auth.uid()) and u.activo and u.rol in ('owner', 'socio')));
revoke insert, update, delete on public.pagos_por_verificar from anon, authenticated;

-- n8n (service_role) registra los pedidos pagados. Si ya existe, actualiza los datos del pedido pero nunca la decisión.
create or replace function public.pago_registrar(p_filas jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.pagos_por_verificar (cuenta, sucursal, orden_id, orden, pedido, tienda, cliente, telefono, ciudad, total, pasarela, estado_shopify)
  select coalesce(r.cuenta, 'GRUPO_RZ_CO'), r.sucursal, r.orden_id, r.orden, r.pedido, r.tienda, r.cliente, r.telefono, r.ciudad,
    coalesce(r.total, 0), r.pasarela, r.estado_shopify
  from jsonb_to_recordset(p_filas) as r(cuenta text, sucursal integer, orden_id integer, orden text, pedido text, tienda text,
    cliente text, telefono text, ciudad text, total numeric, pasarela text, estado_shopify text)
  where r.sucursal is not null and r.orden_id is not null and r.orden is not null
  on conflict (cuenta, sucursal, orden_id) do update set orden = excluded.orden, pedido = excluded.pedido, tienda = excluded.tienda,
    cliente = excluded.cliente, telefono = excluded.telefono, ciudad = excluded.ciudad, total = excluded.total,
    pasarela = excluded.pasarela, estado_shopify = excluded.estado_shopify;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.pago_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.pago_registrar(jsonb) to service_role;

-- El panel: el dueño o un socio decide. 'pendiente' deshace una decisión.
create or replace function public.pago_decidir(p_sucursal integer, p_orden_id integer, p_estado text, p_nota text default null,
  p_cuenta text default 'GRUPO_RZ_CO') returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  select u.email into v_email from public.app_usuarios u
    where u.user_id = (select auth.uid()) and u.activo and u.rol in ('owner', 'socio');
  if v_email is null then raise exception 'Solo el dueño y los socios pueden confirmar pagos'; end if;
  if p_estado not in ('pendiente', 'llego', 'no_llego') then raise exception 'Estado no válido'; end if;
  update public.pagos_por_verificar set estado = p_estado, nota = nullif(trim(coalesce(p_nota, '')), ''),
    decidido_por = case when p_estado = 'pendiente' then null else v_email end,
    decidido_en = case when p_estado = 'pendiente' then null else now() end
  where cuenta = p_cuenta and sucursal = p_sucursal and orden_id = p_orden_id;
  if not found then raise exception 'Pedido no encontrado'; end if;
end $$;
revoke all on function public.pago_decidir(integer, integer, text, text, text) from public, anon;
grant execute on function public.pago_decidir(integer, integer, text, text, text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261030120000', 'pagos_por_verificar') on conflict do nothing;
select to_regclass('public.pagos_por_verificar')::text as tabla,
  (select count(*) from pg_proc where proname in ('pago_registrar', 'pago_decidir')) as funciones;
