"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { MENU_EN_VIVO, MENU_PRINCIPAL, MENU_PRONTO, type ItemMenu } from "@/lib/menu";
import { esSocio, tieneModulo, type Acceso } from "@/lib/modulos";
import { Logo } from "./ui";
import { Salir } from "./salir";

// Navegación estilo Grupo RZ: barra fija arriba (logo, accesos principales y botón Menú) y un menú a pantalla completa
// con secciones numeradas. Mismas reglas de acceso que el menú lateral original.

export function Sidebar({ acceso, email, ultimoSync, sociedad, sociedades, vista, porAceptar = 0, pagosPendientes = 0, conProveeduria = false, soloProveeduria = false }: {
  acceso: Acceso; email: string; ultimoSync: string; sociedad: string; sociedades: string[] | null; vista: string | null;
  porAceptar?: number;
  pagosPendientes?: number;
  conProveeduria?: boolean;
  soloProveeduria?: boolean;
}) {
  const esOwner = acceso.rol === "owner";
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cambiando, start] = useTransition();
  async function verSociedad(s: string) {
    const { error } = await createClient().rpc("app_ver_sociedad", { p_sociedad: s || null });
    if (error) return;
    start(() => { router.push(path); router.refresh(); });
  }
  const qs = sp.toString() ? `?${sp.toString()}` : "";

  useEffect(() => setAbierto(false), [path]);
  useEffect(() => {
    if (!abierto) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [abierto]);

  const visible = (it: ItemMenu) => {
    if (it.soloOwner && !esOwner) return false;
    if (it.soloSocios && !esSocio(acceso)) return false;
    if (it.soloProveeduria && !conProveeduria) return false;
    if (it.noProveeduria && soloProveeduria && !esOwner) return false;
    if (it.modulo && !tieneModulo(acceso, it.modulo)) return false;
    return true;
  };
  const esActivo = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const todos = [...MENU_PRINCIPAL, ...MENU_EN_VIVO, ...MENU_PRONTO].filter(visible);
  const actual = todos.find((it) => esActivo(it.href));
  // Todas las pestañas que el usuario puede abrir, a la vista: operación, en vivo y, al final, las del dueño.
  const EN_VIVO: ItemMenu = { href: "/en-vivo", label: "En vivo", emoji: "", estado: "vivo", modulo: "guias" };
  const pestanas = [
    ...MENU_PRINCIPAL.filter((it) => !it.soloOwner), EN_VIVO, ...MENU_EN_VIVO,
    ...MENU_PRONTO.filter((it) => it.estado === "vivo"), ...MENU_PRINCIPAL.filter((it) => it.soloOwner),
  ].filter(visible);

  // Numeración continua en el menú completo (01, 02…), como las tarjetas de servicios del estilo.
  let n = 0;
  const tarjeta = (it: ItemMenu) => {
    n += 1;
    const activo = esActivo(it.href);
    return (
      <Link key={it.href} href={`${it.href}${qs}`} aria-current={activo ? "page" : undefined}
        className={`group relative flex flex-col gap-1.5 border-l pl-5 py-3 pr-2 transition-colors ${
          activo ? "border-blue" : "border-black/10 hover:border-black/40"
        }`}>
        <span className={`text-[11px] tabular-nums ${activo ? "text-blue" : "text-muted/50"}`}>{String(n).padStart(2, "0")}</span>
        <span className={`text-lg sm:text-xl font-normal leading-tight tracking-tight transition-colors ${activo ? "text-text" : "text-text/80 group-hover:text-text"}`}>
          {it.label}
        </span>
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted/70">
          {it.estado === "pronto" ? "Pronto" : activo ? "Estás aquí" : "Abrir"}
          {it.href === "/pagos" && pagosPendientes > 0 && (
            <span className="rounded-full bg-amber px-1.5 py-0.5 text-[10px] font-bold tracking-normal text-black">{pagosPendientes}</span>
          )}
          {it.href === "/usuarios" && porAceptar > 0 && (
            <span className="rounded-full bg-amber px-1.5 py-0.5 text-[10px] font-bold tracking-normal text-black">{porAceptar}</span>
          )}
        </span>
      </Link>
    );
  };
  const seccion = (titulo: string, items: ItemMenu[], nota?: ReactNode) => {
    const lista = items.filter(visible);
    if (!lista.length) return null;
    return (
      <section>
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted/60 mb-4">{titulo}</p>
        <div className="h-px bg-black/10 mb-6" />
        {nota}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">{lista.map(tarjeta)}</div>
      </section>
    );
  };

  return (
    <>
      {/* Marco tipo iPhone: isla, barra de estado y barra superior coral con TODAS las pestañas a la vista. */}
      <header className="relative px-4 sm:px-8 lg:px-10 pt-2.5 sm:pt-3">
        <span className="isla hidden sm:block" aria-hidden />
        <BarraEstado />
        <div className="mt-4 sm:mt-5 flex items-center gap-2.5">
          <Link href={`/${qs}`} className="flex items-center gap-2.5 shrink-0 dc-left" aria-label="Inicio">
            <Logo />
            <span className="text-lg font-semibold tracking-tight">Effi Connect</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {pagosPendientes > 0 && (
              <Link href="/pagos" className="dc-pop inline-flex h-11 items-center gap-2 rounded-full bg-white px-4 text-xs font-medium text-red shadow-[0_8px_20px_rgba(160,80,70,0.18)]">
                <span className="pulso size-1.5 rounded-full bg-red" />
                {pagosPendientes} {pagosPendientes === 1 ? "pago" : "pagos"} por verificar
              </Link>
            )}
            {esOwner && porAceptar > 0 && (
              <Link href="/usuarios" className="dc-pop hidden sm:inline-flex h-11 items-center gap-2 rounded-full bg-white px-4 text-xs font-medium text-amber shadow-[0_8px_20px_rgba(160,80,70,0.18)]">
                <span className="pulso size-1.5 rounded-full bg-amber" />
                {porAceptar} por aceptar
              </Link>
            )}
            <span className="hidden md:inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-xs text-muted" title="Última sincronización con Effi">
              <span className="pulso size-1.5 rounded-full bg-green" />
              Effi {ultimoSync}
            </span>
            <button onClick={() => setAbierto(true)} aria-expanded={abierto} aria-controls="menu-completo"
              className="h-11 rounded-full bg-white px-5 text-sm font-medium text-text transition hover:bg-white/80 active:scale-[0.96]">
              Menú
            </button>
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[#111111] text-sm font-semibold uppercase text-white" title={email} aria-hidden>
              {email.slice(0, 1)}
            </span>
          </div>
        </div>
        <nav className="pestanas mt-5 -mx-4 sm:mx-0 px-4 sm:px-0 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap" aria-label="Secciones">
          {pestanas.map((it, i) => {
            const activo = esActivo(it.href);
            return (
              <Link key={it.href} href={`${it.href}${qs}`} aria-current={activo ? "page" : undefined}
                style={{ animationDelay: `${0.06 * i}s` }}
                className={`dc-pop inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-sm transition ${
                  activo ? "bg-[#111111] text-white" : "ring-[1.5px] ring-inset ring-text text-text hover:bg-black/5"
                }`}>
                {it.href === "/en-vivo" && <span className="pulso size-1.5 rounded-full bg-red" />}
                {it.label}
                {it.href === "/pagos" && pagosPendientes > 0 && (
                  <span className="rounded-full bg-red px-1.5 py-0.5 text-[10px] font-bold text-white">{pagosPendientes}</span>
                )}
                {it.href === "/usuarios" && porAceptar > 0 && (
                  <span className="rounded-full bg-amber px-1.5 py-0.5 text-[10px] font-bold text-white">{porAceptar}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </header>

      {abierto && (
        <div id="menu-completo" role="dialog" aria-modal="true" aria-label="Menú" className="fixed inset-0 z-[60] overflow-y-auto bg-bg/[0.98] backdrop-blur">
          <div className="flex items-center gap-6 px-4 sm:px-8 lg:px-16 py-4">
            <div className="flex items-center gap-2.5">
              <Logo />
              <span className="text-lg font-semibold tracking-tight">Effi Connect</span>
            </div>
            <button onClick={() => setAbierto(false)} autoFocus
              className="ml-auto h-11 rounded-lg bg-transparent ring-[1.5px] ring-inset ring-text px-6 text-xs font-semibold uppercase tracking-[0.18em] text-text transition hover:bg-black/5 active:scale-[0.97]">
              Cerrar
            </button>
          </div>

          <div className="px-4 sm:px-8 lg:px-16 pt-10 pb-16 space-y-14 max-w-[1400px]">
            <div className="fu" style={{ animationDelay: ".05s" }}>
              <h2 className="text-4xl sm:text-5xl lg:text-[4.5rem] font-light leading-[0.95] tracking-tight">
                {actual ? actual.label : "Panel"}
              </h2>
              <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-muted">
                {sociedades ? (
                  <label className="inline-flex items-center gap-3">
                    <span className="text-[11px] uppercase tracking-[0.2em]">Sociedad</span>
                    <select value={vista ?? ""} onChange={(e) => verSociedad(e.target.value)} disabled={cambiando}
                      className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm text-text">
                      <option value="" className="bg-bg">Todas las sociedades</option>
                      {sociedades.map((s) => <option key={s} value={s} className="bg-bg">{s}</option>)}
                    </select>
                  </label>
                ) : (
                  <span>{sociedad}</span>
                )}
                <span className="inline-flex items-center gap-2" title="Última sincronización con Effi">
                  <span className="pulso size-1.5 rounded-full bg-green shadow-[0_0_8px_var(--green)]" />
                  Effi {ultimoSync}
                </span>
                <Salir email={email} />
              </div>
            </div>

            <div className="fu" style={{ animationDelay: ".15s" }}>{seccion("Operación", MENU_PRINCIPAL.filter((it) => !it.soloOwner))}</div>
            <div className="fu" style={{ animationDelay: ".25s" }}>{seccion("En vivo", [{ href: "/en-vivo", label: "Operación en vivo", emoji: "", estado: "vivo", modulo: "guias" }, ...MENU_EN_VIVO])}</div>
            <div className="fu" style={{ animationDelay: ".35s" }}>{seccion("Próximamente", MENU_PRONTO)}</div>
            {esOwner && (
              <div className="fu" style={{ animationDelay: ".45s" }}>{seccion("Solo para el dueño", MENU_PRINCIPAL.filter((it) => it.soloOwner))}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Barra de estado del marco: hora de Bogotá y los íconos de señal, wifi y batería.
function BarraEstado() {
  const [hora, setHora] = useState("");
  useEffect(() => {
    const f = () => setHora(new Date().toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit", hour12: false }));
    f();
    const t = setInterval(f, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex h-8 items-center justify-between px-3 sm:px-6 text-[15px] font-semibold text-text" aria-hidden>
      <span className="tabular-nums" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif" }}>{hora || "\u00a0"}</span>
      <span className="flex items-center gap-1.5">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.4c2.2 0 4.2.9 5.7 2.3l1.1-1.1A9.6 9.6 0 0 0 8 .8 9.6 9.6 0 0 0 1.2 3.6l1.1 1.1A8 8 0 0 1 8 2.4Zm0 3.2c1.3 0 2.5.5 3.4 1.4l1.1-1.1A6.4 6.4 0 0 0 8 4a6.4 6.4 0 0 0-4.5 1.9l1.1 1.1c.9-.9 2.1-1.4 3.4-1.4Zm0 3.2c-.5 0-.9.2-1.2.5L8 10.5l1.2-1.2c-.3-.3-.7-.5-1.2-.5Z" /></svg>
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none"><rect x="0.5" y="0.5" width="22" height="11" rx="3" stroke="currentColor" strokeOpacity=".4" /><rect x="2" y="2" width="17" height="8" rx="1.8" fill="currentColor" /><rect x="24" y="4" width="1.6" height="4" rx=".8" fill="currentColor" fillOpacity=".5" /></svg>
      </span>
    </div>
  );
}
