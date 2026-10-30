"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { rangoActivo, type Rango } from "@/lib/filtros";

// Calendario tipo Shopify: un botón con el periodo; al abrirlo,
// atajos a la izquierda y dos meses a la derecha. Nada cambia hasta "Aplicar".

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const partes = (iso: string) => ({ a: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) - 1, d: Number(iso.slice(8, 10)) });

export function etiquetaRango(d: string, h: string) {
  const x = partes(d), y = partes(h);
  if (d === h) return `${x.d} ${MESES[x.m]} ${x.a}`;
  if (x.a !== y.a) return `${x.d} ${MESES[x.m]} ${x.a} – ${y.d} ${MESES[y.m]} ${y.a}`;
  if (x.m !== y.m) return `${x.d} ${MESES[x.m]} – ${y.d} ${MESES[y.m]} ${y.a}`;
  return `${x.d}–${y.d} ${MESES[x.m]} ${x.a}`;
}

// "YYYY-MM" ± n meses.
const moverMes = (ym: string, n: number) => {
  const { a, m } = partes(`${ym}-01`);
  const t = a * 12 + m + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

function Mes({ ym, hoy, minimo, inicio, fin, hover, onDia, onHover }: {
  ym: string; hoy: string; minimo?: string; inicio: string; fin: string | null; hover: string | null;
  onDia: (iso: string) => void; onHover: (iso: string | null) => void;
}) {
  const { a, m } = partes(`${ym}-01`);
  const dias = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  const vacios = (new Date(Date.UTC(a, m, 1)).getUTCDay() + 6) % 7; // lunes = 0
  const finVista = fin ?? (hover && hover >= inicio ? hover : null);
  return (
    <div className="w-[15.5rem]">
      <div className="text-sm font-medium text-center mb-2 capitalize">{MESES_LARGO[m]} {a}</div>
      <div className="grid grid-cols-7 text-[11px] text-muted mb-1">
        {DIAS.map((d) => <span key={d} className="text-center py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => onHover(null)}>
        {Array.from({ length: vacios }).map((_, i) => <span key={`v${i}`} />)}
        {Array.from({ length: dias }).map((_, i) => {
          const iso = `${ym}-${String(i + 1).padStart(2, "0")}`;
          const futuro = iso > hoy || (minimo != null && iso < minimo); // fuera de rango: futuro o antes del mínimo
          const extremo = iso === inicio || iso === finVista;
          const dentro = finVista != null && iso > inicio && iso < finVista;
          return (
            <button
              key={iso}
              type="button"
              disabled={futuro}
              onClick={() => onDia(iso)}
              onMouseEnter={() => onHover(iso)}
              aria-label={iso}
              aria-pressed={extremo}
              className={`h-8 text-xs num transition-colors ${
                extremo
                  ? "bg-blue text-white rounded-lg font-semibold"
                  : dentro
                    ? "bg-blue/15 text-text"
                    : futuro
                      ? "text-muted/40 cursor-not-allowed"
                      : "rounded-lg hover:bg-black/[0.07]"
              } ${iso === hoy && !extremo ? "ring-1 ring-inset ring-blue-2/60 rounded-lg" : ""}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// "inactivo": otro filtro manda (por ejemplo los minutos de En vivo); el botón se ve apagado y muestra "inactivo" como texto.
export function SelectorFechas({ desde, hasta, rangos, hoy, onAplicar, inactivo, minimo }: {
  desde: string; hasta: string; rangos: Rango[]; hoy: string; onAplicar: (d: string, h: string) => void; inactivo?: string; minimo?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [ini, setIni] = useState(desde);
  const [fin, setFin] = useState<string | null>(hasta);
  const [hover, setHover] = useState<string | null>(null);
  const [mesDer, setMesDer] = useState(hasta.slice(0, 7));
  const [pos, setPos] = useState<"izq" | "der" | "fijo">("izq");
  const caja = useRef<HTMLDivElement>(null);

  const activo = rangoActivo(rangos, desde, hasta);
  const etiqueta = inactivo ?? (activo ? `${activo.label} · ${etiquetaRango(desde, hasta)}` : etiquetaRango(desde, hasta));
  const borradorActivo = fin ? rangoActivo(rangos, ini, fin) : null;

  const abrir = () => {
    setIni(desde);
    setFin(hasta);
    setMesDer(hasta.slice(0, 7));
    // El panel (~44rem) abre hacia donde haya espacio; en celular queda fijo a lo ancho de la pantalla.
    const r = caja.current?.getBoundingClientRect();
    if (window.innerWidth < 640) setPos("fijo");
    else setPos(r && r.left + 704 > window.innerWidth - 12 ? "der" : "izq");
    setAbierto(true);
  };
  const cerrar = () => setAbierto(false);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && cerrar();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  // Primer clic = inicio; segundo clic = fin (si es antes del inicio, vuelve a empezar).
  const elegirDia = (iso: string) => {
    if (fin != null || iso < ini) {
      setIni(iso);
      setFin(null);
    } else {
      setFin(iso);
    }
  };

  const elegirAtajo = (r: Rango) => {
    setIni(r.d);
    setFin(r.h);
    setMesDer(r.h.slice(0, 7));
  };

  const aplicar = () => {
    if (!fin) return;
    onAplicar(ini, fin);
    cerrar();
  };

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => (abierto ? cerrar() : abrir())}
        aria-expanded={abierto}
        aria-haspopup="dialog"
        className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors ${abierto ? "border-blue/50 bg-blue/15 text-text" : inactivo ? "border-line text-muted hover:text-text hover:bg-black/[0.04]" : "border-line text-text hover:border-black/20 hover:bg-black/[0.04]"}`}
      >
        <CalendarDays size={14} className="text-blue-2" />
        <span className="num">{etiqueta}</span>
        <ChevronDown size={14} className={`text-muted transition-transform ${abierto ? "rotate-180" : ""}`} />
      </button>

      {abierto && (
        <div role="dialog" aria-label="Elegir periodo" className={`card z-40 p-0 overflow-hidden ${pos === "fijo" ? "fixed inset-x-3 top-24 max-h-[80dvh] overflow-y-auto" : `absolute mt-2 w-[44rem] ${pos === "der" ? "right-0" : "left-0"}`}`}>
          <div className="flex flex-col sm:flex-row">
            <div className="flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible border-b sm:border-b-0 sm:border-r border-line p-2 sm:w-40 shrink-0">
              {rangos.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => elegirAtajo(r)}
                  className={`whitespace-nowrap text-left rounded-lg px-3 py-2 text-xs transition-colors ${borradorActivo?.id === r.id ? "bg-blue/15 text-text" : "text-muted hover:text-text hover:bg-black/[0.04]"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="p-4 flex-1">
              <div className="flex items-center justify-between mb-2">
                <button type="button" onClick={() => setMesDer(moverMes(mesDer, -1))} className="rounded-lg p-1.5 text-muted hover:text-text hover:bg-black/[0.06]" aria-label="Ver mes anterior">
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setMesDer(moverMes(mesDer, 1))}
                  disabled={mesDer >= hoy.slice(0, 7)}
                  className="rounded-lg p-1.5 text-muted hover:text-text hover:bg-black/[0.06] disabled:opacity-30 disabled:hover:bg-transparent"
                  aria-label="Ver mes siguiente"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="flex justify-center gap-6">
                <div className="hidden sm:block">
                  <Mes ym={moverMes(mesDer, -1)} hoy={hoy} minimo={minimo} inicio={ini} fin={fin} hover={hover} onDia={elegirDia} onHover={setHover} />
                </div>
                <Mes ym={mesDer} hoy={hoy} minimo={minimo} inicio={ini} fin={fin} hover={hover} onDia={elegirDia} onHover={setHover} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
            <span className="text-xs text-muted num">{fin ? etiquetaRango(ini, fin) : `${etiquetaRango(ini, ini)} → elige el día final`}</span>
            <div className="flex gap-2">
              <button type="button" onClick={cerrar} className="rounded-full border border-line px-3.5 py-1.5 text-xs text-muted hover:text-text">
                Cancelar
              </button>
              <button type="button" onClick={aplicar} disabled={!fin} className="btn-primary rounded-full px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
