"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { entero, haceCuanto } from "@/lib/formato";
import { infoCuenta, ordenCuenta } from "@/lib/paises";

// 🤖 Agente flotante: una pestaña fija al borde derecho de cualquier pantalla. Al abrirla se ve el agente de cada país
// (modo, lo de hoy, lo que falta y los errores) y, para el dueño, los mismos botones de /agente, sin tener que ir allá.
// No sale en /agente. Cerrada consulta cada 2 minutos (solo para el número de la pestaña); abierta, cada 20 s.

type Modo = "apagado" | "vigilar" | "simular" | "automatico";
type Pais = {
  cuenta: string; modo: Modo; corriendo: boolean; ultima_corrida: string | null; errores_hoy: number;
  resumen: { sin_remision: number; sin_guia: number; revision: number; hoy_total?: number; hoy_completas?: number } | null;
};

const MODO: Record<Modo, { label: string; color: string }> = {
  automatico: { label: "Automático", color: "var(--green)" },
  simular: { label: "Manual", color: "var(--blue-2)" },
  vigilar: { label: "En prueba", color: "var(--amber)" },
  apagado: { label: "Apagado", color: "var(--muted)" },
};
// Igual que en /agente: Guatemala hace remisión y guía; Ecuador solo guías (la API de Effi falla al crear remisiones).
const CREA = ["TIENDA_GT", "TIENDA_EC"];

