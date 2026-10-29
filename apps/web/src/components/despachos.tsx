"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ---------- Tipos de lo que entrega n8n ----------
export type GuiaDespacho = {
  guia: string; transp: string; fecha: string; horas?: number; dias?: number; proveedor?: string; destinatario?: string;
  tipo_envio?: string; estado?: string; articulos?: string; contenido?: string; articulos_incompletos?: boolean; por_aprobar?: boolean;
};
export type DatosDespachos = {
  ok: boolean; hoy?: string; generado?: string; inter_revisado_hoy?: boolean; recogidas?: string[]; guias?: GuiaDespacho[];
};

type Fila = {
  guia: string; transp: string; fecha: string; dias: number; riesgo: string; horas: number; vencida: boolean;
  prov: string; dest: string; tipo: string; estado: string; prod: string;
};
type Grupo = { nombre: string; propio: boolean; filas: Fila[]; max: number; antiguo: string; vencidas: number };

// ---------- Reglas (las mismas del reporte de antes) ----------
const PROPIO = "Inventario propio";
const PLANTILLA = "Hola {proveedor}, buen día.\nTenemos {n} guías pendientes por despachar. La más antigua es del {antiguo} ({dias} días).\nTe envío la lista con guía, transportadora y productos.\nPor favor confírmame cuáles salen hoy y si alguna no la puedes surtir.\nGracias.";
const COLS_GEN = ["Nivel de Riesgo", "Días de Retraso", "Proveedor", "Transportadora", "Tipo de Envío", "Número de Guía", "Estado Actual", "Fecha de Creación", "Destinatario", "Artículos a Despachar"];
const W_GEN = [18, 15, 26, 20, 18, 20, 16, 18, 30, 90];
const COLS_PROV = ["Días de Retraso", "Proveedor", "Transportadora", "Tipo de Envío", "Número de Guía", "Fecha de Creación", "Destinatario", "Artículos a Despachar"];
const W_PROV = [15, 26, 20, 16, 18, 17, 30, 95];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const riesgo = (d: number) => (d <= 2 ? "A Tiempo" : d === 3 ? "Riesgo Moderado" : d <= 7 ? "Riesgo Alto" : "Riesgo Muy Alto");
const limpio = (s?: string) => String(s ?? "").replace(/\s+/g, " ").trim();
const corta = (s: string) => { const p = s.split("-"); return `${+p[2]} ${MESES[+p[1] - 1]}`; };
const sumDias = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diasCal = (a: string, b: string) => Math.max(0, Math.round((+new Date(`${b}T12:00:00Z`) - +new Date(`${a}T12:00:00Z`)) / 864e5));
const hoyBogota = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const limpiarNombre = (n: string) => n.replace(/[^\w\sáéíóúñÁÉÍÓÚÑ.&-]/g, "").trim();

function construir(d: DatosDespachos) {
  const hoy = d.hoy || hoyBogota();
  const mapa: Record<string, Fila[]> = {};
  const todas: Fila[] = [];
  let incompletas = 0;
  for (const g of d.guias ?? []) {
    if (g.articulos_incompletos) incompletas++;
    const prov = g.proveedor || PROPIO;
    const dias = typeof g.dias === "number" ? g.dias : diasCal(g.fecha, hoy);
    const f: Fila = {
      guia: g.guia, transp: g.transp, fecha: g.fecha, dias, riesgo: riesgo(dias), horas: g.horas ?? 0, vencida: (g.horas ?? 0) >= 48,
      prov, dest: limpio(g.destinatario), tipo: g.tipo_envio ?? "", estado: g.estado ?? "Generada",
      prod: limpio(g.articulos || g.contenido) + (g.articulos_incompletos ? " … (lista cortada, ver guía)" : ""),
    };
    todas.push(f);
    (mapa[prov] ??= []).push(f);
  }
  todas.sort((a, b) => b.dias - a.dias || a.prov.localeCompare(b.prov));
  const grupos: Grupo[] = Object.keys(mapa).map((n) => {
    const f = mapa[n].sort((a, b) => b.horas - a.horas);
    return { nombre: n, propio: n === PROPIO, filas: f, max: f[0].dias, antiguo: f[0].fecha, vencidas: f.filter((x) => x.vencida).length };
  }).sort((a, b) => (Number(a.propio) - Number(b.propio)) || (b.vencidas - a.vencidas) || (b.max - a.max));
  return { hoy, todas, grupos, incompletas, recogidas: d.recogidas ?? [], interHoy: !!d.inter_revisado_hoy, generado: d.generado ?? "" };
}

