"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Clock, Pause, Play, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { dinero, entero, haceCuanto } from "@/lib/formato";
import { infoCuenta } from "@/lib/paises";
import { FlujoAgente } from "./flujo-agente";

// Agente de órdenes de venta: Effi Connect vigila cada orden de venta (remisión con su convenio, guía, centro de costos
// Recuperado si el cliente empieza con *). En "Simular" arma, cada X minutos y antes de cada corte de despacho, la
// remisión y la guía de cada orden pendiente y muestra qué crearía. "Automático" y "Ejecutar" quedan bloqueados
// hasta activar la creación en Effi.

type Estado = "completa" | "revision" | "sin_guia" | "sin_remision" | "anulada";
type Modo = "apagado" | "vigilar" | "simular" | "automatico";
type Plan = {
  resumen?: Record<string, string | number | boolean>; remision?: Record<string, unknown>; guia?: Record<string, unknown>;
  remision_existente?: { sucursal: number; id: number }; articulos?: { id: number; nombre: string }[]; resultado?: Record<string, unknown>;
};
export type OrdenAuto = {
  sucursal: number; id: number; fecha: string; cliente: string | null; ciudad: string | null; provincia: string | null;
  total: number | null; ecommerce: string | null; pedido: string | null; convenio: string | null; recuperado: boolean;
  id_remision: number | null; rem_fecha: string | null; rem_centro: string | null; rem_convenio: string | null; rem_responsable: string | null;
  guia: string | null; estado: Estado; motivos: string[]; minutos: number;
  decision: "ejecutar" | "descartar" | null; decision_por: string | null; decision_en: string | null;
  plan: Plan | null; plan_estado: "lista" | "revision" | "creada" | "error" | null; plan_motivo: string | null; plan_en: string | null;
};
export type DatosAuto = {
  config: {
    modo: Modo; minutos_alerta: number; ultima_corrida: string | null; ultimo_error: string | null; actualizado_por: string | null;
    cada_min: number; cortes: string[]; antes_min: number; ultima_conversion: string | null; error_conversion: string | null;
  } | null;
  es_owner: boolean;
  resumen: {
    total: number; completa: number; revision: number; sin_guia: number; sin_remision: number; anulada: number; recuperado: number;
    min_remision: number | null; listas: number; plan_revision: number;
    mes_total?: number; mes_completas?: number; hoy_total?: number; hoy_completas?: number;
    mes_anuladas?: number; mes_remisionadas?: number; mes_rem_anuladas?: number; hoy_remisiones?: number; hoy_guias?: number;
  };
  ordenes: OrdenAuto[];
};

const ESTADOS: Record<Estado, { label: string; color: string }> = {
  completa: { label: "Completa", color: "var(--green)" },
  revision: { label: "Revisar", color: "var(--amber)" },
  sin_guia: { label: "Sin guía", color: "var(--blue-2)" },
  sin_remision: { label: "Sin remisión", color: "var(--red)" },
  anulada: { label: "Anulada", color: "var(--muted)" },
};

const hora = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "America/Guatemala", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
// Próxima corrida del agente en hora local: el siguiente minuto múltiplo de cada_min o `antes_min` antes de un corte.
function proxima(zona: string, cadaMin: number, cortes: string[], antesMin: number) {
  const ahora = new Date();
  for (let i = 1; i <= 24 * 60; i++) {
    const t = new Date(ahora.getTime() + i * 60_000);
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t).split(":").map(Number);
    const mas = (h * 60 + m + antesMin) % 1440;
    const hhmm = `${String(Math.floor(mas / 60)).padStart(2, "0")}:${String(mas % 60).padStart(2, "0")}`;
    if (m % cadaMin === 0 || cortes.includes(hhmm)) return { hora: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, corte: cortes.includes(hhmm) ? hhmm : null, en: i };
  }
  return null;
}
const duracion = (min: number) => (min < 60 ? `${Math.round(min)} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.floor(min / 1440)} d`);

