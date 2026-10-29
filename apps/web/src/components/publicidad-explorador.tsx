"use client";

import { useMemo, useState, type ReactNode } from "react";
import { diaCorto, entero, pct } from "@/lib/formato";
import { TablaScroll, Vacio } from "./ui";
import { cop } from "./publicidad-montos";

// Explorador como el Administrador de anuncios: niveles cuenta → campaña → conjunto → anuncio, filtros que se encadenan
// (clic en una fila baja al siguiente nivel), búsqueda por nombre y orden por cualquier columna. Los datos vienen por
// anuncio con lo acumulado del periodo (publicidad_anuncios) y aquí se agrupan.
// Compras y valor son los del píxel (pedidos hechos en la tienda, no entregados).

export type AnuncioAds = {
  anuncio_id: string; anuncio: string | null; conjunto_id: string | null; conjunto: string | null;
  campana_id: string | null; campana: string | null; cuenta_ads: string;
  gasto: number; impresiones: number; clics: number; compras: number; valor: number; conversaciones: number;
  dias: number; ultimo: string | null;
};
type Nivel = "cuenta" | "campana" | "conjunto" | "anuncio";
type Fila = {
  clave: string; nombre: string; padre: string; nivel: Nivel; hijos: number;
  gasto: number; impresiones: number; clics: number; compras: number; valor: number; conversaciones: number; ultimo: string | null;
};
type Col = "nombre" | "gasto" | "impresiones" | "cpm" | "clics" | "ctr" | "cpc" | "compras" | "cpa" | "valor" | "roas" | "conversaciones" | "cpconv" | "ultimo";

const NIVELES: { id: Nivel; label: string; hijos: string }[] = [
  { id: "cuenta", label: "Cuentas", hijos: "campañas" },
  { id: "campana", label: "Campañas", hijos: "conjuntos" },
  { id: "conjunto", label: "Conjuntos", hijos: "anuncios" },
  { id: "anuncio", label: "Anuncios", hijos: "" },
];
const div = (a: number, b: number) => (b ? a / b : null);
const metrica = (f: Fila, c: Col): number | string | null => {
  switch (c) {
    case "nombre": return f.nombre.toLowerCase();
    case "cpm": return div(f.gasto * 1000, f.impresiones);
    case "ctr": return div(f.clics, f.impresiones);
    case "cpc": return div(f.gasto, f.clics);
    case "cpa": return div(f.gasto, f.compras);
    case "roas": return div(f.valor, f.gasto);
    case "cpconv": return div(f.gasto, f.conversaciones);
    case "ultimo": return f.ultimo;
    default: return f[c];
  }
};