function mensaje(g: Grupo, plantilla: string) {
  let t = plantilla.replace(/\{proveedor\}/g, g.nombre).replace(/\{n\}/g, String(g.filas.length))
    .replace(/\{antiguo\}/g, corta(g.antiguo)).replace(/\{dias\}/g, String(g.max));
  if (g.filas.length === 1) t = t.replace("1 guías pendientes", "1 guía pendiente");
  if (g.vencidas) t += `\n${g.vencidas === 1 ? "Ojo: 1 de estas guías ya pasó" : `Ojo: ${g.vencidas} de estas guías ya pasaron`} las 48 horas de despacho del convenio (en rojo).`;
  return t;
}

// ---------- Archivos: Excel con estilos (se carga la librería solo al descargar) e imagen PNG ----------
type XLSXLib = {
  utils: {
    aoa_to_sheet: (a: unknown[][]) => Record<string, any>; encode_range: (r: unknown) => string; encode_cell: (c: unknown) => string;
    book_new: () => unknown; book_append_sheet: (wb: unknown, ws: unknown, n: string) => void;
  };
  write: (wb: unknown, o: unknown) => ArrayBuffer;
};
let cargaXlsx: Promise<XLSXLib> | null = null;
function xlsx(): Promise<XLSXLib> {
  const w = window as unknown as { XLSX?: XLSXLib };
  if (w.XLSX) return Promise.resolve(w.XLSX);
  cargaXlsx ??= new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js";
    s.onload = () => (w.XLSX ? ok(w.XLSX) : mal(new Error("xlsx")));
    s.onerror = () => { cargaXlsx = null; mal(new Error("xlsx")); };
    document.head.appendChild(s);
  });
  return cargaXlsx;
}
const S_HEAD = { font: { bold: true, color: { rgb: "141414" }, name: "Calibri", sz: 12 }, fill: { fgColor: { rgb: "D9F7D9" } }, alignment: { vertical: "center" }, border: { bottom: { style: "thin", color: { rgb: "05E901" } } } };
const S_CELL = { font: { name: "Calibri", sz: 12, color: { rgb: "141414" } }, alignment: { vertical: "center" }, border: { bottom: { style: "thin", color: { rgb: "DADADA" } } } };
const S_RED = { font: { name: "Calibri", sz: 12, color: { rgb: "1A1A1A" } }, fill: { fgColor: { rgb: "FF0000" } }, alignment: { vertical: "center" }, border: { bottom: { style: "thin", color: { rgb: "FFFFFF" } } } };
const filaGen = (f: Fila) => [f.riesgo, f.dias, f.prov, f.transp, f.tipo, f.guia, f.estado, f.fecha, f.dest, f.prod];
const filaProv = (f: Fila) => [f.dias, f.prov, f.transp, f.tipo, f.guia, f.fecha, f.dest, f.prod];

