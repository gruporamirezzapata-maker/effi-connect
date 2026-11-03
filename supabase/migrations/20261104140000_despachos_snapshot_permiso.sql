-- 📦 Despachos (runbook §5.3 paso 2 y §5.5): el panel lee el snapshot directo de Supabase con la sesión de cada usuario.
-- Pueden leerlo quienes tienen el módulo "guias" sobre la cuenta GRUPO_RZ_CO (el mismo permiso que abre /despachos).
-- Con esto desaparecen la dirección DESPACHOS_URL, la clave k y el flujo de n8n que la servía. Idempotente.

drop policy if exists despachos_snapshot_leer on public.despachos_snapshot;
create policy despachos_snapshot_leer on public.despachos_snapshot for select to authenticated using (
  'GRUPO_RZ_CO' = any ((select public.app_cuentas_visibles_en(array['guias']))::text[])
  or exists (select 1 from public.app_usuarios u where u.user_id = (select auth.uid()) and u.activo and u.rol in ('owner', 'socio')));

insert into supabase_migrations.schema_migrations (version, name) values ('20261104140000', 'despachos_snapshot_permiso') on conflict do nothing;
select count(*) as politicas from pg_policies where tablename = 'despachos_snapshot';
