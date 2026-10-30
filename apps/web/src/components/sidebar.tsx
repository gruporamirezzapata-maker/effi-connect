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
const ATAJOS = ["/", "/despachos", "/publicidad", "/oficina", "/novedades"];

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
  const atajos = MENU_PRINCIPAL.filter((it) => ATAJOS.includes(it.href) && visible(it));

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
      <header className="fixed inset-x-0 top-0 z-50 flex items-center gap-6 px-4 sm:px-8 lg:px-16 py-4 bg-gradient-to-b from-bg/95 to-bg/0 backdrop-blur-sm">
        <Link href={`/${qs}`} className="flex items-center gap-2.5 shrink-0" aria-label="Inicio">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Effi Connect</span>
        </Link>

        <nav className="hidden lg:flex flex-1 items-center justify-center gap-9" aria-label="Accesos principales">
          {atajos.map((it) => (
            <Link key={it.href} href={`${it.href}${qs}`} aria-current={esActivo(it.href) ? "page" : undefined}
              className={`text-[13px] uppercase tracking-[0.2em] transition-colors ${
                esActivo(it.href) ? "text-text" : "text-muted hover:text-text"
              }`}>
              {it.label}
            </Link>
          ))}
          {tieneModulo(acceso, "guias") && (
            <Link href="/en-vivo" className={`inline-flex items-center gap-2 text-[13px] uppercase tracking-[0.2em] transition-colors ${
              path.startsWith("/en-vivo") ? "text-text" : "text-muted hover:text-text"
            }`}>
              <span className="pulso size-1.5 rounded-full bg-red shadow-[0_0_8px_var(--red)]" />
              En vivo
            </Link>
          )}
        </nav>

        <div className="ml-auto lg:ml-0 flex items-center gap-3">
          {pagosPendientes > 0 && (
            <Link href="/pagos" className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-amber">
              <span className="pulso size-1.5 rounded-full bg-amber" />
              {pagosPendientes} {pagosPendientes === 1 ? "pago" : "pagos"} por verificar
            </Link>
          )}
          {esOwner && porAceptar > 0 && (
            <Link href="/usuarios" className="hidden sm:inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-amber">
              <span className="pulso size-1.5 rounded-full bg-amber" />
              {porAceptar} por aceptar
            </Link>
          )}
          <button onClick={() => setAbierto(true)} aria-expanded={abierto} aria-controls="menu-completo"
            className="h-11 rounded-lg bg-transparent ring-[1.5px] ring-inset ring-text px-6 text-xs font-semibold uppercase tracking-[0.18em] text-text transition hover:bg-black/5 active:scale-[0.97]">
            Menú
          </button>
        </div>
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
