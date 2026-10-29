-- Publicidad por anuncio (como el Administrador de anuncios): meta-gasto también trae, por día, cada anuncio con su
-- campaña y conjunto, gasto, impresiones, clics en el enlace, compras del píxel y conversaciones iniciadas.
-- Es aparte del gasto por país (app_publicidad_*), que sigue igual. Solo lo ven el dueño y los socios.
-- Idempotente: se puede correr de nuevo sin romper nada.

create table if not exists public.meta_anuncios_dia (
  anuncio_id text not null,
  fecha date not null,
  cuenta_ads_id text not null,
  cuenta_ads text not null,
  campana_id text,
  campana text,
  conjunto_id text,
  conjunto text,
  anuncio text,
  gasto_cop numeric not null default 0,
  impresiones bigint not null default 0,
  clics bigint not null default 0,
  compras numeric not null default 0,
  valor_compras_cop numeric not null default 0,
  conversaciones numeric not null default 0,
  actualizado timestamptz not null default now(),
  primary key (anuncio_id, fecha)
);
create index if not exists meta_anuncios_dia_fecha on public.meta_anuncios_dia (fecha);
alter table public.meta_anuncios_dia enable row level security;
drop policy if exists meta_anuncios_dia_leer on public.meta_anuncios_dia;
create policy meta_anuncios_dia_leer on public.meta_anuncios_dia for select to authenticated using (
  exists (select 1 from public.app_usuarios u where u.user_id = (select auth.uid()) and u.activo and u.rol in ('owner', 'socio')));

-- meta-gasto guarda lo de unas cuentas y un rango: reemplaza esos días (si un anuncio cambió de nombre no queda doble).
create or replace function public.meta_guardar_anuncios(p_filas jsonb, p_cuentas text[], p_desde date, p_hasta date) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.meta_anuncios_dia where cuenta_ads_id = any (p_cuentas) and fecha between p_desde and p_hasta;
  insert into public.meta_anuncios_dia (anuncio_id, fecha, cuenta_ads_id, cuenta_ads, campana_id, campana, conjunto_id, conjunto, anuncio,
    gasto_cop, impresiones, clics, compras, valor_compras_cop, conversaciones)
  select r.anuncio_id, r.fecha, r.cuenta_ads_id, r.cuenta_ads, r.campana_id, r.campana, r.conjunto_id, r.conjunto, r.anuncio,
    coalesce(r.gasto_cop, 0), coalesce(r.impresiones, 0), coalesce(r.clics, 0), coalesce(r.compras, 0), coalesce(r.valor_compras_cop, 0), coalesce(r.conversaciones, 0)
  from jsonb_to_recordset(p_filas) as r(anuncio_id text, fecha date, cuenta_ads_id text, cuenta_ads text, campana_id text, campana text,
    conjunto_id text, conjunto text, anuncio text, gasto_cop numeric, impresiones bigint, clics bigint, compras numeric, valor_compras_cop numeric, conversaciones numeric)
  where r.fecha between p_desde and p_hasta and r.anuncio_id is not null
  on conflict (anuncio_id, fecha) do update set cuenta_ads_id = excluded.cuenta_ads_id, cuenta_ads = excluded.cuenta_ads,
    campana_id = excluded.campana_id, campana = excluded.campana, conjunto_id = excluded.conjunto_id, conjunto = excluded.conjunto,
    anuncio = excluded.anuncio, gasto_cop = excluded.gasto_cop, impresiones = excluded.impresiones, clics = excluded.clics,
    compras = excluded.compras, valor_compras_cop = excluded.valor_compras_cop, conversaciones = excluded.conversaciones, actualizado = now();
  get diagnostics v_n = row_count;
  -- Las cuentas excluidas nunca quedan.
  delete from public.meta_anuncios_dia d using public.meta_cuentas_ads a where a.excluir and d.cuenta_ads_id = a.id;
  return v_n;
end $$;
revoke all on function public.meta_guardar_anuncios(jsonb, text[], date, date) from public, anon, authenticated;
grant execute on function public.meta_guardar_anuncios(jsonb, text[], date, date) to service_role;

-- Para la página: cada anuncio con lo acumulado en el rango (la página agrupa por cuenta, campaña o conjunto y filtra).
create or replace function public.publicidad_anuncios(p_desde date, p_hasta date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not exists (select 1 from public.app_usuarios u where u.user_id = (select auth.uid()) and u.activo and u.rol in ('owner', 'socio'))
    then null else coalesce((
      select jsonb_agg(x order by x.gasto desc) from (
        select d.anuncio_id, max(d.anuncio) as anuncio, max(d.conjunto_id) as conjunto_id, max(d.conjunto) as conjunto,
          max(d.campana_id) as campana_id, max(d.campana) as campana, max(d.cuenta_ads) as cuenta_ads,
          round(sum(d.gasto_cop)) as gasto, sum(d.impresiones) as impresiones, sum(d.clics) as clics, sum(d.compras) as compras,
          round(sum(d.valor_compras_cop)) as valor, sum(d.conversaciones) as conversaciones,
          count(*) filter (where d.gasto_cop > 0) as dias, max(d.fecha) filter (where d.gasto_cop > 0) as ultimo
        from public.meta_anuncios_dia d
        where d.fecha between p_desde and p_hasta
        group by d.anuncio_id
        having sum(d.gasto_cop) > 0 or sum(d.impresiones) > 0
      ) x), '[]'::jsonb) end;
$$;
revoke all on function public.publicidad_anuncios(date, date) from public, anon;
grant execute on function public.publicidad_anuncios(date, date) to authenticated;
