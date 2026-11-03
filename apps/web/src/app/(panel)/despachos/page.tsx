import { Suspense } from "react";
import { createClient, exigirModulo } from "@/lib/supabase/server";
import { DespachosApp, type DatosDespachos } from "@/components/despachos";

// 📦 Despachos: guías pendientes por despachar, por proveedor, con el reporte en Excel del formato de siempre,
// la imagen para WhatsApp y la revisión de Inter Rapidísimo. El flujo principal de n8n arma la lista cada 30 min
// (7:00–20:30) y la guarda en Supabase (despachos_snapshot). Aquí solo se lee con la sesión del usuario:
// abrir la página no consulta Effi ni n8n, y no hay clave en ningún enlace.
export const dynamic = "force-dynamic";

async function traer(): Promise<{ datos: DatosDespachos | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("despachos_snapshot").select("generado_en, datos").eq("id", 1).maybeSingle();
  if (error) return { datos: null, error: "No se pudo leer la lista de despachos. Intenta de nuevo en un momento." };
  if (!data) return { datos: null, error: "Todavía no hay datos de despachos: se generan cada 30 min entre 7:00 a. m. y 8:30 p. m." };
  const d = (data.datos ?? {}) as DatosDespachos;
  const gen = new Date(data.generado_en as string);
  const ms = Math.max(0, Date.now() - gen.getTime());
  const extra = Math.floor(ms / 3_600_000);
  return {
    datos: {
      ...d,
      ok: true,
      hoy: new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }),
      generado: gen.toLocaleString("sv-SE", { timeZone: "America/Bogota" }).slice(0, 16),
      minutos_desde_generado: Math.floor(ms / 60_000),
      guias: (d.guias ?? []).map((g) => ({ ...g, horas: (g.horas ?? 0) + extra })),
    },
    error: null,
  };
}

async function Contenido() {
  const { datos, error } = await traer();
  return <DespachosApp datos={datos} error={error} />;
}

export default async function DespachosPage() {
  await exigirModulo("guias");
  return (
    <>
      <div className="pt-6 sm:pt-10 mb-8 space-y-6">
        <div>
          <p className="fu text-[11px] uppercase tracking-[0.25em] text-muted/70 mb-5" style={{ animationDelay: "0.05s" }}>Effi Connect · Grupo RZ</p>
          <h1 className="fu text-5xl sm:text-6xl lg:text-[5rem] font-light leading-[0.95] tracking-tight" style={{ animationDelay: "0.2s" }}>
            Despachos<br />del día
          </h1>
          <p className="fu text-base text-muted mt-5 max-w-3xl" style={{ animationDelay: "0.4s" }}>
            Guías pendientes por despachar de los últimos 30 días, por proveedor. El reporte de siempre, sin descargar nada de Effi, con la revisión de Inter cruzada.
          </p>
        </div>
        <div className="h-px bg-black/10" />
      </div>
      <Suspense fallback={<Cargando />}>
        <Contenido />
      </Suspense>
    </>
  );
}

function Cargando() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Cargando despachos">
      <p className="text-sm text-muted mb-4">Leyendo Effi… (tarda unos segundos)</p>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="card h-40" />
        <div className="card h-40" />
      </div>
      <div className="card h-72 mt-3" />
    </div>
  );
}
