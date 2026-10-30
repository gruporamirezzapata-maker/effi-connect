"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { dinero, entero } from "@/lib/formato";

export type LineaPyg = {
  key: string;
  plataforma: "Effi" | "Ambas"; // "Ambas" = líneas generales (publicidad, gastos); solo cambia el color
  concepto: string;
  n: number | null;
  monto: number;
  tipo: "ingreso" | "egreso";
  excluidoInicial: boolean;
  aFlujo?: boolean;   // retiros y transferencias: se ven tachados con enlace al Flujo de Caja
  nota?: string;
};

const COLOR = { Effi: "var(--blue)", Ambas: "#a78bfa" } as const;
const GUARDADO = "effi-connect.pyg.casillas"; // preferencia de este navegador: qué conceptos marcó o desmarcó

export function PygWallet({ cuenta, lineas, despachos, entregas }: {
  cuenta: string; lineas: LineaPyg[]; despachos: number; entregas: number;
}) {
  const [cambios, setCambios] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setCambios(JSON.parse(localStorage.getItem(GUARDADO) ?? "{}")); } catch { /* sin almacenamiento: valores por defecto */ }
  }, []);
  const incluida = (l: LineaPyg) => cambios[l.key] ?? !l.excluidoInicial;
  const alternar = (l: LineaPyg) => {
    const nuevo = { ...cambios, [l.key]: !incluida(l) };
    if (nuevo[l.key] === !l.excluidoInicial) delete nuevo[l.key];
    setCambios(nuevo);
    try { localStorage.setItem(GUARDADO, JSON.stringify(nuevo)); } catch { /* ignorar */ }
  };

  const $ = (v: number) => dinero(v, cuenta);
  const ingresos = lineas.filter((l) => l.tipo === "ingreso");
  // Retiros arriba, luego lo del wallet y al final lo que aplica en general (publicidad, gastos).
  const egresos = [...lineas.filter((l) => l.tipo === "egreso" && l.aFlujo), ...lineas.filter((l) => l.tipo === "egreso" && !l.aFlujo)];
  const { totIng, totEgr, ads } = useMemo(() => {
    const sum = (xs: LineaPyg[]) => xs.filter(incluida).reduce((a, l) => a + l.monto, 0);
    return { totIng: sum(ingresos), totEgr: sum(egresos), ads: -(lineas.find((l) => l.key === "Ambas|Inversión Ads" && incluida(l))?.monto ?? 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineas, cambios]);
  const utilidad = totIng + totEgr;
  const margen = totIng ? utilidad / totIng : null;
  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);

  return (
    <div className="space-y-4">
      <div className="grid gap-5 xl:grid-cols-2">
        <Tabla titulo="Ingresos" color="var(--green)" lineas={ingresos} total={totIng} etiquetaTotal="Total ingresos"
          incluida={incluida} alternar={alternar} $={$} despachos={despachos} />
        <Tabla titulo="Egresos" color="var(--red)" lineas={egresos} total={totEgr} etiquetaTotal="Total egresos"
          incluida={incluida} alternar={alternar} $={$} despachos={despachos} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line border-l-4 bg-green/[0.06] px-6 py-5" style={{ borderLeftColor: "var(--green)" }}>
        <div className="text-xs uppercase tracking-widest font-mono text-muted">Utilidad neta (según wallet)</div>
        <div className="flex items-center gap-3">
          <span className={`num text-4xl font-semibold ${utilidad >= 0 ? "text-green" : "text-red"}`}>{$(utilidad)}</span>
          <span className="rounded-full border border-green/40 bg-green/15 px-3 py-1 text-xs font-mono font-semibold text-green">{pct(margen)} margen</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador color="var(--blue)" titulo="Utilidad x despacho" valor={despachos ? $(utilidad / despachos) : "—"} sub={`${entero(despachos)} despachos`} />
        <Indicador color="var(--green)" titulo="Utilidad x entrega" valor={entregas ? $(utilidad / entregas) : "—"} sub={`${entero(entregas)} entregas`} />
        <Indicador color="#a78bfa" titulo="ROI" valor={ads ? pct(utilidad / ads) : "—"} sub="utilidad neta según wallet / inversión publicitaria" />
        <Indicador color="var(--amber)" titulo="Costo por venta" valor={despachos && ads ? $(ads / despachos) : "—"} sub="inversión / # ventas" />
      </div>
    </div>
  );
}

