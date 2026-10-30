-- 💳 Bold confirma pagos solo: Bold avisa cada venta aprobada (webhook) y aquí se cruza con los pedidos de
-- "Pagos por verificar". Si el pago es de UN solo pedido posible, se marca "Llegó la plata" automáticamente.
-- Si hay duda (dos pedidos del mismo valor, o ninguno), el pedido sigue esperando a Cristian en el panel.
-- La firma de Bold se verifica aquí con la llave secreta guardada en el Vault de Supabase (nunca pasa por n8n).
-- Idempotente.

create table if not exists public.bold_pagos (
  payment_id text not null,
  tipo text not null,
  valor numeric,
  fecha timestamptz,
  referencia text,
  medio text,
  integracion text,
  email text,
  prueba boolean not null default false,
  orden text,
  sucursal integer,
  orden_id integer,
  payload jsonb not null,
  recibido timestamptz not null default now(),
  primary key (payment_id, tipo)
);
create index if not exists bold_pagos_sin_cruzar on public.bold_pagos (fecha) where orden is null;
alter table public.bold_pagos enable row level security;
drop policy if exists bold_pagos_leer on public.bold_pagos;
create policy bold_pagos_leer on public.bold_pagos for select to authenticated using (
  exists (select 1 from public.app_usuarios u where u.user_id = (select auth.uid()) and u.activo and u.rol in ('owner', 'socio')));
revoke insert, update, delete on public.bold_pagos from anon, authenticated;

-- Cruce: 1) por referencia (pedido, orden o id de Shopify/Lucid) y mismo valor; 2) si no, por valor exacto y hora
-- (±3 h del pedido), solo si hay UN pedido pendiente posible y UN pago de Bold sin cruzar con ese valor cerca.
create or replace function public.pagos_cruzar_bold() returns integer
language plpgsql security definer set search_path = '' as $$
declare b record; v_p record; v_n integer := 0; v_cand integer; v_rivales integer;
begin
  for b in select * from public.bold_pagos where tipo = 'SALE_APPROVED' and not prueba and orden is null
             and fecha > now() - interval '4 days' order by fecha loop
    select count(*) into v_cand from public.pagos_por_verificar p
      where p.estado = 'pendiente' and coalesce(length(b.referencia), 0) >= 4 and abs(p.total - b.valor) <= 1
        and b.referencia in (p.referencia, p.pedido, p.orden, ltrim(coalesce(p.pedido, ''), '#'));
    if v_cand = 1 then
      select * into v_p from public.pagos_por_verificar p
        where p.estado = 'pendiente' and coalesce(length(b.referencia), 0) >= 4 and abs(p.total - b.valor) <= 1
          and b.referencia in (p.referencia, p.pedido, p.orden, ltrim(coalesce(p.pedido, ''), '#'));
    else
      select count(*) into v_cand from public.pagos_por_verificar p
        where p.estado = 'pendiente' and abs(p.total - b.valor) <= 1
          and (p.pasarela ilike '%bold%' or p.pasarela ilike 'lucid%')
          and coalesce(p.fecha_pedido, p.creado) between b.fecha - interval '3 hours' and b.fecha + interval '3 hours';
      select count(*) into v_rivales from public.bold_pagos x
        where x.tipo = 'SALE_APPROVED' and not x.prueba and x.orden is null and abs(x.valor - b.valor) <= 1
          and x.fecha between b.fecha - interval '6 hours' and b.fecha + interval '6 hours';
      if v_cand <> 1 or v_rivales <> 1 then continue; end if;
      select * into v_p from public.pagos_por_verificar p
        where p.estado = 'pendiente' and abs(p.total - b.valor) <= 1
          and (p.pasarela ilike '%bold%' or p.pasarela ilike 'lucid%')
          and coalesce(p.fecha_pedido, p.creado) between b.fecha - interval '3 hours' and b.fecha + interval '3 hours';
    end if;
    update public.pagos_por_verificar set estado = 'llego', decidido_por = 'Bold (automático)', decidido_en = now(),
      nota = 'Bold ' || b.payment_id || coalesce(' · ' || b.medio, '') || coalesce(' · ' || b.email, '')
        || ' · pagó ' || to_char(b.fecha at time zone 'America/Bogota', 'DD/MM HH24:MI')
      where cuenta = v_p.cuenta and sucursal = v_p.sucursal and orden_id = v_p.orden_id and estado = 'pendiente';
    update public.bold_pagos set orden = v_p.orden, sucursal = v_p.sucursal, orden_id = v_p.orden_id
      where payment_id = b.payment_id and tipo = b.tipo;
    v_n := v_n + 1;
  end loop;
  -- Si Bold anula un pago que ya se había cruzado solo, el pedido vuelve a pendientes.
  update public.pagos_por_verificar p set estado = 'pendiente', decidido_por = null, decidido_en = null,
    nota = 'Bold anuló el pago ' || s.payment_id
    from public.bold_pagos s join public.bold_pagos v on v.payment_id = s.payment_id and v.tipo = 'VOID_APPROVED'
    where s.tipo = 'SALE_APPROVED' and s.sucursal = p.sucursal and s.orden_id = p.orden_id
      and p.estado = 'llego' and p.decidido_por = 'Bold (automático)';
  return v_n;
