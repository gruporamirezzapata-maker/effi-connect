"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Maximize2, Minimize2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { dinero, entero } from "@/lib/formato";
import { infoCuenta } from "@/lib/paises";
import { hoyBogota, rangosRapidos, sumarDias } from "@/lib/filtros";
import { COLOR_ESTADO } from "./charts";
import { RedNeuronal, type RedNeuronalApi } from "./red-neuronal";
import { MapaNeuronal, type MapaApi } from "./mapa-neuronal";
import { SelectorFechas, etiquetaRango } from "./selector-fechas";

// ⚡ En vivo: la operación como un "segundo cerebro" con el proceso completo de la empresa. Alrededor de cada país:
// orden de venta → remisión → guía generada → estados de la guía (en tránsito, en oficina, novedad, entregada,
// devolución). Cada cambio de estado que llega de Effi viaja como un impulso desde "guía generada" hasta su estado, y
// las órdenes, remisiones y guías nuevas recorren su tramo de la cadena. Effi se sincroniza cada minuto. Al abrir (o al
// cambiar el filtro) hay una "puesta al día": los números suben de cero a lo que ya pasó en un solo estallido. Desde
// ahí solo estalla lo nuevo, y cada número sube justo cuando su cambio llega a su hexágono (mientras espera su turno no
// se cuenta). Al centro, el logo de la sociedad.

type Cat = "ENTREGADO" | "EN_TRANSITO" | "NOVEDAD" | "EN_OFICINA" | "DEVOLUCION";
type Etapa = "ORDEN" | "REMISION" | "GENERADA";
type Evento = {
  cuenta: string; guia: string | null; fecha_hist_est: string; estado_new_efficommerce: string | null; estado_new: string | null;
  nombre_transportadora_efficommerce: string | null; nombre_ciudad_destinatario: string | null; nombre_provincia_destinatario: string | null;
  valor_recaudo: number | null;
  est_guia_new_efficommerce: number | null; pagada: boolean | null;
};
type Pulso = {
  ahora: string; minutos: number; hoy?: boolean; rango?: boolean;
  cuentas: {
    cuenta: string; agente?: boolean; hoy: Record<string, number>; ventana: Record<string, number>;
    proceso_hoy?: Record<string, number>; proceso_ventana?: Record<string, number>;
    serie: number[]; recaudo_hoy: number; pagos_hoy: number; ultimo: string | null;
  }[];
};

const diaLocal = (cuenta: string, ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: infoCuenta(cuenta).zona }).format(new Date(ms));

const ESTADOS: { id: Cat; label: string }[] = [
  { id: "EN_TRANSITO", label: "En tránsito" },
  { id: "EN_OFICINA", label: "En oficina" },
  { id: "NOVEDAD", label: "Novedad" },
  { id: "ENTREGADO", label: "Entregada" },
  { id: "DEVOLUCION", label: "Devolución" },
];
// El proceso en orden: cada etapa cuelga de la anterior (las órdenes del país; los estados de la guía generada).
const ETAPAS: { id: Etapa; label: string; color: string }[] = [
  { id: "ORDEN", label: "Órdenes", color: "#ff6ad5" }, // rosado: distinto del naranja de las novedades
  { id: "REMISION", label: "Remisiones", color: "#b48cff" },
  { id: "GENERADA", label: "Guías generadas", color: "#c9d3ea" },
];
const NODOS = [
  ...ETAPAS.map((e, i) => ({ id: e.id as string, label: e.label, color: e.color, padre: i ? ETAPAS[i - 1].id : undefined })),
  ...ESTADOS.map((e) => ({ id: e.id as string, label: e.label, color: COLOR_ESTADO[e.id], padre: "GENERADA" })),
];
const esEtapa = (id: string): id is Etapa => ETAPAS.some((e) => e.id === id);
// Afuera, los últimos minutos; en el calendario, días completos (hoy, ayer o los que se elijan), cada uno contado
// desde la medianoche de cada país.
const VENTANAS = [{ min: 1, label: "1 min" }, { min: 10, label: "10 min" }, { min: 60, label: "1 h" }];
type Dias = { d: string; h: string };
const atajos = () => rangosRapidos().filter((r) => ["hoy", "ayer", "7d", "mes"].includes(r.id));
const CAT: Record<number, Cat> = { 4: "ENTREGADO", 5: "DEVOLUCION", 2: "EN_TRANSITO", 8: "EN_TRANSITO", 3: "NOVEDAD", 9: "EN_OFICINA" };
const ANCHO = 1000, ALTO = 760, CX = 500, CY = 380;
const GUARDADO = "effi-connect.envivo";
const claveEv = (e: Evento) => `${e.cuenta}|${e.guia}|${e.fecha_hist_est}|${e.est_guia_new_efficommerce}`;
// A qué número suma un cambio de estado (los que no son de ninguna tarjeta cuentan solo en el total del país).
const claveNum = (e: Evento) => `${e.cuenta}|${CAT[e.est_guia_new_efficommerce ?? -1] ?? "OTRO"}`;
const LLEGADA_MS = 1150; // lo que tarda una señal en llegar a su hexágono
const SUBIDA_MS = 2400; // la puesta al día
const AZUL = "rgb(120 160 255)";
// Coordenadas redondeadas: el servidor y el navegador calculan los decimales distinto.
const q = (n: number) => Math.round(n * 100) / 100;

