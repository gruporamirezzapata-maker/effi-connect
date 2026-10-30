"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type Pago = {
  cuenta: string; sucursal: number; orden_id: number; orden: string; pedido: string | null; tienda: string | null;
  cliente: string | null; telefono: string | null; ciudad: string | null; total: number; pasarela: string | null;
  estado_shopify: string | null; estado: "pendiente" | "llego" | "no_llego"; nota: string | null;
  decidido_por: string | null; decidido_en: string | null; creado: string;
  fecha_pedido: string | null; productos: string | null; direccion: string | null; documento: string | null; referencia: string | null;
};

const cop = (v: number) => "$" + Math.round(Number(v) || 0).toLocaleString("es-CO");
const hora = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
  : "";
// Fecha y hora exacta en Bogotá, con segundos, para cruzarla con el movimiento en Bold o en el banco.
const exacta = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })
  : "Sin fecha";
const horasDesde = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
const BTN = "h-11 rounded-lg px-5 text-xs font-semibold uppercase tracking-[0.16em] active:scale-[0.97] transition disabled:opacity-40";

export function PagosVerificar({ pendientes, decididos, error }: { pendientes: Pago[]; decididos: Pago[]; error: string | null }) {
  const router = useRouter();
  const [refrescando, start] = useTransition();
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");

  const decidir = async (p: Pago, estado: Pago["estado"]) => {
    const k = `${p.sucursal}-${p.orden_id}`;
    setEnCurso(k);
    const { error: e } = await createClient().rpc("pago_decidir", {
      p_sucursal: p.sucursal, p_orden_id: p.orden_id, p_estado: estado, p_cuenta: p.cuenta,
    });
    setEnCurso(null);
    if (e) { setAviso("No se guardó: " + e.message); return; }
    setAviso(estado === "llego" ? `${p.orden}: confirmado, sale sin recaudo` : estado === "no_llego" ? `${p.orden}: frenado` : `${p.orden}: vuelve a pendientes`);
    setTimeout(() => setAviso(""), 2500);
    start(() => router.refresh());
  };

  if (error) return <div className="card p-6 text-sm text-red">{error}</div>;

  return (
    <div className="space-y-10">
      {aviso && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-transparent ring-[1.5px] ring-inset ring-text px-5 py-3 text-sm shadow-lg">{aviso}</div>
      )}

      <section>
        <div className="flex items-baseline justify-between gap-4 mb-4">
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted/70">Por verificar</p>
          <button onClick={() => start(() => router.refresh())} disabled={refrescando}
            className="text-[11px] uppercase tracking-[0.18em] text-muted hover:text-text disabled:opacity-40">
            {refrescando ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
        {pendientes.length === 0 ? (
          <div className="card p-6 text-sm text-muted">No hay pagos por verificar. Cuando caiga un pedido pagado en Shopify aparece aquí.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {pendientes.map((p) => {
              const k = `${p.sucursal}-${p.orden_id}`;
              const h = horasDesde(p.creado);
              return (
                <article key={k} className="card p-5 flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted/70">
                        {p.tienda ?? "Tienda"} · {p.pedido ?? ""} · {p.orden}
                      </div>
                      <div className="text-lg leading-tight mt-1 truncate">{p.cliente ?? "Sin nombre"}</div>
                      <div className="text-sm text-muted mt-0.5">{p.ciudad ?? ""}{p.telefono ? ` · ${p.telefono}` : ""}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="num text-3xl font-light leading-none">{cop(p.total)}</div>
                      <div className={`text-[11px] mt-2 ${h >= 3 ? "text-amber" : "text-muted"}`}>
                        {h < 1 ? "hace menos de 1 h" : `hace ${h} h`}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-black/[0.04] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted/70">Pedido hecho</div>
                    <div className="num text-base mt-0.5">{exacta(p.fecha_pedido ?? p.creado)}</div>
                    {!p.fecha_pedido && <div className="text-[11px] text-amber mt-0.5">Hora en que llegó al panel, no la del pedido</div>}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted">Pago</dt>
                    <dd>{p.pasarela ?? "?"}{p.estado_shopify ? ` · ${p.estado_shopify}` : ""}</dd>
                    <dt className="text-muted">Valor exacto</dt>
                    <dd className="num">{cop(p.total)}</dd>
                    {p.productos && (<><dt className="text-muted">Productos</dt><dd className="break-words">{p.productos.split(" | ").map((x, i) => <div key={i}>{x}</div>)}</dd></>)}
                    {p.documento && (<><dt className="text-muted">Documento</dt><dd className="num">{p.documento}</dd></>)}
                    {p.telefono && (<><dt className="text-muted">Teléfono</dt><dd className="num"><a className="underline" href={`https://wa.me/57${p.telefono.replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noreferrer">{p.telefono}</a></dd></>)}
                    {p.direccion && (<><dt className="text-muted">Dirección</dt><dd className="break-words">{p.direccion}{p.ciudad ? `, ${p.ciudad}` : ""}</dd></>)}
                    {p.referencia && (<><dt className="text-muted">Referencia</dt><dd className="num break-all">{p.referencia}</dd></>)}
                  </dl>
                  <div className="text-xs text-muted">
                    Busca en Bold o en el banco un pago de {cop(p.total)} a nombre de {p.cliente ?? "la clienta"}, cerca de esa hora. Si no lo encuentras, no lo aceptes.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button disabled={enCurso === k} onClick={() => decidir(p, "llego")} className={`${BTN} bg-blue text-black hover:bg-blue-2`}>
                      Llegó la plata
                    </button>
                    <button disabled={enCurso === k} onClick={() => decidir(p, "no_llego")} className={`${BTN} bg-transparent ring-[1.5px] ring-inset ring-text hover:bg-black/5`}>
                      No ha llegado
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted/70 mb-4">Decididos · últimos 30 días</p>
        {decididos.length === 0 ? (
          <div className="card p-6 text-sm text-muted">Todavía no hay decisiones.</div>
        ) : (
          <div className="card divide-y divide-black/5">
            {decididos.map((p) => {
              const k = `${p.sucursal}-${p.orden_id}`;
              return (
                <div key={k} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-sm">
                  <span className={`text-[11px] uppercase tracking-[0.16em] w-28 ${p.estado === "llego" ? "text-blue" : "text-amber"}`}>
                    {p.estado === "llego" ? "Llegó" : "No ha llegado"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.pedido ?? p.orden} · {p.cliente ?? ""} · <span className="text-muted">{exacta(p.fecha_pedido ?? p.creado)}</span></span>
                  <span className="num">{cop(p.total)}</span>
                  <span className="text-xs text-muted">{(p.decidido_por ?? "").split("@")[0]} · {hora(p.decidido_en)}</span>
                  <button disabled={enCurso === k} onClick={() => decidir(p, "pendiente")}
                    className="text-[11px] uppercase tracking-[0.16em] text-muted hover:text-text disabled:opacity-40">
                    Deshacer
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
