import type { ReactNode } from "react";
import { Info } from "lucide-react";
import type { Filtros } from "@/lib/filtros";
import { kpiPendientes, kpiUtilidad, rangoDatos } from "@/lib/datos";
import { dinero, entero } from "@/lib/formato";
import { infoCuenta } from "@/lib/paises";
import { COLOR_ESTADO } from "./charts";

// Recuadros del final de Datos: inconsistencias pendientes de pago,
// proyección de lo pendiente a devolución y los gastos del mes (aplicaciones, administrativos, operativo).

const COLOR_PLATAFORMA = { Effi: "var(--blue)" } as const;
const NOMBRE_ESTADO: Record<string, string> = { EN_TRANSITO: "EN TRÁNSITO", NOVEDAD: "NOVEDAD", EN_OFICINA: "DISPONIBLE EN OFICINA", PENDIENTE: "PENDIENTE" };
// Bodega que cobra el fulfillment por país (Colombia no tiene: paga 4x1000 sobre el recaudo).
const BODEGA: Record<string, string> = { TIENDA_GT: "Bodega Efficaex", TIENDA_EC: "Bodega Effi Quito" };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const fechaCorta = (iso: string) => `${Number(iso.slice(8, 10))}-${MESES[Number(iso.slice(5, 7)) - 1]}`;

// parte "pendientes" va debajo del PyG; parte "gastos" (con la nota final) cierra la página.
export async function CuadrosDatos({ f, parte }: { f: Filtros; parte: "pendientes" | "gastos" }) {
  const cuenta = f.cuentas?.[0] ?? "TIENDA_CO";
  const [{ data: p, error }, { data: u }, rango] = await Promise.all([
    kpiPendientes(cuenta, f.desde, f.hasta),
    kpiUtilidad(cuenta, f.desde, f.hasta),
    rangoDatos(cuenta),
  ]);
  const $ = (v: number) => dinero(v, cuenta);
  const info = infoCuenta(cuenta);

  if (parte === "pendientes") return (
    <>
      {p ? <Inconsistencias p={p.inconsistencias} $={$} /> : <p className="text-sm text-red mt-3">No se pudieron calcular las inconsistencias: {error}</p>}
      {p && <Proyeccion filas={p.proyeccion} $={$} bodega={BODEGA[cuenta]} />}
    </>
  );

  return (
    <>
      {u && (
        <>
          <Gastos titulo="Gastos por aplicaciones (mensual)" lineas={u.gastos.apps.detalle} meses={u.gastos.meses} $={$} totalLabel="Total gastos por aplicaciones" />
          <Gastos titulo="Gastos administrativos (mensual)" lineas={u.gastos.admin.detalle} meses={u.gastos.meses} $={$} totalLabel="Total gastos administrativos" nomina />
          <Gastos titulo="Gasto operativo (mensual)" lineas={u.gastos.operativo.detalle} meses={u.gastos.meses} $={$} totalLabel="Total gasto operativo" />
        </>
      )}
      <p className="text-xs text-muted mt-4 leading-relaxed">
        No incluye retiros de wallet ni gasto publicitario salvo lo indicado en el PyG. Ganancia/utilidad en la tabla de estados solo se reconoce en ENTREGADO
        (venta − costo de mercancía − flete − otros costos). {info.nombre}
        {rango.desde && rango.hasta ? ` — datos disponibles: ${fechaCorta(rango.desde.slice(0, 10))} – ${fechaCorta(rango.hasta.slice(0, 10))}.` : "."}
      </p>
    </>
  );
}

