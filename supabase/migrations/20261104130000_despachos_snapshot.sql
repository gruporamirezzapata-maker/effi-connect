-- 📦 Despachos lee un snapshot, no Effi (runbook §5.3). El flujo principal de n8n (cada 30 min, 7:00–20:30) arma la
-- lista de guías pendientes y la guarda aquí; el webhook despachos-datos solo la sirve. Abrir la página ya no consulta Effi.
-- Una sola fila (id = 1). Idempotente.

create table if not exists public.despachos_snapshot (
  id smallint primary key default 1 check (id = 1),
  generado_en timestamptz not null,
  datos jsonb not null
);
alter table public.despachos_snapshot enable row level security;
-- Lectura para el dueño y los socios (paso 2 opcional: el panel lee directo sin n8n ni clave k).
drop policy if exists despachos_snapshot_leer on public.despachos_snapshot;
create policy despachos_snapshot_leer on public.despachos_snapshot for select to authenticated using (
  exists (select 1 from public.app_usuarios u where u.user_id = (select auth.uid()) and u.activo and u.rol in ('owner', 'socio')));
revoke insert, update, delete on public.despachos_snapshot from anon, authenticated;

-- n8n guarda (service_role). Rechaza listas vacías por error: solo guarda si datos.ok = true.
create or replace function public.despachos_snapshot_guardar(p_datos jsonb) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((p_datos ->> 'ok')::boolean, false) is not true or jsonb_typeof(p_datos -> 'guias') <> 'array' then
    return 'rechazado';
  end if;
  insert into public.despachos_snapshot (id, generado_en, datos) values (1, now(), p_datos)
  on conflict (id) do update set generado_en = excluded.generado_en, datos = excluded.datos;
  return 'ok';
end $$;
revoke all on function public.despachos_snapshot_guardar(jsonb) from public, anon, authenticated;
grant execute on function public.despachos_snapshot_guardar(jsonb) to service_role;

-- n8n lee (service_role): datos + hora en que se generaron.
create or replace function public.despachos_snapshot_leer() returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce((select datos || jsonb_build_object('generado_en', generado_en) from public.despachos_snapshot where id = 1),
                  jsonb_build_object('ok', false, 'mensaje', 'Todavía no hay datos de despachos'));
$$;
revoke all on function public.despachos_snapshot_leer() from public, anon, authenticated;
grant execute on function public.despachos_snapshot_leer() to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261104130000', 'despachos_snapshot') on conflict do nothing;
select to_regclass('public.despachos_snapshot')::text as tabla,
  (select count(*) from pg_proc where proname in ('despachos_snapshot_guardar', 'despachos_snapshot_leer')) as funciones;