function hoja(X: XLSXLib, cols: string[], widths: number[], filas: Fila[], valores: (f: Fila) => unknown[]) {
  const aoa = [cols, ...filas.map(valores)];
  const ws = X.utils.aoa_to_sheet(aoa);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  ws["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: cols.length - 1 } }) };
  for (let r = 0; r < aoa.length; r++) for (let c = 0; c < cols.length; c++) {
    const ref = X.utils.encode_cell({ r, c });
    ws[ref] ??= { t: "s", v: "" };
    ws[ref].s = r === 0 ? S_HEAD : filas[r - 1].vencida ? S_RED : S_CELL;
  }
  return ws;
}
function compartirOBajar(blob: Blob, nombre: string) {
  let file: File | null = null;
  try { file = new File([blob], nombre, { type: blob.type }); } catch { /* navegador viejo */ }
  if (file && navigator.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    navigator.share({ files: [file], title: nombre }).catch(() => {});
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function guardarLibro(armar: (X: XLSXLib) => unknown, nombre: string) {
  const X = await xlsx();
  const wb = armar(X);
  compartirOBajar(new Blob([X.write(wb, { type: "array", bookType: "xlsx", cellStyles: true })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nombre);
}
function nombreHoja(n: string, usados: Set<string>) {
  const b = n.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Hoja";
  let x = b, i = 2;
  while (usados.has(x.toLowerCase())) x = `${b.slice(0, 26)} ${i++}`;
  usados.add(x.toLowerCase());
  return x;
}

function imagen(g: Grupo, hoy: string) {
  const cols = ["Días", "Transportadora", "Tipo de Envío", "Número de Guía", "Fecha", "Destinatario", "Artículos a Despachar"];
  const wcol = [64, 170, 150, 150, 108, 230, 700], pad = 10, fs = 17, lh = 23, scale = 2;
  const W = wcol.reduce((a, b) => a + b, 0) + 48;
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d")!;
  const font = (w: string) => `${w} ${fs}px Sora, Calibri, Arial, sans-serif`;
  ctx.font = font("400");
  const wrap = (t: string, max: number) => {
    const lines: string[] = []; let cur = "";
    for (const w of String(t).split(" ")) { const test = cur ? `${cur} ${w}` : w; if (ctx.measureText(test).width > max && cur) { lines.push(cur); cur = w; } else cur = test; }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };
  const rows = g.filas.map((f) => {
    const cells = [String(f.dias), f.transp, f.tipo, f.guia, f.fecha, f.dest, f.prod].map((v, i) => wrap(v, wcol[i] - 2 * pad));
    return { f, cells, h: Math.max(...cells.map((c) => c.length)) * lh + 2 * pad - 4 };
  });
  const head = 86, th = 40, H = head + th + rows.reduce((a, r) => a + r.h, 0) + 40;
  cv.width = W * scale; cv.height = H * scale; ctx.scale(scale, scale);
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#141414"; ctx.font = "600 26px Sora, Calibri, Arial, sans-serif"; ctx.fillText(g.nombre, 24, 40);
  ctx.fillStyle = "#5A5A5A"; ctx.font = "400 16px Sora, Calibri, Arial, sans-serif";
  ctx.fillText(`${g.filas.length}${g.filas.length === 1 ? " guía pendiente" : " guías pendientes"} · corte ${corta(hoy)}${g.vencidas ? ` · en rojo: ${g.vencidas} ${g.vencidas === 1 ? "pasó" : "pasaron"} 48 h` : ""}`, 24, 66);
  let y = head;
  ctx.fillStyle = "#EDEDED"; ctx.fillRect(24, y, W - 48, th);
  ctx.fillStyle = "#141414"; ctx.font = font("600");
  let x = 24; cols.forEach((c, i) => { ctx.fillText(c, x + pad, y + 26); x += wcol[i]; });
  y += th;
  for (const r of rows) {
    ctx.fillStyle = r.f.vencida ? "#FF0000" : "#FFFFFF"; ctx.fillRect(24, y, W - 48, r.h);
    ctx.fillStyle = r.f.vencida ? "#FFFFFF" : "#E4E4E4"; ctx.fillRect(24, y + r.h - 1, W - 48, 1);
    ctx.fillStyle = r.f.vencida ? "#1A1A1A" : "#141414"; ctx.font = font("400");
    let xx = 24; r.cells.forEach((lines, i) => { lines.forEach((l, k) => ctx.fillText(l, xx + pad, y + pad + 16 + k * lh)); xx += wcol[i]; });
    y += r.h;
  }
  cv.toBlob((b) => b && compartirOBajar(b, `Despachos ${limpiarNombre(g.nombre)} ${hoy}.png`), "image/png");
}

// ---------- Gráficas (mismo dibujo de la app de despachos, en verde) ----------
function serie(hoy: string, todas: Fila[]) {
  const dias = Array.from({ length: 10 }, (_, i) => sumDias(hoy, i - 9));
  const tot: Record<string, number> = {}, ven: Record<string, number> = {};
  for (const f of todas) { tot[f.fecha] = (tot[f.fecha] ?? 0) + 1; if (f.vencida) ven[f.fecha] = (ven[f.fecha] ?? 0) + 1; }
  return { dias, a: dias.map((d) => tot[d] ?? 0), b: dias.map((d) => ven[d] ?? 0) };
}
const linea = (pts: number[][]) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

function GraficaA({ a }: { a: number[] }) {
  const w = 300, h = 92, max = Math.max(4, ...a);
  const pts = a.map((v, i) => [8 + (i * (w - 16)) / 9, h - 10 - (v / max) * (h - 30)]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto overflow-visible" aria-hidden>
      <defs><linearGradient id="dga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#05e901" stopOpacity=".22" /><stop offset="1" stopColor="#05e901" stopOpacity="0" /></linearGradient></defs>
      <path d={`${linea(pts)} L${pts[9][0]} ${h - 4} L${pts[0][0]} ${h - 4} Z`} fill="url(#dga)" />
      <path d={linea(pts)} fill="none" stroke="#05e901" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[9][0]} cy={pts[9][1]} r="3.8" fill="#141414" stroke="#05e901" strokeWidth="2" />
    </svg>
  );
}
function GraficaB({ dias, a, b }: { dias: string[]; a: number[]; b: number[] }) {
  const W = 440, H = 150, L = 34, R = 8, T = 10, B = 22, max = Math.max(4, ...a);
  const X = (i: number) => L + (i * (W - L - R)) / 9, Y = (v: number) => T + (H - T - B) * (1 - v / max);
  const oi = a.findIndex((v) => v > 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible" aria-hidden>
      {[0, 1, 2, 3].map((k) => { const v = Math.round((max * k) / 3); return (
        <g key={k}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#2a2a2a" /><text x={L - 6} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="#7a7a7a">{v}</text></g>
      ); })}
      {dias.map((d, i) => (i % 2 === 0 || i === 9) && <text key={d} x={X(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#7a7a7a">{corta(d)}</text>)}
      <path d={linea(b.map((v, i) => [X(i), Y(v)]))} fill="none" stroke="#6f6f6f" strokeWidth="1.8" strokeDasharray="4 4" />
      <path d={linea(a.map((v, i) => [X(i), Y(v)]))} fill="none" stroke="#05e901" strokeWidth="2.2" strokeLinejoin="round" />
      {oi >= 0 && (
        <g>
          <line x1={X(oi)} x2={X(oi)} y1={T} y2={H - B} stroke="#05e901" strokeOpacity=".35" strokeDasharray="2 3" />
          <circle cx={X(oi)} cy={Y(a[oi])} r="3.6" fill="#141414" stroke="#05e901" strokeWidth="2" />
          <text x={Math.min(Math.max(X(oi), L + 40), W - R - 40)} y={T + 6} textAnchor="middle" fontSize="10" fontWeight="600" fill="#f5f5f5">{corta(dias[oi])} · la más vieja</text>
        </g>
      )}
    </svg>
  );
}

// ---------- Revisión de Coordinadora (marcas compartidas en Supabase: tabla despachos_revisadas) ----------
// Coordinadora no deja consultar en bloque (CAPTCHA), así que el equipo revisa guía por guía en su página y deja la marca.
// «Ya la recogieron» vale hasta que la guía salga de la lista; «Sigue sin recoger» vale solo el día en que se marcó.
const CUENTA = "GRUPO_RZ_CO";
const URL_COORD = (g: string) => `https://coordinadora.com/rastreo/rastreo-de-guia/detalle-de-rastreo-de-guia/?guia=${g}`;
const esCoord = (t: string) => /COORDINADORA/i.test(t);
type EstadoMarca = "recogida" | "sin_recoger";
type Marca = { estado: EstadoMarca; por: string; en: string };
const diaBogota = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const horaBogota = (iso: string) => new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const vigente = (m: Marca | undefined, hoy: string) => !!m && (m.estado === "recogida" || diaBogota(m.en) === hoy);

function useMarcas() {
  const [marcas, setMarcas] = useState<Record<string, Marca>>({});
  const [listo, setListo] = useState(false);
  const [error, setError] = useState("");
  const cargar = useCallback(async () => {
    const { data, error: e } = await createClient().from("despachos_revisadas").select("guia, estado, marcada_por, marcada_en").eq("cuenta", CUENTA);
    if (e) { setError("No se pudieron leer las marcas de revisión."); return; }
    const m: Record<string, Marca> = {};
    for (const r of data ?? []) m[r.guia] = { estado: r.estado as EstadoMarca, por: r.marcada_por, en: r.marcada_en };
    setMarcas(m); setListo(true); setError("");
  }, []);
  useEffect(() => {
    cargar();
    // Al volver de la pestaña de Coordinadora se traen las marcas del resto del equipo.
    const alVolver = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [cargar]);
  const marcar = useCallback(async (guia: string, estado: EstadoMarca | null) => {
    const sb = createClient();
    const antes = marcas[guia];
    if (estado === null) {
      setMarcas((x) => { const y = { ...x }; delete y[guia]; return y; });
      const { error: e } = await sb.from("despachos_revisadas").delete().eq("cuenta", CUENTA).eq("guia", guia);
      if (e) { setMarcas((x) => (antes ? { ...x, [guia]: antes } : x)); return false; }
      return true;
    }
    const { data: u } = await sb.auth.getUser();
    const fila = { cuenta: CUENTA, guia, estado, marcada_por: u.user?.email ?? "", marcada_en: new Date().toISOString() };
    setMarcas((x) => ({ ...x, [guia]: { estado, por: fila.marcada_por, en: fila.marcada_en } }));
    const { error: e } = await sb.from("despachos_revisadas").upsert(fila, { onConflict: "cuenta,guia" });
    if (e) { setMarcas((x) => { const y = { ...x }; if (antes) y[guia] = antes; else delete y[guia]; return y; }); return false; }
    return true;
  }, [marcas]);
  return { marcas, listo, error, marcar };
}

function EtiquetaMarca({ m, hoy }: { m?: Marca; hoy: string }) {
  if (!m || !vigente(m, hoy)) return <span className="text-[11px] uppercase tracking-[0.16em] text-muted/70">Sin revisar{m ? " hoy" : ""}</span>;
  const quien = m.por.split("@")[0];
  return m.estado === "recogida"
    ? <span className="text-[11px] uppercase tracking-[0.16em] text-blue">Revisada · ya la recogieron <span className="normal-case tracking-normal text-muted">({quien}, {horaBogota(m.en)})</span></span>
    : <span className="text-[11px] uppercase tracking-[0.16em] text-amber">Revisada · sigue sin recoger <span className="normal-case tracking-normal text-muted">({quien}, {horaBogota(m.en)})</span></span>;
}

const BTN_GRIS = "h-9 rounded-lg bg-[#2e2e2e] px-4 text-[11px] font-semibold uppercase tracking-[0.16em] hover:bg-[#262626] active:scale-[0.97] transition disabled:opacity-40";

// ---------- Pantalla ----------
export function DespachosApp({ datos, error }: { datos: DatosDespachos | null; error: string | null }) {
  const router = useRouter();
  const [actualizando, start] = useTransition();
  const [plantilla, setPlantilla] = useState(PLANTILLA);
  const [aviso, setAviso] = useState("");
  const s = useMemo(() => (datos ? construir(datos) : null), [datos]);
  const avisar = (t: string) => { setAviso(t); setTimeout(() => setAviso(""), 1800); };
  const { marcas, listo, error: errMarcas, marcar } = useMarcas();
  const [actual, setActual] = useState<string | null>(null);
  const actualizar = <button onClick={() => start(() => router.refresh())} disabled={actualizando}
    className="btn-primary h-11 px-7 text-xs disabled:opacity-50">{actualizando ? "Leyendo Effi…" : "Actualizar"}</button>;

  if (!s) return (
    <div className="space-y-4">
      <div className="note-error border-l-2 border-red pl-4 py-2 text-sm">{error ?? "No hay datos."}</div>
      {actualizar}
    </div>
  );

  const ven = s.todas.filter((f) => f.vencida).length;
  const { dias, a, b } = serie(s.hoy, s.todas);
  const bajarGeneral = () => guardarLibro((X) => {
    const wb = X.utils.book_new(); const u = new Set<string>();
    X.utils.book_append_sheet(wb, hoja(X, COLS_GEN, W_GEN, s.todas, filaGen), nombreHoja("Guías Pendientes", u));
    for (const g of s.grupos) X.utils.book_append_sheet(wb, hoja(X, COLS_PROV, W_PROV, g.filas, filaProv), nombreHoja(g.nombre, u));
    return wb;
  }, `GRUPO_RZ_Reporte_Despachos_General_${s.hoy}.xlsx`).catch(() => avisar("No se pudo crear el archivo"));
  const bajarProv = (g: Grupo) => guardarLibro((X) => {
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, hoja(X, COLS_PROV, W_PROV, g.filas, filaProv), "Pendientes"); return wb;
  }, `Despachos ${limpiarNombre(g.nombre)} ${s.hoy}.xlsx`).catch(() => avisar("No se pudo crear el archivo"));
  // Coordinadora: la más antigua primero; las que ya tienen marca vigente salen de la cola.
  const coord = s.todas.filter((f) => esCoord(f.transp)).sort((x, y) => y.horas - x.horas);
  const cola = coord.filter((f) => !vigente(marcas[f.guia], s.hoy));
  const revisadas = coord.length - cola.length;
  const recogidasCoord = coord.filter((f) => marcas[f.guia]?.estado === "recogida").length;
  const filaActual = actual ? coord.find((f) => f.guia === actual) ?? null : null;
  // Abre la guía en una sola pestaña con nombre fijo (no se llenan 59 pestañas). Se llama directo desde el clic.
  const abrir = (guia: string) => { window.open(URL_COORD(guia), "coordinadora"); setActual(guia); };
  const siguiente = (saltar?: string) => {
    const f = cola.find((x) => x.guia !== saltar);
    if (f) abrir(f.guia); else { setActual(null); avisar("No quedan guías de Coordinadora por revisar"); }
  };
  const marcarYSeguir = (guia: string, estado: EstadoMarca) => {
    siguiente(guia);
    marcar(guia, estado).then((ok) => { if (!ok) avisar("No se guardó la marca. Revisa tu conexión."); });
  };
  const marcarSolo = (guia: string, estado: EstadoMarca | null) =>
    marcar(guia, estado).then((ok) => avisar(ok ? (estado ? "Guía marcada" : "Marca quitada") : "No se guardó la marca"));

  const copiar = async (g: Grupo) => {
    try { await navigator.clipboard.writeText(mensaje(g, plantilla)); avisar("Mensaje copiado"); } catch { avisar("No se pudo copiar"); }
  };

  return (
    <div>
      {/* Acciones y resumen */}
      <div className="fu flex flex-wrap items-center gap-x-8 gap-y-4 mb-8" style={{ animationDelay: ".5s" }}>
        {actualizar}
        <button onClick={bajarGeneral} className="border-b border-blue pb-1 text-xs uppercase tracking-[0.18em] text-text hover:text-blue transition-colors">
          Descargar reporte general (Excel)
        </button>
        <span className="text-sm text-muted">Datos de Effi de las {s.generado.slice(11) || "—"} · días calendario</span>
      </div>

      <div className="grid md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3">
        <div className="card p-5 flex flex-col justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted">Guías pendientes</div>
            <div className="num text-6xl font-light mt-3 leading-none">{s.todas.length}</div>
            <div className="text-xs text-muted mt-3">{s.grupos.filter((g) => !g.propio).length} proveedores · {ven} {ven === 1 ? "pasó" : "pasaron"} 48 h</div>
          </div>
          <div className="mt-4"><GraficaA a={a} /></div>
        </div>
        <div className="card p-5">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted mb-3">Pendientes por día de creación · punteado: pasaron 48 h</div>
          <GraficaB dias={dias} a={a} b={b} />
        </div>
      </div>

      <div className="mt-6 space-y-2 text-sm">
        {s.recogidas.length > 0 && <p className="border-l-2 border-green pl-4 py-1">{s.recogidas.length === 1 ? "1 guía de Inter salió" : `${s.recogidas.length} guías de Inter salieron`} de la lista: Effi las muestra pendientes, pero Inter ya las recibió.</p>}
        {s.recogidas.length === 0 && !s.interHoy && <p className="border-l-2 border-white/30 pl-4 py-1 text-muted">Hoy no hay revisión de Inter: las guías de Inter se muestran como dice Effi.</p>}
        {s.incompletas > 0 && <p className="border-l-2 border-amber pl-4 py-1">{s.incompletas} guías no se pudieron completar con el detalle de Effi (marcadas con «…»). Revísalas antes de enviar.</p>}
      </div>

      {/* Revisión de Coordinadora */}
      {coord.length > 0 && (
        <section className="mt-12">
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted/60 mb-4">Revisar Coordinadora</p>
          <div className="h-px bg-white/10 mb-6" />
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <div className="num text-5xl font-light leading-none">{revisadas}<span className="text-muted/60 text-3xl"> / {coord.length}</span></div>
              <div className="text-xs text-muted mt-2">revisadas hoy · {recogidasCoord} {recogidasCoord === 1 ? "ya la recogieron" : "ya las recogieron"} · faltan {cola.length}</div>
            </div>
            <button onClick={() => siguiente()} disabled={!listo || cola.length === 0} className="btn-primary h-11 px-7 text-xs disabled:opacity-40">
              {cola.length === 0 ? "Todas revisadas" : filaActual ? "Saltar a la siguiente" : `Revisar siguiente (${cola.length})`}
            </button>
          </div>
          <p className="text-sm text-muted mt-4 max-w-3xl">
            Cada clic abre la guía en la página de Coordinadora, siempre en la misma pestaña. Mira el estado, vuelve aquí y márcala: la marca la ve todo el equipo.
            «Sigue sin recoger» vale solo por hoy; mañana la guía vuelve a la cola.
          </p>
          {errMarcas && <p className="mt-3 border-l-2 border-red pl-4 py-1 text-sm">{errMarcas}</p>}
          {filaActual && (
            <div className="card mt-6 p-5 max-w-3xl">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <a href={URL_COORD(filaActual.guia)} target="coordinadora" rel="noreferrer" className="text-2xl font-light tabular-nums underline decoration-blue/60 underline-offset-4 hover:text-blue">{filaActual.guia} ↗</a>
                <span className="text-sm text-muted">{filaActual.prov} · {filaActual.dias} d</span>
              </div>
              <p className="mt-1 text-sm">{filaActual.dest}</p>
              <p className="mt-1 text-sm text-muted">{filaActual.prod}</p>
              <div className="mt-2"><EtiquetaMarca m={marcas[filaActual.guia]} hoy={s.hoy} /></div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={() => marcarYSeguir(filaActual.guia, "recogida")} className="btn-primary h-11 px-6 text-xs">Ya la recogieron · siguiente</button>
                <button onClick={() => marcarYSeguir(filaActual.guia, "sin_recoger")} className="h-11 rounded-lg bg-[#2e2e2e] px-6 text-xs font-semibold uppercase tracking-[0.18em] hover:bg-[#262626] active:scale-[0.97] transition">Sigue sin recoger · siguiente</button>
                <button onClick={() => setActual(null)} className="h-11 px-3 text-xs uppercase tracking-[0.18em] text-muted hover:text-text">Terminar</button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Proveedores */}
      <section className="mt-12">
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted/60 mb-4">Por proveedor</p>
        <div className="h-px bg-white/10" />
        {s.grupos.length === 0 && <p className="py-10 text-muted">No hay guías pendientes. Todo salió.</p>}
        {s.grupos.map((g, i) => (
          <details key={g.nombre} className="group border-b border-white/10">
            <summary className="flex cursor-pointer list-none items-center gap-5 py-6 [&::-webkit-details-marker]:hidden">
              <span className="w-6 text-xs tabular-nums text-muted/50">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xl font-normal tracking-tight">{g.nombre}</div>
                <div className="mt-1 text-sm text-muted">
                  {g.filas.length} {g.filas.length === 1 ? "guía" : "guías"} · desde el {corta(g.antiguo)}
                  {g.vencidas > 0 && <span className="text-red"> · {g.vencidas} {g.vencidas === 1 ? "pasó" : "pasaron"} 48 h</span>}
                </div>
              </div>
              <span className={`num text-2xl font-light ${g.vencidas ? "text-red" : g.max >= 3 ? "text-amber" : "text-text"}`}>{g.max} d</span>
              <span className="size-2 rotate-45 border-b border-r border-muted transition-transform group-open:rotate-[225deg]" aria-hidden />
            </summary>
            <div className="pb-8 sm:pl-11">
              <div className="flex flex-wrap gap-3 mb-5">
                {!g.propio && <button onClick={() => imagen(g, s.hoy)} className="btn-primary h-11 px-6 text-xs">Imagen para WhatsApp</button>}
                <button onClick={() => bajarProv(g)} className="h-11 rounded-lg bg-[#2e2e2e] px-6 text-xs font-semibold uppercase tracking-[0.18em] hover:bg-[#262626] active:scale-[0.97] transition">Excel</button>
                {!g.propio && <button onClick={() => copiar(g)} className="h-11 rounded-lg bg-[#2e2e2e] px-6 text-xs font-semibold uppercase tracking-[0.18em] hover:bg-[#262626] active:scale-[0.97] transition">Copiar mensaje</button>}
              </div>
              {!g.propio && (
                <pre className="mb-5 whitespace-pre-wrap rounded-lg border border-white/10 bg-panel p-4 font-sans text-sm text-text/90">{mensaje(g, plantilla)}</pre>
              )}
              <div className="divide-y divide-white/10 border-y border-white/10">
                {g.filas.map((f) => (
                  <div key={f.guia} className={`py-3 pl-4 text-sm border-l-2 ${f.vencida ? "border-red bg-red/[0.06]" : "border-transparent"}`}>
                    <div className="flex justify-between gap-3">
                      {/COORDINADORA/i.test(f.transp)
                        ? <a href={URL_COORD(f.guia)} target="coordinadora" onClick={() => setActual(f.guia)} rel="noreferrer" title="Ver el estado real en Coordinadora" className="font-semibold tabular-nums underline decoration-blue/60 underline-offset-4 hover:text-blue">{f.guia} ↗</a>
                        : <b className="font-semibold tabular-nums">{f.guia}</b>}
                      <span className="whitespace-nowrap text-muted">{f.transp} · {f.dias} d</span>
                    </div>
                    <p className="mt-0.5 font-medium">{f.dest}{f.tipo ? ` · ${f.tipo}` : ""}</p>
                    <p className="mt-0.5 text-muted">{f.prod}{f.vencida && <span className="font-semibold text-red"> · pasó 48 h</span>}</p>
                    {esCoord(f.transp) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <EtiquetaMarca m={marcas[f.guia]} hoy={s.hoy} />
                        <span className="flex-1" />
                        <button onClick={() => abrir(f.guia)} className={BTN_GRIS}>Abrir</button>
                        {marcas[f.guia]?.estado !== "recogida" && <button onClick={() => marcarSolo(f.guia, "recogida")} disabled={!listo} className={BTN_GRIS}>Ya la recogieron</button>}
                        {!(marcas[f.guia]?.estado === "sin_recoger" && vigente(marcas[f.guia], s.hoy)) && <button onClick={() => marcarSolo(f.guia, "sin_recoger")} disabled={!listo} className={BTN_GRIS}>Sin recoger</button>}
                        {marcas[f.guia] && <button onClick={() => marcarSolo(f.guia, null)} disabled={!listo} className="h-9 px-2 text-[11px] uppercase tracking-[0.16em] text-muted hover:text-text">Quitar</button>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </details>
        ))}
      </section>

      {/* Ajustes */}
      <section className="mt-12">
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted/60 mb-4">Mensaje base</p>
        <div className="h-px bg-white/10 mb-5" />
        <p className="text-sm text-muted mb-3">Usa {"{proveedor}"}, {"{n}"}, {"{antiguo}"} y {"{dias}"}. El cambio vale mientras tengas abierta la página.</p>
        <textarea value={plantilla} onChange={(e) => setPlantilla(e.target.value)} rows={6}
          className="w-full rounded-lg border border-white/10 bg-panel p-4 text-sm outline-none focus:border-blue" aria-label="Mensaje base" />
      </section>

      {aviso && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-blue px-5 py-3 text-sm font-semibold text-[#0a0a0a]" role="status">{aviso}</div>}
    </div>
  );
}
