import Link from "next/link";
import { createClient, exigirModulo } from "@/lib/supabase/server";
import { hoyBogota, leerFiltros, rpcArgs } from "@/lib/filtros";
import { entero, pct } from "@/lib/formato";
import { infoCuenta, type Semaforo } from "@/lib/paises";
import { Encabezado } from "@/components/encabezado";
import { Barra, Chip, Kpi, Panel, TablaScroll, Vacio } from "@/components/ui";
import { NovedadesBandeja, type FilaNovedad, type Medidores, type Solucion } from "@/components/novedades-bandeja";

type Fila = { cuenta: string; novedad: string; transportadora: string; guias: number; recuperadas: number; devueltas: number; abiertas: number };

const agrupar = (filas: Fila[], clave: (f: Fila) => string) => {
  const m = new Map<string, { k: string; cuenta: string; guias: number; recuperadas: number; devueltas: number; abiertas: number }>();
  for (const f of filas) {
    const k = clave(f);
    const o = m.get(k) ?? { k, cuenta: f.cuenta, guias: 0, recuperadas: 0, devueltas: 0, abiertas: 0 };
    o.guias += Number(f.guias);
    o.recuperadas += Number(f.recuperadas);
    o.devueltas += Number(f.devueltas);
    o.abiertas += Number(f.abiertas);
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.guias - a.guias);
};

// Recuperación por transportadora: verde ≥ 30 %, amarillo ≥ 15 % (skill effi-dashboard).
const semRecuperacion = (v: number | null): Semaforo => (v == null ? "nada" : v >= 0.3 ? "verde" : v >= 0.15 ? "naranja" : "rojo");

// Dos vistas: la bandeja para solucionar (por defecto, con los medidores de hoy) y el análisis del periodo.
function Vistas({ vista, c }: { vista: "bandeja" | "analisis"; c: string }) {
  const tab = (on: boolean) => `rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${on ? "bg-blue/25 text-text" : "text-muted hover:text-text"}`;
  return (
    <div className="inline-flex rounded-xl border border-line bg-black/[0.02] p-0.5 mb-4">
      <Link href={`/novedades?c=${c}`} className={tab(vista === "bandeja")}>📞 Bandeja</Link>
      <Link href={`/novedades?c=${c}&vista=analisis`} className={tab(vista === "analisis")}>📊 Análisis</Link>
    </div>
  );
}