export function AgenteFlotante({ esOwner }: { esOwner: boolean }) {
  const path = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [paises, setPaises] = useState<Pais[] | null>(null);
  const [confirmar, setConfirmar] = useState<{ cuenta: string; accion: "ahora" | "guias" } | null>(null);
  const [aviso, setAviso] = useState<{ cuenta: string; txt: string; error?: boolean } | null>(null);

  const cargar = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    const { data } = await createClient().rpc("auto_flotante");
    if (data) setPaises((data as Pais[]).sort((a, b) => ordenCuenta(a.cuenta) - ordenCuenta(b.cuenta)));
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, abierto ? 20_000 : 120_000);
    return () => clearInterval(t);
  }, [abierto, cargar]);
  useEffect(() => {
    if (!abierto) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [abierto]);

  async function ejecutar(cuenta: string, accion: "ahora" | "guias") {
    setConfirmar(null);
    setAviso({ cuenta, txt: "Enviando…" });
    const { data, error } = await createClient().rpc(accion === "ahora" ? "auto_ejecutar_ahora" : "auto_pasar_a_guia", { p_cuenta: cuenta });
    if (error) return setAviso({ cuenta, txt: error.message, error: true });
    setAviso({ cuenta, txt: data === "ocupado" ? "Ya hay una corrida en curso." : accion === "ahora" ? "Corriendo: creando en Effi." : "Haciendo las guías de a 10." });
    cargar();
  }

  if (path.startsWith("/agente")) return null;
  // Lo que pide mirar a alguien: errores de hoy y órdenes para revisar.
  const alertas = (paises ?? []).filter((p) => p.modo !== "vigilar").reduce((a, p) => a + p.errores_hoy + (p.resumen?.revision ?? 0), 0);
  const corriendo = (paises ?? []).some((p) => p.corriendo);

  return (
    <>
      {!abierto && (
        <button onClick={() => setAbierto(true)} title="Abrir el agente sin salir de esta pantalla"
          className="fixed right-0 top-1/2 z-30 -translate-y-1/2 flex flex-col items-center gap-1.5 rounded-l-2xl border border-r-0 border-blue/40 bg-panel/95 px-2 py-3 shadow-[0_0_24px_rgb(47_123_255_/_0.25)] backdrop-blur hover:bg-blue/15">
          <span className="text-lg leading-none">🤖</span>
          <span className="text-[11px] font-semibold tracking-wider text-text [writing-mode:vertical-rl] rotate-180">Agente</span>
          {corriendo && <span className="pulso size-2 rounded-full bg-green shadow-[0_0_8px_var(--green)]" title="Corriendo" />}
          {alertas > 0 && <span className="rounded-full bg-red px-1.5 py-0.5 text-[10px] font-bold text-white">{alertas}</span>}
        </button>
      )}
      {abierto && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button className="flex-1 bg-black/40" onClick={() => setAbierto(false)} aria-label="Cerrar el agente" />
          <aside className="flex h-full w-[24rem] max-w-[92vw] flex-col border-l border-line bg-panel shadow-2xl entra" role="dialog" aria-label="Agente">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-display text-lg font-semibold">🤖 Agente</span>
              <button onClick={() => setAbierto(false)} className="rounded-lg p-1.5 text-muted hover:text-text" aria-label="Cerrar"><X size={18} /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {!paises && <p className="py-8 text-center text-sm text-muted">Cargando…</p>}
              {paises?.length === 0 && <p className="py-8 text-center text-sm text-muted">No hay agente montado en tus tiendas.</p>}
              {paises?.map((p) => {
                const info = infoCuenta(p.cuenta), m = MODO[p.modo] ?? MODO.apagado, r = p.resumen;
                const prueba = p.modo === "vigilar" || !CREA.includes(p.cuenta);
                return (
                  <div key={p.cuenta} className="card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{info.bandera} {info.nombre}</span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: m.color, color: m.color }}>
                        {p.corriendo && <span className="pulso size-1.5 rounded-full" style={{ background: m.color }} />}
                        {p.corriendo ? "Corriendo" : m.label}
                      </span>
                    </div>
                    {prueba ? (
                      <p className="mt-2 text-xs text-muted">Todavía no ejecuta nada en Effi; solo vigila las órdenes.</p>
                    ) : (
                      <>
                        <div className="mt-2.5 grid grid-cols-4 gap-1.5 text-center">
                          <Dato titulo="Hoy" valor={`${entero(r?.hoy_completas ?? 0)}/${entero(r?.hoy_total ?? 0)}`} color="var(--green)" />
                          <Dato titulo="Sin remisión" valor={entero(r?.sin_remision ?? 0)} color="var(--red)" />
                          <Dato titulo="Sin guía" valor={entero(r?.sin_guia ?? 0)} color="var(--blue-2)" />
                          <Dato titulo="Revisar" valor={entero(r?.revision ?? 0)} color="var(--amber)" />
                        </div>
                        <div className={`mt-2 rounded-lg px-2.5 py-1.5 text-xs ${p.errores_hoy ? "bg-red/10 text-red" : "bg-green/10 text-green"}`}>
                          {p.errores_hoy ? `${p.errores_hoy} con error hoy · requieren verificación humana` : "Sin errores hoy"}
                        </div>
                        <div className="mt-1.5 text-[11px] text-muted">Última revisión {haceCuanto(p.ultima_corrida)} · hoy: completas / órdenes</div>
                        {esOwner && (
                          confirmar?.cuenta === p.cuenta ? (
                            <div className="mt-2.5 rounded-lg border border-amber/40 bg-amber/10 p-2.5 text-xs">
                              <p>{confirmar.accion === "ahora" ? "Esto crea en Effi lo que esté listo. ¿Seguro?" : "Esto hace en Effi las guías de las remisiones ya hechas. ¿Seguro?"}</p>
                              <div className="mt-2 flex gap-2">
                                <button onClick={() => ejecutar(p.cuenta, confirmar.accion)} className="rounded-full bg-green px-3 py-1 font-bold text-black">Sí, ejecutar</button>
                                <button onClick={() => setConfirmar(null)} className="rounded-full border border-line px-3 py-1 text-muted hover:text-text">Cancelar</button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2.5 flex flex-wrap gap-2">
                              <button onClick={() => setConfirmar({ cuenta: p.cuenta, accion: "ahora" })} disabled={p.corriendo}
                                className="rounded-full bg-green px-3 py-1.5 text-xs font-bold text-black disabled:opacity-40">▶ Ejecutar ahora</button>
                              <button onClick={() => setConfirmar({ cuenta: p.cuenta, accion: "guias" })} disabled={p.corriendo}
                                className="rounded-full border border-blue/50 px-3 py-1.5 text-xs font-bold text-blue-2 disabled:opacity-40">Pasar de remisión a guía</button>
                            </div>
                          )
                        )}
                        {aviso?.cuenta === p.cuenta && <p className={`mt-1.5 text-xs ${aviso.error ? "text-red" : "text-green"}`}>{aviso.txt}</p>}
                      </>
                    )}
                    <Link href={`/agente?c=${p.cuenta}`} onClick={() => setAbierto(false)} className="mt-2 inline-block text-xs text-blue-2 hover:underline">
                      Abrir el agente de {info.nombre} →
                    </Link>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function Dato({ titulo, valor, color }: { titulo: string; valor: string; color: string }) {
  return (
    <div className="rounded-lg bg-black/[0.03] px-1 py-1.5">
      <div className="num text-base font-semibold" style={{ color }}>{valor}</div>
      <div className="text-[10px] text-muted">{titulo}</div>
    </div>
  );
}