end $$;
revoke all on function public.pagos_cruzar_bold() from public, anon, authenticated;
grant execute on function public.pagos_cruzar_bold() to service_role;

-- n8n recibe el webhook y manda el cuerpo crudo (base64) + la firma. Firma inválida -> no se guarda nada.
-- "Probar el webhook" de Bold firma con llave vacía: se guarda como prueba y nunca confirma pedidos.
create or replace function public.bold_registrar(p_cuerpo_b64 text, p_firma text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_secreto text; v_firma text := lower(trim(coalesce(p_firma, ''))); v_prueba boolean := false; v_ev jsonb; d jsonb;
begin
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'bold_llave_secreta' limit 1;
  if v_secreto is null or v_firma <> encode(extensions.hmac(p_cuerpo_b64, v_secreto, 'sha256'), 'hex') then
    if v_firma = encode(extensions.hmac(p_cuerpo_b64, '', 'sha256'), 'hex') then v_prueba := true;
    else return 'firma_invalida'; end if;
  end if;
  v_ev := convert_from(decode(p_cuerpo_b64, 'base64'), 'UTF8')::jsonb;
  d := v_ev -> 'data';
  insert into public.bold_pagos (payment_id, tipo, valor, fecha, referencia, medio, integracion, email, prueba, payload)
  values (coalesce(d ->> 'payment_id', v_ev ->> 'subject'), coalesce(v_ev ->> 'type', '?'), (d -> 'amount' ->> 'total')::numeric,
    coalesce((d ->> 'created_at')::timestamptz, now()), nullif(d -> 'metadata' ->> 'reference', ''), d ->> 'payment_method',
    d ->> 'integration', d ->> 'payer_email', v_prueba, v_ev)
  on conflict (payment_id, tipo) do update set payload = excluded.payload;
  perform public.pagos_cruzar_bold();
  return case when v_prueba then 'prueba' else 'ok' end;
end $$;
revoke all on function public.bold_registrar(text, text) from public, anon, authenticated;
grant execute on function public.bold_registrar(text, text) to service_role;

-- Cuando n8n registra pedidos nuevos, también se intenta el cruce (el pago de Bold puede haber llegado antes).
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
  perform public.pagos_cruzar_bold();
  return v_n;
end $$;
revoke all on function public.pago_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.pago_registrar(jsonb) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261030160000', 'bold_webhook') on conflict do nothing;
select to_regclass('public.bold_pagos')::text as tabla,
  (select count(*) from pg_proc where proname in ('pagos_cruzar_bold', 'bold_registrar')) as funciones,
  (select count(*) from vault.decrypted_secrets where name = 'bold_llave_secreta') as llave_guardada;
