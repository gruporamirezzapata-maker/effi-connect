-- 💳 Cruce Bold v2. Aprobado por Cristian el 3 nov 2026 tras prueba en transacción deshecha (3 casos OK).
-- Cierra tres huecos de pagos_cruzar_bold v1 (20261030160000_bold_webhook.sql):
--   1) Un pago de Bold cuyo pedido ya se confirmó A MANO quedaba "sin cruzar" y podía terminar confirmando OTRO pedido
--      pendiente del mismo valor (regla 1 solo miraba pendientes; regla 2 solo contaba pendientes como candidatos).
--   2) No quedaba registrado con qué regla se confirmó cada pedido (regla_cruce).
--   3) Un aviso repetido de Bold se procesaba en silencio; ahora se guarda el id del aviso y se responde 'duplicado'.
-- Idempotente. No cambia la firma ni la verificación con la llave del Vault.

alter table public.bold_pagos add column if not exists bold_evento_id text;          -- "id" del aviso (UUID por envío)
alter table public.pagos_por_verificar add column if not exists regla_cruce text;      -- 'referencia' | 'valor_hora'
do $$ begin
  alter table public.pagos_por_verificar add constraint pagos_regla_cruce_valida
    check (regla_cruce is null or regla_cruce in ('referencia', 'valor_hora'));
exception when duplicate_object then null; end $$;

create or replace function public.pagos_cruzar_bold() returns integer
language plpgsql security definer set search_path = '' as $$
declare b record; v_p record; v_n integer := 0; v_ref_todos integer; v_ref_pend integer; v_cand_todos integer; v_rivales integer;
begin
  for b in select * from public.bold_pagos where tipo = 'SALE_APPROVED' and not prueba and orden is null
             and fecha > now() - interval '4 days' order by fecha loop

    -- Regla 1: referencia + valor. Se mira en TODOS los estados: si la referencia apunta a un pedido ya decidido
    -- (a mano), el pago queda amarrado a ese pedido y no sigue a la regla 2.
    select count(*), count(*) filter (where p.estado = 'pendiente') into v_ref_todos, v_ref_pend
      from public.pagos_por_verificar p
      where coalesce(length(b.referencia), 0) >= 4 and abs(p.total - b.valor) <= 1
        and b.referencia in (p.referencia, p.pedido, p.orden, ltrim(coalesce(p.pedido, ''), '#'));

    if v_ref_todos = 1 then
      select * into v_p from public.pagos_por_verificar p
        where coalesce(length(b.referencia), 0) >= 4 and abs(p.total - b.valor) <= 1
          and b.referencia in (p.referencia, p.pedido, p.orden, ltrim(coalesce(p.pedido, ''), '#'));
      if v_ref_pend = 1 then
        update public.pagos_por_verificar set estado = 'llego', decidido_por = 'Bold (automático)', decidido_en = now(),
          regla_cruce = 'referencia',
          nota = 'Bold ' || b.payment_id || coalesce(' · ' || b.medio, '') || coalesce(' · ' || b.email, '')
            || ' · pagó ' || to_char(b.fecha at time zone 'America/Bogota', 'DD/MM HH24:MI')
          where cuenta = v_p.cuenta and sucursal = v_p.sucursal and orden_id = v_p.orden_id and estado = 'pendiente';
        v_n := v_n + 1;
      end if;
      -- Pendiente o ya decidido: el pago queda consumido por ese pedido.
      update public.bold_pagos set orden = v_p.orden, sucursal = v_p.sucursal, orden_id = v_p.orden_id
        where payment_id = b.payment_id and tipo = b.tipo;
      continue;
    end if;
    if v_ref_todos > 1 then continue; end if;   -- referencia ambigua: decide una persona

    -- Regla 2: valor + hora. El universo de candidatos incluye pedidos YA DECIDIDOS en la ventana:
    -- solo confirma si el único pedido posible está pendiente y hay un solo pago de Bold de ese valor cerca.
    select count(*) into v_cand_todos from public.pagos_por_verificar p
      where abs(p.total - b.valor) <= 1
        and (p.pasarela ilike '%bold%' or p.pasarela ilike 'lucid%')
        and coalesce(p.fecha_pedido, p.creado) between b.fecha - interval '3 hours' and b.fecha + interval '3 hours';
    select count(*) into v_rivales from public.bold_pagos x
      where x.tipo = 'SALE_APPROVED' and not x.prueba and x.orden is null and abs(x.valor - b.valor) <= 1
        and x.fecha between b.fecha - interval '6 hours' and b.fecha + interval '6 hours';
    if v_cand_todos <> 1 or v_rivales <> 1 then continue; end if;

    select * into v_p from public.pagos_por_verificar p
      where abs(p.total - b.valor) <= 1
        and (p.pasarela ilike '%bold%' or p.pasarela ilike 'lucid%')
        and coalesce(p.fecha_pedido, p.creado) between b.fecha - interval '3 hours' and b.fecha + interval '3 hours';
    if v_p.estado <> 'pendiente' then continue; end if;   -- el único candidato ya lo decidió una persona: no tocar

    update public.pagos_por_verificar set estado = 'llego', decidido_por = 'Bold (automático)', decidido_en = now(),
      regla_cruce = 'valor_hora',
      nota = 'Bold ' || b.payment_id || coalesce(' · ' || b.medio, '') || coalesce(' · ' || b.email, '')
        || ' · pagó ' || to_char(b.fecha at time zone 'America/Bogota', 'DD/MM HH24:MI')
      where cuenta = v_p.cuenta and sucursal = v_p.sucursal and orden_id = v_p.orden_id and estado = 'pendiente';
    update public.bold_pagos set orden = v_p.orden, sucursal = v_p.sucursal, orden_id = v_p.orden_id
      where payment_id = b.payment_id and tipo = b.tipo;
    v_n := v_n + 1;
  end loop;

  -- Anulación (VOID_APPROVED) de un pago que se había confirmado solo: el pedido vuelve a pendientes.
  update public.pagos_por_verificar p set estado = 'pendiente', decidido_por = null, decidido_en = null, regla_cruce = null,
    nota = 'Bold anuló el pago ' || s.payment_id
    from public.bold_pagos s join public.bold_pagos v on v.payment_id = s.payment_id and v.tipo = 'VOID_APPROVED'
    where s.tipo = 'SALE_APPROVED' and s.sucursal = p.sucursal and s.orden_id = p.orden_id
      and p.estado = 'llego' and p.decidido_por = 'Bold (automático)';
  -- Anulación de un pago amarrado a un pedido confirmado A MANO: no se cambia la decisión, se deja la nota.
  update public.pagos_por_verificar p set nota = coalesce(p.nota || ' · ', '') || '⚠ Bold anuló el pago ' || s.payment_id
    from public.bold_pagos s join public.bold_pagos v on v.payment_id = s.payment_id and v.tipo = 'VOID_APPROVED'
    where s.tipo = 'SALE_APPROVED' and s.sucursal = p.sucursal and s.orden_id = p.orden_id
      and p.estado = 'llego' and p.decidido_por is distinct from 'Bold (automático)'
      and coalesce(p.nota, '') not like '%Bold anuló el pago ' || s.payment_id || '%';
  return v_n;
