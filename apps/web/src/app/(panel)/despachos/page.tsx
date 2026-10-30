import { Suspense } from "react";
import { exigirModulo } from "@/lib/supabase/server";
import { DespachosApp, type DatosDespachos } from "@/components/despachos";

// 📦 Despachos: guías pendientes por despachar, por proveedor, con el reporte en Excel del formato de siempre,
// la imagen para WhatsApp y la revisión de Inter Rapidísimo. Los datos los arma n8n (Effi + Inter) y se piden desde el
// servidor: la dirección con su clave vive solo en la variable DESPACHOS_URL de Vercel, nunca en el navegador.
export const dynamic = "force-dynamic";

async function traer(): Promise<{ datos: DatosDespachos | null; error: string | null }> {
  const url = process.env.DESPACHOS_URL;
  if (!url) return { datos: null, error: "Falta configurar DESPACHOS_URL en Vercel." };
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
    const d = (await r.json().catch(() => null)) as DatosDespachos | null;
    if (!d || d.ok !== true) return { datos: null, error: "El servidor de despachos no respondió bien. Intenta de nuevo." };
    return { datos: d, error: null };
  } catch {
    return { datos: null, error: "Effi se demoró demasiado. Intenta de nuevo en un momento." };
  }
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