function Tabla({ titulo, color, lineas, total, etiquetaTotal, incluida, alternar, $, despachos }: {
  titulo: string; color: string; lineas: LineaPyg[]; total: number; etiquetaTotal: string;
  incluida: (l: LineaPyg) => boolean; alternar: (l: LineaPyg) => void; $: (v: number) => string; despachos: number;
}) {
  const max = Math.max(1, ...lineas.map((l) => Math.abs(l.monto)));
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="size-3 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
        <h3 className="font-display text-lg font-semibold" style={{ color }}>{titulo}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-1.5 text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-widest font-mono text-muted">
              <th className="text-left font-medium pl-3">Concepto</th>
              <th className="text-right font-medium px-2">Cant.</th>
              <th className="text-right font-medium px-2">Valor</th>
              <th className="text-right font-medium pr-3">Promedio</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => {
              const on = incluida(l);
              const c = COLOR[l.plataforma];
              const prom = l.n ? l.monto / l.n : despachos ? l.monto / despachos : null;
              return (
                <tr key={l.key} className={on ? "" : "opacity-45"}>
                  <td className="rounded-l-xl border-l-4 bg-black/[0.03] pl-3 pr-2 py-2.5" style={{ borderColor: c }}>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={on} onChange={() => alternar(l)} className="size-4 shrink-0 accent-[var(--blue)]" />
                      <span className={`font-semibold ${on ? "" : "line-through"}`}>{l.concepto}</span>
                      {l.aFlujo && (
                        <Link href="/flujo-caja" className="rounded-full border border-line px-2 py-0.5 text-[10px] font-mono text-muted hover:text-text">ver detalle en Flujo de Caja ↗</Link>
                      )}
                    </label>
                    <div className="mt-1.5 h-0.5 rounded-full" style={{ width: `${(Math.abs(l.monto) / max) * 100}%`, background: `color-mix(in srgb, ${c} 60%, transparent)` }} />
                    {l.nota && <div className="text-[11px] text-muted mt-0.5">{l.nota}</div>}
                  </td>
                  <td className="bg-black/[0.03] px-2 text-right num font-mono text-muted">{l.n != null ? entero(l.n) : "–"}</td>
                  <td className={`bg-black/[0.03] px-2 text-right num font-semibold ${on ? "" : "line-through"}`}>{$(l.monto)}</td>
                  <td className="rounded-r-xl bg-black/[0.03] pr-3 text-right num text-muted">{prom != null ? $(prom) : "—"}</td>
                </tr>
              );
            })}
            <tr>
              <td className="rounded-l-xl border-l-4 bg-black/[0.06] pl-3 py-2.5 font-semibold" style={{ borderColor: color }}>{etiquetaTotal}</td>
              <td className="bg-black/[0.06]" />
              <td className="bg-black/[0.06] px-2 text-right num font-semibold">{$(total)}</td>
              <td className="rounded-r-xl bg-black/[0.06]" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Indicador({ color, titulo, valor, sub }: { color: string; titulo: string; valor: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-line border-l-4 bg-black/[0.02] p-4" style={{ borderLeftColor: color }}>
      <div className="text-[11px] uppercase tracking-widest font-mono text-muted">{titulo}</div>
      <div className="num text-3xl font-semibold mt-1">{valor}</div>
      <div className="text-xs font-mono text-muted mt-1">{sub}</div>
    </div>
  );
}
