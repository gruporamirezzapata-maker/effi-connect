import { Suspense } from "react";
import { Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { sumarDias, type Filtros } from "@/lib/filtros";
import { entero } from "@/lib/formato";
import { COLOR_SEMAFORO, infoCuenta, semaforoDevolucion } from "@/lib/paises";
import { FiltroMulti } from "./filtro-multi";

// "Resumen diario por estados" del tablero: filtros por transportadora, centro de costos y
// proveedor; tarjetas del periodo vs. el mes pasado; y tabla de calor por estado y día.
// % devolución aquí = lo que no se ha entregado / pedidos, sin contar indemnizaciones ni canceladas (misma definición
// del tablero: incluye lo que sigue en camino, por eso los días recientes salen altos).

type SP = Record<string, string | string[] | undefined>;
type Fila = { fecha: string; estado_u: string; guias: number };

// Mismo orden de filas del tablero.
const ESTADOS = [
  { id: "ENTREGADO", label: "ENTREGADO", color: "47 210 143" },
  { id: "DEVOLUCION", label: "DEVOLUCIÓN", color: "255 90 106" },
  { id: "EN_TRANSITO", label: "EN TRÁNSITO", color: "47 123 255" },
  { id: "EN_OFICINA", label: "DISPONIBLE EN OFICINA", color: "180 140 255" },
  { id: "NOVEDAD", label: "NOVEDAD", color: "255 181 71" },
  { id: "PENDIENTE", label: "PENDIENTE", color: "138 148 168" },
  { id: "INDEMNIZACION", label: "INDEMNIZACIÓN", color: "255 140 66" },
  { id: "CANCELADA", label: "CANCELADA POR TRANSPORTADORA", color: "110 118 135" },
];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
const DIAS_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const lista = (v: unknown) => (typeof v === "string" && v ? v.split("|").filter(Boolean) : null);
const corto = (iso: string) => `${Number(iso.slice(8, 10))}-${MESES[Number(iso.slice(5, 7)) - 1]}`;
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const pctTxt = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(2).replace(".", ",")}%`);

// Mismo rango de días, un mes atrás (1–23 oct → 1–23 sep).
function mesAnterior(iso: string) {
  const a = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1, d = Number(iso.slice(8, 10));
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const x = new Date(Date.UTC(a, m - 1, Math.min(d, ultimo)));
  return x.toISOString().slice(0, 10);
}

function dias(desde: string, hasta: string) {
  const out: string[] = [];
  for (let d = desde; d <= hasta && out.length < 400; d = sumarDias(d, 1)) out.push(d);
  return out;
}

// Las indemnizaciones y las canceladas por la transportadora no son entrega ni devolución: salen de la base del % devolución.
const pctDevolucion = (pedidos: number, ent: number, indem: number) => (pedidos - indem ? (pedidos - indem - ent) / (pedidos - indem) : null);
const pct2 = (v: number) => `${(v * 100).toFixed(2).replace(".", ",")}%`;
// Columna "Total" del periodo filtrado, fija a la derecha al desplazar los días.
const COL_TOTAL = "sticky right-0 z-10 border-l border-line bg-panel text-center num text-sm font-semibold px-4 min-w-[6rem]";

function totales(filas: Fila[]) {
  const suma = (estado?: string) => filas.filter((f) => !estado || f.estado_u === estado).reduce((a, f) => a + Number(f.guias), 0);
  const pedidos = suma(), ent = suma("ENTREGADO"), indem = suma("INDEMNIZACION") + suma("CANCELADA");
  return { pedidos, ent, pctEnt: pedidos ? ent / pedidos : null, pctDev: pctDevolucion(pedidos, ent, indem) };
}

export async function ResumenDiario({ f, sp, hoy }: { f: Filtros; sp: SP; hoy: string }) {
  const transportadoras = lista(sp.t), centros = lista(sp.cc), proveedores = lista(sp.pv);
  const hasta = f.hasta > hoy ? hoy : f.hasta;
  const antDesde = mesAnterior(f.desde), antHasta = mesAnterior(hasta);
  const args = { p_cuentas: f.cuentas, p_transportadoras: transportadoras, p_centros: centros, p_proveedores: proveedores };

  const supabase = await createClient();
  const [{ data: act, error }, { data: ant }, { data: ops }] = await Promise.all([
    supabase.rpc("kpi_diario_dim", { ...args, p_desde: f.desde, p_hasta: hasta }),
    supabase.rpc("kpi_diario_dim", { ...args, p_desde: antDesde, p_hasta: antHasta }),
    supabase.rpc("kpi_opciones_dim", { p_cuentas: f.cuentas, p_desde: f.desde, p_hasta: hasta }),
  ]);
  const filas = (act ?? []) as Fila[];
  const opciones = (ops ?? []) as { dimension: string; valor: string; guias: number }[];
  const op = (d: string) => opciones.filter((o) => o.dimension === d).map((o) => ({ valor: o.valor, guias: Number(o.guias) }));

  const t = totales(filas), tAnt = totales((ant ?? []) as Fila[]);
  const fechas = dias(f.desde, hasta);
  const porDia = new Map<string, Map<string, number>>();
  for (const r of filas) {
    const m = porDia.get(r.fecha) ?? new Map<string, number>();
    m.set(r.estado_u, (m.get(r.estado_u) ?? 0) + Number(r.guias));
    porDia.set(r.fecha, m);
  }
  const totalDia = (d: string) => [...(porDia.get(d)?.values() ?? [])].reduce((a, n) => a + n, 0);
  const entDia = (d: string) => porDia.get(d)?.get("ENTREGADO") ?? 0;
  const indemDia = (d: string) => (porDia.get(d)?.get("INDEMNIZACION") ?? 0) + (porDia.get(d)?.get("CANCELADA") ?? 0);
  const devDia = (d: string) => pctDevolucion(totalDia(d), entDia(d), indemDia(d));
  const totalEstado = (estado: string) => filas.filter((r) => r.estado_u === estado).reduce((a, r) => a + Number(r.guias), 0);
  const estados = ESTADOS.filter((e) => (e.id !== "INDEMNIZACION" && e.id !== "CANCELADA") || filas.some((r) => r.estado_u === e.id));
  const maxFila = Object.fromEntries(estados.map((e) => [e.id, Math.max(1, ...fechas.map((d) => porDia.get(d)?.get(e.id) ?? 0))]));

  // Mejor / peor día (ventas = pedidos; devolución = no entregado / pedidos sin indemnizaciones, mínimo 10 pedidos).
  const conVentas = fechas.map((d) => ({ d, n: totalDia(d) })).filter((x) => x.n > 0);
  const mejorV = conVentas.reduce<typeof conVentas[0] | null>((a, x) => (!a || x.n > a.n ? x : a), null);
  const peorV = conVentas.reduce<typeof conVentas[0] | null>((a, x) => (!a || x.n < a.n ? x : a), null);
  const devDias = conVentas.filter((x) => x.n >= 10).map((x) => ({ ...x, n: x.n - indemDia(x.d), dev: x.n - indemDia(x.d) - entDia(x.d), pct: devDia(x.d) ?? 0 }));
  const mejorD = devDias.reduce<typeof devDias[0] | null>((a, x) => (!a || x.pct < a.pct ? x : a), null);
  const peorD = devDias.reduce<typeof devDias[0] | null>((a, x) => (!a || x.pct > a.pct ? x : a), null);

  // Meta de % devolución: la del país si hay uno solo elegido.
  const unaCuenta = f.cuentas?.length === 1 ? f.cuentas[0] : null;
  const meta = unaCuenta ? infoCuenta(unaCuenta).verde : null;
  const pais = unaCuenta ? infoCuenta(unaCuenta) : null;
  const antLabel = `${corto(antDesde)}–${corto(antHasta)}`;
  const varPedidos = tAnt.pedidos ? (t.pedidos - tAnt.pedidos) / tAnt.pedidos : null;
  const ptsEnt = t.pctEnt != null && tAnt.pctEnt != null ? (t.pctEnt - tAnt.pctEnt) * 100 : null;
  const ptsDev = t.pctDev != null && tAnt.pctDev != null ? (t.pctDev - tAnt.pctDev) * 100 : null;

  return (
    <section className="card p-4 sm:p-5 min-w-0">
      <header className="flex items-center gap-2 mb-4">
        <h2 className="font-display text-lg font-semibold tracking-tight">Resumen diario por estados</h2>
        <span title="Guías por fecha de creación (hora local de cada país) y su estado actual. Responde al calendario, a los países y a los tres filtros de abajo." className="text-muted">
          <Info size={15} />
        </span>
      </header>

      <Suspense>
        <div className="flex flex-wrap gap-2 mb-4">
          <FiltroMulti etiqueta="Transportadoras" param="t" opciones={op("transportadora")} seleccion={transportadoras} />
          <FiltroMulti etiqueta="Centro de costos" param="cc" opciones={op("centro_costos")} seleccion={centros} />
          <FiltroMulti etiqueta="Proveedor" param="pv" opciones={op("proveedor")} seleccion={proveedores} />
        </div>
      </Suspense>
      {error && <p className="text-sm text-red mb-3">{error.message}</p>}

      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-5">
        <Tarjeta acento="var(--blue)" titulo="Pedidos del período" valor={entero(t.pedidos)}
          sub={`${fechas.length} días · prom. ${entero(Math.round(t.pedidos / Math.max(1, fechas.length)))} por día`}
          delta={varPedidos == null ? null : { valor: varPedidos * 100, unidad: "%", subirEsBueno: true }}
          pie={`Mes pasado (${antLabel}): ${entero(tAnt.pedidos)} pedidos`} />
        <Tarjeta acento="var(--green)" titulo="Entregados" valor={entero(t.ent)} sub={`${pctTxt(t.pctEnt)} de lo despachado`}
          delta={ptsEnt == null ? null : { valor: ptsEnt, unidad: " pts", subirEsBueno: true }}
          pie={`Mes pasado (${antLabel}): ${pctTxt(tAnt.pctEnt)} de entrega`} />
        <Tarjeta acento="var(--amber)" titulo="% devolución" valor={pctTxt(t.pctDev)}
          sub={meta == null ? "No entregado / pedidos" : t.pctDev != null && t.pctDev > meta ? `En alerta · meta ≤ ${Math.round(meta * 100)}%` : `Dentro de meta · ≤ ${Math.round(meta * 100)}%`}
          delta={ptsDev == null ? null : { valor: ptsDev, unidad: " pts", subirEsBueno: false }}
          pie={`Mes pasado (${antLabel}): ${pctTxt(tAnt.pctDev)}`} />
        <DiaDoble acento="var(--amber)" arriba={{ titulo: "Mejor día · ventas", dia: mejorV?.d, det: mejorV ? `${entero(mejorV.n)} pedidos` : "" }}
          abajo={{ titulo: "Peor día · ventas", dia: peorV?.d, det: peorV ? `${entero(peorV.n)} pedidos` : "" }} />
        <DiaDoble acento="var(--green)" arriba={{ titulo: "Mejor día · devolución", dia: mejorD?.d, det: mejorD ? `${pctTxt(mejorD.pct)} · ${mejorD.dev} de ${mejorD.n} pedidos` : "" }}
          abajo={{ titulo: "Peor día · devolución", dia: peorD?.d, det: peorD ? `${pctTxt(peorD.pct)} · ${peorD.dev} de ${peorD.n} pedidos` : "" }} />
      </div>

      <div className="overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5 pb-2">
        <table className="w-full border-separate border-spacing-y-1.5 min-w-max">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-panel text-left text-xs font-medium text-muted pr-4 pl-3 min-w-[13rem]">Estado</th>
              {fechas.map((d) => {
                const finde = dow(d) === 0 || dow(d) === 6;
                return (
                  <th key={d} className="px-1 text-center min-w-[4.25rem]">
                    <div className="font-display text-sm font-semibold">{corto(d)}</div>
                    <div className={`text-[10px] tracking-wider ${finde ? "text-blue-2" : "text-muted"}`}>{DIAS[dow(d)]}</div>
                  </th>
                );
              })}
              <th className={`${COL_TOTAL} align-bottom text-xs font-mono font-semibold text-muted`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {estados.map((e) => (
              <tr key={e.id}>
                <td className="sticky left-0 z-10 bg-panel pr-4">
                  <div className="flex items-center gap-2.5 rounded-l-xl border-l-4 bg-black/[0.03] px-3 py-2.5" style={{ borderColor: `rgb(${e.color})` }}>
                    <span className="size-2.5 rounded-full" style={{ background: `rgb(${e.color})`, boxShadow: `0 0 8px rgb(${e.color})` }} />
                    <span className="text-sm font-semibold whitespace-nowrap">{e.label}</span>
                  </div>
                </td>
                {fechas.map((d) => {
                  const n = porDia.get(d)?.get(e.id) ?? 0;
                  const a = n ? 0.12 + 0.5 * (n / maxFila[e.id]) : 0;
                  return (
                    <td key={d} className="text-center num text-sm font-medium py-2.5" style={{ background: n ? `rgb(${e.color} / ${a})` : undefined }}>
                      {n ? entero(n) : <span className="text-muted/50">—</span>}
                    </td>
                  );
                })}
                <td className={`${COL_TOTAL} py-2.5`}>
                  <div className="-mx-4 -my-2.5 px-4 py-2.5" style={{ background: `rgb(${e.color} / 0.12)` }}>{entero(totalEstado(e.id))}</div>
                </td>
              </tr>
            ))}
            <tr>
              <td className="sticky left-0 z-10 bg-panel pr-4">
                <div className="rounded-l-xl border-l-4 border-text bg-black/[0.06] px-3 py-2.5 text-sm font-semibold">Total general</div>
              </td>
              {fechas.map((d) => (
                <td key={d} className="text-center num text-sm font-semibold py-2.5 bg-black/[0.06]">{totalDia(d) ? entero(totalDia(d)) : "—"}</td>
              ))}
              <td className={`${COL_TOTAL} py-2.5`}><div className="-mx-4 -my-2.5 px-4 py-2.5 bg-black/[0.08]">{entero(t.pedidos)}</div></td>
            </tr>
            <tr>
              <td className="sticky left-0 z-10 bg-panel pr-4">
                <div className="rounded-l-xl border-l-4 bg-black/[0.03] px-3 py-2.5 text-sm font-semibold" style={{ borderColor: "rgb(255 90 106)" }}>% devolución</div>
              </td>
              {fechas.map((d) => {
                const v = totalDia(d) ? devDia(d) : null;
                const c = COLOR_SEMAFORO[unaCuenta ? semaforoDevolucion(unaCuenta, v) : "nada"];
                return (
                  <td key={d} className="text-center py-2.5 px-1">
                    {v == null ? <span className="text-muted/50">—</span> : (
                      <span className="inline-block rounded-full border px-2 py-0.5 num text-xs font-semibold"
                        style={{ color: c, borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
                        {pct2(v)}
                      </span>
                    )}
                  </td>
                );
              })}
              <td className={`${COL_TOTAL} py-2.5`}>
                {t.pctDev == null ? <span className="text-muted/50">—</span> : (() => {
                  const c = COLOR_SEMAFORO[unaCuenta ? semaforoDevolucion(unaCuenta, t.pctDev) : "nada"];
                  return (
                    <span className="inline-block rounded-full border px-2 py-0.5 text-xs font-semibold"
                      style={{ color: c, borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
                      {pct2(t.pctDev)}
                    </span>
                  );
                })()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {pais && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>% devolución ({pais.nombre}):</span>
          {([["verde", `hasta ${pct2(pais.verde)}`], ["naranja", `${pct2(pais.verde + 0.0001)} – ${pct2(pais.naranja)}`], ["rojo", `más de ${pct2(pais.naranja)}`]] as const).map(([s, txt]) => (
            <span key={s} className="rounded-full border px-2.5 py-0.5 font-semibold"
              style={{ color: COLOR_SEMAFORO[s], borderColor: `color-mix(in srgb, ${COLOR_SEMAFORO[s]} 45%, transparent)`, background: `color-mix(in srgb, ${COLOR_SEMAFORO[s]} 14%, transparent)` }}>
              {txt}
            </span>
          ))}
          <span>· el color de cada celda es más intenso cuanto más alto el día dentro de su estado</span>
        </div>
      )}
    </section>
  );
}

function Tarjeta({ acento, titulo, valor, sub, delta, pie }: {
  acento: string; titulo: string; valor: string; sub: string; delta: { valor: number; unidad: string; subirEsBueno: boolean } | null; pie: string;
}) {
  // Variación vs. mes pasado: ▲/▼ con signo; verde si va en la dirección buena; neutra si es ~0.
  const igual = delta != null && Math.abs(delta.valor) < 0.05;
  const bueno = delta != null && (delta.valor > 0) === delta.subirEsBueno;
  const txt = delta == null ? "" : igual ? "Igual que el mes pasado" : `${delta.valor > 0 ? "▲ +" : "▼ −"}${Math.abs(delta.valor).toFixed(1).replace(".", ",")}${delta.unidad} vs mes pasado`;
  return (
    <div className="rounded-2xl border border-line bg-black/[0.02] border-l-4 p-4" style={{ borderLeftColor: acento }}>
      <div className="text-[11px] uppercase tracking-widest text-muted font-mono">{titulo}</div>
      <div className="num text-3xl font-semibold mt-1">{valor}</div>
      <div className="text-xs text-muted mt-1">{sub}</div>
      {delta && (
        <span className={`inline-flex items-center gap-1 mt-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${igual ? "bg-black/[0.06] text-muted" : bueno ? "bg-green/15 text-green" : "bg-red/15 text-red"}`}>
          {txt}
        </span>
      )}
      <div className="text-[11px] text-muted mt-2">{pie}</div>
    </div>
  );
}

function DiaDoble({ acento, arriba, abajo }: {
  acento: string; arriba: { titulo: string; dia?: string; det: string }; abajo: { titulo: string; dia?: string; det: string };
}) {
  const bloque = (b: { titulo: string; dia?: string; det: string }, peor: boolean) => (
    <div>
      <div className={`text-[11px] uppercase tracking-widest font-mono ${peor ? "text-red" : "text-muted"}`}>{b.titulo}</div>
      {b.dia ? (
        <>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`font-display font-semibold ${peor ? "text-xl" : "text-2xl"}`}>{corto(b.dia)}</span>
            <span className="text-xs text-muted">{DIAS_LARGO[dow(b.dia)]}</span>
          </div>
          <div className="text-xs text-muted">{b.det}</div>
        </>
      ) : (
        <div className="text-sm text-muted mt-1">—</div>
      )}
    </div>
  );
  return (
    <div className="rounded-2xl border border-line bg-black/[0.02] border-l-4 p-4 space-y-3" style={{ borderLeftColor: acento }}>
      {bloque(arriba, false)}
      <div className="border-t border-dashed border-line" />
      {bloque(abajo, true)}
    </div>
  );
}