export function ExploradorAds({ anuncios }: { anuncios: AnuncioAds[] }) {
  const [nivel, setNivel] = useState<Nivel>("campana");
  const [cuenta, setCuenta] = useState("");
  const [campana, setCampana] = useState("");
  const [conjunto, setConjunto] = useState("");
  const [busca, setBusca] = useState("");
  const [orden, setOrden] = useState<{ col: Col; asc: boolean }>({ col: "gasto", asc: false });

  // Filtros encadenados: cada lista solo ofrece lo que queda con los filtros de arriba.
  const enCuenta = useMemo(() => anuncios.filter((a) => !cuenta || a.cuenta_ads === cuenta), [anuncios, cuenta]);
  const enCampana = useMemo(() => enCuenta.filter((a) => !campana || a.campana_id === campana), [enCuenta, campana]);
  const enConjunto = useMemo(() => enCampana.filter((a) => !conjunto || a.conjunto_id === conjunto), [enCampana, conjunto]);
  const opciones = (lista: AnuncioAds[], id: (a: AnuncioAds) => string | null, nombre: (a: AnuncioAds) => string | null) => {
    const m = new Map<string, { nombre: string; gasto: number }>();
    for (const a of lista) {
      const k = id(a); if (!k) continue;
      const x = m.get(k) ?? { nombre: nombre(a) ?? k, gasto: 0 };
      x.gasto += Number(a.gasto); m.set(k, x);
    }
    return [...m.entries()].sort((a, b) => b[1].gasto - a[1].gasto);
  };
  const cuentas = useMemo(() => opciones(anuncios, (a) => a.cuenta_ads, (a) => a.cuenta_ads), [anuncios]);
  const campanas = useMemo(() => opciones(enCuenta, (a) => a.campana_id, (a) => a.campana), [enCuenta]);
  const conjuntos = useMemo(() => opciones(enCampana, (a) => a.conjunto_id, (a) => a.conjunto), [enCampana]);

  const filas = useMemo(() => {
    const clave = (a: AnuncioAds) => nivel === "cuenta" ? a.cuenta_ads : nivel === "campana" ? a.campana_id ?? "?" : nivel === "conjunto" ? a.conjunto_id ?? "?" : a.anuncio_id;
    const m = new Map<string, Fila & { _h: Set<string> }>();
    for (const a of enConjunto) {
      const k = clave(a);
      const f = m.get(k) ?? {
        clave: k, nivel, hijos: 0, _h: new Set<string>(), ultimo: null,
        nombre: (nivel === "cuenta" ? a.cuenta_ads : nivel === "campana" ? a.campana : nivel === "conjunto" ? a.conjunto : a.anuncio) ?? "(sin nombre)",
        padre: nivel === "cuenta" ? "" : nivel === "campana" ? a.cuenta_ads : nivel === "conjunto" ? `${a.campana ?? ""}` : `${a.conjunto ?? ""}`,
        gasto: 0, impresiones: 0, clics: 0, compras: 0, valor: 0, conversaciones: 0,
      };
      f.gasto += Number(a.gasto); f.impresiones += Number(a.impresiones); f.clics += Number(a.clics);
      f.compras += Number(a.compras); f.valor += Number(a.valor); f.conversaciones += Number(a.conversaciones);
      if (a.ultimo && (!f.ultimo || a.ultimo > f.ultimo)) f.ultimo = a.ultimo;
      const hijo = nivel === "cuenta" ? a.campana_id : nivel === "campana" ? a.conjunto_id : nivel === "conjunto" ? a.anuncio_id : null;
      if (hijo) f._h.add(hijo);
      m.set(k, f);
    }
    const q = busca.trim().toLowerCase();
    return [...m.values()].map(({ _h, ...f }) => ({ ...f, hijos: _h.size }))
      .filter((f) => !q || f.nombre.toLowerCase().includes(q))
      .sort((a, b) => {
        const x = metrica(a, orden.col), y = metrica(b, orden.col);
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
        const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es");
        return orden.asc ? d : -d;
      });
  }, [enConjunto, nivel, busca, orden]);

  const tot = filas.reduce((t, f) => ({ ...t, gasto: t.gasto + f.gasto, impresiones: t.impresiones + f.impresiones, clics: t.clics + f.clics,
    compras: t.compras + f.compras, valor: t.valor + f.valor, conversaciones: t.conversaciones + f.conversaciones }),
  { clave: "total", nombre: "Total", padre: "", nivel, hijos: 0, gasto: 0, impresiones: 0, clics: 0, compras: 0, valor: 0, conversaciones: 0, ultimo: null } as Fila);

  // Clic en una fila: filtra por ella y baja un nivel, como en el Administrador de anuncios.
  const bajar = (f: Fila) => {
    if (f.nivel === "cuenta") { setCuenta(f.clave); setCampana(""); setConjunto(""); setNivel("campana"); }
    else if (f.nivel === "campana") { setCampana(f.clave); setConjunto(""); setNivel("conjunto"); }
    else if (f.nivel === "conjunto") { setConjunto(f.clave); setNivel("anuncio"); }
    setBusca("");
  };
  const limpiar = () => { setCuenta(""); setCampana(""); setConjunto(""); setBusca(""); };
  const hayFiltro = cuenta || campana || conjunto || busca;

  const num = (v: number | null, tipo: "cop" | "n" | "pct" | "x") =>
    v == null ? <span className="text-muted/50">—</span>
      : tipo === "cop" ? cop(v) : tipo === "pct" ? pct(v, 2) : tipo === "x" ? `${v.toFixed(2)}x` : entero(v);
  const Th = ({ col, children, izq = false }: { col: Col; children: ReactNode; izq?: boolean }) => {
    const activa = orden.col === col;
    return (
      <th className={izq ? undefined : "text-right"} aria-sort={activa ? (orden.asc ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => setOrden({ col, asc: activa ? !orden.asc : col === "nombre" })}
          className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-text ${activa ? "text-text" : ""}`}>
          {children}<span aria-hidden className="text-[10px]">{activa ? (orden.asc ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  };
  const celdas = (f: Fila) => (
    <>
      <td className="text-right num font-semibold">{num(f.gasto, "cop")}</td>
      <td className="text-right num text-muted">{num(f.impresiones, "n")}</td>
      <td className="text-right num text-muted">{num(metrica(f, "cpm") as number | null, "cop")}</td>
      <td className="text-right num text-muted">{num(f.clics, "n")}</td>
      <td className="text-right num">{num(metrica(f, "ctr") as number | null, "pct")}</td>
      <td className="text-right num text-muted">{num(metrica(f, "cpc") as number | null, "cop")}</td>
      <td className="text-right num">{num(f.compras, "n")}</td>
      <td className="text-right num font-semibold">{num(metrica(f, "cpa") as number | null, "cop")}</td>
      <td className="text-right num text-muted">{num(f.valor, "cop")}</td>
      <td className="text-right num">{num(metrica(f, "roas") as number | null, "x")}</td>
      <td className="text-right num">{num(f.conversaciones, "n")}</td>
      <td className="text-right num text-muted">{num(metrica(f, "cpconv") as number | null, "cop")}</td>
    </>
  );
  const sel = "h-10 min-w-0 max-w-full rounded-lg border border-white/15 bg-transparent px-3 text-sm text-text";

  if (!anuncios.length) return <Vacio>Todavía no hay datos por anuncio en este periodo. Se llenan solos cada hora desde Meta.</Vacio>;

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Nivel">
        {NIVELES.map((n) => (
          <button key={n.id} role="tab" aria-selected={nivel === n.id} onClick={() => setNivel(n.id)}
            className={`h-10 rounded-lg px-5 text-xs font-semibold uppercase tracking-[0.16em] transition ${nivel === n.id ? "bg-blue text-[#0a0a0a]" : "bg-[#2e2e2e] text-text hover:bg-[#262626]"}`}>
            {n.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
        <select value={cuenta} onChange={(e) => { setCuenta(e.target.value); setCampana(""); setConjunto(""); }} className={sel} aria-label="Cuenta publicitaria">
          <option value="" className="bg-bg">Todas las cuentas</option>
          {cuentas.map(([k, v]) => <option key={k} value={k} className="bg-bg">{v.nombre}</option>)}
        </select>
        <select value={campana} onChange={(e) => { setCampana(e.target.value); setConjunto(""); }} className={sel} aria-label="Campaña">
          <option value="" className="bg-bg">Todas las campañas ({campanas.length})</option>
          {campanas.map(([k, v]) => <option key={k} value={k} className="bg-bg">{v.nombre}</option>)}
        </select>
        <select value={conjunto} onChange={(e) => setConjunto(e.target.value)} className={sel} aria-label="Conjunto de anuncios">
          <option value="" className="bg-bg">Todos los conjuntos ({conjuntos.length})</option>
          {conjuntos.map(([k, v]) => <option key={k} value={k} className="bg-bg">{v.nombre}</option>)}
        </select>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={`Buscar ${NIVELES.find((n) => n.id === nivel)!.label.toLowerCase()} por nombre`}
          className={`${sel} placeholder:text-muted/60`} aria-label="Buscar por nombre" />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 text-xs text-muted">
        <span>{entero(filas.length)} {NIVELES.find((n) => n.id === nivel)!.label.toLowerCase()} con datos · clic en una fila para ver su detalle</span>
        {hayFiltro && <button onClick={limpiar} className="border-b border-blue pb-0.5 uppercase tracking-[0.16em] text-text hover:text-blue">Quitar filtros</button>}
      </div>

      <TablaScroll>
        <thead>
          <tr>
            <Th col="nombre" izq>{NIVELES.find((n) => n.id === nivel)!.label.replace(/s$/, "")}</Th>
            <Th col="gasto">Gasto</Th><Th col="impresiones">Impr.</Th><Th col="cpm">CPM</Th><Th col="clics">Clics</Th><Th col="ctr">CTR</Th><Th col="cpc">CPC</Th>
            <Th col="compras">Compras</Th><Th col="cpa">Costo / compra</Th><Th col="valor">Valor compras</Th><Th col="roas">ROAS</Th>
            <Th col="conversaciones">Conversac.</Th><Th col="cpconv">Costo / conv.</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} onClick={f.nivel !== "anuncio" ? () => bajar(f) : undefined} className={f.nivel !== "anuncio" ? "cursor-pointer hover:bg-white/[0.03]" : undefined}>
              <td className="max-w-[24rem]">
                <div className="truncate font-medium" title={f.nombre}>{f.nombre}</div>
                <div className="truncate text-[11px] text-muted" title={f.padre}>
                  {f.padre ? `${f.padre} · ` : ""}{f.hijos > 0 && f.nivel !== "anuncio" ? `${entero(f.hijos)} ${NIVELES.find((n) => n.id === f.nivel)!.hijos}` : ""}
                  {f.ultimo ? `${f.hijos ? " · " : ""}último gasto ${diaCorto(f.ultimo)}` : ""}
                </div>
              </td>
              {celdas(f)}
            </tr>
          ))}
          {filas.length > 1 && <tr className="font-semibold border-t border-white/20"><td>Total ({entero(filas.length)})</td>{celdas(tot)}</tr>}
        </tbody>
      </TablaScroll>
      <p className="mt-3 text-xs text-muted max-w-4xl">
        Compras y valor son los que reporta el píxel de Meta: pedidos hechos en la tienda, no entregados. En contraentrega el costo real
        por pedido entregado es mayor. Conversaciones: chats de WhatsApp o Messenger iniciados desde el anuncio.
      </p>
    </div>
  );
}
