import { dinero, entero } from "@/lib/formato";
import { Panel, TablaScroll } from "./ui";

// Tablero de una empresa de proveeduría con los bloques de indicadores de Effi (prov_tablero): ventas a las tiendas,
// inventario, compras, cartera, tesorería, wallet, clientes y alertas. Primera versión: muestra todo lo que trae Effi;
// el dueño irá diciendo qué quitar, cambiar o agregar.

type Lista = { ids?: number[]; categorias: string[]; valores: number[] };
type Serie = { categorias: string[]; series: { id?: number; nombre: string; datos: number[] }[] };
type Bloque = { kpis?: Record<string, number | null>; kpis_anterior?: Record<string, number | null>; graficos?: Record<string, Lista & Serie>; _desde?: string; _hasta?: string; _actualizado?: string; [k: string]: unknown };
type FilaArt = { id: number; nombre: string; categoria?: string; stock_actual: number; valor_stock: number; valor_vendido?: number; cantidad?: number | null; ultima_venta?: string | null; faltante?: number; stock_minimo?: number };
export type DatosProveeduria = Partial<Record<"ventas" | "compras" | "inventario" | "cartera" | "tesoreria" | "wallets" | "clientes" | "alertas", Bloque>>;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const corto = (iso: string) => `${Number(iso.slice(8, 10))}-${MESES[Number(iso.slice(5, 7)) - 1]}`;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const pctTxt = (v: number | null | undefined, dec = 1) => (v == null || Number.isNaN(v) ? "—" : `${v.toFixed(dec).replace(".", ",")}%`);
const cambio = (act?: number | null, ant?: number | null) => (act == null || !ant ? null : ((act - ant) / Math.abs(ant)) * 100);

