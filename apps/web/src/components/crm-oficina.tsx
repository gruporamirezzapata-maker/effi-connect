"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, MessageCircle, PhoneCall, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { dinero, entero } from "@/lib/formato";
import { CON_FECHA, OBSERVACIONES, PREFIJO_OTRO, textoObservacion, type CodigoObs } from "@/lib/oficina";
import { infoCuenta } from "@/lib/paises";
import { BarraHorizontal } from "./barra-horizontal";

// CRM de "Disponible en oficina" con el mismo formato que el equipo usaba en Drive: por guía, Contacto 1, 2 y 3
// por llamada, cada uno Contactado / No contesta / No aplica, más una Observación de una lista cerrada (sin texto
// libre, para poder medirla). El WhatsApp lo envía el bot.
// Cada contacto queda guardado con hora y usuario, así se puede medir la efectividad; quién llenó cada casilla solo lo
// ve el dueño. La lista se actualiza sola cada minuto: lo que pasa a devolución o a entregada sale de aquí (la medición
// de qué pasó con lo que llegó a oficina está en el cuadre).
// "Hacer seguimiento" guarda el día en que el cliente pidió que lo llamen: desde ese día la guía va siempre arriba de la
// lista, resaltada, hasta que alguien cambie la observación (o la guía se entregue o se devuelva y salga sola).

type Resultado = "contesto" | "no_contesto" | "telefono_malo";
export type Llamada = { id: number; intento: number; resultado: Resultado; canal: "llamada" | "whatsapp"; nota: string | null; usuario: string | null; creado_en: string };
export type GuiaOficina = {
  guia: string; transportadora: string | null; destinatario: string | null; id_destinatario: string | null; telefono: string | null;
  pais: string | null; ciudad: string | null; provincia: string | null; direccion: string | null; valor: number | null;
  contenido: string | null; centro_costos: string | null; remitente: string | null; estado: string | null; estado_efficommerce: string | null;
  fecha_trans: string | null; llegada: string | null;
  llamadas: Llamada[];
  observacion: { codigo: CodigoObs | null; fecha: string | null; texto: string | null; usuario: string | null; actualizado_en: string } | null;
};

export const RESULTADOS: Record<Resultado, { label: string; color: string }> = {
  contesto: { label: "CONTACTADO", color: "var(--green)" },
  no_contesto: { label: "NO CONTESTA", color: "var(--red)" },
  telefono_malo: { label: "NO APLICA", color: "#b48cff" },
};
const CONTACTOS = [
  { intento: 1, label: "Contacto 1", canal: "llamada" },
  { intento: 2, label: "Contacto 2", canal: "llamada" },
  { intento: 3, label: "Contacto 3", canal: "llamada" },
] as const;
const FILTROS = [
  { id: "todas", label: "Todas" },
  { id: "seguimiento", label: "📌 Seguimiento hoy" },
  { id: "sin_llamar", label: "Sin contactar" },
  { id: "contesto", label: "Contactado" },
  { id: "no_contesto", label: "No contesta" },
  { id: "telefono_malo", label: "No aplica" },
] as const;
const POR_PAGINA = 60;
// Hora local de cada tienda e indicativo para abrir WhatsApp.

const hace = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return `${Math.floor(m / 1440)} d`;
};
// Un campo puede traer varios teléfonos: "300 123 4567 / 311..." → cada uno con su botón (sin repetir).
const telefonos = (t: string | null) => [...new Set((t ?? "").split(/[,;/|]| - /).map((x) => x.replace(/[^\d+]/g, "")).filter((x) => x.length >= 7))];
const whatsapp = (tel: string, cuenta: string) => {
  const d = tel.replace(/\D/g, ""), ind = infoCuenta(cuenta).indicativo;
  return `https://wa.me/${d.startsWith(ind) && d.length > 10 ? d : ind + d.replace(/^0+/, "")}`;
};

