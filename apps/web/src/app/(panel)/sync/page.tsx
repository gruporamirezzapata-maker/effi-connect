import { redirect } from "next/navigation";
import { createClient, getUsuario } from "@/lib/supabase/server";
import { entero, fechaHora, haceCuanto } from "@/lib/formato";
import { infoCuenta } from "@/lib/paises";
import { Barra, Panel, TablaScroll, Vacio } from "@/components/ui";

const NOMBRE: Record<string, string> = {
  hist: "Cambios de estado",
  wallet: "Wallet",
  guias: "Guías",
  novedades_1: "Novedades operativas",
  novedades_2: "Novedades por solucionar",
};

export default async function SyncPage() {
  const u = await getUsuario();
  if (u?.rol !== "owner") redirect("/");
  const supabase = await createClient();
  const [{ data: estado }, { data: jobs }, { data: runs }, { count: webhooks }] = await Promise.all([
    supabase.from("effi_sync_state").select("cuenta,recurso,cursor_utc,ultimo_ok,ultimo_error,filas_ultima").order("cuenta").order("recurso"),
    supabase.from("effi_sync_jobs").select("id,cuenta,recurso,desde_utc,hasta_utc,avance_utc,estado,filas,error").order("id", { ascending: false }).limit(40),
    supabase.from("effi_sync_runs").select("id,inicio,fin,resumen").order("id", { ascending: false }).limit(15),
    supabase.from("effi_webhook_events").select("id", { count: "exact", head: true }),
  ]);

  return (
    <div className="pt-8 space-y-3">
      <div className="mb-6">
        <h1 className="fu text-5xl sm:text-6xl lg:text-[5rem] font-light leading-[0.95] tracking-tight">Estado de los datos</h1>
        <p className="text-sm text-muted mt-1.5">
          Effi → Supabase cada minuto por API. Webhooks recibidos: {entero(webhooks ?? 0)} (Effi aún no los envía).
        </p>
      </div>

      <Panel titulo="Estado por cuenta y recurso">
        {estado?.length ? (
          <TablaScroll>
            <thead><tr><th>Cuenta</th><th>Recurso</th><th>Sincronizado hasta</th><th>Última corrida OK</th><th className="text-right">Filas última</th><th>Error</th></tr></thead>
            <tbody>
              {estado.map((e) => (
                <tr key={`${e.cuenta}-${e.recurso}`}>
                  <td>{infoCuenta(e.cuenta).bandera} {infoCuenta(e.cuenta).nombre}</td>
                  <td>{NOMBRE[e.recurso] ?? e.recurso}</td>
                  <td className="text-muted">{fechaHora(e.cursor_utc)}</td>
                  <td className="text-muted">{haceCuanto(e.ultimo_ok)}</td>
                  <td className="text-right num">{entero(e.filas_ultima)}</td>
                  <td className="text-red text-xs max-w-[22rem] truncate" title={e.ultimo_error ?? ""}>{e.ultimo_error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </TablaScroll>
        ) : <Vacio>Sin datos de sincronización.</Vacio>}
      </Panel>

      <Panel titulo="Cargas históricas y reconciliaciones" detalle="Se avanzan con el tiempo que sobra en cada corrida">
        {jobs?.length ? (
          <TablaScroll>
            <thead><tr><th>#</th><th>Cuenta</th><th>Recurso</th><th>Rango</th><th>Avance</th><th className="text-right">Filas</th><th>Estado</th></tr></thead>
            <tbody>
              {jobs.map((j) => {
                const total = Date.parse(j.hasta_utc) - Date.parse(j.desde_utc);
                const av = total > 0 ? (Date.parse(j.avance_utc) - Date.parse(j.desde_utc)) / total : 1;
                return (
                  <tr key={j.id}>
                    <td className="text-muted">{j.id}</td>
                    <td>{infoCuenta(j.cuenta).bandera} {infoCuenta(j.cuenta).nombre}</td>
                    <td>{NOMBRE[j.recurso] ?? j.recurso}</td>
                    <td className="text-muted text-xs">{j.desde_utc.slice(0, 10)} → {j.hasta_utc.slice(0, 10)}</td>
                    <td><div className="flex items-center gap-2"><Barra valor={av} color={j.estado === "listo" ? "var(--green)" : "var(--blue)"} /><span className="text-xs num">{Math.round(av * 100)} %</span></div></td>
                    <td className="text-right num">{entero(j.filas)}</td>
                    <td className={j.estado === "listo" ? "text-green" : j.error ? "text-red" : "text-muted"} title={j.error ?? ""}>{j.error ? "reintentando" : j.estado}</td>
                  </tr>
                );
              })}
            </tbody>
          </TablaScroll>
        ) : <Vacio>Sin cargas.</Vacio>}
      </Panel>

      <Panel titulo="Últimas corridas">
        {runs?.length ? (
          <TablaScroll>
            <thead><tr><th>#</th><th>Inicio</th><th className="text-right">Segundos</th><th>Peticiones por cuenta</th></tr></thead>
            <tbody>
              {runs.map((r) => {
                const res = (r.resumen ?? {}) as Record<string, { peticiones?: number; error?: string }>;
                return (
                  <tr key={r.id}>
                    <td className="text-muted">{r.id}</td>
                    <td>{fechaHora(r.inicio)}</td>
                    <td className="text-right num">{(res as unknown as { segundos?: number }).segundos ?? "—"}</td>
                    <td className="text-xs text-muted">
                      {Object.entries(res).filter(([, v]) => v && typeof v === "object" && "peticiones" in v).map(([k, v]) => `${infoCuenta(k).bandera} ${v.peticiones}${v.error ? " ⚠" : ""}`).join("  ·  ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TablaScroll>
        ) : <Vacio>Sin corridas.</Vacio>}
      </Panel>
    </div>
  );
}
