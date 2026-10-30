"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { dinero, entero } from "@/lib/formato";
import { sumarDias } from "@/lib/filtros";
import { BarraHorizontal } from "./barra-horizontal";
import { infoCuenta } from "@/lib/paises";

// 📞 Bandeja de novedades: una línea por novedad, para solucionar cientos sin salir de Effi Connect. En cada línea la
// asesora marca Contacto 1, 2 y 3 (el mismo CRM de Disponible en oficina), escoge la solución de la transportadora y
// la envía a Effi con Enter o con el botón. Las nuevas llegan solas: Effi se sincroniza cada minuto.
// "📌 Hacer seguimiento" es interno (no va a Effi ni a la transportadora): se pone el día en que el cliente pidió que lo
// llamen y, desde ese día, la novedad sube arriba resaltada hasta que se quite o la novedad se cierre en Effi.

type Resultado = "contesto" | "no_contesto" | "telefono_malo";
export type FilaNovedad = {
  cuenta: string; empresa: number; id: number; guia: string | null; transportadora: string | null; transportadora_id: number;
  novedad: string | null; aclaracion: string | null; llego: string; est_novedad: number; estado_novedad: string | null;
  cliente: string | null; telefono: string | null; direccion: string | null; ciudad: string | null; provincia: string | null;
  contenido: string | null; // lo que se vendió (contenido de la guía)
  seguimiento: { fecha: string; nota: string | null; u: string | null; en: string } | null; // interno, no va a Effi
  recaudo: number | null; estado_guia: string | null;
  llamadas: Record<string, { r: Resultado; u: string | null; en: string }>;
  envio: { id: number; estado: "enviando" | "enviada" | "error"; mensaje: string | null; solucion: string | null; usuario: string | null; en: string } | null;
};
export type Solucion = { cuenta: string; transportadora_efficommerce: number; id_solucion: number; nombre_solucion: string; pide_entrega: boolean; veces: number };
type Medidor = { llegaron: number; llamadas: number; contactados: number; solucionadas: number; cambiaron: number; entregadas: number; pendientes: number; respuesta_min: number | null };
export type Medidores = { cuentas: (Medidor & { cuenta: string })[]; asesoras: (Medidor & { email: string; nombre: string })[] };
type Borrador = { sol?: string; fecha?: string; tel?: string; dir?: string; ges?: string };

