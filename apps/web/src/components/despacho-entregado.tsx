import type { ReactNode } from "react";
import { kpiDespacho, kpiUtilidad, type Utilidad } from "@/lib/datos";
import type { Filtros } from "@/lib/filtros";
import { diaCorto, dinero, entero } from "@/lib/formato";
import { TARIFA_FULFILLMENT, infoCuenta } from "@/lib/paises";

// Bloque "Despachado vs Entregado" (pestaña Datos), con los datos de Effi en vivo.
// Despachado = todo lo montado en el periodo (sin anuladas ni canceladas). Costo = 0 en devoluciones.

export async function DespachoEntregado({ f }: { f: Filtros }) {
  const cuenta = f.cuentas?.[0] ?? "TIENDA_CO";
  const [{ data: d, error }, ut] = await Promise.all([kpiDespacho(cuenta, f.desde, f.hasta), kpiUtilidad(cuenta, f.desde, f.hasta)]);
  if (error || !d) return <p className="text-sm text-red">No se pudo calcular despachado vs entregado: {error}</p>;
  const u = ut.data;
  const $ = (v: number) => dinero(v, cuenta);
  const pctDe = (v: number, base: number) => (base ? `${((v / base) * 100).toFixed(1).replace(".", ",")}%` : null);
  const prom = (v: number, n: number) => (n ? $(v / n) : "—");

  const tarifa = TARIFA_FULFILLMENT[cuenta];
  // Effi: tarifa por guía despachada (GT/EC), 4x1000 (CO) o, en las demás cuentas, el fulfillment que Effi cobra
  // directamente en el wallet.
  const P = d.plataformas;
  const delWallet = tarifa == null && Number(d.fulfillment_wallet ?? 0) !== 0;
  const full = tarifa != null
    ? { total: P.effi * tarifa, label: "Fulfillment" }
    : delWallet
      ? { total: Number(d.fulfillment_wallet) + d.x4, label: "Fulfillment" }
      : { total: d.x4, label: "4x1000" };
  const fullSub = [
    P.effi ? (tarifa != null ? `${entero(P.effi)} guías Effi × ${$(tarifa)} por despacho`
      : delWallet ? "Lo que Effi cobró en el wallet por fulfillment (bodegaje, alistamiento, empaque)"
      : "4x1000 cobrado en el wallet sobre el recaudo") : null,
  ].filter(Boolean).join(" · ");
  const D = d.despachado, E = d.entregado;
  const ads = u?.publicidad;
  const hayAds = ads?.total != null;
  const adsSub = !ads?.fuente ? "Sin publicidad cargada para este periodo."
    : ads.fuente === "mensual" ? "Total mensual de Meta (mes sin dato por día)."
    : `Meta · ${entero(ads.dias)} días con gasto, hasta ${diaCorto(ads.ultimo)}${ads.ultimo && ads.ultimo < f.hasta ? " (faltan días por cargar)" : ""}. COP convertido con la TRM del mes.`;

  return (
    <section className="space-y-3">
      <Fila titulo="Despachado" detalle="Todo lo montado en el periodo, sin importar su estado (sin anuladas ni canceladas)">
        <Tarjeta titulo="Ventas" valor={entero(D.n)} />
        <Tarjeta titulo="Venta total (despachado)" badge={pctDe(D.venta, D.venta)} valor={$(D.venta)} ayuda={`${entero(D.n)} guías despachadas`} pie={prom(D.venta, D.n)} />
        <Tarjeta titulo="Costo mercancía (despachado)" badge={pctDe(D.costo, D.venta)} valor={$(D.costo)}
          ayuda={D.costo_estimadas ? `Incluye ${entero(D.costo_estimadas)} guías aún sin cobro de mercancía (costo estimado por producto). Devoluciones en 0.` : "Devoluciones en 0."}
          pie={prom(D.costo, D.n)} />
        <Tarjeta titulo="Flete (despachado)" badge={pctDe(D.flete, D.venta)} valor={$(D.flete)} pie={prom(D.flete, D.n)} />
        <Tarjeta titulo="Publicidad (sobre despachado)" badge={hayAds ? pctDe(ads!.total!, D.venta) : null} valor={hayAds ? $(ads!.total!) : "—"}
          ayuda={adsSub} pie={hayAds ? prom(ads!.total!, D.n) : "—"} pendiente={!hayAds} />
        <Tarjeta titulo={`${full.label} (despachado)`} badge={pctDe(full.total, D.venta)} valor={$(full.total)}
          ayuda={fullSub} pie={prom(full.total, D.n)} />
      </Fila>

      <Fila titulo="Entregado" detalle="Solo lo entregado al cliente (el wallet manda: si hay recaudo, cuenta como entregada)">
        <Tarjeta titulo="Ventas entregadas" valor={entero(E.n)} />
        <Tarjeta titulo="Venta total (entregado)" badge={pctDe(E.venta, E.venta)} valor={$(E.venta)} pie={prom(E.venta, E.n)} />
        <Tarjeta titulo="Costo mercancía (entregado)" badge={pctDe(E.costo, E.venta)} valor={$(E.costo)}
          ayuda={E.costo_estimadas ? `${entero(E.costo_estimadas)} entregadas sin cobro de mercancía aún (estimado)` : "Costo real: wallet de Effi"}
          pie={prom(E.costo, E.n)} />
        <Tarjeta titulo="Flete (entregado)" badge={pctDe(E.flete, E.venta)} valor={$(E.flete)} pie={prom(E.flete, E.n)}>
          <div className="mt-2 space-y-0.5">
            {d.transportadoras.map((t) => (
              <div key={t.nombre} title={`${entero(t.envios)} envíos`} className="flex items-baseline gap-1.5 text-[10px] font-mono leading-tight">
                <span className="truncate flex-1 font-semibold">{t.nombre}</span>
                <span className="text-blue-2 shrink-0">{E.n ? Math.round((t.envios / E.n) * 100) : 0}%</span>
                <span className="text-muted shrink-0">{prom(t.flete, t.envios)}</span>
              </div>
            ))}
          </div>
        </Tarjeta>
        <Tarjeta titulo="Publicidad (sobre entregado)" badge={hayAds ? pctDe(ads!.total!, E.venta) : null} valor={hayAds ? $(ads!.total!) : "—"}
          ayuda={hayAds ? `Mismo gasto, repartido sobre ${entero(E.n)} guías entregadas` : adsSub} pie={hayAds ? prom(ads!.total!, E.n) : "—"} pendiente={!hayAds} />
        <Tarjeta titulo={`${full.label} (entregado)`} badge={pctDe(full.total, E.venta)} valor={$(full.total)}
          ayuda={`Mismo valor del despachado, repartido sobre ${entero(E.n)} guías entregadas`}
          pie={prom(full.total, E.n)} />
      </Fila>

      {u ? <UtilidadNeta u={u} ventaTotal={D.venta} cuenta={cuenta} /> : <p className="text-sm text-red">No se pudo calcular la utilidad neta: {ut.error}</p>}
    </section>
  );
}

