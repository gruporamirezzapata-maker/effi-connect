"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dinero } from "@/lib/formato";
import { infoCuenta } from "@/lib/paises";
import { COLOR_ESTADO } from "./charts";

type Evento = {
  cuenta: string;
  guia: string | null;
  fecha_hist_est: string;
  estado_new_efficommerce: string | null;
  estado_new: string | null;
  nombre_transportadora_efficommerce: string | null;
  nombre_ciudad_destinatario: string | null;
  valor_recaudo: number | null;
  pagada: boolean | null;
};

// Estados globales de Effi (api/est_guia_efficommerce) que se pueden filtrar en el feed.
const ESTADOS = [
  { id: null, label: "Todos" },
  { id: [4], label: "Entregadas", color: COLOR_ESTADO.ENTREGADO },
  { id: [5], label: "Devoluciones", color: COLOR_ESTADO.DEVOLUCION },
  { id: [3], label: "Novedad", color: COLOR_ESTADO.NOVEDAD },
  { id: [9], label: "En oficina", color: COLOR_ESTADO.EN_OFICINA },
  { id: [2, 8], label: "En tránsito", color: COLOR_ESTADO.EN_TRANSITO },
] as const;

const VENTANAS = [
  { min: 5, label: "5 min" },
  { min: 60, label: "1 h" },
  { min: 1440, label: "24 h" },
  { min: null, label: "Últimos 40" },
] as const;

const colorDe = (estado: string | null) => {
  const e = (estado ?? "").toLowerCase();
  if (e.includes("entreg")) return COLOR_ESTADO.ENTREGADO;
  if (e.includes("devol")) return COLOR_ESTADO.DEVOLUCION;
  if (e.includes("novedad")) return COLOR_ESTADO.NOVEDAD;
  if (e.includes("oficina")) return COLOR_ESTADO.EN_OFICINA;
  if (e.includes("tr") || e.includes("reparto")) return COLOR_ESTADO.EN_TRANSITO;
  return COLOR_ESTADO.PENDIENTE;
};

const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-[11px] transition-colors ${on ? "border-blue/50 bg-blue/15 text-text" : "border-line text-muted hover:text-text"}`;

// Cambios de estado recientes; se refresca cada 20 s (el sync trae datos nuevos cada minuto).
export function FeedEstados({ cuentas }: { cuentas: string[] | null }) {
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState(0);
  const [ventana, setVentana] = useState(3);
  const clave = cuentas?.join(",") ?? "";
  const filtroEstado = ESTADOS[estado].id;
  const minutos = VENTANAS[ventana].min;

  useEffect(() => {
    const supabase = createClient();
    let vivo = true;
    setEventos(null);
    setError(null);
    const cargar = async () => {
      let q = supabase
        .from("v_feed_estados")
        .select("cuenta,guia,fecha_hist_est,estado_new_efficommerce,estado_new,nombre_transportadora_efficommerce,nombre_ciudad_destinatario,valor_recaudo,pagada")
        .order("fecha_hist_est", { ascending: false })
        .limit(minutos ? 500 : 40);
      if (clave) q = q.in("cuenta", clave.split(","));
      if (filtroEstado) q = q.in("est_guia_new_efficommerce", [...filtroEstado]);
      if (minutos) q = q.gte("fecha_hist_est", new Date(Date.now() - minutos * 60_000).toISOString());
      const { data, error: err } = await q;
      if (!vivo) return;
      // Si falla, se conserva lo último que se mostró y se avisa (no se finge que no hubo cambios).
      setError(err ? "No se pudo actualizar el feed; se reintenta en 20 s." : null);
      if (!err) setEventos((data as Evento[]) ?? []);
    };
    cargar();
    const t = setInterval(cargar, 20_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [clave, filtroEstado, minutos]);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {ESTADOS.map((e, i) => (
          <button key={e.label} onClick={() => setEstado(i)} className={chip(i === estado)}>
            {"color" in e && <span className="inline-block size-1.5 rounded-full mr-1 align-middle" style={{ background: e.color }} />}
            {e.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 mb-3">
        {VENTANAS.map((v, i) => (
          <button key={v.label} onClick={() => setVentana(i)} className={chip(i === ventana)}>
            {v.label}
          </button>
        ))}
        {eventos && minutos && (
          <span className="ml-auto text-xs text-muted num">
            {eventos.length} {eventos.length === 1 ? "guía" : "guías"}
          </span>
        )}
      </div>

      {error && <p className="text-xs text-amber mb-2" role="status">{error}</p>}
      {eventos == null ? (
        error ? null :
        <div className="h-72 animate-pulse rounded-xl bg-black/[0.02]" />
      ) : !eventos.length ? (
        <p className="text-sm text-muted py-6 text-center">
          {minutos ? `Ningún cambio así en los últimos ${VENTANAS[ventana].label}.` : "Sin cambios de estado todavía."}
        </p>
      ) : (
        <ul className="max-h-[26rem] overflow-y-auto -mr-2 pr-2 space-y-1">
          {eventos.map((e, i) => {
            const estadoTxt = e.estado_new_efficommerce ?? e.estado_new ?? "—";
            const hora = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(new Date(e.fecha_hist_est));
            return (
              <li key={`${e.cuenta}-${e.guia}-${e.fecha_hist_est}-${i}`} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-black/[0.03]">
                <span className="size-2 rounded-full shrink-0" style={{ background: colorDe(estadoTxt), boxShadow: `0 0 8px ${colorDe(estadoTxt)}` }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm truncate">{estadoTxt}</span>
                    <span className="text-[11px] text-muted shrink-0">{infoCuenta(e.cuenta).bandera}</span>
                    {e.pagada && <span className="text-[10px] text-green border border-green/30 rounded-full px-1.5 shrink-0">pagada</span>}
                  </div>
                  <div className="text-[11px] text-muted truncate font-mono">
                    {e.guia ?? "sin número"} · {e.nombre_transportadora_efficommerce ?? "—"} · {e.nombre_ciudad_destinatario ?? ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] text-muted">{hora}</div>
                  {e.valor_recaudo != null && <div className="text-[11px] num">{dinero(e.valor_recaudo, e.cuenta)}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
