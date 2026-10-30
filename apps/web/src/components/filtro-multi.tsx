"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";

// Desplegable de selección múltiple que guarda lo elegido en la URL (?t=, ?cc=, ?pv= separados por "|").
export function FiltroMulti({ etiqueta, param, opciones, seleccion }: {
  etiqueta: string; param: string; opciones: { valor: string; guias: number }[]; seleccion: string[] | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [abierto, setAbierto] = useState(false);
  const [pendiente, start] = useTransition();
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  const guardar = (lista: string[] | null) => {
    const p = new URLSearchParams(sp.toString());
    if (lista && lista.length) p.set(param, lista.join("|"));
    else p.delete(param);
    start(() => router.push(`${path}?${p.toString()}`, { scroll: false }));
  };

  const activos = seleccion ?? [];
  const alternar = (v: string) => {
    const s = new Set(activos);
    s.has(v) ? s.delete(v) : s.add(v);
    guardar([...s]);
  };

  const resumen = !seleccion?.length ? etiqueta : seleccion.length === 1 ? seleccion[0] : `${etiqueta} · ${seleccion.length}`;

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        aria-expanded={abierto}
        className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors ${seleccion?.length ? "border-blue/50 bg-blue/15 text-text" : "border-line text-text hover:bg-black/[0.04]"} ${pendiente ? "opacity-60" : ""}`}
      >
        <span className={`size-1.5 rounded-full ${seleccion?.length ? "bg-blue-2" : "bg-muted"}`} />
        <span className="max-w-[12rem] truncate">{resumen}</span>
        <ChevronDown size={14} className={`text-muted transition-transform ${abierto ? "rotate-180" : ""}`} />
      </button>
      {abierto && (
        <div className="card absolute left-0 z-40 mt-2 w-72 max-w-[85vw] p-2">
          <button
            type="button"
            onClick={() => guardar(null)}
            className={`w-full text-left rounded-lg px-3 py-2 text-xs ${!seleccion?.length ? "bg-blue/15 text-text" : "text-muted hover:text-text hover:bg-black/[0.04]"}`}
          >
            Todas
          </button>
          <div className="max-h-72 overflow-y-auto mt-1 space-y-0.5">
            {opciones.length === 0 && <p className="text-xs text-muted px-3 py-2">Sin opciones en este periodo.</p>}
            {opciones.map((o) => (
              <label key={o.valor} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs cursor-pointer hover:bg-black/[0.04]">
                <input type="checkbox" checked={activos.includes(o.valor)} onChange={() => alternar(o.valor)} className="accent-[var(--blue)]" />
                <span className="flex-1 truncate">{o.valor}</span>
                <span className="text-muted num">{o.guias.toLocaleString("es-CO")}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