export function Agente({ cuenta, datos }: { cuenta: string; datos: DatosAuto }) {
  const router = useRouter();
  const [confirmarModo, setConfirmarModo] = useState(false);
  const [confirmarOrden, setConfirmarOrden] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const modo = datos.config?.modo ?? "apagado";
  const alerta = datos.config?.minutos_alerta ?? 30;
  const r = datos.resumen;
  const cfg = datos.config;
  const zona = infoCuenta(cuenta).zona;
  const [abierta, setAbierta] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [horario, setHorario] = useState({ cada: cfg?.cada_min ?? 10, cortes: (cfg?.cortes ?? []).join(", "), antes: cfg?.antes_min ?? 2 });
  const sig = cfg && modo !== "apagado" && modo !== "vigilar" ? proxima(zona, cfg.cada_min, cfg.cortes, cfg.antes_min) : null;

  // La vigilancia corre en Supabase; la pantalla se refresca sola cada minuto.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);

  // Una orden sin remisión solo es alerta cuando pasa el tiempo de espera (normalmente se convierte en minutos).
  const atrasada = (o: OrdenAuto) => o.estado === "sin_remision" && o.minutos >= alerta;
  // Novedad en la orden: lo que el agente no pudo resolver y alguien debe revisar a mano (por ejemplo cambiar de
  // proveedor porque se le acabó la mercancía): error al crear, regla que no cumple, sin antecedentes, o una orden
  // que lleva más del tiempo de espera sin remisión o sin guía.
  // Un pendiente (sin cobertura o pedido repetido) se resuelve solo cuando la remisión se anula en Effi o ya tiene
  // guía: sale de aquí sin que nadie lo borre.
  const pendienteResuelto = (o: OrdenAuto) =>
    !!o.plan_motivo?.startsWith("Pendiente:") && (o.estado === "completa" || o.motivos.some((m) => m.startsWith("La remisión está anulada")));
  const novedad = (o: OrdenAuto) => !pendienteResuelto(o) && (
    o.plan_estado === "error" || o.estado === "revision" ||
    (o.estado === "sin_remision" && (o.plan_estado === "revision" || o.minutos >= alerta)) ||
    (o.estado === "sin_guia" && (o.plan_estado === "revision" || o.minutos >= alerta)));

  // Listas para crear: el agente ya sabe qué hacer (remisión y guía, o solo la guía de una remisión hecha a mano). No
  // son novedad aunque lleven rato esperando: salen con "Ejecutar ahora" o con "Ejecutar" en cada una.
  const paraCrear = (o: OrdenAuto) =>
    o.plan_estado === "lista" && (o.estado === "sin_remision" || o.estado === "sin_guia") && o.decision !== "descartar";
  // Una orden que ya tiene remisión y guía está resuelta: el error de un intento anterior (por ejemplo una guía que
  // falló y se hizo después) ya no cuenta como novedad ni se muestra.
  const ordenes = useMemo(() => datos.ordenes.map((o) =>
    o.estado === "completa" && o.plan_estado === "error" ? { ...o, plan_estado: null, plan_motivo: null } : o), [datos.ordenes]);
  const lista = useMemo(() => ordenes.filter((o) => novedad(o) && !paraCrear(o)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordenes]);
  const listas = useMemo(() => ordenes.filter(paraCrear),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordenes]);
  // Dos listas: órdenes que pasan a remisión (y luego a guía) y remisiones ya hechas que solo esperan la guía.
  const listasRemision = listas.filter((o) => o.estado === "sin_remision");
  const listasGuia = listas.filter((o) => o.estado === "sin_guia");

  // El automático está montado para Guatemala y Ecuador; activarlo y pasarlo a manual piden confirmación en pantalla
  // (el navegador de la app bloquea las ventanas de confirmación). "Manual" = simular: arma lo que haría sin crear.
  const automaticoPosible = cuenta === "TIENDA_GT" || cuenta === "TIENDA_EC";
  // En Ecuador la API de Effi falla al crear remisiones (error 1452 dentro de Effi): allá Effi Connect hace solo las guías.
  const creaRemision = cuenta === "TIENDA_GT";
  async function cambiarModo(m: Modo) {
    if (m === modo || (m === "automatico" && !automaticoPosible)) return;
    setGuardando("modo"); setError(null);
    const { error: e } = await createClient().rpc("auto_cambiar_modo", { p_cuenta: cuenta, p_modo: m });
    setGuardando(null);
    if (e) setError(e.message); else router.refresh();
  }
  // "Ejecutar ahora": la misma corrida del horario, disparada en el momento. Mientras corre, la pantalla se refresca
  // cada pocos segundos para ver en la bitácora lo que va creando.
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [confirmarAhora, setConfirmarAhora] = useState(false);
  async function ejecutarAhora() {
    setConfirmarAhora(false);
    setGuardando("ahora"); setError(null);
    const { data, error: e } = await createClient().rpc("auto_ejecutar_ahora", { p_cuenta: cuenta });
    setGuardando(null);
    if (e) return setError(e.message);
    setCorriendo(data === "ocupado" ? "Ya hay una corrida en curso; la bitácora muestra lo que va haciendo." : "Creando en Effi… mira la bitácora del agente.");
    router.refresh();
    let n = 0;
    const t = setInterval(() => {
      router.refresh();
      if (++n >= 15) { clearInterval(t); setCorriendo(null); }
    }, 4000);
  }
  // "Pasar de remisión a guía": solo las guías de las remisiones ya hechas, en tandas de 10 hasta acabarlas. En Ecuador
  // es el paso que sí se puede hacer (las remisiones las hace una persona porque la API de Effi falla al crearlas).
  const [confirmarGuias, setConfirmarGuias] = useState(false);
  async function pasarAGuia() {
    setConfirmarGuias(false);
    setGuardando("guias"); setError(null);
    const { data, error: e } = await createClient().rpc("auto_pasar_a_guia", { p_cuenta: cuenta });
    setGuardando(null);
    if (e) return setError(e.message);
    setCorriendo(data === "ocupado" ? "Ya hay una corrida en curso; la bitácora muestra lo que va haciendo." : "Haciendo las guías de a 10… mira la bitácora del agente.");
    router.refresh();
    let n = 0;
    const t = setInterval(() => {
      router.refresh();
      if (++n >= 45) { clearInterval(t); setCorriendo(null); }
    }, 4000);
  }
  async function guardarHorario() {
    setGuardando("horario"); setError(null);
    const cortes = horario.cortes.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean).map((x) => (x.length === 4 ? `0${x}` : x));
    const { error: e } = await createClient().rpc("auto_guardar_horario", { p_cuenta: cuenta, p_cada_min: Number(horario.cada), p_cortes: cortes, p_antes_min: Number(horario.antes) });
    setGuardando(null);
    if (e) setError(e.message); else { setEditando(false); router.refresh(); }
  }
  // Guatemala y Ecuador tienen montada la creación; la orden debe tener la remisión lista, o la guía de una remisión ya
  // hecha (o un error para reintentar).
  const creaEnEffi = cuenta === "TIENDA_GT" || cuenta === "TIENDA_EC";
  const puedeEjecutar = (o: OrdenAuto) =>
    datos.es_owner && creaEnEffi && (o.plan_estado === "lista" || o.plan_estado === "error") &&
    ((!!o.plan?.remision && creaRemision) || (!!o.plan?.remision_existente && !!o.plan?.guia));
  async function ejecutar(o: OrdenAuto) {
    const clave = `${o.sucursal}-${o.id}`;
    setConfirmarOrden(null);
    setGuardando(clave); setError(null);
    const { error: e } = await createClient().rpc("auto_decidir", { p_cuenta: cuenta, p_sucursal: o.sucursal, p_id: o.id, p_decision: "ejecutar" });
    setGuardando(null);
    if (e) setError(e.message); else router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Modo: Automático (Effi Connect crea sola remisión y guía, solo Guatemala) o Manual (crea cuando el dueño pulsa
          "Ejecutar ahora" o "Ejecutar" en una orden). */}
      {cfg && (
        <div className={`card p-4 flex flex-wrap items-center justify-between gap-3 ${modo === "automatico" ? "border border-green/40" : ""}`}
          style={modo === "automatico" ? { background: "linear-gradient(90deg, rgb(47 210 143 / 0.12), transparent)" } : undefined}>
          <div className="flex items-center gap-3">
            <span className="relative flex size-3">
              {modo === "automatico" && <span className="absolute inline-flex h-full w-full rounded-full bg-green onda" />}
              <span className={`relative inline-flex size-3 rounded-full ${modo === "automatico" ? "bg-green" : "bg-muted"}`} />
            </span>
            <div>
              <div className={`font-semibold ${modo === "automatico" ? "text-green" : ""}`}>Modo: {modo === "automatico" ? "Automático" : "Manual"}</div>
              <div className="text-xs text-muted">
                {modo === "automatico"
                  ? creaRemision
                    ? "Effi Connect crea sola en Effi la remisión y la guía de cada orden, según el horario."
                    : "Effi Connect crea sola en Effi la guía de cada remisión, según el horario (la remisión se hace en Effi)."
                  : creaEnEffi
                    ? "Effi Connect no crea nada sola en Effi: crea cuando pulsas “Ejecutar ahora” o “Ejecutar” en una orden."
                    : "Effi Connect solo revisa: la creación en Effi aún no está montada para este país."}
                {datos.config?.ultima_corrida && <> · última revisión {haceCuanto(datos.config.ultima_corrida)}</>}
              </div>
              {datos.config?.ultimo_error && <div className="text-xs text-red mt-0.5">{datos.config.ultimo_error}</div>}
              {corriendo && <div className="text-xs text-green mt-0.5">{corriendo}</div>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          {/* Ejecutar ahora: crea ya en Effi lo que esté listo, sin esperar el horario. */}
          {datos.es_owner && creaEnEffi && (confirmarAhora ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">¿Crear ya en Effi lo que está listo ({entero(listas.length)})?</span>
              <button onClick={ejecutarAhora} disabled={guardando === "ahora"} className="rounded-full bg-green px-4 py-2 text-sm font-bold text-black">Sí, ejecutar</button>
              <button onClick={() => setConfirmarAhora(false)} className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-muted hover:text-text">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmarAhora(true)} disabled={guardando === "ahora" || !!corriendo}
              className="inline-flex items-center gap-2 rounded-full bg-green px-5 py-2.5 text-sm font-bold text-black shadow-[0_0_24px_-6px_var(--green)] hover:brightness-110 disabled:opacity-60">
              <Play size={16} /> {corriendo ? "Ejecutando…" : "Ejecutar ahora"}
            </button>
          ))}
          {datos.es_owner && creaEnEffi && (confirmarGuias ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">¿Hacer ya en Effi las guías de las remisiones hechas ({entero(listasGuia.length)}), de a 10?</span>
              <button onClick={pasarAGuia} disabled={guardando === "guias"} className="rounded-full bg-blue px-4 py-2 text-sm font-bold text-white">Sí, hacer guías</button>
              <button onClick={() => setConfirmarGuias(false)} className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-muted hover:text-text">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmarGuias(true)} disabled={guardando === "guias" || !!corriendo}
              className="inline-flex items-center gap-2 rounded-full bg-blue px-5 py-2.5 text-sm font-bold text-white shadow-[0_0_24px_-6px_var(--blue)] hover:brightness-110 disabled:opacity-60">
              <Truck size={16} /> Pasar de remisión a guía{listasGuia.length ? ` (${entero(listasGuia.length)})` : ""}
            </button>
          ))}
          {datos.es_owner && automaticoPosible && (confirmarModo ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">{modo === "automatico" ? "¿Pasar a modo manual?" : "¿Activar el modo automático?"}</span>
              <button onClick={() => { setConfirmarModo(false); cambiarModo(modo === "automatico" ? "simular" : "automatico"); }}
                disabled={guardando === "modo"}
                className={`rounded-full px-4 py-2 text-sm font-bold ${modo === "automatico" ? "bg-red text-white" : "bg-green text-black"}`}>
                Sí
              </button>
              <button onClick={() => setConfirmarModo(false)} className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-muted hover:text-text">No</button>
            </div>
          ) : modo === "automatico" ? (
            <button onClick={() => setConfirmarModo(true)} disabled={guardando === "modo"}
              className="inline-flex items-center gap-2 rounded-full bg-red px-5 py-2.5 text-sm font-bold text-white shadow-[0_0_24px_-6px_var(--red)] hover:brightness-110 disabled:opacity-60">
              <Pause size={16} /> Poner modo manual
            </button>
          ) : (
            <button onClick={() => setConfirmarModo(true)} disabled={guardando === "modo"}
              className="inline-flex items-center gap-2 rounded-full border border-green/50 bg-green/15 px-5 py-2.5 text-sm font-bold text-green hover:bg-green/25 disabled:opacity-60">
              <Play size={16} /> Activar automático
            </button>
          ))}
          </div>
        </div>
      )}

      {cfg && (
        <div className="card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Clock size={18} className="text-blue-2 mt-0.5" />
              <div>
                <div className="font-semibold text-sm">Horario del agente</div>
                <div className="text-xs text-muted mt-0.5">
                  Cada {cfg.cada_min} minutos y {cfg.antes_min} minutos antes de cada corte de despacho:{" "}
                  <span className="text-text font-mono">{cfg.cortes.join(" · ")}</span> (hora local)
                </div>
                <div className="text-xs mt-1">
                  {modo === "simular" || modo === "automatico" ? (
                    <>
                      {sig ? <span className="text-blue-2">Próxima corrida a las {sig.hora}{sig.corte ? ` (antes del corte de las ${sig.corte})` : ""} · en {sig.en} min</span> : null}
                      <span className="text-muted"> · última {cfg.ultima_conversion ? haceCuanto(cfg.ultima_conversion) : "aún no ha corrido"}</span>
                    </>
                  ) : (
                    <span className="text-muted">El agente no está corriendo.</span>
                  )}
                </div>
                {cfg.error_conversion && <div className="text-xs text-red mt-1">{cfg.error_conversion}</div>}
              </div>
            </div>
            {datos.es_owner && !editando && (
              <button onClick={() => setEditando(true)} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted hover:text-text">Cambiar horario</button>
            )}
          </div>
          {editando && (
            <div className="mt-3 flex flex-wrap items-end gap-3 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-muted">Cada (minutos)</span>
                <input type="number" min={2} max={60} value={horario.cada} onChange={(e) => setHorario({ ...horario, cada: Number(e.target.value) })}
                  className="w-24 rounded-lg bg-panel-2 border border-line px-2 py-1.5 num" />
              </label>
              <label className="flex flex-col gap-1 flex-1 min-w-[14rem]">
                <span className="text-muted">Cortes de despacho (HH:MM, separados por coma)</span>
                <input value={horario.cortes} onChange={(e) => setHorario({ ...horario, cortes: e.target.value })}
                  className="rounded-lg bg-panel-2 border border-line px-2 py-1.5 font-mono" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted">Minutos antes del corte</span>
                <input type="number" min={0} max={30} value={horario.antes} onChange={(e) => setHorario({ ...horario, antes: Number(e.target.value) })}
                  className="w-24 rounded-lg bg-panel-2 border border-line px-2 py-1.5 num" />
              </label>
              <button onClick={guardarHorario} disabled={guardando === "horario"} className="btn-primary rounded-full px-4 py-1.5 font-semibold text-white">Guardar</button>
              <button onClick={() => setEditando(false)} className="rounded-full border border-line px-3 py-1.5 font-semibold text-muted hover:text-text">Cancelar</button>
            </div>
          )}
        </div>
      )}

      <FlujoAgente cuenta={cuenta} resumen={r} proxima={sig} onNuevo={() => router.refresh()}
        completas={ordenes.filter((o) => o.estado === "completa" || pendienteResuelto(o)).map((o) => o.id)} />

      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
        {/* Mes como el listado de Effi; hoy: órdenes, cuántas ya tienen remisión y cuántas ya tienen guía. */}
        <Indicador titulo="Órdenes del mes" valor={entero(r.mes_total ?? 0)} color="var(--blue-2)"
          sub={r.mes_anuladas ? `${entero(r.mes_anuladas)} anuladas sin remisión` : undefined} />
        <Indicador titulo="Remisionadas del mes" valor={entero(r.mes_remisionadas ?? 0)} color="var(--green)"
          sub={r.mes_rem_anuladas ? `${entero(r.mes_rem_anuladas)} remisiones anuladas` : undefined} />
        <Indicador titulo="Órdenes de hoy" valor={entero(r.hoy_total ?? 0)} color="var(--blue-2)" />
        <Indicador titulo="Remisiones hoy" valor={entero(r.hoy_remisiones ?? 0)} color="var(--green)"
          sub={(r.hoy_total ?? 0) > (r.hoy_remisiones ?? 0) ? `${entero((r.hoy_total ?? 0) - (r.hoy_remisiones ?? 0))} sin remisionar` : undefined} />
        <Indicador titulo="Guías hoy" valor={entero(r.hoy_guias ?? 0)} color="var(--green)"
          sub={(r.hoy_remisiones ?? 0) > (r.hoy_guias ?? 0) ? `${entero((r.hoy_remisiones ?? 0) - (r.hoy_guias ?? 0))} sin guía` : undefined} />
        <Indicador titulo="Requieren revisión" valor={entero(lista.length)} color="var(--amber)" />
        <Indicador titulo="Listas para crear" valor={entero(listas.length)} color="var(--green)"
          sub={`${entero(listasRemision.length)} a remisión · ${entero(listasGuia.length)} a guía`} />
      </div>

      {error && <p className="text-sm text-red">{error}</p>}

      {[
        { titulo: "Listas: orden → remisión", filas: listasRemision, vacio: "Ninguna orden esperando remisión.",
          texto: creaRemision
            ? "Órdenes que el agente pasa a remisión y luego a guía, con “Ejecutar ahora” o “Ejecutar” en cada una."
            : "Por ahora la remisión se hace en Effi (la API de Effi falla al crearla); apenas exista, el agente hace la guía." },
        { titulo: "Listas: remisión → guía", filas: listasGuia, vacio: "Ninguna remisión esperando guía.",
          texto: "Remisiones ya hechas que solo esperan la guía, con la transportadora que toca." },
        { titulo: "Novedad en la orden", filas: lista, vacio: "Sin novedades: todas las órdenes van bien.",
          texto: "Lo que el agente no pudo resolver solo. Se corrige a mano en Effi (por ejemplo, cambiar de proveedor) y sale de aquí al quedar con remisión y guía." },
      ].map((s) => (
      <Fragment key={s.titulo}>
      <div className="flex flex-wrap items-baseline gap-2 pt-2">
        <span className="font-display text-lg font-semibold">{s.titulo}</span>
        <span className="text-xs text-muted">{s.texto}</span>
        <span className="text-xs text-muted ml-auto">{entero(s.filas.length)} {s.filas.length === 1 ? "orden" : "órdenes"}</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="bg-blue/10 text-left text-[11px] uppercase tracking-wider font-semibold whitespace-nowrap">
              <th className="px-3 py-3">Orden</th>
              <th className="px-3 py-3">Cliente</th>
              <th className="px-3 py-3">Ciudad</th>
              <th className="px-3 py-3 text-right">Total</th>
              <th className="px-3 py-3">Convenio</th>
              <th className="px-3 py-3">Remisión</th>
              <th className="px-3 py-3">Guía</th>
              <th className="px-3 py-3">Estado</th>
              <th className="px-3 py-3">Lo que haría el agente</th>
              <th className="px-3 py-3">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {s.filas.map((o) => {
              const est = ESTADOS[o.estado];
              const clave = `${o.sucursal}-${o.id}`;
              const abierto = abierta === clave;
              return (
                <Fragment key={clave}>
                <tr className="align-middle hover:bg-black/[0.02]">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="font-mono font-semibold">OV {o.id}</div>
                    <div className="text-[11px] text-muted">{hora(o.fecha)}{o.pedido ? ` · ${o.ecommerce ?? ""} #${o.pedido}` : ""}</div>
                  </td>
                  <td className="px-3 py-2 min-w-[11rem]">
                    <div className="font-semibold">{o.cliente ?? "—"}</div>
                    <span
                      className="mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={o.recuperado ? { background: "rgba(180,140,255,.15)", color: "#b48cff" } : { background: "rgba(17,17,17,.05)", color: "var(--muted)" }}
                    >
                      {o.recuperado ? "Recuperado" : "Principal"}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {o.ciudad ?? "—"}
                    <div className="text-muted">{o.provincia}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right num">{dinero(o.total, cuenta)}</td>
                  {/* Todo es dropshipping: importa que tenga convenio, no cuál. */}
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {o.convenio ? <span className="text-green">✓ Con convenio</span> : <span className="font-semibold text-red">Sin convenio</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {o.id_remision ? (
                      <>
                        <div className="font-mono font-semibold text-sm">RV {o.id_remision}</div>
                        <div className="text-muted">
                          {o.rem_centro ?? "—"}
                          {o.rem_fecha ? ` · ${duracion((Date.parse(o.rem_fecha) - Date.parse(o.fecha)) / 60_000)}` : ""}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{o.guia ?? "—"}</td>
                  <td className="px-3 py-2 min-w-[12rem]">
                    <span className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: est.color, background: "rgba(17,17,17,.05)" }}>
                      {o.estado === "sin_remision" && !atrasada(o) ? "Esperando remisión" : est.label}
                    </span>
                    {o.estado === "sin_remision" && <div className="text-[11px] text-muted mt-0.5">hace {duracion(o.minutos)}</div>}
                    {o.motivos.map((m) => (
                      <div key={m} className="text-[11px] text-amber mt-0.5">{m}</div>
                    ))}
                    {o.plan_estado === "error" && o.plan_motivo && (
                      <div className="mt-1 min-w-[26rem] max-w-[44rem] rounded-lg border border-red/40 bg-red/10 px-2 py-1 text-[11px] text-red whitespace-normal">
                        ⚠ {o.plan_motivo}
                        {o.plan?.resultado && (
                          <button onClick={() => setAbierta(abierto ? null : clave)} className="ml-1 underline">ver variables</button>
                        )}
                      </div>
                    )}
                    {o.plan_estado === "creada" && (
                      <div className="mt-1 text-[11px] text-green">✓ Creada por Effi Connect</div>
                    )}
                  </td>
                  <td className="px-3 py-2 min-w-[15rem]">
                    <Simulacion o={o} cuenta={cuenta} abierto={abierto} onAlternar={() => setAbierta(abierto ? null : clave)} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.estado === "completa" || o.estado === "anulada" ? (
                      <span className="text-xs text-muted">—</span>
                    ) : datos.es_owner ? (
                      <div className="flex items-center gap-2">
                        {puedeEjecutar(o) && confirmarOrden === clave ? (
                          <>
                            <button onClick={() => ejecutar(o)} disabled={guardando === clave}
                              className="rounded-full bg-green px-3 py-1 text-xs font-bold text-black">Sí, crear</button>
                            <button onClick={() => setConfirmarOrden(null)} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted hover:text-text">No</button>
                          </>
                        ) : puedeEjecutar(o) ? (
                          <button
                            onClick={() => setConfirmarOrden(clave)}
                            disabled={guardando === clave || o.decision === "ejecutar"}
                            title={o.plan_estado === "error" ? "Vuelve a intentar con Effi (si la remisión ya se creó, solo reintenta la guía)" : "Crea en Effi la remisión y la guía que muestra la simulación"}
                            className="inline-flex items-center gap-1 rounded-full border border-green/50 bg-green/10 px-3 py-1 text-xs font-semibold text-green hover:bg-green/20 disabled:opacity-60"
                          >
                            <Play size={12} /> {o.decision === "ejecutar" ? "Creando…" : o.plan_estado === "error" ? "Reintentar" : "Ejecutar"}
                          </button>
                        ) : (
                          <button
                            disabled
                            title={creaEnEffi ? "Necesita una simulación lista para crear" : "La creación en Effi aún no está montada para este país"}
                            className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted opacity-60 cursor-not-allowed"
                          >
                            <Play size={12} /> Ejecutar
                          </button>
                        )}
                      </div>
                    ) : null}
                  </td>
                </tr>
                {abierto && o.plan && (
                  <tr>
                    <td colSpan={10} className="px-3 pb-4 bg-black/[0.015]">
                      {o.plan.resultado && (
                        <div className="grid lg:grid-cols-2 gap-3 pt-2">
                          <Envio titulo={`Lo que se envió a Effi (${String(o.plan.resultado.paso ?? "")})`} datos={(o.plan.resultado.enviado as Record<string, unknown>) ?? undefined} />
                          <Envio titulo="Lo que respondió Effi" datos={(o.plan.resultado.respuesta as Record<string, unknown>) ?? (o.plan.resultado as Record<string, unknown>)} />
                        </div>
                      )}
                      <div className="grid lg:grid-cols-2 gap-3 pt-2">
                        <Envio titulo="Remisión de venta que se crearía (POST api/remision_v)" datos={o.plan.remision} />
                        <Envio titulo="Guía que se crearía después (POST api/guia_transporte)" datos={o.plan.guia} />
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {!s.filas.length && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-sm text-muted">
                  {s.vacio}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </Fragment>
      ))}
    </div>
  );
}

function Indicador({ titulo, valor, color, sub }: { titulo: string; valor: string; color: string; sub?: string }) {
  return (
    <div className="card p-4 border-t-2" style={{ borderTopColor: color }}>
      <div className="text-[11px] uppercase tracking-widest font-mono text-muted">{titulo}</div>
      <div className="num text-3xl font-semibold mt-1" style={{ color }}>{valor}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

// Lo que armó la simulación para una orden pendiente: listo para crear (producto, cantidad, centro, remitente) o el
// motivo por el que necesita revisión.
function Simulacion({ o, cuenta, abierto, onAlternar }: { o: OrdenAuto; cuenta: string; abierto: boolean; onAlternar: () => void }) {
  if (o.plan_estado === "creada") {
    const res = (o.plan?.resultado ?? {}) as { remision?: { id_transaccion?: string; id?: number }; guia?: { guia?: string } };
    return (
      <div className="text-xs">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-green bg-black/5">✓ Creada por Effi Connect</span>
        <div className="text-muted mt-1">RV {res.remision?.id_transaccion ?? res.remision?.id ?? "—"} · guía {res.guia?.guia ?? "—"}</div>
      </div>
    );
  }
  if (o.estado !== "sin_remision" && o.estado !== "sin_guia" && o.plan_estado !== "error") return <span className="text-xs text-muted">—</span>;
  if (!o.plan_estado) return <span className="text-xs text-muted">Aún no simulada</span>;
  if (o.decision === "ejecutar") return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-blue-2 bg-black/5">Creando en Effi…</span>;
  if (o.plan_estado === "error") {
    return (
      <div className="text-xs">
        <button onClick={onAlternar} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-red bg-black/5 hover:bg-black/10">
          {abierto ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Falló al crear
        </button>
        <div className="text-muted mt-1">Mira el error en Estado y las variables al desplegar</div>
      </div>
    );
  }
  if (o.plan_estado === "revision") {
    return (
      <div className="text-xs">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-amber bg-black/5">Pendiente de revisión</span>
        <div className="text-amber mt-1 min-w-[26rem] max-w-[44rem] whitespace-normal">{o.plan_motivo}</div>
      </div>
    );
  }
  const r = o.plan?.resumen ?? {};
  // Transportadora escogida y por qué (Ecuador: oficina → Servientrega, sin cobertura de Gintracom, domicilio).
  const transporte = r.transportadora ? (
    <div className="text-blue-2 whitespace-normal">
      🚚 {String(r.transportadora).split("|")[0].trim()}{r.motivo_transportadora ? ` · ${String(r.motivo_transportadora)}` : ""}
    </div>
  ) : null;
  if (r.solo_guia) {
    return (
      <div className="text-xs">
        <button onClick={onAlternar} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-green bg-black/5 hover:bg-black/10">
          {abierto ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Guía lista para crear
        </button>
        <div className="mt-1 text-muted">Remisión {String(r.remision)} · remitente {String(r.remitente)}{r.recuperado ? " · Recuperado" : ""}</div>
        {transporte}
        {o.plan_en && <div className="text-[10px] text-muted">simulada {haceCuanto(o.plan_en)}</div>}
      </div>
    );
  }
  return (
    <div className="text-xs">
      <button onClick={onAlternar} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-green bg-black/5 hover:bg-black/10">
        {abierto ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Lista para crear
      </button>
      <div className="mt-1 whitespace-normal">
        <span className="font-semibold">{String(r.cantidad)} × {String(r.producto)}</span> a {precio2(Number(r.precio), cuenta)} c/u
      </div>
      <div className="text-muted">
        Centro {r.recuperado ? "Recuperado" : "Principal"} · remitente {String(r.remitente)} · {Number(r.antecedentes).toLocaleString("es-CO")} antecedentes
      </div>
      {transporte}
      {o.plan_en && <div className="text-[10px] text-muted">simulada {haceCuanto(o.plan_en)}</div>}
    </div>
  );
}

// Precio unitario con centavos (Q109,67): con el redondeo de la moneda se vería Q110.
const precio2 = (v: number, cuenta: string) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: infoCuenta(cuenta).divisa, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

function Envio({ titulo, datos }: { titulo: string; datos?: Record<string, unknown> }) {
  return (
    <div className="rounded-xl border border-line p-3 min-w-0">
      <div className="text-[11px] uppercase tracking-wider font-mono text-muted mb-2">{titulo}</div>
      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-all font-mono text-text/90">{datos ? JSON.stringify(datos, null, 2) : "—"}</pre>
    </div>
  );
}