export default async function NovedadesPage({ searchParams }: PageProps<"/novedades">) {
  const u = await exigirModulo("novedades");
  const sp = await searchParams;
  const vista = sp.vista === "analisis" ? "analisis" : "bandeja";
  const hoy = hoyBogota();
  const f = leerFiltros(vista === "bandeja" && typeof sp.d !== "string" ? { ...sp, d: hoy, h: hoy } : sp);
  const cuenta = f.cuentas?.[0] ?? "TIENDA_CO";
  const supabase = await createClient();

  if (vista === "bandeja") {
    const [b, s, m] = await Promise.all([
      supabase.rpc("novedades_bandeja", { p_cuentas: [cuenta] }),
      supabase.from("novedad_soluciones").select("cuenta,transportadora_efficommerce,id_solucion,nombre_solucion,pide_entrega,veces").eq("cuenta", cuenta),
      supabase.rpc("novedades_medidores", { p_cuentas: [cuenta], p_desde: f.desde, p_hasta: f.hasta }),
    ]);
    return (
      <>
        <Encabezado titulo="⚠️ Novedades" subtitulo="Las novedades que requieren solución de la tienda llegan solas. Se llama al cliente y la solución se envía a Effi desde cada línea. El calendario cambia los medidores." f={f} />
        <Vistas vista="bandeja" c={cuenta} />
        {(b.error || m.error) && <p className="text-sm text-red mb-4">{b.error?.message ?? m.error?.message}</p>}
        <NovedadesBandeja key={`${cuenta}|${f.desde}|${f.hasta}`} cuenta={cuenta} desde={f.desde} hasta={f.hasta}
          filas={(b.data ?? []) as FilaNovedad[]} soluciones={(s.data ?? []) as Solucion[]} medidores={(m.data ?? null) as Medidores | null}
          verEquipo={u.rol === "owner" || u.rol === "socio"} email={u.email} />
      </>
    );
  }

  const { data, error } = await supabase.rpc("kpi_novedades", rpcArgs(f));
  const filas = (data ?? []) as Fila[];
  const total = filas.reduce((a, r) => a + Number(r.guias), 0);
  const rec = filas.reduce((a, r) => a + Number(r.recuperadas), 0);
  const dev = filas.reduce((a, r) => a + Number(r.devueltas), 0);
  const abiertas = filas.reduce((a, r) => a + Number(r.abiertas), 0);
  const porTipo = agrupar(filas, (r) => r.novedad);
  const porTransp = agrupar(filas, (r) => `${r.cuenta}|${r.transportadora}`);

  return (
    <>
      <Encabezado titulo="⚠️ Novedades" subtitulo="Novedades que requieren solución de la tienda, creadas en el periodo. Recuperada = la guía terminó entregada." f={f} />
      <Vistas vista="analisis" c={cuenta} />
      {error && <p className="text-sm text-red mb-4">{error.message}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi acento etiqueta="Guías con novedad" valor={entero(total)} />
        <Kpi etiqueta="Recuperadas" valor={entero(rec)} nota={`${pct(total ? rec / total : null)} de recuperación`} semaforo={semRecuperacion(total ? rec / total : null)} />
        <Kpi etiqueta="Terminaron en devolución" valor={entero(dev)} nota={pct(total ? dev / total : null)} />
        <Kpi etiqueta="Aún abiertas" valor={entero(abiertas)} nota="por gestionar o en camino" />
      </div>

      <div className="grid xl:grid-cols-2 gap-3 mt-3">
        <Panel titulo="Por tipo de novedad" detalle="Ordenado por número de guías">
          {porTipo.length ? (
            <TablaScroll>
              <thead><tr><th>Novedad</th><th className="text-right">Guías</th><th>Peso</th><th className="text-right">Recuperadas</th><th className="text-right">Devueltas</th><th className="text-right">% recup.</th></tr></thead>
              <tbody>
                {porTipo.slice(0, 30).map((t) => {
                  const r = t.guias ? t.recuperadas / t.guias : null;
                  return (
                    <tr key={t.k}>
                      <td className="max-w-[18rem] truncate" title={t.k}>{t.k}</td>
                      <td className="text-right num">{entero(t.guias)}</td>
                      <td><Barra valor={t.guias / (porTipo[0]?.guias || 1)} /></td>
                      <td className="text-right num">{entero(t.recuperadas)}</td>
                      <td className="text-right num">{entero(t.devueltas)}</td>
                      <td className="text-right"><Chip s={semRecuperacion(r)}>{pct(r)}</Chip></td>
                    </tr>
                  );
                })}
              </tbody>
            </TablaScroll>
          ) : <Vacio>Sin novedades en este periodo (o aún se están cargando).</Vacio>}
        </Panel>

        <Panel titulo="Por transportadora" detalle="Recuperación: verde ≥ 30 %, amarillo ≥ 15 %">
          {porTransp.length ? (
            <TablaScroll>
              <thead><tr><th>País</th><th>Transportadora</th><th className="text-right">Guías</th><th className="text-right">Recuperadas</th><th className="text-right">Devueltas</th><th className="text-right">Abiertas</th><th className="text-right">% recup.</th></tr></thead>
              <tbody>
                {porTransp.map((t) => {
                  const r = t.guias ? t.recuperadas / t.guias : null;
                  return (
                    <tr key={t.k}>
                      <td>{infoCuenta(t.cuenta).bandera}</td>
                      <td className="font-medium">{t.k.split("|")[1]}</td>
                      <td className="text-right num">{entero(t.guias)}</td>
                      <td className="text-right num">{entero(t.recuperadas)}</td>
                      <td className="text-right num">{entero(t.devueltas)}</td>
                      <td className="text-right num text-muted">{entero(t.abiertas)}</td>
                      <td className="text-right"><Chip s={semRecuperacion(r)}>{pct(r)}</Chip></td>
                    </tr>
                  );
                })}
              </tbody>
            </TablaScroll>
          ) : <Vacio>Sin datos.</Vacio>}
        </Panel>
      </div>
    </>
  );
}