export function Fila({ titulo, detalle, children }: { titulo: string; detalle: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="font-display font-semibold">{titulo}</h2>
        <span className="text-xs text-muted">{detalle}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">{children}</div>
    </div>
  );
}

// "ayuda" no se muestra en la tarjeta: queda como texto al pasar el mouse para no alargar los recuadros.
export function Tarjeta({ titulo, valor, badge, ayuda, pie, pendiente, children }: {
  titulo: string; valor: string; badge?: string | null; ayuda?: string; pie?: string; pendiente?: boolean; children?: ReactNode;
}) {
  return (
    <div title={ayuda} className={`card flex flex-col p-4 border-t-2 ${pendiente ? "border-t-black/15" : "border-t-blue"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] uppercase tracking-widest font-mono text-muted leading-snug">{titulo}</div>
        {badge && <span className="shrink-0 rounded-full bg-blue/20 text-blue-2 px-2 py-0.5 text-[11px] font-mono font-semibold">{badge}</span>}
      </div>
      {/* Los montos en pesos colombianos son largos: letra un poco menor para que no se corten. */}
      <div className={`num font-semibold mt-2 whitespace-nowrap ${valor.length > 12 ? "text-xl" : "text-2xl"} ${pendiente ? "text-muted" : ""}`}>{valor}</div>
      {children}
      {pie != null && (
        <div className="mt-auto pt-3">
          <div className="border-t border-dashed border-line pt-2 text-[11px] font-mono text-muted">
            Promedio: <span className="text-text font-semibold">{pie}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// "Resumen real: utilidad neta": solo el resultado y su % sobre la venta total.
// El desglose (PyG, proyección de pendientes, publicidad y gastos) va en la pestaña 📈 Utilidad.
export function UtilidadNeta({ u, ventaTotal, cuenta }: { u: Pick<Utilidad, "utilidad_neta">; ventaTotal: number; cuenta: string }) {
  const neta = u.utilidad_neta;
  return (
    <div className="card card-glow p-5">
      <div className="text-[11px] uppercase tracking-widest font-mono text-green">Resumen real: utilidad neta</div>
      <div className={`num text-4xl font-semibold mt-1 ${neta >= 0 ? "text-green" : "text-red"}`}>{dinero(neta, cuenta)}</div>
      <div className="text-sm text-muted mt-1">
        {ventaTotal ? `${((neta / ventaTotal) * 100).toFixed(1).replace(".", ",")}%` : "—"} de utilidad neta real sobre venta total
      </div>
    </div>
  );
}