function Kpi({ titulo, valor, color = "var(--text)", sub, delta }: { titulo: string; valor: string; color?: string; sub?: string; delta?: number | null }) {
  return (
    <div className="card p-4 border-t-2" style={{ borderTopColor: color }}>
      <div className="text-[11px] uppercase tracking-widest font-mono text-muted">{titulo}</div>
      <div className="num text-2xl font-semibold mt-1" style={{ color }}>{valor}</div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted">
        {delta != null && <span className={delta >= 0 ? "text-green" : "text-red"}>{delta >= 0 ? "▲" : "▼"} {pctTxt(Math.abs(delta), 0)} vs. periodo anterior</span>}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

// Ranking con barras horizontales (tiendas, productos, proveedores, deudores…).
function Top({ titulo, detalle, l, fmt, color = "var(--blue)", max = 10 }: { titulo: string; detalle?: string; l?: Lista; fmt: (v: number) => string; color?: string; max?: number }) {
  const filas = (l?.categorias ?? []).map((c, i) => ({ c, v: num(l!.valores[i]) })).slice(0, max);
  const tope = Math.max(1, ...filas.map((f) => f.v));
  return (
    <Panel titulo={titulo} detalle={detalle}>
      {filas.length ? (
        <div className="space-y-2">
          {filas.map((f, i) => (
            <div key={i} className="text-xs">
              <div className="flex justify-between gap-3"><span className="truncate" title={f.c}>{f.c}</span><span className="num shrink-0 font-semibold">{fmt(f.v)}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-black/5 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(f.v / tope) * 100}%`, background: color }} /></div>
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-muted">Sin datos en este periodo.</p>}
    </Panel>
  );
}

// Barras verticales por día (ventas, compras, wallet).
function PorDia({ s, serie, fmt, color }: { s?: Serie; serie: string; fmt: (v: number) => string; color: string }) {
  const datos = s?.series.find((x) => x.nombre === serie)?.datos ?? s?.series.at(-1)?.datos ?? [];
  const cats = s?.categorias ?? [];
  const tope = Math.max(1, ...datos.map(num));
  if (!cats.length) return <p className="text-sm text-muted">Sin datos en este periodo.</p>;
  return (
    <div className="flex items-end gap-1 h-40">
      {cats.map((c, i) => (
        <div key={c} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${c.length === 10 ? corto(c) : c}: ${fmt(num(datos[i]))}`}>
          <div className="w-full rounded-t" style={{ height: `${(num(datos[i]) / tope) * 100}%`, minHeight: num(datos[i]) ? 2 : 0, background: color }} />
          <span className="mt-1 text-[9px] text-muted truncate w-full text-center">{c.length === 10 ? Number(c.slice(8, 10)) : c}</span>
        </div>
      ))}
    </div>
  );
}

export function TableroProveeduria({ cuenta, datos }: { cuenta: string; datos: DatosProveeduria }) {
  const $ = (v: number) => dinero(v, cuenta);
  const v = datos.ventas?.kpis ?? {}, va = datos.ventas?.kpis_anterior ?? {};
  const g = datos.ventas?.graficos ?? {};
  const inv = datos.inventario, ik = inv?.kpis ?? {};
  const c = datos.compras?.kpis ?? {}, ca = datos.compras?.kpis_anterior ?? {}, cg = datos.compras?.graficos ?? {};
  const car = datos.cartera?.kpis ?? {}, carg = datos.cartera?.graficos ?? {};
  const t = datos.tesoreria?.kpis ?? {};
  const w = datos.wallets?.kpis ?? {}, wg = datos.wallets?.graficos ?? {};
  const cl = datos.clientes?.kpis ?? {};
  const alertas = (datos.alertas?.alertas ?? []) as { clave: string; titulo: string; cantidad: number; nivel: string; valor: number | null }[];
  // Días del periodo del inventario (este mes hasta hoy) para estimar cuántos días de venta quedan en bodega.
  const diasInv = inv?._desde && inv?._hasta ? Math.max(1, (Date.parse(inv._hasta) - Date.parse(inv._desde)) / 86_400_000 + 1) : 30;
  const masVendidos = ((inv?.mas_vendidos as { filas?: FilaArt[] })?.filas ?? []).slice(0, 15);
  const sinRot = ((inv?.sin_rotacion as { filas?: FilaArt[]; total?: number })?.filas ?? []).slice(0, 10);
  const porAgotarse = ((inv?.bajo_stock_minimo as { filas?: FilaArt[] })?.filas ?? []).slice(0, 10);
  const antig = carg.antiguedad as Serie | undefined;
  const saldosCuentas = (datos.tesoreria?.saldos_cuentas ?? []) as { id: number; nombre: string; nombre_banco: string; divisa: string; saldo: number }[];
  const saldosCajas = (datos.tesoreria?.saldos_cajas ?? []) as { id: number; nombre: string; estado: string; cajero: string | null; saldo: number }[];
  const periodo = datos.ventas?._desde && datos.ventas?._hasta ? (datos.ventas._desde === datos.ventas._hasta ? corto(datos.ventas._desde) : `${corto(datos.ventas._desde)} al ${corto(datos.ventas._hasta)}`) : "";

  return (
    <div className="space-y-6">
      {alertas.some((a) => a.cantidad > 0) && (
        <div className="flex flex-wrap gap-2">
          {alertas.filter((a) => a.cantidad > 0).map((a) => (
            <span key={a.clave} className={`rounded-full border px-3 py-1 text-xs ${a.nivel === "critico" ? "border-red/50 bg-red/10 text-red" : a.nivel === "alerta" ? "border-amber/50 bg-amber/10 text-amber" : "border-line text-muted"}`}>
              {a.nivel === "critico" ? "⛔" : "⚠️"} {a.titulo}: <b className="num">{entero(a.cantidad)}</b>
            </span>
          ))}
        </div>
      )}

      {/* Ventas a las tiendas */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold">💰 Ventas a las tiendas <span className="text-sm font-normal text-muted">· {periodo}</span></h2>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi titulo="Ventas" valor={$(num(v.ventas))} color="var(--green)" delta={cambio(v.ventas, va.ventas)} />
          <Kpi titulo="Margen" valor={$(num(v.margen))} color="var(--blue-2)" sub={`${pctTxt(v.pct_margen)} de margen`} delta={cambio(v.margen, va.margen)} />
          <Kpi titulo="Costo" valor={$(num(v.costo))} color="var(--muted)" />
          <Kpi titulo="Documentos" valor={entero(v.documentos)} delta={cambio(v.documentos, va.documentos)} sub={`${$(num(v.remisiones))} en remisiones · ${$(num(v.facturas))} en facturas`} />
          <Kpi titulo="Ticket promedio" valor={$(num(v.ticket_promedio))} delta={cambio(v.ticket_promedio, va.ticket_promedio)} />
          <Kpi titulo="Tiendas que compraron" valor={entero(v.clientes)} color="#ff6ad5" delta={cambio(v.clientes, va.clientes)} sub={v.devoluciones ? `Devoluciones ${$(num(v.devoluciones))}` : undefined} />
        </div>
        <Panel titulo="Ventas por día" detalle="Remisiones y facturas de venta, en la moneda de la empresa">
          <PorDia s={g.tiempo} serie="Total ventas" fmt={$} color="var(--green)" />
        </Panel>
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <Top titulo="Tiendas que más compran" l={g.clientes} fmt={$} color="#ff6ad5" />
          <Top titulo="Productos más vendidos" detalle="Por valor vendido" l={g.articulos} fmt={$} color="var(--green)" />
          <Top titulo="Cómo se vendió" detalle="Remisiones por origen (cantidad)" l={g.remisiones_por_origen} fmt={entero} color="var(--blue)" />
          <Top titulo="Ciudades" l={g.ciudad} fmt={$} color="var(--amber)" />
        </div>
      </section>

      {/* Inventario */}
      {inv && (
        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold">📦 Inventario <span className="text-sm font-normal text-muted">· foto de hoy</span></h2>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="Valor del inventario" valor={$(num(ik.valor_inventario))} color="var(--blue-2)" sub="al costo" />
            <Kpi titulo="Productos con existencias" valor={entero(ik.articulos_con_stock)} />
            <Kpi titulo="Por agotarse" valor={entero(ik.bajo_minimo)} color={num(ik.bajo_minimo) ? "var(--red)" : "var(--green)"} sub="debajo del mínimo" />
            <Kpi titulo="Sin rotación 90 días" valor={entero(ik.sin_rotacion_90)} color="var(--amber)" sub="con existencias y sin ventas" />
          </div>
          <Panel titulo="Más vendidos y cuánto queda" detalle={`Este mes. Días de venta = existencias ÷ venta diaria del mes; en rojo si quedan menos de 7 días.`}>
            <TablaScroll>
              <thead><tr><th>Producto</th><th>Categoría</th><th className="text-right">Unidades vendidas</th><th className="text-right">Valor vendido</th><th className="text-right">Existencias</th><th className="text-right">Días de venta</th><th>Última venta</th></tr></thead>
              <tbody>
                {masVendidos.map((f) => {
                  const diario = f.cantidad ? f.cantidad / diasInv : 0;
                  const dias = diario ? f.stock_actual / diario : null;
                  return (
                    <tr key={f.id}>
                      <td className="font-semibold">{f.nombre}</td><td className="text-muted">{f.categoria || "—"}</td>
                      <td className="text-right num">{entero(f.cantidad)}</td><td className="text-right num">{$(num(f.valor_vendido))}</td>
                      <td className="text-right num">{entero(f.stock_actual)}</td>
                      <td className={`text-right num font-semibold ${dias == null ? "text-muted" : dias < 7 ? "text-red" : dias < 15 ? "text-amber" : "text-green"}`}>{dias == null ? "—" : entero(Math.round(dias))}</td>
                      <td className="text-muted">{f.ultima_venta ? corto(f.ultima_venta) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TablaScroll>
          </Panel>
          <div className="grid gap-3 xl:grid-cols-2">
            <Panel titulo="Plata quieta: sin ventas en 90 días" detalle={`Los 10 con más valor en bodega · ${entero((inv?.sin_rotacion as { total?: number })?.total)} productos en total`}>
              <TablaScroll>
                <thead><tr><th>Producto</th><th className="text-right">Existencias</th><th className="text-right">Valor en bodega</th><th>Última venta</th></tr></thead>
                <tbody>{sinRot.map((f) => <tr key={f.id}><td>{f.nombre}</td><td className="text-right num">{entero(f.stock_actual)}</td><td className="text-right num">{$(num(f.valor_stock))}</td><td className="text-muted">{f.ultima_venta ? corto(f.ultima_venta) : "nunca"}</td></tr>)}</tbody>
              </TablaScroll>
            </Panel>
            <Panel titulo="Por agotarse" detalle="Debajo del mínimo configurado en Effi">
              {porAgotarse.length ? (
                <TablaScroll>
                  <thead><tr><th>Producto</th><th className="text-right">Existencias</th><th className="text-right">Mínimo</th><th className="text-right">Faltan</th></tr></thead>
                  <tbody>{porAgotarse.map((f) => <tr key={f.id}><td>{f.nombre}</td><td className="text-right num">{entero(f.stock_actual)}</td><td className="text-right num">{entero(f.stock_minimo)}</td><td className="text-right num text-red">{entero(f.faltante)}</td></tr>)}</tbody>
                </TablaScroll>
              ) : <p className="text-sm text-muted">Ningún producto debajo del mínimo. (Si en Effi no hay mínimos configurados, aquí no sale nada: mira "Días de venta" arriba).</p>}
            </Panel>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Top titulo="Valor por categoría" l={inv.graficos?.valor_categoria} fmt={$} color="var(--blue-2)" />
            <Top titulo="Valor por bodega" l={inv.graficos?.valor_bodega} fmt={$} color="var(--blue)" />
          </div>
        </section>
      )}

      {/* Compras */}
      {datos.compras && (
        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold">🛍️ Compras <span className="text-sm font-normal text-muted">· {periodo}</span></h2>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="Compras" valor={$(num(c.compras))} color="var(--amber)" delta={cambio(c.compras, ca.compras)} />
            <Kpi titulo="Documentos" valor={entero(c.documentos)} sub={`${entero(c.proveedores)} proveedores`} />
            <Kpi titulo="Ticket de compra" valor={$(num(c.ticket_promedio))} />
            <Kpi titulo="Gastos (egresos)" valor={$(num(c.egresos))} sub={`${entero(c.comprobantes)} comprobantes`} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel titulo="Compras por día"><PorDia s={cg.tiempo} serie="Total compras" fmt={$} color="var(--amber)" /></Panel>
            <Top titulo="Proveedores a los que más compramos" l={cg.proveedores} fmt={$} color="var(--amber)" />
            <Top titulo="Productos más comprados" l={cg.articulos} fmt={$} color="var(--amber)" />
          </div>
        </section>
      )}

      {/* Cartera */}
      {datos.cartera && (
        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold">🧾 Cartera <span className="text-sm font-normal text-muted">· foto de hoy</span></h2>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi titulo="Nos deben" valor={$(num(car.cxc_total))} color="var(--green)" sub={`${entero(car.cxc_documentos)} documentos`} />
            <Kpi titulo="Vencido por cobrar" valor={$(num(car.cxc_vencida))} color="var(--red)" sub={`${pctTxt(car.pct_cxc_vencida)} de lo que nos deben`} />
            <Kpi titulo="Días para cobrar" valor={entero(Math.round(num(car.dso)))} sub="promedio (DSO)" />
            <Kpi titulo="Debemos" valor={$(num(car.cxp_total))} color="var(--amber)" sub={`${entero(car.cxp_documentos)} documentos`} />
            <Kpi titulo="Vencido por pagar" valor={$(num(car.cxp_vencida))} color="var(--red)" sub={pctTxt(car.pct_cxp_vencida)} />
            <Kpi titulo="Posición neta" valor={$(num(car.posicion_neta))} color="var(--blue-2)" sub="nos deben − debemos" />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel titulo="Antigüedad">
              <TablaScroll>
                <thead><tr><th>Días</th>{antig?.series.map((s) => <th key={s.nombre} className="text-right">{s.nombre}</th>)}</tr></thead>
                <tbody>{antig?.categorias.map((cat, i) => <tr key={cat}><td>{cat}</td>{antig.series.map((s) => <td key={s.nombre} className="text-right num">{$(num(s.datos[i]))}</td>)}</tr>)}</tbody>
              </TablaScroll>
            </Panel>
            <Top titulo="Quiénes nos deben más" l={carg.deudores} fmt={$} color="var(--green)" />
            <Top titulo="A quiénes les debemos más" l={carg.acreedores} fmt={$} color="var(--amber)" />
          </div>
        </section>
      )}

      {/* Tesorería y wallet */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold">🏦 Bancos, cajas y wallet</h2>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {datos.tesoreria && <>
            <Kpi titulo="Saldo total" valor={$(num(t.saldo_total))} color="var(--blue-2)" sub="bancos + cajas" />
            <Kpi titulo="Bancos" valor={$(num(t.saldo_bancos))} />
            <Kpi titulo="Cajas" valor={$(num(t.saldo_cajas))} color={num(t.saldo_cajas) < 0 ? "var(--red)" : "var(--text)"} />
            <Kpi titulo="Flujo del mes" valor={$(num(t.flujo_neto))} color={num(t.flujo_neto) < 0 ? "var(--red)" : "var(--green)"} sub={`entró ${$(num(t.ingresos))} · salió ${$(num(t.egresos))}`} />
          </>}
          {datos.wallets && <>
            <Kpi titulo="Wallet disponible" valor={$(num(w.saldo_disponible))} color="var(--green)" />
            <Kpi titulo="Wallet en el periodo" valor={$(num(w.neto_periodo))} color={num(w.neto_periodo) < 0 ? "var(--red)" : "var(--green)"} sub={`+${$(num(w.creditos_periodo))} · −${$(num(w.debitos_periodo))} · retiros ${$(num(w.retiros_periodo))}`} />
          </>}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel titulo="Cuentas bancarias">
            <TablaScroll>
              <thead><tr><th>Cuenta</th><th>Banco</th><th className="text-right">Saldo</th></tr></thead>
              <tbody>{saldosCuentas.map((s) => <tr key={s.id}><td>{s.nombre}</td><td className="text-muted">{s.nombre_banco?.replace(/‌/g, "")}</td><td className="text-right num">{dinero(s.saldo, cuenta)}</td></tr>)}</tbody>
            </TablaScroll>
          </Panel>
          <Panel titulo="Cajas">
            <TablaScroll>
              <thead><tr><th>Caja</th><th>Estado</th><th className="text-right">Saldo</th></tr></thead>
              <tbody>{saldosCajas.map((s) => <tr key={s.id}><td>{s.nombre}</td><td className="text-muted">{s.estado}{s.cajero ? ` · ${s.cajero.split("@")[0]}` : ""}</td><td className={`text-right num ${s.saldo < 0 ? "text-red" : ""}`}>{$(s.saldo)}</td></tr>)}</tbody>
            </TablaScroll>
          </Panel>
          <Top titulo="Movimientos del wallet por tipo" detalle={periodo} l={wg.totales_tipo} fmt={$} color="var(--green)" />
        </div>
      </section>

      {/* Clientes (tiendas) */}
      {datos.clientes && (
        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold">🏪 Tiendas clientes <span className="text-sm font-normal text-muted">· {periodo}</span></h2>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <Kpi titulo="Activas" valor={entero(cl.activos)} color="var(--green)" sub="compraron en el periodo" />
            <Kpi titulo="Recurrentes" valor={entero(cl.recurrentes)} color="var(--blue-2)" />
            <Kpi titulo="Nuevas que compraron" valor={entero(cl.activos_nuevos)} color="#ff6ad5" />
            <Kpi titulo="Registradas nuevas" valor={entero(cl.nuevos)} />
            <Kpi titulo="Perdidas" valor={entero(cl.perdidos)} color="var(--red)" sub="compraban y dejaron de comprar" />
          </div>
        </section>
      )}
    </div>
  );
}