// Cada país tiene su lugar fijo alrededor del centro: Colombia arriba, Guatemala a la derecha, Costa Rica abajo
// y Ecuador a la izquierda (no cambia al filtrar países). Con más de cuatro cuentas (otras sociedades) se reparten en
// círculo en el orden de las banderas.
const ANGULO: Record<string, number> = { TIENDA_CO: -Math.PI / 2, TIENDA_GT: 0, TIENDA_CR: Math.PI / 2, TIENDA_EC: Math.PI };

// Con una tienda: el proceso de izquierda a derecha, como una línea (país → órdenes → remisiones → guías generadas →
// estados en abanico). Con varias: el logo al centro, los países en cruz y su proceso en arco alrededor de cada uno.
function geometria(cuentas: string[]) {
  const sola = cuentas.length === 1;
  const paises = cuentas.map((c, i) => {
    const a = cuentas.length <= 4 && ANGULO[c] != null ? ANGULO[c] : -Math.PI / 2 + (2 * Math.PI * i) / cuentas.length;
    if (sola) {
      const linea = [250, 405, 560];
      const estados = NODOS.map((n, j) => j < ETAPAS.length
        ? { ...n, x: linea[j], y: CY }
        : { ...n, x: 830, y: q(CY + (j - ETAPAS.length - 2) * 140) });
      return { cuenta: c, x: 95, y: CY, estados };
    }
    const x = q(CX + Math.cos(a) * 300), y = q(CY + Math.sin(a) * 225);
    const estados = NODOS.map((n, j) => {
      const b = a + ((j - (NODOS.length - 1) / 2) * Math.PI) / 7.6;
      return { ...n, x: q(x + Math.cos(b) * 132), y: q(y + Math.sin(b) * 112) };
    });
    return { cuenta: c, x, y, estados };
  });
  return { sola, paises };
}

