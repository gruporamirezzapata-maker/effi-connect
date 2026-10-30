-- 💸 Pagos por verificar: todos los datos para cruzar el pago con Bold o el banco antes de aceptarlo —
-- fecha y hora exacta del pedido, productos, dirección, documento de la clienta y referencia del pedido. Idempotente.

alter table public.pagos_por_verificar
  add column if not exists fecha_pedido timestamptz,
  add column if not exists productos text,
  add column if not exists direccion text,
  add column if not exists documento text,
  add column if not exists referencia text;

create or replace function public.pago_registrar(p_filas jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.pagos_por_verificar (cuenta, sucursal, orden_id, orden, pedido, tienda, cliente, telefono, ciudad, total, pasarela,
    estado_shopify, fecha_pedido, productos, direccion, documento, referencia)
  select coalesce(r.cuenta, 'GRUPO_RZ_CO'), r.sucursal, r.orden_id, r.orden, r.pedido, r.tienda, r.cliente, r.telefono, r.ciudad,
    coalesce(r.total, 0), r.pasarela, r.estado_shopify, r.fecha_pedido, r.productos, r.direccion, r.documento, r.referencia
  from jsonb_to_recordset(p_filas) as r(cuenta text, sucursal integer, orden_id integer, orden text, pedido text, tienda text,
    cliente text, telefono text, ciudad text, total numeric, pasarela text, estado_shopify text, fecha_pedido timestamptz,
    productos text, direccion text, documento text, referencia text)
  where r.sucursal is not null and r.orden_id is not null and r.orden is not null
  on conflict (cuenta, sucursal, orden_id) do update set orden = excluded.orden, pedido = excluded.pedido, tienda = excluded.tienda,
    cliente = excluded.cliente, telefono = excluded.telefono, ciudad = excluded.ciudad, total = excluded.total,
    pasarela = excluded.pasarela, estado_shopify = excluded.estado_shopify,
    fecha_pedido = coalesce(excluded.fecha_pedido, public.pagos_por_verificar.fecha_pedido),
    productos = coalesce(excluded.productos, public.pagos_por_verificar.productos),
    direccion = coalesce(excluded.direccion, public.pagos_por_verificar.direccion),
    documento = coalesce(excluded.documento, public.pagos_por_verificar.documento),
    referencia = coalesce(excluded.referencia, public.pagos_por_verificar.referencia);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.pago_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.pago_registrar(jsonb) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261030140000', 'pagos_datos_completos') on conflict do nothing;
select count(*) filter (where column_name in ('fecha_pedido', 'productos', 'direccion', 'documento', 'referencia')) as columnas_nuevas
from information_schema.columns where table_schema = 'public' and table_name = 'pagos_por_verificar';
