-- 🧪 Informe de aciertos de la fase sombra (runbook §7.2). Cada mañana n8n lee la hoja sombra (propuesta de n8n +
-- comparación con lo que hizo Estefanía en Effi) y la deja aquí, una fila por pedido. Con esto se mide el criterio de salida (§7.3).
--   resultado: acierto | fallo (comparado y algo distinto) | excepcion (n8n lo mandaba a revisión humana)
--              | esperando (Estefanía aún no lo hace) | sin_remision (3+ días sin remisión: pedido que no se despachó)
--   falso_positivo: n8n lo habría creado solo y no debía (sin_remision sin excepción, o n8n no cobraba y la guía real sí cobró).
-- Idempotente.

create table if not exists public.sombra_aciertos (
  tienda text not null check (tienda in ('zenit', 'noara')),
  orden text not null,
  fecha_orden date,
  resultado text not null check (resultado in ('acierto', 'fallo', 'excepcion', 'esperando', 'sin_remision')),
  acierto boolean,
  falso_positivo boolean not null default false,
  diferencia text,
  propuesta jsonb,
  real jsonb,
  actualizado timestamptz not null default now(),
  primary key (tienda, orden)
);
create index if not exists sombra_aciertos_fecha on public.sombra_aciertos (fecha_orden, tienda);
alter table public.sombra_aciertos enable row level security;
drop policy if exists sombra_aciertos_leer on public.sombra_aciertos;
create policy sombra_aciertos_leer on public.sombra_aciertos for select to authenticated using (
  exists (select 1 from public.app_usuarios u where u.user_id = (select auth.uid()) and u.activo and u.rol in ('owner', 'socio')));
revoke insert, update, delete on public.sombra_aciertos from anon, authenticated;

create or replace function public.sombra_registrar(p_filas jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.sombra_aciertos (tienda, orden, fecha_orden, resultado, acierto, falso_positivo, diferencia, propuesta, real, actualizado)
  select r.tienda, r.orden, r.fecha_orden, r.resultado, r.acierto, coalesce(r.falso_positivo, false), nullif(r.diferencia, ''),
    r.propuesta, r.real, now()
  from jsonb_to_recordset(p_filas) as r(tienda text, orden text, fecha_orden date, resultado text, acierto boolean,
    falso_positivo boolean, diferencia text, propuesta jsonb, real jsonb)
  where r.tienda in ('zenit', 'noara') and nullif(r.orden, '') is not null
  on conflict (tienda, orden) do update set fecha_orden = excluded.fecha_orden, resultado = excluded.resultado,
    acierto = excluded.acierto, falso_positivo = excluded.falso_positivo, diferencia = excluded.diferencia,
    propuesta = excluded.propuesta, real = excluded.real, actualizado = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.sombra_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.sombra_registrar(jsonb) to service_role;

-- Resumen por día y tienda. % de aciertos = aciertos / (aciertos + fallos). Las excepciones no cuentan como fallo
-- (van a una persona por diseño) pero se reportan, porque una sombra que manda todo a excepción no automatiza nada.
create or replace view public.sombra_resumen with (security_invoker = true) as
select fecha_orden, tienda,
  count(*) filter (where resultado in ('acierto', 'fallo')) as evaluados,
  count(*) filter (where resultado = 'acierto') as aciertos,
  round(100.0 * count(*) filter (where resultado = 'acierto')
    / nullif(count(*) filter (where resultado in ('acierto', 'fallo')), 0), 1) as pct_aciertos,
  count(*) filter (where resultado = 'excepcion') as excepciones,
  count(*) filter (where resultado = 'esperando') as esperando,
  count(*) filter (where resultado = 'sin_remision') as sin_remision,
  count(*) filter (where falso_positivo) as falsos_positivos,
  count(*) as total
from public.sombra_aciertos
group by fecha_orden, tienda;

insert into supabase_migrations.schema_migrations (version, name) values ('20261104160000', 'sombra_aciertos') on conflict do nothing;
select to_regclass('public.sombra_aciertos')::text as tabla, to_regclass('public.sombra_resumen')::text as vista,
  (select count(*) from pg_proc where proname = 'sombra_registrar') as funciones;