// cuentas: las tiendas activas que el usuario puede ver, en el orden de las banderas (de todas las sociedades).
// logo: el de la sociedad que se está mirando (null si no tiene o si se miran varias).
export function EnVivo({ cuentas: TIENDAS, logo }: { cuentas: string[]; logo: string | null }) {
  const [sel, setSel] = useState<string[]>(TIENDAS);
  const [ventana, setVentana] = useState(60);
  const [dias, setDias] = useState<Dias | null>(null); // con calendario manda el rango de días
  const [pulso, setPulso] = useState<Pulso | null>(null);
  const [stream, setStream] = useState<Evento[]>([]);
  const [cola, setCola] = useState(0);
  const [copiada, setCopiada] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const colaRef = useRef<Evento[]>([]);
  const procesoAntes = useRef<Record<string, number>>({});
  const vistos = useRef(new Set<string>());
  // Cambios ya contados en la base que todavía no han estallado en pantalla (por "cuenta|estado"): se restan del número
  // hasta que llegan a su hexágono.
  const pendientes = useRef<Record<string, number>>({});
  const generacion = useRef(0);
  const [, setVer] = useState(0);
  const [subida, setSubida] = useState(0); // 0 → 1 en la puesta al día
  const subidaRaf = useRef(0);
  const red = useRef<RedNeuronalApi>(null);
  // Mapa de un país: se entra pulsando su bandera. "entrando" guarda desde dónde se hace el acercamiento.
  const [mapa, setMapa] = useState<string | null>(null);
  const [entrando, setEntrando] = useState<{ cuenta: string; x: number; y: number } | null>(null);
  const [mapaDatos, setMapaDatos] = useState<Record<string, Record<string, number>>>({});
  const mapaRef = useRef<MapaApi>(null);
  // Pantalla completa: solo el metaverso (la red o el mapa de un país), sin la lista de cambios. Se sale con el mismo
  // botón o con Escape. Si el navegador no deja usar la pantalla completa, el metaverso igual llena toda la ventana.
  const escenario = useRef<HTMLDivElement>(null);
  const [completa, setCompleta] = useState<"no" | "pantalla" | "ventana">("no");
  useEffect(() => {
    const cambio = () => setCompleta((c) => document.fullscreenElement === escenario.current && escenario.current ? "pantalla" : c === "pantalla" ? "no" : c);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setCompleta((c) => (c === "ventana" ? "no" : c));
    document.addEventListener("fullscreenchange", cambio);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("fullscreenchange", cambio); window.removeEventListener("keydown", esc); };
  }, []);
  const pantallaCompleta = () => {
    if (completa === "pantalla") document.exitFullscreen().catch(() => setCompleta("no"));
    else if (completa === "ventana") setCompleta("no");
    else if (escenario.current?.requestFullscreen) {
      // Algunos navegadores ni aceptan ni rechazan: si en medio segundo no entró, se llena la ventana.
      const t = setTimeout(() => { if (!document.fullscreenElement) setCompleta("ventana"); }, 500);
      escenario.current.requestFullscreen().then(() => clearTimeout(t)).catch(() => { clearTimeout(t); setCompleta("ventana"); });
    } else setCompleta("ventana");
  };
  const grande = completa !== "no";
  const mapaCuenta = useRef<string | null>(null);
  mapaCuenta.current = mapa;

  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(GUARDADO) ?? "null");
      if (Array.isArray(g?.sel) && g.sel.length && g.sel.every((c: string) => TIENDAS.includes(c))) setSel(g.sel);
      if (VENTANAS.some((v) => v.min === g?.ventana)) setVentana(g.ventana);
      // "Hoy" y "Ayer" se guardan como atajo (al día siguiente siguen siendo hoy y ayer); otro rango, tal cual.
      const a = atajos().find((r) => r.id === g?.atajo);
      if (a) setDias({ d: a.d, h: a.h });
      else if (/^\d{4}-\d{2}-\d{2}$/.test(g?.dias?.d ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(g?.dias?.h ?? "")) setDias(g.dias);
    } catch { /* sin almacenamiento: valores por defecto */ }
  }, []);
  const guardar = (s: string[], v: number, r: Dias | null) => {
    const atajo = r ? atajos().find((x) => x.d === r.d && x.h === r.h)?.id ?? null : null;
    try { localStorage.setItem(GUARDADO, JSON.stringify({ sel: s, ventana: v, dias: r, atajo })); } catch { /* ignorar */ }
  };
  const elegir = (cs: string[]) => { setSel(cs); guardar(cs, ventana, dias); };
  const elegirVentana = (v: number) => { setVentana(v); setDias(null); guardar(sel, v, null); };
  const elegirDias = (d: string, h: string) => { setDias({ d, h }); guardar(sel, ventana, { d, h }); };

  const hoy = hoyBogota();
  // En vivo de verdad solo si el periodo llega hasta ahora (minutos, hoy, este mes); un día pasado es una foto quieta.
  const enVivo = !dias || dias.h >= hoy;

  const geo = useMemo(() => geometria(sel), [sel]);
  const clave = `${sel.join(",")}|${dias ? `${dias.d}~${dias.h}` : ventana}`;

  const pendiente = (k: string, n: number) => {
    pendientes.current[k] = Math.max(0, (pendientes.current[k] ?? 0) + n);
    setVer((v) => v + 1);
  };
  const megaReaccion = () => {
    cancelAnimationFrame(subidaRaf.current);
    const t0 = performance.now();
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / SUBIDA_MS);
      setSubida(1 - Math.pow(1 - k, 3));
      if (k < 1) subidaRaf.current = requestAnimationFrame(paso);
    };
    subidaRaf.current = requestAnimationFrame(paso);
    setTimeout(() => red.current?.alDia(), 60);
  };
  useEffect(() => () => cancelAnimationFrame(subidaRaf.current), []);

  // Al instante (Realtime) y de respaldo cada 12 s, una sola lectura trae el resumen y los cambios nuevos
  // (envivo_vivo): todo cambio nuevo ya está en el número, así que se resta mientras espera su turno y se suma cuando estalla.
  useEffect(() => {
    const supabase = createClient();
    const gen = ++generacion.current;
    let vivo = true, marca: string | null = null;
    vistos.current = new Set();
    procesoAntes.current = {};
    pendientes.current = {};
    colaRef.current = [];
    setStream([]);
    setPulso(null);
    setCola(0);
    setSubida(0);
    // Un periodo que ya terminó es una foto quieta: se lee una vez.
    const quieto = !!dias && dias.h < hoyBogota();
    const cargar = async () => {
      const { data, error: e } = await supabase.rpc("envivo_vivo", {
        p_cuentas: sel, p_minutos: dias ? 0 : ventana, p_desde: dias?.d ?? null, p_hasta: dias?.h ?? null, p_marca: marca,
      });
      if (!vivo) return;
      if (e || !data) { setError("Sin señal de la base de datos; se reintenta solo."); return; }
      setError(null);
      const r = data as { pulso: Pulso; marca: string; eventos: Evento[] };
      const primera = marca == null;
      marca = r.marca;
      const nuevos = r.eventos.filter((x) => !vistos.current.has(claveEv(x)));
      nuevos.forEach((x) => vistos.current.add(claveEv(x)));
      if (primera) {
        // Puesta al día: lo que ya pasó entra de una vez (lista completa, números de cero a su valor) y no se repite.
        for (const c of r.pulso.cuentas) for (const et of ETAPAS) procesoAntes.current[`${c.cuenta}|${et.id}`] = c.proceso_ventana?.[et.id] ?? 0;
        setStream(nuevos.slice(0, 200));
        setPulso(r.pulso);
        megaReaccion();
        return;
      }
      // Órdenes, remisiones y guías nuevas desde la lectura anterior: cada una recorre su tramo en los próximos segundos
      // y su número sube cuando llega.
      for (const c of r.pulso.cuentas) for (const et of ETAPAS) {
        const k = `${c.cuenta}|${et.id}`, n = c.proceso_ventana?.[et.id] ?? 0, antes = procesoAntes.current[k] ?? n;
        procesoAntes.current[k] = n;
        if (n <= antes) continue;
        pendientes.current[k] = (pendientes.current[k] ?? 0) + (n - antes);
        for (let i = 0; i < n - antes; i++) {
          setTimeout(() => {
            if (gen !== generacion.current) return;
            if (i < 12) red.current?.disparar(c.cuenta, et.id);
            setTimeout(() => gen === generacion.current && pendiente(k, -1), i < 12 ? LLEGADA_MS : 0);
          }, Math.random() * Math.min(10_000, 700 * (n - antes))); // una sola sale ya; muchas se reparten hasta 10 s
        }
      }
      // Cambios de estado nuevos: a la cola, del más viejo al más nuevo.
      for (const x of [...nuevos].reverse()) {
        colaRef.current.push(x);
        pendientes.current[claveNum(x)] = (pendientes.current[claveNum(x)] ?? 0) + 1;
      }
      setCola(colaRef.current.length);
      setPulso(r.pulso);
    };
    cargar();
    const t = quieto ? undefined : setInterval(cargar, 12_000);
    // Tiempo real: cuando entra algo de una cuenta visible (estados, guías u órdenes), la base marca envivo_senales y se
    // relee al instante. La consulta cada 12 s queda de respaldo por si se corta la conexión.
    let senal: ReturnType<typeof setTimeout> | undefined;
    const canal = quieto ? null : supabase
      .channel(`envivo-${gen}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "envivo_senales" }, () => {
        clearTimeout(senal);
        senal = setTimeout(cargar, 300);
      })
      .subscribe();
    return () => { vivo = false; clearInterval(t); clearTimeout(senal); if (canal) supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  // Mapa: movimientos por departamento cada 15 s; las órdenes, remisiones y guías nuevas se encienden en su departamento.
  useEffect(() => {
    if (!mapa) return;
    const supabase = createClient();
    let vivo = true;
    const antes: Record<string, number> = {};
    let primera = true;
    const cargar = async () => {
      const { data } = await supabase.rpc("envivo_mapa", dias
        ? { p_cuenta: mapa, p_minutos: 0, p_desde: dias.d, p_hasta: dias.h }
        : { p_cuenta: mapa, p_minutos: ventana });
      if (!vivo || !data) return;
      const provs = ((data as { provincias: Record<string, Record<string, number>> }).provincias) ?? {};
      for (const [prov, cats] of Object.entries(provs)) for (const et of ["ORDEN", "REMISION", "GENERADA"]) {
        const k = `${prov}|${et}`, n = cats[et] ?? 0, a = antes[k];
        antes[k] = n;
        if (primera || a == null || n <= a || !enVivo) continue;
        for (let i = 0; i < Math.min(8, n - a); i++) setTimeout(() => mapaRef.current?.disparar(prov, et), Math.random() * 12_000);
      }
      primera = false;
      setMapaDatos(provs);
    };
    cargar();
    const t = setInterval(cargar, 15_000);
    return () => { vivo = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa, clave]);
  const entrarMapa = (cuenta: string, x: number, y: number) => {
    setEntrando({ cuenta, x, y });
    setTimeout(() => { setMapaDatos({}); setMapa(cuenta); setEntrando(null); }, 520);
  };

  // Cada cambio nuevo dispara una señal en la red, entra a la lista y suma a su número cuando llega.
  const disparar = useCallback((e: Evento) => {
    const cat = CAT[e.est_guia_new_efficommerce ?? -1] ?? null, gen = generacion.current;
    red.current?.disparar(e.cuenta, cat);
    if (cat && e.cuenta === mapaCuenta.current) mapaRef.current?.disparar(e.nombre_provincia_destinatario, cat);
    setStream((s) => [e, ...s].slice(0, 200));
    setTimeout(() => {
      if (gen !== generacion.current) return;
      pendientes.current[claveNum(e)] = Math.max(0, (pendientes.current[claveNum(e)] ?? 0) - 1);
      setVer((v) => v + 1);
    }, LLEGADA_MS);
  }, []);

  // Reproductor: saca un cambio de la cola a un ritmo que reparte el lote antes de la siguiente lectura (12 s).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const paso = () => {
      const e = colaRef.current.shift();
      if (e) disparar(e);
      setCola(colaRef.current.length);
      const n = colaRef.current.length;
      t = setTimeout(paso, n ? Math.min(2500, Math.max(220, 10_000 / n)) : 600);
    };
    t = setTimeout(paso, 600);
    return () => clearTimeout(t);
  }, [disparar]);

  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);

  const copiar = async (guia: string) => {
    try { await navigator.clipboard.writeText(guia); setCopiada(guia); setTimeout(() => setCopiada(null), 1500); } catch { /* sin permiso de portapapeles */ }
  };

  const datos = (c: string) => pulso?.cuentas.find((x) => x.cuenta === c);
  // Lo que se ve: lo de la base menos lo que aún no ha estallado, escalado por la puesta al día.
  const visible = (c: string, id: string, n: number) => Math.round(Math.max(0, n - (pendientes.current[`${c}|${id}`] ?? 0)) * subida);
  const enVentana = (c: string, cat?: Cat) => {
    const v = datos(c)?.ventana ?? {};
    return cat ? visible(c, cat, v[cat] ?? 0) : Object.entries(v).reduce((a, [k, n]) => a + visible(c, k, n), 0);
  };
  const enProceso = (c: string, et: Etapa) => visible(c, et, datos(c)?.proceso_ventana?.[et] ?? 0);
  const nodo = (c: string, id: string) => esEtapa(id) ? enProceso(c, id) : enVentana(c, id as Cat);
  const suma = (cat?: Cat) => sel.reduce((a, c) => a + enVentana(c, cat), 0);
  const sumaEtapa = (et: Etapa) => sel.reduce((a, c) => a + enProceso(c, et), 0);
  // Órdenes y remisiones salen de la vigilancia del Agente; si algún país elegido no la tiene, se dice de cuáles salen.
  const conAgente = sel.filter((c) => datos(c)?.agente).map((c) => infoCuenta(c).nombre);
  const origenProceso = !pulso || conAgente.length === sel.length ? "" : conAgente.length ? `solo ${conAgente.join(" y ")}` : "sin vigilancia aún";
  const maxNodo = Math.max(1, ...sel.flatMap((c) => NODOS.map((n) => nodo(c, n.id))));
  const ultimo = pulso?.cuentas.map((c) => c.ultimo).filter(Boolean).sort().pop() ?? null;
  const hace = ultimo ? Math.max(0, Math.round((ahora - Date.parse(ultimo)) / 1000)) : null;
  const serie = Array.from({ length: 60 }, (_, i) => sel.reduce((a, c) => a + (datos(c)?.serie?.[i] ?? 0), 0));
  const atajo = dias ? atajos().find((r) => r.d === dias.d && r.h === dias.h) : null;
  const etiquetaVentana = !dias ? VENTANAS.find((v) => v.min === ventana)?.label ?? ""
    : atajo ? atajo.label : etiquetaRango(dias.d, dias.h);
  // Frases: "cambios en 10 min" / "cambios de hoy" / "cambios de ayer" / "cambios del 1–15 oct 2026".
  const enVentanaTxt = !dias ? `en ${etiquetaVentana}` : atajo ? `de ${atajo.label.toLowerCase()}` : `del ${etiquetaVentana}`;
  const minutos = dias ? pulso?.minutos ?? 60 : ventana;
  const corte = minutos; // 60 puntos en la ventana: cada punto dura (minutos × 60 s) / 60 = minutos segundos
  const corteTxt = corte < 60 ? `${corte} s` : corte < 3600 ? `${Math.round(corte / 60)} min` : `${Math.round(corte / 360) / 10} h`;
  const lista = stream.filter((e) => {
    const t = Date.parse(e.fecha_hist_est);
    if (!dias) return t >= ahora - (ventana + 1) * 60_000;
    const dia = diaLocal(e.cuenta, t);
    return dia >= dias.d && dia <= dias.h;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Con una sola cuenta (p. ej. una sola sociedad en un solo país) no hay "Todas": se ve solo su bandera. */}
        {TIENDAS.length > 1 && <button onClick={() => elegir(TIENDAS)} className={chip(sel.length === TIENDAS.length)}>🌎 Todas</button>}
        {TIENDAS.map((c) => (
          <button key={c} onClick={() => elegir([c])} className={chip(sel.length === 1 && sel[0] === c)}>
            {infoCuenta(c).bandera} {infoCuenta(c).nombre}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-line bg-black/[0.02] p-0.5 font-mono text-[11px]">
            {VENTANAS.map((v) => (
              <button key={v.min} onClick={() => elegirVentana(v.min)}
                className={`rounded-lg px-2.5 py-1 font-semibold uppercase tracking-wider transition-colors ${!dias && ventana === v.min ? "bg-blue/25 text-text shadow-[inset_0_0_0_1px_rgb(47_123_255_/_0.6)]" : "text-muted hover:text-text"}`}>
                {v.label}
              </button>
            ))}
          </div>
          <SelectorFechas desde={dias?.d ?? hoy} hasta={dias?.h ?? hoy} rangos={atajos()} hoy={hoy} onAplicar={elegirDias}
            inactivo={dias ? undefined : "Calendario"} />
        </div>
      </div>

      {/* El proceso de punta a punta, en el mismo orden del cerebro. */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
        {ETAPAS.map((e) => (
          <Contador key={e.id} titulo={e.label} valor={sumaEtapa(e.id)} color={e.color}
            sub={e.id === "GENERADA" || !origenProceso ? etiquetaVentana : `${etiquetaVentana} · ${origenProceso}`} />
        ))}
        {ESTADOS.map((e) => (
          <Contador key={e.id} titulo={e.label} valor={suma(e.id)} color={COLOR_ESTADO[e.id]}
            sub={suma() ? `${Math.round((suma(e.id) / suma()) * 100)}% de los cambios` : "—"} />
        ))}
      </div>
      {error && <p className="text-xs text-amber" role="status">{error}</p>}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_23rem] items-start">
        <div ref={escenario} className={`card pantalla p-0 min-w-0 ${completa === "ventana" ? "fixed inset-0 z-[60]" : "relative"} ${grande ? "flex flex-col justify-center overflow-auto" : "overflow-hidden"}`}
          style={grande ? { borderRadius: 0 } : undefined}>
          <button onClick={pantallaCompleta} title={grande ? "Salir de pantalla completa (Esc)" : "Ver el metaverso en pantalla completa"}
            aria-label={grande ? "Salir de pantalla completa" : "Pantalla completa"}
            className="absolute right-2 top-2 z-20 rounded-lg border border-line bg-bg/70 p-1.5 text-muted backdrop-blur hover:text-text hover:border-blue/50">
            {grande ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          {/* En pantalla completa el lienzo toma el ancho que quepa sin pasarse del alto de la pantalla. */}
          <div style={grande ? { width: `min(100vw, calc((100vh - 6.5rem) * ${ANCHO} / ${ALTO}))`, margin: "0 auto" } : undefined}>
          {mapa ? (
            <div className="metaverso">
              <div className="flex flex-wrap items-center gap-3 border-b border-line py-2 pl-4 pr-12">
                <button onClick={() => setMapa(null)} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-text">← Volver</button>
                <span className="font-display text-lg font-semibold">{infoCuenta(mapa).bandera} {infoCuenta(mapa).nombre}</span>
                <span className="text-xs text-muted">por departamento · {etiquetaVentana}</span>
                <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-muted">
                  {[...ETAPAS.map((e) => [e.id, e.label, e.color]), ...ESTADOS.map((e) => [e.id, e.label, COLOR_ESTADO[e.id]])].map(([id, label, color]) => (
                    <span key={id} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: color }} />{label}</span>
                  ))}
                </div>
              </div>
              <MapaNeuronal ref={mapaRef} pais={infoCuenta(mapa).pais} datos={mapaDatos} ancho={ANCHO} alto={ALTO}
                colores={Object.fromEntries([...ETAPAS.map((e) => [e.id, e.color]), ...ESTADOS.map((e) => [e.id, COLOR_ESTADO[e.id]])])} />
            </div>
          ) : (
          <div className={entrando ? "zoom-pais" : ""}
            style={entrando ? { transformOrigin: `${(entrando.x / ANCHO) * 100}% ${(entrando.y / ALTO) * 100}%` } : undefined}>
          <RedNeuronal ref={red} ancho={ANCHO} alto={ALTO} centro={geo.sola ? null : { x: CX, y: CY }} total={suma()} maxNodo={maxNodo} logo={logo}
            onPais={entrarMapa}
            paises={geo.paises.map((p) => ({
              cuenta: p.cuenta, bandera: infoCuenta(p.cuenta).bandera, x: p.x, y: p.y, total: enVentana(p.cuenta),
              estados: p.estados.map((e) => ({
                ...e, n: nodo(p.cuenta, e.id),
                hoy: esEtapa(e.id) ? datos(p.cuenta)?.proceso_hoy?.[e.id] ?? 0 : datos(p.cuenta)?.hoy[e.id] ?? 0,
              })),
            }))} />
          </div>
          )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2">
          <div className="text-[11px] text-muted max-w-xl">
            Proceso de cada país: órdenes → remisiones → guías generadas → estados. Número y tamaño de cada hexágono = movimientos {enVentanaTxt}. Cada movimiento sale como señal desde el nodo del país hasta su estado; entregas y devoluciones lanzan una onda.
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted">
            <span className="pulso size-2 rounded-full bg-red shadow-[0_0_10px_var(--red)]" />
            {hace == null ? "ESPERANDO SEÑAL" : `ÚLTIMO CAMBIO HACE ${hace < 60 ? `${hace} S` : `${Math.floor(hace / 60)} MIN`}`}
            {cola > 0 && <span className="rounded-full border border-line px-2 py-0.5">{cola} EN COLA</span>}
          </div>
          </div>
        </div>

        <div className="card p-3 min-w-0 flex flex-col max-h-[44rem]">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="font-display font-semibold">Cambios en vivo</span>
            <span className="text-[11px] font-mono text-muted">{entero(lista.length)} · {etiquetaVentana}</span>
          </div>
          <ul className="flex-1 overflow-y-auto space-y-1 pr-1">
            {lista.map((e) => {
              const cat = CAT[e.est_guia_new_efficommerce ?? -1];
              const c = cat ? COLOR_ESTADO[cat] : COLOR_ESTADO.PENDIENTE;
              const hora = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(e.fecha_hist_est));
              return (
                <li key={claveEv(e)} className="entra flex items-center gap-2.5 rounded-xl border-l-2 px-2 py-1.5" style={{ borderColor: c }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm truncate" style={{ color: c }}>{e.estado_new_efficommerce ?? e.estado_new ?? "—"}</span>
                      <span className="text-[11px]">{infoCuenta(e.cuenta).bandera}</span>
                      {e.pagada && <span className="text-[10px] text-green border border-green/30 rounded-full px-1.5">pagada</span>}
                    </div>
                    {e.guia && (
                      <button onClick={() => copiar(e.guia!)} title="Copiar número de guía para buscarla en Effi"
                        className="group inline-flex items-center gap-1 font-mono text-[13px] font-semibold tracking-wide text-text hover:text-blue-2">
                        {e.guia}
                        <Copy size={11} className="opacity-40 group-hover:opacity-100" />
                        {copiada === e.guia && <span className="text-[10px] text-green font-sans font-normal">copiada</span>}
                      </button>
                    )}
                    <div className="text-[11px] text-muted truncate font-mono">{e.nombre_transportadora_efficommerce ?? "—"} · {e.nombre_ciudad_destinatario ?? ""}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-mono text-muted">{hora}</div>
                    {e.valor_recaudo != null && <div className="text-[11px] num">{dinero(e.valor_recaudo, e.cuenta)}</div>}
                  </div>
                </li>
              );
            })}
            {!lista.length && <li className="text-sm text-muted text-center py-8">Sin cambios {enVentanaTxt}…</li>}
          </ul>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[11px] uppercase tracking-widest font-mono text-muted">Latido · cambios cada {corteTxt}, {dias ? etiquetaVentana.toLowerCase() : `últimos ${etiquetaVentana}`}</span>
          <span className="text-[11px] text-muted num">{entero(serie.reduce((a, n) => a + n, 0))} cambios</span>
        </div>
        <Latido valores={serie} />
      </div>

      <div className={`grid gap-3 ${sel.length > 1 ? "sm:grid-cols-2 xl:grid-cols-4" : ""}`}>
        {sel.map((c) => {
          const d = datos(c), info = infoCuenta(c);
          return (
            <div key={c} className="card p-4">
              <div className="flex items-center justify-between font-semibold">
                <span>{info.bandera} {info.nombre}</span>
                <span className="text-[11px] font-mono text-muted">{entero(enVentana(c))} {enVentanaTxt}</span>
              </div>
              {/* Sigue el filtro de tiempo; "hoy" va aparte porque cada país tiene su propia medianoche. */}
              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                <Dato titulo="Entregadas" valor={entero(enVentana(c, "ENTREGADO"))} color={COLOR_ESTADO.ENTREGADO} />
                <Dato titulo="En tránsito" valor={entero(enVentana(c, "EN_TRANSITO"))} color={COLOR_ESTADO.EN_TRANSITO} />
                <Dato titulo="Novedades" valor={entero(enVentana(c, "NOVEDAD"))} color={COLOR_ESTADO.NOVEDAD} />
                <Dato titulo="Devoluciones" valor={entero(enVentana(c, "DEVOLUCION"))} color={COLOR_ESTADO.DEVOLUCION} />
              </div>
              <div className="mt-3 border-t border-dashed border-line pt-2 text-xs text-muted space-y-0.5">
                <div>
                  Hoy desde las 00:00 hora {info.nombre}: <span className="text-text font-semibold num">{entero(Object.values(d?.hoy ?? {}).reduce((a, n) => a + n, 0))}</span> cambios ·{" "}
                  {entero(d?.hoy.ENTREGADO ?? 0)} entregadas
                </div>
                <div>Recaudo acreditado hoy: <span className="text-text font-semibold num">{dinero(d?.recaudo_hoy ?? 0, c)}</span> · {entero(d?.pagos_hoy ?? 0)} pagos</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${on ? "border-blue/50 bg-blue/15 text-text" : "border-line text-muted hover:text-text"}`;

function Contador({ titulo, valor, color, sub }: { titulo: string; valor: number; color: string; sub: string }) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
      <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">{titulo}</div>
      <div className="num text-4xl font-semibold mt-1 tabular-nums" style={{ color, textShadow: `0 0 18px ${color}` }}>{entero(valor)}</div>
      <div className="text-[11px] font-mono text-muted mt-1">{sub}</div>
    </div>
  );
}

function Dato({ titulo, valor, color }: { titulo: string; valor: string; color: string }) {
  return (
    <div className="rounded-xl bg-black/[0.03] px-2 py-2">
      <div className="num text-xl font-semibold" style={{ color }}>{valor}</div>
      <div className="text-[10px] text-muted">{titulo}</div>
    </div>
  );
}

// Línea tipo electrocardiograma con los cambios de cada corte (el último punto es el más reciente).
function Latido({ valores }: { valores: number[] }) {
  const w = 1000, h = 70, max = Math.max(1, ...valores);
  const pts = valores.map((v, i) => `${(i / (valores.length - 1)) * w},${h - 6 - (v / max) * (h - 14)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16 block" preserveAspectRatio="none" aria-label="Cambios por corte de tiempo">
      {Array.from({ length: 11 }, (_, i) => <line key={i} x1={(i * w) / 10} y1={0} x2={(i * w) / 10} y2={h} stroke="rgb(140 170 255 / 0.07)" vectorEffect="non-scaling-stroke" />)}
      <polyline points={pts} fill="none" stroke="var(--green)" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ filter: "drop-shadow(0 0 4px var(--green))" }} />
    </svg>
  );
}