function Recuadro({ titulo, ayuda, children }: { titulo: string; ayuda: string; children: ReactNode }) {
  return (
    <section className="card relative overflow-hidden p-4 sm:p-5 min-w-0 mt-3">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber via-blue-2/60 to-blue" />
      <header className="flex items-center gap-2 mb-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">{titulo}</h2>
        <span title={ayuda} className="text-muted"><Info size={15} /></span>
      </header>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

const TH = "text-[11px] uppercase tracking-widest font-mono text-muted font-medium px-3 pb-1";
const fila = (color: string) => ({ className: "rounded-l-xl border-l-4 bg-black/[0.03] pl-3 pr-2 py-2.5", style: { borderColor: color } });

function Inconsistencias({ p, $ }: { p: NonNullable<Awaited<ReturnType<typeof kpiPendientes>>["data"]>["inconsistencias"]; $: (v: number) => string }) {
  const esperado = (i: (typeof p)[number]) => i.venta - i.costo - i.flete;
  const total = p.reduce((a, i) => a + esperado(i), 0);
  return (
    <Recuadro titulo="Inconsistencias pendientes de pago"
      ayuda="Guías entregadas sin recaudo en el wallet de Effi, de cualquier fecha hasta el fin del periodo. Se reclaman sin esperar días de rezago. El costo es el real cobrado o, si no lo hay, el promedio del producto.">
      {p.length ? (
        <table className="w-full border-separate border-spacing-y-1.5 text-sm">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>Guía</th><th className={`${TH} text-left`}>Fecha</th><th className={`${TH} text-left`}>Transportadora</th>
              <th className={`${TH} text-right`}>Venta</th><th className={`${TH} text-right`}>Costo</th><th className={`${TH} text-right`}>Flete</th>
              <th className={`${TH} text-right`}>Ingreso esperado</th><th className={`${TH} text-right`}>Acción requerida</th>
            </tr>
          </thead>
          <tbody>
            {p.map((i) => (
              <tr key={`${i.plataforma}-${i.guia}`}>
                <td {...fila(COLOR_PLATAFORMA[i.plataforma])}>
                  <span className="font-mono font-semibold">{i.guia ?? "—"}</span>
                </td>
                <td className="bg-black/[0.03] px-3 whitespace-nowrap">{i.fecha}</td>
                <td className="bg-black/[0.03] px-3">{i.transportadora ?? "—"}</td>
                <td className="bg-black/[0.03] px-3 text-right num">{$(i.venta)}</td>
                <td className="bg-black/[0.03] px-3 text-right num">{$(i.costo)}</td>
                <td className="bg-black/[0.03] px-3 text-right num">{$(i.flete)}</td>
                <td className="bg-black/[0.03] px-3 text-right num font-semibold text-green">{$(esperado(i))}</td>
                <td className="rounded-r-xl bg-black/[0.03] px-3 text-right text-xs max-w-[26rem]">
                  {i.flete_dev > 0
                    ? `Wallet solo tiene el cargo de flete de devolución (−${$(i.flete_dev)}) y la guía figura entregada — pedir a Effi que retroceda la devolución y liquide la venta`
                    : "Guía entregada sin ningún movimiento de recaudo en el wallet — pedir a Effi que la liquide"}
                </td>
              </tr>
            ))}
            <tr>
              <td className="rounded-l-xl border-l-4 border-text bg-black/[0.06] pl-3 py-2.5 font-semibold" colSpan={6}>TOTAL ({entero(p.length)} {p.length === 1 ? "guía" : "guías"})</td>
              <td className="bg-black/[0.06] px-3 text-right num font-semibold text-green">{$(total)}</td>
              <td className="rounded-r-xl bg-black/[0.06]" />
            </tr>
          </tbody>
        </table>
      ) : <p className="text-sm text-muted py-4 text-center">Sin guías entregadas pendientes de pago. 🎉</p>}
    </Recuadro>
  );
}

function Proyeccion({ filas, $, bodega }: { filas: NonNullable<Awaited<ReturnType<typeof kpiPendientes>>["data"]>["proyeccion"]; $: (v: number) => string; bodega?: string }) {
  const n = filas.reduce((a, x) => a + x.n, 0), flete = filas.reduce((a, x) => a + x.flete_proyectado, 0), full = filas.reduce((a, x) => a + Number(x.fulfillment), 0);
  return (
    <Recuadro titulo="Proyección: si lo pendiente termina en devolución"
      ayuda="Peor caso: todo lo que sigue abierto en el periodo (en tránsito, novedad, en oficina, pendiente) termina devuelto. Se proyecta el flete de devolución promedio real de Effi. El costo de mercancía no aplica en devolución. El fulfillment ya cobrado ya está en el PyG. Cuando una guía se entrega, sale de aquí y su resultado pasa a positivo.">
      <table className="w-full border-separate border-spacing-y-1.5 text-sm">
        <thead>
          <tr>
            <th className={`${TH} text-left`}>Plataforma</th><th className={`${TH} text-right`}>Estado actual</th><th className={`${TH} text-right`}># Órdenes</th>
            <th className={`${TH} text-right`}>Flete devolución proyectado</th>
            {bodega && <th className={`${TH} text-right`}>Fulfillment ({bodega})</th>}
            <th className={`${TH} text-right`}>Pérdida total proyectada</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((x) => {
            const c = COLOR_ESTADO[x.estado] ?? "var(--muted)";
            return (
              <tr key={`${x.plataforma}-${x.estado}`}>
                <td {...fila(COLOR_PLATAFORMA[x.plataforma])}>
                  <span className="inline-flex items-center gap-2 font-semibold"><span className="size-2 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />{x.plataforma}</span>
                </td>
                <td className="bg-black/[0.03] px-3 text-right">{NOMBRE_ESTADO[x.estado] ?? x.estado}</td>
                <td className="bg-black/[0.03] px-3 text-right num">{entero(x.n)}</td>
                <td className="bg-black/[0.03] px-3 text-right num" title={x.flete_dev_prom != null ? `${entero(x.n)} × ${$(x.flete_dev_prom)}` : undefined}>{$(x.flete_proyectado)}</td>
                {bodega && <td className="bg-black/[0.03] px-3 text-right num">{Number(x.fulfillment) ? `${$(Number(x.fulfillment))} (ya en PyG)` : "—"}</td>}
                <td className="rounded-r-xl bg-black/[0.03] px-3 text-right num text-red">{$(-x.flete_proyectado)}</td>
              </tr>
            );
          })}
          {!filas.length && <tr><td colSpan={6} className="text-sm text-muted py-4 text-center">Nada pendiente en el periodo.</td></tr>}
          <tr>
            <td className="rounded-l-xl border-l-4 border-text bg-black/[0.06] pl-3 py-2.5 font-semibold" colSpan={2}>TOTAL PROYECTADO</td>
            <td className="bg-black/[0.06] px-3 text-right num font-semibold">{entero(n)}</td>
            <td className="bg-black/[0.06] px-3 text-right num font-semibold">{$(flete)}</td>
            {bodega && <td className="bg-black/[0.06] px-3 text-right num font-semibold">{$(full)}</td>}
            <td className="rounded-r-xl bg-black/[0.06] px-3 text-right num font-semibold text-red">{$(-flete)}</td>
          </tr>
        </tbody>
      </table>
    </Recuadro>
  );
}

// Gastos del mes en moneda local. La nómina (administrativos) viene por quincena: "Daniel (1-15 sep)".
function Gastos({ titulo, lineas, meses, $, totalLabel, nomina }: {
  titulo: string; lineas: { mes: string; concepto: string; monto: number }[]; meses: string[]; $: (v: number) => string; totalLabel: string; nomina?: boolean;
}) {
  const leer = (l: (typeof lineas)[number]) => {
    const m = /^(.*?)\s*\((\d{1,2})\s*-\s*(\d{1,2})[^)]*\)\s*$/.exec(l.concepto);
    return { nombre: (m ? m[1] : l.concepto).trim(), col: m ? `${l.mes}|${m[2]}-${m[3]}` : `${l.mes}|mes` };
  };
  const cols = [...new Set(lineas.map((l) => leer(l).col))].sort();
  const etiqueta = (c: string) => {
    const [mes, tramo] = c.split("|");
    const nombreMes = MESES[Number(mes.slice(5, 7)) - 1];
    return tramo === "mes" ? `${MESES_LARGO[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}` : `${tramo.replace("-", "–")} ${nombreMes}`;
  };
  const nombres = [...new Set(lineas.map((l) => leer(l).nombre))].sort((a, b) => a.localeCompare(b, "es"));
  const valor = (nombre: string, col: string) => lineas.filter((l) => leer(l).nombre === nombre && leer(l).col === col).reduce((a, l) => a + Number(l.monto), 0);
  const totalCol = (col: string) => lineas.filter((l) => leer(l).col === col).reduce((a, l) => a + Number(l.monto), 0);
  const total = lineas.reduce((a, l) => a + Number(l.monto), 0);
  const sinDatos = meses.filter((m) => !lineas.some((l) => l.mes === m));

  return (
    <Recuadro titulo={titulo}
      ayuda="Se cargan a mano o por Excel: estos gastos se pagan por fuera de Effi. Se toman los meses completos que toca el calendario (no se prorratean por días). La nómina va por quincena: 1–15 y 16–fin de mes.">
      {lineas.length ? (
        <table className="w-full border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>Concepto</th>
              {nomina && <th className={`${TH} text-left`}>Descripción</th>}
              {cols.map((c) => <th key={c} className={`${TH} text-right`}>{etiqueta(c)}</th>)}
              <th className={`${TH} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {nombres.map((n) => (
              <tr key={n}>
                <td {...fila("var(--blue-2)")}><span className="font-semibold">{nomina ? "Nómina" : n}</span></td>
                {nomina && <td className="bg-black/[0.03] px-3">{n}</td>}
                {cols.map((c) => <td key={c} className="bg-black/[0.03] px-3 text-right num">{$(valor(n, c))}</td>)}
                <td className="rounded-r-xl bg-black/[0.03] px-3 text-right num font-semibold">{$(cols.reduce((a, c) => a + valor(n, c), 0))}</td>
              </tr>
            ))}
            <tr>
              <td className="rounded-l-xl border-l-4 border-text bg-black/[0.06] pl-3 py-2.5 font-semibold" colSpan={nomina ? 2 : 1}>{totalLabel}</td>
              {cols.map((c) => <td key={c} className="bg-black/[0.06] px-3 text-right num font-semibold">{$(totalCol(c))}</td>)}
              <td className="rounded-r-xl bg-black/[0.06] px-3 text-right num font-semibold">{$(total)}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
      {sinDatos.length > 0 && (
        <p className="text-xs text-amber mt-2">Sin gastos cargados para {sinDatos.map((m) => `${MESES_LARGO[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`).join(", ")}.</p>
      )}
    </Recuadro>
  );
}