const RESULTADOS: Record<Resultado, { label: string; color: string }> = {
  contesto: { label: "Contactado", color: "var(--green)" },
  no_contesto: { label: "No contesta", color: "var(--red)" },
  telefono_malo: { label: "No aplica", color: "#b48cff" },
};
const hoyLocal = (cuenta: string) => new Intl.DateTimeFormat("en-CA", { timeZone: infoCuenta(cuenta).zona }).format(new Date());
const hace = (iso: string, ahora: number) => {
  const m = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d`;
};
const minutos = (m: number | null) => (m == null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
const ESTADOS = [{ id: "pendientes", label: "Por solucionar" }, { id: "seguimiento", label: "📌 Seguimiento hoy" }, { id: "enviadas", label: "Enviadas hoy" }, { id: "todas", label: "Todas" }];
const SEGUIR = "seguir"; // valor de "Hacer seguimiento" en la lista de soluciones
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function NovedadesBandeja({ cuenta, desde, hasta, filas: inicial, soluciones, medidores: medInicial, verEquipo, email }: {
  cuenta: string; desde: string; hasta: string; filas: FilaNovedad[]; soluciones: Solucion[]; medidores: Medidores | null;
  verEquipo: boolean; email: string;
}) {
  const [filas, setFilas] = useState(inicial);
  const [med, setMed] = useState(medInicial);
  const [borr, setBorr] = useState<Record<number, Borrador>>({});
  const [aviso, setAviso] = useState<Record<number, string>>({});
  const [ocupada, setOcupada] = useState<Record<number, boolean>>({});
  const [filtro, setFiltro] = useState({ estado: "pendientes", transp: "", novedad: "", buscar: "", mias: false });
  const [ahora, setAhora] = useState(() => Date.now());
  const [copiada, setCopiada] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const vivo = useRef(true);

  // Bandeja y medidores se refrescan solos: las novedades nuevas aparecen arriba sin recargar la página.
  const recargar = useCallback(async () => {
    const [b, m] = await Promise.all([
      supabase.rpc("novedades_bandeja", { p_cuentas: [cuenta] }),
      supabase.rpc("novedades_medidores", { p_cuentas: [cuenta], p_desde: desde, p_hasta: hasta }),
    ]);
    if (!vivo.current) return;
    if (b.data) setFilas(b.data as FilaNovedad[]);
    if (m.data) setMed(m.data as Medidores);
  }, [supabase, cuenta, desde, hasta]);
  useEffect(() => {
    vivo.current = true;
    const t = setInterval(recargar, 30_000), r = setInterval(() => setAhora(Date.now()), 30_000);
    return () => { vivo.current = false; clearInterval(t); clearInterval(r); };
  }, [recargar]);
  // Mientras haya envíos en camino a Effi, se revisa cada 2 segundos cómo terminaron.
  const enCamino = filas.some((f) => f.envio?.estado === "enviando");
  useEffect(() => {
    if (!enCamino) return;
    const t = setInterval(recargar, 2000);
    return () => clearInterval(t);
  }, [enCamino, recargar]);

  const catalogo = useMemo(() => {
    const m = new Map<number, Solucion[]>();
    for (const s of soluciones) m.set(s.transportadora_efficommerce, [...(m.get(s.transportadora_efficommerce) ?? []), s]);
    for (const xs of m.values()) xs.sort((a, b) => b.veces - a.veces);
    return m;
  }, [soluciones]);

  const hoy = hoyLocal(cuenta);
  const enviadaHoy = (f: FilaNovedad) => f.envio && f.envio.estado !== "error" && hoyLocal(cuenta) === new Intl.DateTimeFormat("en-CA", { timeZone: infoCuenta(cuenta).zona }).format(new Date(f.envio.en));
  const transportadoras = [...new Set(filas.map((f) => f.transportadora ?? "—"))].sort();
  const tipos = [...new Set(filas.map((f) => f.novedad ?? "—"))].sort();
  const q = filtro.buscar.trim().toLowerCase();
  // Seguimiento que ya toca (su día es hoy o ya pasó) y la novedad sigue abierta en Effi.
  const toca = (f: FilaNovedad) => (f.seguimiento && f.est_novedad === 1 && f.seguimiento.fecha <= hoy ? f.seguimiento.fecha : null);
  const porSeguir = filas.filter(toca).length;
  const vista = filas.filter((f) => {
    const pendiente = f.est_novedad === 1 && (!f.envio || f.envio.estado === "error");
    if (filtro.estado === "seguimiento" && !toca(f)) return false;
    if (filtro.estado === "pendientes" && !pendiente && f.envio?.estado !== "enviando") return false;
    if (filtro.estado === "enviadas" && !enviadaHoy(f)) return false;
    if (filtro.transp && (f.transportadora ?? "—") !== filtro.transp) return false;
    if (filtro.novedad && (f.novedad ?? "—") !== filtro.novedad) return false;
    if (filtro.mias && !Object.values(f.llamadas).some((l) => l.u === email) && f.envio?.usuario !== email) return false;
    if (q && ![f.guia, f.telefono, f.cliente].some((x) => (x ?? "").toLowerCase().includes(q))) return false;
    return true;
  // Los seguimientos que ya tocan van siempre arriba (el más atrasado primero); el resto sigue en su orden.
  }).map((f, i) => ({ f, i, t: toca(f) }))
    .sort((a, z) => (a.t ? 0 : 1) - (z.t ? 0 : 1) || (a.t && z.t ? a.t.localeCompare(z.t) : 0) || a.i - z.i)
    .map((x) => x.f);

  const cambiar = (id: number, c: Borrador) => setBorr((b) => ({ ...b, [id]: { ...b[id], ...c } }));

  async function marcar(f: FilaNovedad, intento: number, r: string) {
    const antes = f.llamadas;
    setFilas((xs) => xs.map((x) => x.id === f.id ? { ...x, llamadas: r ? { ...x.llamadas, [intento]: { r: r as Resultado, u: email, en: new Date().toISOString() } } : Object.fromEntries(Object.entries(x.llamadas).filter(([k]) => k !== String(intento))) } : x));
    const { error } = await supabase.rpc("novedad_llamar", { p_cuenta: f.cuenta, p_empresa: f.empresa, p_novedad: f.id, p_intento: intento, p_resultado: r });
    if (error) { setFilas((xs) => xs.map((x) => x.id === f.id ? { ...x, llamadas: antes } : x)); setAviso((a) => ({ ...a, [f.id]: error.message })); }
  }

  // Seguimiento interno: se guarda en Effi Connect (novedad_seguir), nunca se envía a Effi. Sin fecha = quitarlo.
  async function seguir(f: FilaNovedad, fecha: string | null) {
    const b = borr[f.id] ?? {};
    if (fecha === undefined || (fecha !== null && !fecha)) return;
    setOcupada((o) => ({ ...o, [f.id]: true }));
    const nota = fecha ? (b.ges ?? "").trim() || null : null;
    const { error } = await supabase.rpc("novedad_seguir", { p_cuenta: f.cuenta, p_empresa: f.empresa, p_novedad: f.id, p_fecha: fecha, p_nota: nota });
    setOcupada((o) => ({ ...o, [f.id]: false }));
    if (error) { setAviso((a) => ({ ...a, [f.id]: error.message })); return; }
    setAviso((a) => ({ ...a, [f.id]: "" }));
    setFilas((xs) => xs.map((x) => x.id === f.id ? { ...x, seguimiento: fecha ? { fecha, nota, u: email, en: new Date().toISOString() } : null } : x));
    if (fecha) setBorr((x) => ({ ...x, [f.id]: {} }));
  }

  async function enviar(f: FilaNovedad) {
    if (ocupada[f.id]) return;
    const b = borr[f.id] ?? {};
    if (b.sol === SEGUIR) {
      if (!b.fecha) { setAviso((a) => ({ ...a, [f.id]: "¿Qué día lo llamamos?" })); return; }
      return seguir(f, b.fecha);
    }
    const sols = catalogo.get(f.transportadora_id) ?? [];
    const s = sols.find((x) => String(x.id_solucion) === b.sol);
    const falta = !s ? "Elige la solución" : s.pide_entrega && !b.fecha ? "Pon la fecha de nueva entrega" : !(b.ges ?? "").trim() ? "Escribe qué se habló" : null;
    if (falta) { setAviso((a) => ({ ...a, [f.id]: falta })); return; }
    setOcupada((o) => ({ ...o, [f.id]: true }));
    setAviso((a) => ({ ...a, [f.id]: "" }));
    const { data, error } = await supabase.rpc("novedad_enviar", {
      p_cuenta: f.cuenta, p_empresa: f.empresa, p_novedad: f.id, p_id_solucion: s!.id_solucion, p_gestion: b.ges,
      p_fecha: s!.pide_entrega ? b.fecha : null, p_destinatario: s!.pide_entrega ? (f.cliente ?? "").slice(0, 50) : null,
      p_direccion: s!.pide_entrega ? (b.dir ?? f.direccion ?? "").slice(0, 100) : null,
      p_telefonos: s!.pide_entrega ? (b.tel ?? f.telefono ?? "").slice(0, 40) : null,
    });
    setOcupada((o) => ({ ...o, [f.id]: false }));
    if (error) { setAviso((a) => ({ ...a, [f.id]: error.message })); return; }
    setFilas((xs) => xs.map((x) => x.id === f.id ? { ...x, envio: { id: Number(data), estado: "enviando", mensaje: null, solucion: s!.nombre_solucion, usuario: email, en: new Date().toISOString() } } : x));
  }

  const m = med?.cuentas.find((c) => c.cuenta === cuenta);
  const asesoras = (med?.asesoras ?? []).filter((a) => verEquipo || a.email === email);
  const copiar = async (g: string) => { try { await navigator.clipboard.writeText(g); setCopiada(g); setTimeout(() => setCopiada(null), 1500); } catch { /* sin portapapeles */ } };
  const sel = "h-7 rounded-md border border-line bg-black/[0.03] px-1.5 text-xs text-text";
  const inp = "h-7 rounded-md border border-line bg-black/[0.03] px-2 text-xs text-text placeholder:text-muted/60";

  return (
    <div className="space-y-4">
      {/* Medidores del periodo del calendario (hoy por defecto). */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
        <Medidor titulo="Llegaron" valor={m?.llegaron} />
        <Medidor titulo="Llamadas" valor={m?.llamadas} />
        <Medidor titulo="Contactados" valor={m?.contactados} sub={m?.llamadas ? `${Math.round((m.contactados / m.llamadas) * 100)}% de las llamadas` : undefined} />
        <Medidor titulo="Solucionadas" valor={m?.solucionadas} color="var(--blue-2)" />
        <Medidor titulo="Cambiaron de estado" valor={m?.cambiaron} />
        <Medidor titulo="Entregadas" valor={m?.entregadas} color="var(--green)" sub={m?.solucionadas ? `${Math.round((m.entregadas / m.solucionadas) * 100)}% de las solucionadas` : undefined} />
        <Medidor titulo="Pendientes ahora" valor={m?.pendientes} color="var(--amber)" />
        <Medidor titulo="Respuesta promedio" texto={minutos(m?.respuesta_min ?? null)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-line bg-black/[0.02] p-0.5 text-xs">
          {ESTADOS.map((e) => (
            <button key={e.id} onClick={() => setFiltro((x) => ({ ...x, estado: e.id }))}
              className={`rounded-lg px-3 py-1 font-semibold transition-colors ${filtro.estado === e.id ? "bg-blue/25 text-text" : "text-muted hover:text-text"}`}>{e.label}</button>
          ))}
        </div>
        <select value={filtro.transp} onChange={(e) => setFiltro((x) => ({ ...x, transp: e.target.value }))} className={`${sel} h-8`}>
          <option value="">Todas las transportadoras</option>
          {transportadoras.map((t) => <option key={t} value={t} className="bg-bg">{t}</option>)}
        </select>
        <select value={filtro.novedad} onChange={(e) => setFiltro((x) => ({ ...x, novedad: e.target.value }))} className={`${sel} h-8 max-w-[16rem]`}>
          <option value="">Todas las novedades</option>
          {tipos.map((t) => <option key={t} value={t} className="bg-bg">{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={filtro.mias} onChange={(e) => setFiltro((x) => ({ ...x, mias: e.target.checked }))} /> Solo las mías
        </label>
        <input value={filtro.buscar} onChange={(e) => setFiltro((x) => ({ ...x, buscar: e.target.value }))} placeholder="Buscar guía, teléfono o cliente" className={`${inp} h-8 w-56`} />
        <span className="ml-auto text-xs text-muted">{entero(vista.length)} {vista.length === 1 ? "novedad" : "novedades"} · llegan solas cada minuto</span>
      </div>

      {/* Clientes que pidieron que los llamaran hoy (o antes) y la novedad sigue abierta: siempre a la vista. */}
      {porSeguir > 0 && (
        <button onClick={() => setFiltro((x) => ({ ...x, estado: "seguimiento" }))}
          className="w-full flex flex-wrap items-center gap-3 rounded-2xl border border-amber/50 bg-amber/10 px-4 py-3 text-left hover:bg-amber/15">
          <span className="text-2xl">📌</span>
          <span className="font-display text-lg font-semibold text-amber">
            {porSeguir === 1 ? "1 novedad para hacer seguimiento hoy" : `${entero(porSeguir)} novedades para hacer seguimiento hoy`}
          </span>
          <span className="text-xs text-muted">Pidieron que los llamaran hoy o antes y la novedad sigue abierta. Van de primeras en la lista.</span>
        </button>
      )}

      <BarraHorizontal>
        <table className="w-full min-w-max text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted border-b border-line">
              {["Llegó", "Transportadora", "Guía", "Novedad", "Contenido", "Cliente", "Teléfono", "Ciudad", "Dirección", "Recaudo", "Contacto 1", "Contacto 2", "Contacto 3", "Solución", "Nueva entrega", "Qué se habló", "", "Asesora"].map((h, i) => (
                <th key={i} className="px-2 py-2 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vista.map((f) => {
              const b = borr[f.id] ?? {};
              const sols = catalogo.get(f.transportadora_id) ?? [];
              const s = sols.find((x) => String(x.id_solucion) === b.sol);
              const env = f.envio;
              const enviada = env && env.estado !== "error";
              const fondo = env?.estado === "enviada" ? "bg-green/10" : env?.estado === "enviando" ? "bg-amber/10" : aviso[f.id] || env?.estado === "error" ? "bg-red/10" : "";
              const bloqueada = !!enviada || ocupada[f.id];
              const asesora = env?.usuario ?? Object.values(f.llamadas).sort((a, z) => z.en.localeCompare(a.en))[0]?.u ?? null;
              const seg = toca(f), sigue = b.sol === SEGUIR;
              return (
                <tr key={`${f.empresa}-${f.id}`} className={`border-b border-line/60 align-middle ${seg ? "bg-amber/[0.08] hover:bg-amber/[0.12] shadow-[inset_3px_0_0_#ffb347]" : `hover:bg-black/[0.03] ${fondo}`}`}>
                  <td className="px-2 py-1.5 whitespace-nowrap text-muted" title={new Date(f.llego).toLocaleString("es-CO")} suppressHydrationWarning>
                    {seg && (
                      <div className="mb-1 inline-block rounded-full bg-amber px-2 py-0.5 text-[10px] font-bold text-black">
                        📌 {seg === hoy ? "Llamar hoy" : `Seguimiento del ${ddmm(seg)}`}
                      </div>
                    )}
                    <div>{hace(f.llego, ahora)}</div>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{f.transportadora}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {f.guia && (
                      <button onClick={() => copiar(f.guia!)} title="Copiar guía" className="group inline-flex items-center gap-1 font-mono font-semibold hover:text-blue-2">
                        {f.guia}<Copy size={10} className="opacity-40 group-hover:opacity-100" />
                        {copiada === f.guia && <span className="text-[10px] text-green font-sans">copiada</span>}
                      </button>
                    )}
                    <div className="text-[10px] text-muted">{f.estado_guia}</div>
                  </td>
                  <td className="px-2 py-1.5 max-w-[15rem]">
                    <div className="font-semibold truncate" title={f.novedad ?? ""}>{f.novedad}</div>
                    <div className="text-muted truncate" title={f.aclaracion ?? ""}>{f.aclaracion}</div>
                  </td>
                  <td className="px-2 py-1.5 min-w-[10rem] max-w-[14rem] font-semibold text-blue-2" title={f.contenido ?? ""}>
                    <div className="line-clamp-2">{f.contenido ?? "—"}</div>
                  </td>
                  <td className="px-2 py-1.5 max-w-[11rem] truncate" title={f.cliente ?? ""}>{f.cliente}</td>
                  <td className="px-2 py-1.5"><input value={b.tel ?? f.telefono ?? ""} disabled={bloqueada} onChange={(e) => cambiar(f.id, { tel: e.target.value })} className={`${inp} w-28`} /></td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{f.ciudad}</td>
                  <td className="px-2 py-1.5"><input value={b.dir ?? f.direccion ?? ""} disabled={bloqueada} onChange={(e) => cambiar(f.id, { dir: e.target.value })} title={b.dir ?? f.direccion ?? ""} className={`${inp} w-48`} /></td>
                  <td className="px-2 py-1.5 whitespace-nowrap num">{f.recaudo != null ? dinero(f.recaudo, f.cuenta) : "—"}</td>
                  {[1, 2, 3].map((i) => {
                    const l = f.llamadas[String(i)];
                    return (
                      <td key={i} className="px-2 py-1.5">
                        <select value={l?.r ?? ""} onChange={(e) => marcar(f, i, e.target.value)} title={l?.u ?? ""}
                          className={sel} style={l ? { color: RESULTADOS[l.r].color, borderColor: RESULTADOS[l.r].color } : undefined}>
                          <option value="" className="bg-bg text-text">—</option>
                          {(Object.keys(RESULTADOS) as Resultado[]).map((r) => <option key={r} value={r} className="bg-bg text-text">{RESULTADOS[r].label}</option>)}
                        </select>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5">
                    {/* Seguimiento interno guardado: el día y la nota, con ✕ para quitarlo. */}
                    {f.seguimiento && (
                      <div className="mb-1 flex items-center gap-1" title={`${f.seguimiento.nota ?? ""}${f.seguimiento.u ? ` · ${f.seguimiento.u.split("@")[0]}` : ""}`}>
                        <span className="rounded-full border border-amber/60 bg-amber/10 px-2 py-0.5 text-[10px] font-semibold text-amber">
                          📌 Seguimiento {ddmm(f.seguimiento.fecha)}{f.seguimiento.nota ? ` · ${f.seguimiento.nota.slice(0, 24)}` : ""}
                        </span>
                        <button onClick={() => seguir(f, null)} disabled={ocupada[f.id]} title="Quitar el seguimiento" className="rounded p-0.5 text-muted hover:text-red"><X size={11} /></button>
                      </div>
                    )}
                    {enviada ? <span className="font-semibold text-green">{env!.solucion}</span> : (
                      <select value={b.sol ?? ""} disabled={bloqueada} onChange={(e) => cambiar(f.id, { sol: e.target.value, fecha: undefined })} className={`${sel} w-44`}
                        style={sigue ? { color: "#ffb347", borderColor: "#ffb347" } : undefined}>
                        <option value="" className="bg-bg">{sols.length ? "Elegir…" : "Elegir… (sin catálogo de Effi)"}</option>
                        <option value={SEGUIR} className="bg-bg">📌 Hacer seguimiento (interno)</option>
                        {sols.map((x, i) => (
                          <option key={x.id_solucion} value={x.id_solucion} className="bg-bg">
                            {x.nombre_solucion}{sols.findIndex((y) => y.nombre_solucion === x.nombre_solucion) < i ? ` (opción ${x.id_solucion})` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {sigue && !enviada
                      ? <input type="date" value={b.fecha ?? ""} min={hoy} disabled={bloqueada} title="Día en que el cliente pidió que lo llamen"
                          onChange={(e) => cambiar(f.id, { fecha: e.target.value })} className={`${inp} w-32 border-amber/60`} />
                      : s?.pide_entrega && !enviada
                      ? <input type="date" value={b.fecha ?? ""} min={sumarDias(hoy, 1)} max={sumarDias(hoy, 5)} disabled={bloqueada} onChange={(e) => cambiar(f.id, { fecha: e.target.value })} className={`${inp} w-32`} />
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    {enviada ? <span className="text-muted">{env!.estado === "enviando" ? "Enviando a Effi…" : env!.mensaje ?? "Recibida por Effi"}</span> : (
                      <input value={b.ges ?? ""} disabled={bloqueada} maxLength={sigue ? 500 : 1024} placeholder={sigue ? "Llámeme el martes en la tarde" : "Recibe el jueves en la tarde"}
                        onChange={(e) => cambiar(f.id, { ges: e.target.value })} onKeyDown={(e) => e.key === "Enter" && enviar(f)} className={`${inp} w-56`} />
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {env?.estado === "enviada" ? <span className="font-semibold text-green">✓ En Effi</span>
                      : env?.estado === "enviando" ? <span className="text-amber">Enviando…</span>
                      : (
                        <div>
                          {sigue ? (
                            <button onClick={() => enviar(f)} disabled={ocupada[f.id]} title="Se guarda en Effi Connect; no se envía a Effi"
                              className="inline-flex items-center gap-1 rounded-md bg-amber px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-40">
                              📌 Guardar
                            </button>
                          ) : (
                            <button onClick={() => enviar(f)} disabled={ocupada[f.id] || !sols.length}
                              className="inline-flex items-center gap-1 rounded-md bg-blue px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
                              <Send size={11} /> Enviar
                            </button>
                          )}
                          {(aviso[f.id] || env?.estado === "error") && <div className="mt-0.5 max-w-[14rem] whitespace-normal text-[10px] text-red">{aviso[f.id] || env?.mensaje}</div>}
                        </div>
                      )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-muted">{asesora ? asesora.split("@")[0] : "—"}</td>
                </tr>
              );
            })}
            {!vista.length && (
              <tr><td colSpan={18} className="px-4 py-10 text-center text-sm text-muted">
                {filtro.estado === "pendientes" ? "Sin novedades por solucionar en este país. Las nuevas aparecen aquí solas." : "Nada con estos filtros."}
              </td></tr>
            )}
          </tbody>
        </table>
      </BarraHorizontal>
      <p className="text-[11px] text-muted">Tab pasa de casilla en casilla dentro de la línea; Enter en “Qué se habló” envía la línea a Effi. Lo enviado no se puede deshacer en Effi.</p>

      <div className="space-y-2">
        <div className="font-display text-lg font-semibold">{verEquipo ? "Rendimiento por asesora" : "Tu rendimiento"}</div>
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted border-b border-line">
                {["Asesora", "Llamadas", "Contactados", "Solucionadas", "Cambiaron de estado", "Entregadas", "Pendientes suyas", "Respuesta promedio"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {asesoras.map((a) => (
                <tr key={a.email} className="border-b border-line/60">
                  <td className="px-3 py-2 font-semibold">{a.nombre}</td>
                  <td className="px-3 py-2 num">{entero(a.llamadas)}</td>
                  <td className="px-3 py-2 num">{entero(a.contactados)} <span className="text-muted text-xs">{a.llamadas ? `${Math.round((a.contactados / a.llamadas) * 100)}%` : ""}</span></td>
                  <td className="px-3 py-2 num text-blue-2">{entero(a.solucionadas)}</td>
                  <td className="px-3 py-2 num">{entero(a.cambiaron)}</td>
                  <td className="px-3 py-2 num text-green">{entero(a.entregadas)} <span className="text-muted text-xs">{a.solucionadas ? `${Math.round((a.entregadas / a.solucionadas) * 100)}%` : ""}</span></td>
                  <td className="px-3 py-2 num text-amber">{entero(a.pendientes)}</td>
                  <td className="px-3 py-2">{minutos(a.respuesta_min)}</td>
                </tr>
              ))}
              {!asesoras.length && <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-muted">Todavía nadie ha llamado ni solucionado en este periodo.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Medidor({ titulo, valor, texto, color, sub }: { titulo: string; valor?: number; texto?: string; color?: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">{titulo}</div>
      <div className="num text-2xl font-semibold mt-0.5" style={color ? { color } : undefined}>{texto ?? entero(valor ?? 0)}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}
