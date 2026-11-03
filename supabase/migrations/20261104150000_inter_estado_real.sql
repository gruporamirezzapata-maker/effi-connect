-- 🚚 Estado real de las guías de Inter en Supabase (runbook §10-10). Antes vivía en una Data Table de n8n (ih43WH9mjiJiDrAi).
-- GitHub Actions (6:30 a. m.) → n8n → inter_estado_guardar; el snapshot de Despachos lo lee con inter_estado_leer.
-- Todo el estado queda en un solo sitio. Idempotente.

create table if not exists public.inter_estado_real (
  guia text primary key,
  estado_inter text,
  recogida boolean not null default false,
  revisado_en text,                       -- hora Bogotá de la revisión, 'YYYY-MM-DD HH:MI' (como la manda GitHub)
  actualizado timestamptz not null default now()
);
alter table public.inter_estado_real enable row level security;
revoke all on public.inter_estado_real from anon, authenticated;

create or replace function public.inter_estado_guardar(p_filas jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.inter_estado_real (guia, estado_inter, recogida, revisado_en, actualizado)
  select r.guia, r.estado_inter, coalesce(r.recogida, false), r.revisado_en, now()
  from jsonb_to_recordset(p_filas) as r(guia text, estado_inter text, recogida boolean, revisado_en text)
  where nullif(trim(r.guia), '') is not null
  on conflict (guia) do update set estado_inter = excluded.estado_inter, recogida = excluded.recogida,
    revisado_en = excluded.revisado_en, actualizado = now();
  get diagnostics v_n = row_count;
  delete from public.inter_estado_real where actualizado < now() - interval '60 days';
  return v_n;
end $$;
revoke all on function public.inter_estado_guardar(jsonb) from public, anon, authenticated;
grant execute on function public.inter_estado_guardar(jsonb) to service_role;

create or replace function public.inter_estado_leer() returns setof public.inter_estado_real
language sql stable security definer set search_path = '' as $$
  select * from public.inter_estado_real where actualizado > now() - interval '45 days';
$$;
revoke all on function public.inter_estado_leer() from public, anon, authenticated;
grant execute on function public.inter_estado_leer() to service_role;

-- Copia de lo que había en la Data Table de n8n (revisión del 3 nov 10:27).
insert into public.inter_estado_real (guia, estado_inter, recogida, revisado_en) values
  ('240064856482', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856481', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856312', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856307', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856303', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856300', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856297', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856292', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856290', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856284', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856283', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856279', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856276', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856269', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856263', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856260', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856257', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856252', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856250', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856247', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064856243', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064846787', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064846726', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064846725', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064846724', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064846719', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064846714', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064846710', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064846709', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064846705', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064846703', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825272', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825270', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825268', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825267', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825266', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825265', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825264', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825263', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825262', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825261', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825075', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825074', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825073', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825067', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825066', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825064', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825063', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825060', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825058', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825057', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825056', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825055', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825054', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064825053', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064748240', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064746011', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064746005', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064745997', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064745967', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064745953', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064745942', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064745928', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064745899', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064745879', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064745840', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064745825', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064745805', 'Por iniciar', false, '2026-11-03 10:27'),
  ('240064667528', 'Por iniciar', false, '2026-11-03 10:27')
on conflict (guia) do nothing;

insert into supabase_migrations.schema_migrations (version, name) values ('20261104150000', 'inter_estado_real') on conflict do nothing;
select (select count(*) from public.inter_estado_real) as filas,
  (select count(*) from pg_proc where proname in ('inter_estado_guardar', 'inter_estado_leer')) as funciones;
