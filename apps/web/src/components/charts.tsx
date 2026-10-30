"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Colores fijos por estado: el mismo estado siempre tiene el mismo color.
export const COLOR_ESTADO: Record<string, string> = {
  ENTREGADO: "#2fd28f",
  DEVOLUCION: "#ff5a6a",
  EN_TRANSITO: "#2f7bff",
  EN_OFICINA: "#45c8ff",
  NOVEDAD: "#ffb547",
  PENDIENTE: "#9b8681",
  INDEMNIZACION: "#b48cff",
  CANCELADA: "#b9a7a2",
};
export const NOMBRE_ESTADO: Record<string, string> = {
  ENTREGADO: "Entregada",
  DEVOLUCION: "Devolución",
  EN_TRANSITO: "En tránsito",
  EN_OFICINA: "En oficina",
  NOVEDAD: "Novedad",
  PENDIENTE: "Generada",
  INDEMNIZACION: "Indemnización",
  CANCELADA: "Cancelada",
};
const ORDEN = ["ENTREGADO", "EN_TRANSITO", "EN_OFICINA", "NOVEDAD", "PENDIENTE", "DEVOLUCION", "INDEMNIZACION", "CANCELADA"];

const ejeX = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const tooltipStyle = {
  contentStyle: { background: "#ffffff", border: "1px solid rgb(17 17 17 / 0.1)", borderRadius: 12, fontSize: 12 },
  labelStyle: { color: "#7c6a66" },
  cursor: { fill: "rgb(17 17 17 / 0.04)" },
};

export function GuiasPorDia({ filas }: { filas: { fecha: string; estado_u: string; guias: number }[] }) {
  const porFecha = new Map<string, Record<string, number | string>>();
  for (const f of filas) {
    const o = porFecha.get(f.fecha) ?? { fecha: f.fecha };
    o[f.estado_u] = Number(o[f.estado_u] ?? 0) + Number(f.guias);
    porFecha.set(f.fecha, o);
  }
  const data = [...porFecha.values()].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const estados = ORDEN.filter((e) => filas.some((f) => f.estado_u === e));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -12, right: 4, top: 4 }}>
          <CartesianGrid vertical={false} stroke="rgb(17 17 17 / 0.06)" />
          <XAxis dataKey="fecha" tickFormatter={ejeX} tick={{ fill: "#7c6a66", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tick={{ fill: "#7c6a66", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipStyle} labelFormatter={(l) => ejeX(String(l))} formatter={(v, n) => [Number(v).toLocaleString("es-CO"), NOMBRE_ESTADO[String(n)] ?? n]} />
          <Legend formatter={(v) => <span style={{ color: "#7c6a66", fontSize: 12 }}>{NOMBRE_ESTADO[v] ?? v}</span>} iconType="circle" iconSize={8} />
          {estados.map((e, i) => (
            <Bar key={e} dataKey={e} stackId="a" fill={COLOR_ESTADO[e]} radius={i === estados.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FlujoWallet({ filas, moneda }: { filas: { fecha: string; grupo: string; total: number }[]; moneda: (v: number) => string }) {
  const porFecha = new Map<string, { fecha: string; ingreso: number; egreso: number }>();
  for (const f of filas) {
    if (f.grupo === "caja" || f.grupo === "reversion") continue;
    const o = porFecha.get(f.fecha) ?? { fecha: f.fecha, ingreso: 0, egreso: 0 };
    if (f.grupo === "ingreso") o.ingreso += Number(f.total);
    else o.egreso += Math.abs(Number(f.total));
    porFecha.set(f.fecha, o);
  }
  const data = [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 4, top: 4 }}>
          <defs>
            <linearGradient id="gIng" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2fd28f" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#2fd28f" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gEgr" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff5a6a" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#ff5a6a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="rgb(17 17 17 / 0.06)" />
          <XAxis dataKey="fecha" tickFormatter={ejeX} tick={{ fill: "#7c6a66", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tickFormatter={(v) => moneda(Number(v))} tick={{ fill: "#7c6a66", fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
          <Tooltip {...tooltipStyle} labelFormatter={(l) => ejeX(String(l))} formatter={(v, n) => [moneda(Number(v)), n === "ingreso" ? "Ingresos" : "Egresos"]} />
          <Area type="monotone" dataKey="ingreso" stroke="#2fd28f" strokeWidth={2} fill="url(#gIng)" />
          <Area type="monotone" dataKey="egreso" stroke="#ff5a6a" strokeWidth={2} fill="url(#gEgr)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Gasto de publicidad por día, apilado por país, en pesos; al pasar el mouse sale también en la moneda de cada país.
const compacta = (divisa: string) => (v: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: divisa, currencyDisplay: divisa === "USD" ? "symbol" : "narrowSymbol", notation: "compact", maximumFractionDigits: 1 }).format(v);
const exacta = (divisa: string) => (v: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: divisa, currencyDisplay: divisa === "USD" ? "symbol" : "narrowSymbol", maximumFractionDigits: divisa === "COP" ? 0 : 2 }).format(v);

export function GastoPorDia({ filas, paises }: {
  filas: { fecha: string; cuenta: string; monto: number; local?: number | null }[];
  paises: { cuenta: string; nombre: string; color: string; divisa: string }[];
}) {
  const porFecha = new Map<string, Record<string, number | string>>();
  for (const f of filas) {
    const o = porFecha.get(f.fecha) ?? { fecha: f.fecha };
    o[f.cuenta] = Number(o[f.cuenta] ?? 0) + Number(f.monto);
    if (f.local != null) o[`${f.cuenta}__local`] = Number(o[`${f.cuenta}__local`] ?? 0) + Number(f.local);
    porFecha.set(f.fecha, o);
  }
  const data = [...porFecha.values()].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const pais = (c: string) => paises.find((p) => p.cuenta === c);
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 4, top: 4 }}>
          <CartesianGrid vertical={false} stroke="rgb(17 17 17 / 0.06)" />
          <XAxis dataKey="fecha" tickFormatter={ejeX} tick={{ fill: "#7c6a66", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tickFormatter={(v) => compacta("COP")(Number(v))} tick={{ fill: "#7c6a66", fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(l) => ejeX(String(l))}
            formatter={(v, n, item) => {
              const p = pais(String(n));
              const local = (item?.payload as Record<string, number> | undefined)?.[`${n}__local`];
              const enLocal = p && p.divisa !== "COP" && local != null ? ` · ${exacta(p.divisa)(local)}` : "";
              return [`${exacta("COP")(Number(v))}${enLocal}`, p?.nombre ?? String(n)];
            }}
          />
          <Legend formatter={(v) => <span style={{ color: "#7c6a66", fontSize: 12 }}>{pais(String(v))?.nombre ?? v}</span>} iconType="circle" iconSize={8} />
          {paises.map((p, i) => (
            <Bar key={p.cuenta} dataKey={p.cuenta} stackId="a" fill={p.color} radius={i === paises.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