// Efectividad del contacto medida por entregas (oficina_efectividad): de las guías contactadas en 14 días, cuántas se
// entregaron, y cuántas de ellas se entregaron hoy.
export type Efectividad = { contactadas: number; entregadas: number; entregadas_hoy: number };

export function CrmOficina({ cuenta, guias, esDueno = false, ingresaronHoy, efectividad }: {
  cuenta: string; guias: GuiaOficina[]; esDueno?: boolean; ingresaronHoy?: number; efectividad?: Efectividad | null;
}) {
  const router = useRouter();
  // Cada minuto se vuelve a pedir la lista: las guías que Effi pasó a devolución o a entregada desaparecen sin que nadie
  // las llame.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);
  const quien = (email: string | null) => (email ? email.split("@")[0] : "");
  const zona = infoCuenta(cuenta).zona;
  const hora = (iso: string) => new Intl.DateTimeFormat("es-CO", { timeZone: zona, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const dia = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date(iso));
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["id"]>("todas");
  const [buscar, setBuscar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  // Cambios guardados en esta sesión, para verlos al instante antes de que la página se refresque.
  const [locales, setLocales] = useState<Record<string, Llamada[]>>({});
  const [obs, setObs] = useState<Record<string, { codigo: CodigoObs | ""; fecha: string | null; texto?: string }>>({});
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [copiada, setCopiada] = useState<string | null>(null);

  const llamadasDe = (g: GuiaOficina) => {
    const m = new Map(g.llamadas.map((l) => [l.intento, l]));
    (locales[g.guia] ?? []).forEach((l) => m.set(l.intento, l));
    return [...m.values()].sort((a, b) => a.intento - b.intento);
  };
  const hoy = dia(new Date());
  // Seguimiento que ya toca (su día es hoy o ya pasó): con lo recién guardado en esta sesión.
  const seguimiento = (g: GuiaOficina) => {
    const o = obs[g.guia] ?? { codigo: g.observacion?.codigo ?? "", fecha: g.observacion?.fecha ?? null };
    return o.codigo === "seguimiento" && !!o.fecha && o.fecha <= hoy ? o.fecha : null;
  };
  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return guias.filter((g) => {
      const ult = llamadasDe(g).at(-1);
      if (filtro === "seguimiento" && !seguimiento(g)) return false;
      if (filtro === "sin_llamar" && ult) return false;
      if (filtro !== "todas" && filtro !== "sin_llamar" && filtro !== "seguimiento" && ult?.resultado !== filtro) return false;
      return !q || [g.guia, g.destinatario, g.telefono, g.ciudad, g.contenido, g.transportadora, g.observacion?.texto].some((x) => (x ?? "").toLowerCase().includes(q));
    // Los seguimientos que ya tocan van siempre arriba (el más atrasado primero); el resto sigue en su orden.
    }).map((g, i) => ({ g, i, s: seguimiento(g) }))
      .sort((a, b) => (a.s ? 0 : 1) - (b.s ? 0 : 1) || (a.s && b.s ? a.s.localeCompare(b.s) : 0) || a.i - b.i)
      .map((x) => x.g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guias, filtro, buscar, locales, obs, hoy]);
  const porSeguir = guias.filter((g) => seguimiento(g)).length;

  const todas = guias.flatMap((g) => llamadasDe(g));
  const deHoy = todas.filter((l) => dia(l.creado_en) === hoy);
  const sinContactar = guias.filter((g) => !llamadasDe(g).length).length;

  async function marcar(g: GuiaOficina, intento: number, canal: "llamada" | "whatsapp", resultado: Resultado | "") {
    if (!resultado) return;
    setGuardando(`${g.guia}|${intento}`); setError(null);
    const supabase = createClient();
    const actual = llamadasDe(g).find((l) => l.intento === intento);
    const q = actual
      ? supabase.from("oficina_llamadas").update({ resultado }).eq("id", actual.id)
      : supabase.from("oficina_llamadas").insert({ cuenta, guia: g.guia, resultado, canal });
    const { data, error: e } = await q.select("id,intento,resultado,canal,nota,usuario_email,creado_en").single();
    setGuardando(null);
    if (e || !data) { setError(e?.message ?? "No se pudo guardar el contacto"); return; }
    setLocales((x) => ({ ...x, [g.guia]: [...(x[g.guia] ?? []).filter((l) => l.intento !== data.intento), { ...data, usuario: data.usuario_email } as Llamada] }));
    router.refresh();
  }
  // Guarda la observación elegida. "Retirará el…" espera a que se escoja la fecha en el calendario y "Otro" a que se
  // escriba lo que dijo el cliente.
  async function guardarObs(g: GuiaOficina, codigo: CodigoObs | "", fecha: string | null, texto?: string) {
    setObs((o) => ({ ...o, [g.guia]: { codigo, fecha, texto } }));
    if (CON_FECHA.includes(codigo as CodigoObs) && !fecha) return;
    if (codigo === "otro" && !(texto ?? "").trim()) return;
    setGuardando(`${g.guia}|obs`); setError(null);
    const supabase = createClient();
    const fila: { cuenta: string; guia: string; codigo: CodigoObs | null; fecha_compromiso: string | null; observacion: string | null } = codigo
      ? { cuenta, guia: g.guia, codigo, fecha_compromiso: CON_FECHA.includes(codigo) ? fecha : null, observacion: textoObservacion(codigo, fecha, texto).slice(0, 1000) }
      : { cuenta, guia: g.guia, codigo: null, fecha_compromiso: null, observacion: null };
    const { error: e } = await supabase.from("oficina_observaciones").upsert(fila);
    setGuardando(null);
    if (e) setError(e.message); else router.refresh();
  }
  const copiar = async (t: string) => { try { await navigator.clipboard.writeText(t); setCopiada(t); setTimeout(() => setCopiada(null), 1200); } catch { /* sin portapapeles */ } };

  return (
    <div className="space-y-3">
      {/* Clientes que pidieron que los llamen hoy (o antes y siguen pendientes): siempre a la vista. */}
      {porSeguir > 0 && (
        <button onClick={() => { setFiltro("seguimiento"); setMostrar(POR_PAGINA); }}
          className="w-full flex flex-wrap items-center gap-3 rounded-2xl border border-amber/50 bg-amber/10 px-4 py-3 text-left hover:bg-amber/15">
          <span className="text-2xl">📌</span>
          <span className="font-display text-lg font-semibold text-amber">
            {porSeguir === 1 ? "1 cliente para hacer seguimiento hoy" : `${entero(porSeguir)} clientes para hacer seguimiento hoy`}
          </span>
          <span className="text-xs text-muted">Pidieron que los llamaran hoy o antes y la guía sigue en oficina. Van de primeras en la lista.</span>
        </button>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Indicador titulo="En oficina ahora" valor={entero(guias.length)} color="var(--blue-2)" />
        <Indicador titulo="Sin contactar" valor={entero(sinContactar)} color="var(--amber)" />
        <Indicador titulo="Ingresaron a oficina hoy" valor={ingresaronHoy != null ? entero(ingresaronHoy) : "—"} color="var(--blue)" />
        <Indicador titulo="Contactados hoy" valor={entero(deHoy.filter((l) => l.resultado === "contesto").length)} color="var(--green)"
          sub={`de ${entero(deHoy.length)} contactos marcados hoy`} />
        {/* Lo que importa: de lo que se contactó, cuánto se entregó. Sube con cada entrega. */}
        <Indicador titulo="Efectividad del contacto" color="var(--green)" destacado
          valor={efectividad?.contactadas ? `${Math.round((efectividad.entregadas / efectividad.contactadas) * 100)}%` : "—"}
          sub={efectividad ? `${entero(efectividad.entregadas)} de ${entero(efectividad.contactadas)} contactadas ya entregadas · +${entero(efectividad.entregadas_hoy)} hoy` : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button key={f.id} onClick={() => { setFiltro(f.id); setMostrar(POR_PAGINA); }}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filtro === f.id ? "border-blue/50 bg-blue/15 text-text" : "border-line text-muted hover:text-text"}`}>
            {f.label}{f.id === "seguimiento" ? ` (${entero(porSeguir)})` : ""}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm">
          <Search size={14} className="text-muted" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Guía, cliente, teléfono, ciudad, producto u observación"
            className="bg-transparent outline-none w-72 placeholder:text-muted" />
        </label>
      </div>
      {error && <p className="text-sm text-red">{error}</p>}

      <BarraHorizontal>
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="bg-green/15 text-left text-[11px] uppercase tracking-wider font-semibold whitespace-nowrap">
              <th className="sticky left-0 z-10 bg-green/10 px-3 py-3">Llegó</th>
              <th className="px-3 py-3">Centro de costos</th>
              <th className="px-3 py-3">Fecha de creación</th>
              <th className="px-3 py-3">Remitente</th>
              <th className="px-3 py-3">Destinatario</th>
              <th className="px-3 py-3">ID destinatario</th>
              <th className="px-3 py-3">País</th>
              <th className="px-3 py-3">Departamento</th>
              <th className="px-3 py-3">Ciudad</th>
              <th className="px-3 py-3">Dirección</th>
              <th className="px-3 py-3">Teléfonos</th>
              <th className="px-3 py-3">Transportadora</th>
              <th className="px-3 py-3">Guía</th>
              <th className="px-3 py-3 text-right">Valor recaudo</th>
              <th className="px-3 py-3">Contenido</th>
              <th className="px-3 py-3">Estado guía</th>
              <th className="px-3 py-3">Estado global</th>
              {CONTACTOS.map((c) => <th key={c.intento} className="px-2 py-3">{c.label}</th>)}
              <th className="px-3 py-3 min-w-[18rem]">Observación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lista.slice(0, mostrar).map((g) => {
              const ls = llamadasDe(g);
              const dias = g.llegada ? (Date.now() - Date.parse(g.llegada)) / 86_400_000 : 0;
              const tels = telefonos(g.telefono);
              const seg = seguimiento(g);
              return (
                <tr key={g.guia} className={`align-middle ${seg ? "bg-amber/[0.07] hover:bg-amber/[0.11]" : "hover:bg-black/[0.02]"}`}>
                  <td className={`sticky left-0 z-10 px-3 py-2 whitespace-nowrap text-xs font-mono ${seg ? "bg-amber/10 shadow-[inset_3px_0_0_#ffb347]" : "bg-panel"} ${dias >= 3 ? "text-red" : dias >= 1 ? "text-amber" : "text-muted"}`} title={g.llegada ? hora(g.llegada) : ""}>
                    {seg && (
                      <div className="mb-1 inline-block rounded-full bg-amber px-2 py-0.5 font-sans text-[10px] font-bold text-black">
                        📌 {seg === hoy ? "Llamar hoy" : `Seguimiento del ${seg.slice(8, 10)}/${seg.slice(5, 7)}`}
                      </div>
                    )}
                    <div>{g.llegada ? hora(g.llegada) : "—"}</div>
                    <div className="text-[10px] opacity-80">hace {hace(g.llegada)}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{g.centro_costos ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted">{g.fecha_trans ? hora(g.fecha_trans) : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{g.remitente ?? "—"}</td>
                  <td className="px-3 py-2 min-w-[11rem] font-semibold">{g.destinatario ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-muted">{g.id_destinatario ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{g.pais ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{g.provincia ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{g.ciudad ?? "—"}</td>
                  <td className="px-3 py-2 min-w-[14rem] max-w-[18rem] text-xs text-muted">{g.direccion ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      {tels.map((t) => (
                        <span key={t} className="inline-flex items-center gap-1">
                          <a href={`tel:${t}`} title="Llamar" className="inline-flex items-center gap-1 rounded-lg border border-green/40 bg-green/10 px-2 py-0.5 font-mono text-xs font-semibold text-green hover:bg-green/20">
                            <PhoneCall size={12} />{t}
                          </a>
                          <a href={whatsapp(t, cuenta)} target="_blank" rel="noopener noreferrer" title="Abrir WhatsApp" className="rounded-lg border border-green/40 p-1 text-green hover:bg-green/20">
                            <MessageCircle size={12} />
                          </a>
                        </span>
                      ))}
                      {!tels.length && <span className="text-xs text-red">Sin teléfono</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{g.transportadora ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={() => copiar(g.guia)} title="Copiar guía" className="group inline-flex items-center gap-1 font-mono font-semibold hover:text-blue-2">
                      {g.guia}<Copy size={11} className="opacity-40 group-hover:opacity-100" />
                    </button>
                    {copiada === g.guia && <span className="ml-1 text-[10px] text-green">copiada</span>}
                  </td>
                  <td className="px-3 py-2 text-right num whitespace-nowrap">{dinero(g.valor, cuenta)}</td>
                  <td className="px-3 py-2 min-w-[12rem] font-semibold text-blue-2">{g.contenido ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{g.estado ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{g.estado_efficommerce ?? "—"}</td>
                  {CONTACTOS.map((c) => {
                    const l = ls.find((x) => x.intento === c.intento);
                    // Se llena en orden: el contacto 2 se habilita cuando ya hay contacto 1, y así.
                    const habilitado = !!l || ls.length === c.intento - 1;
                    const col = l ? RESULTADOS[l.resultado].color : null;
                    return (
                      <td key={c.intento} className="px-2 py-2">
                        <select value={l?.resultado ?? ""} disabled={!habilitado || guardando === `${g.guia}|${c.intento}`}
                          onChange={(e) => marcar(g, c.intento, c.canal, e.target.value as Resultado | "")}
                          title={l ? `${hora(l.creado_en)}${l.usuario ? ` · ${l.usuario}` : ""}` : habilitado ? `Marcar ${c.label}` : "Primero el contacto anterior"}
                          className="w-[9.5rem] rounded-full border px-3 py-1 text-xs font-semibold outline-none disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
                          style={col ? { color: col, borderColor: `color-mix(in srgb, ${col} 50%, transparent)`, background: `color-mix(in srgb, ${col} 14%, transparent)` } : { borderColor: "var(--line)", background: "rgb(17 17 17 / 0.03)" }}>
                          <option value="" className="bg-bg text-text">—</option>
                          {(Object.keys(RESULTADOS) as Resultado[]).map((r) => <option key={r} value={r} className="bg-bg text-text">{RESULTADOS[r].label}</option>)}
                        </select>
                        {esDueno && l?.usuario && <div className="mt-0.5 text-center text-[10px] text-muted">{quien(l.usuario)} · {hora(l.creado_en)}</div>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    {(() => {
                      const actual = obs[g.guia] ?? {
                        codigo: g.observacion?.codigo ?? "", fecha: g.observacion?.fecha ?? null,
                        texto: g.observacion?.codigo === "otro" ? (g.observacion.texto ?? "").replace(PREFIJO_OTRO, "") : undefined,
                      };
                      const guardado = g.observacion?.codigo === "otro" ? (g.observacion.texto ?? "").replace(PREFIJO_OTRO, "") : "";
                      const col = actual.codigo ? OBSERVACIONES[actual.codigo].color : null;
                      return (
                        <div className="flex flex-wrap items-center gap-1.5"
                          title={g.observacion?.usuario ? `Última edición: ${hora(g.observacion.actualizado_en)} · ${g.observacion.usuario}` : undefined}>
                          <select value={actual.codigo} onChange={(e) => guardarObs(g, e.target.value as CodigoObs | "", null)}
                            className="max-w-[20rem] rounded-lg border px-2 py-1 text-xs outline-none cursor-pointer"
                            style={col ? { color: col, borderColor: `color-mix(in srgb, ${col} 45%, transparent)`, background: `color-mix(in srgb, ${col} 10%, transparent)` } : { borderColor: "var(--line)", background: "rgb(17 17 17 / 0.03)" }}>
                            <option value="" className="bg-bg text-text">— Seleccionar observación —</option>
                            {(Object.keys(OBSERVACIONES) as CodigoObs[]).map((c) => <option key={c} value={c} className="bg-bg text-text">{OBSERVACIONES[c].label}</option>)}
                          </select>
                          {/* "Realizará el retiro" y "Hacer seguimiento" despliegan el calendario: de hoy en adelante. */}
                          {actual.codigo && CON_FECHA.includes(actual.codigo) && (
                            <input type="date" min={hoy} value={actual.fecha ?? ""} onChange={(e) => guardarObs(g, actual.codigo as CodigoObs, e.target.value || null)}
                              className={`rounded-lg border px-2 py-1 text-xs outline-none [color-scheme:dark] ${actual.fecha ? "border-green/50 text-green" : "border-amber/60 text-amber"}`} />
                          )}
                          {actual.codigo && CON_FECHA.includes(actual.codigo) && !actual.fecha && (
                            <span className="text-[10px] text-amber">{actual.codigo === "seguimiento" ? "¿Qué día lo llamamos?" : "Elige el día"}</span>
                          )}
                          {/* "Otro": se escribe lo que dijo el cliente; se guarda al salir de la casilla o con Enter. */}
                          {actual.codigo === "otro" && (
                            <input autoFocus={!guardado} value={actual.texto ?? ""} maxLength={990} placeholder="¿Qué dijo el cliente?"
                              onChange={(e) => setObs((o) => ({ ...o, [g.guia]: { codigo: "otro", fecha: null, texto: e.target.value } }))}
                              onBlur={(e) => e.target.value.trim() !== guardado && guardarObs(g, "otro", null, e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                              className={`basis-full min-w-[16rem] rounded-lg border bg-black/[0.03] px-2 py-1 text-xs outline-none ${(actual.texto ?? "").trim() ? "border-line text-text" : "border-amber/60"}`} />
                          )}
                          {actual.codigo === "otro" && !(actual.texto ?? "").trim() && <span className="text-[10px] text-amber">Escribe lo que dijo el cliente</span>}
                          {guardando === `${g.guia}|obs` && <span className="text-[10px] text-muted">Guardando…</span>}
                          {esDueno && g.observacion?.usuario && <span className="basis-full text-[10px] text-muted">{quien(g.observacion.usuario)} · {hora(g.observacion.actualizado_en)}</span>}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!lista.length && <p className="text-sm text-muted text-center py-6">Nada con ese filtro.</p>}
      </BarraHorizontal>
      {lista.length > mostrar && (
        <button onClick={() => setMostrar((m) => m + POR_PAGINA)} className="w-full rounded-xl border border-line py-2 text-sm text-muted hover:text-text">
          Ver {entero(Math.min(POR_PAGINA, lista.length - mostrar))} más ({entero(lista.length - mostrar)} restantes)
        </button>
      )}
    </div>
  );
}

function Indicador({ titulo, valor, color, sub, destacado }: { titulo: string; valor: string; color: string; sub?: string; destacado?: boolean }) {
  return (
    <div className={`card p-4 border-t-2 ${destacado ? "border border-green/50" : ""}`}
      style={{ borderTopColor: color, ...(destacado ? { background: "linear-gradient(160deg, rgb(47 210 143 / 0.16), transparent 70%)", boxShadow: "0 0 24px rgb(47 210 143 / 0.18)" } : {}) }}>
      <div className={`text-[11px] uppercase tracking-widest font-mono ${destacado ? "text-green" : "text-muted"}`}>{titulo}</div>
      <div className={`num font-semibold mt-1 ${destacado ? "text-4xl" : "text-3xl"}`} style={{ color, ...(destacado ? { textShadow: `0 0 16px ${color}` } : {}) }}>{valor}</div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