end $$;
revoke all on function public.pagos_cruzar_bold() from public, anon, authenticated;
grant execute on function public.pagos_cruzar_bold() to service_role;

-- bold_registrar v2: igual verificación de firma; guarda el id del aviso y responde 'duplicado' si el mismo pago y tipo
-- ya estaba (Bold reenvía; su documentación pide idempotencia por payment_id, que es la llave primaria).
create or replace function public.bold_registrar(p_cuerpo_b64 text, p_firma text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_secreto text; v_firma text := lower(trim(coalesce(p_firma, ''))); v_prueba boolean := false; v_ev jsonb; d jsonb;
  v_pid text; v_tipo text; v_existia boolean;
begin
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'bold_llave_secreta' limit 1;
  if v_secreto is null or v_firma <> encode(extensions.hmac(p_cuerpo_b64, v_secreto, 'sha256'), 'hex') then
    if v_firma = encode(extensions.hmac(p_cuerpo_b64, '', 'sha256'), 'hex') then v_prueba := true;
    else return 'firma_invalida'; end if;
  end if;
  v_ev := convert_from(decode(p_cuerpo_b64, 'base64'), 'UTF8')::jsonb;
  d := v_ev -> 'data';
  v_pid := coalesce(d ->> 'payment_id', v_ev ->> 'subject');
  v_tipo := coalesce(v_ev ->> 'type', '?');
  select exists (select 1 from public.bold_pagos where payment_id = v_pid and tipo = v_tipo) into v_existia;
  insert into public.bold_pagos (payment_id, tipo, valor, fecha, referencia, medio, integracion, email, prueba, payload, bold_evento_id)
  values (v_pid, v_tipo, (d -> 'amount' ->> 'total')::numeric,
    coalesce((d ->> 'created_at')::timestamptz, now()), nullif(d -> 'metadata' ->> 'reference', ''), d ->> 'payment_method',
    d ->> 'integration', d ->> 'payer_email', v_prueba, v_ev, v_ev ->> 'id')
  on conflict (payment_id, tipo) do nothing;
  perform public.pagos_cruzar_bold();
  return case when v_existia then 'duplicado' when v_prueba then 'prueba' else 'ok' end;
end $$;
revoke all on function public.bold_registrar(text, text) from public, anon, authenticated;
grant execute on function public.bold_registrar(text, text) to service_role;

-- Trazabilidad hacia atrás: pedidos ya confirmados por Bold, con la regla que (casi seguro) se usó.
update public.pagos_por_verificar p set regla_cruce = case
    when coalesce(length(b.referencia), 0) >= 4
     and b.referencia in (p.referencia, p.pedido, p.orden, ltrim(coalesce(p.pedido, ''), '#')) then 'referencia'
    else 'valor_hora' end
  from public.bold_pagos b
  where b.tipo = 'SALE_APPROVED' and b.sucursal = p.sucursal and b.orden_id = p.orden_id
    and p.decidido_por = 'Bold (automático)' and p.regla_cruce is null;

insert into supabase_migrations.schema_migrations (version, name) values ('20261104120000', 'bold_cruce_v2') on conflict do nothing;
select (select count(*) from information_schema.columns where table_schema = 'public'
          and ((table_name = 'bold_pagos' and column_name = 'bold_evento_id')
            or (table_name = 'pagos_por_verificar' and column_name = 'regla_cruce'))) as columnas_nuevas,
       (select count(*) from public.pagos_por_verificar where regla_cruce is not null) as con_regla;
