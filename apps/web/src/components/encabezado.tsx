import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { hoyBogota, rangosRapidos, type Filtros } from "@/lib/filtros";
import { ordenCuenta } from "@/lib/paises";
import { FiltrosBar } from "./filtros-bar";

// Quita el emoji del inicio del título: el estilo de la marca usa títulos limpios.
const sinEmoji = (t: string) => t.replace(/^[^\p{L}\p{N}]+/u, "").trim() || t;

// Título de la pantalla + filtros de país y calendario (solo muestra las cuentas que el usuario puede ver).
// tipos: qué cuentas salen en la barra (los módulos de tiendas solo tiendas; Datos también la proveeduría).
// inicio: primer día que se puede elegir en el calendario (por defecto el inicio de los datos).
export async function Encabezado({ titulo, subtitulo, f, conFechas = true, varios = false, tipos = ["tienda"], inicio }: {
  titulo: string; subtitulo: string; f: Filtros; conFechas?: boolean; varios?: boolean; tipos?: string[]; inicio?: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase.from("effi_accounts").select("slug").eq("activa", true).in("tipo", tipos).order("slug");
  const cuentas = (data ?? []).map((c) => c.slug as string).sort((a, b) => ordenCuenta(a) - ordenCuenta(b));
  const hoy = hoyBogota();
  return (
    <div className="pt-6 sm:pt-10 mb-8 space-y-6">
      <div>
        <p className="fu text-[11px] uppercase tracking-[0.25em] text-muted/70 mb-5" style={{ animationDelay: "0.05s" }}>Effi Connect · Grupo RZ</p>
        <h1 className="fu text-5xl sm:text-6xl lg:text-[5rem] font-light leading-[0.95] tracking-tight" style={{ animationDelay: "0.2s" }}>{sinEmoji(titulo)}</h1>
        <p className="fu text-base text-muted mt-5 max-w-3xl" style={{ animationDelay: "0.4s" }}>{subtitulo}</p>
      </div>
      <div className="h-px bg-white/10" />
      <Suspense>
        <FiltrosBar cuentas={cuentas} rangos={rangosRapidos(hoy, inicio)} hoy={hoy} minimo={inicio} desde={f.desde} hasta={f.hasta} seleccion={f.cuentas} conFechas={conFechas} varios={varios} />
      </Suspense>
    </div>
  );
}
