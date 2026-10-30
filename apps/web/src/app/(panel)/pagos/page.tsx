import { createClient, exigirSocio } from "@/lib/supabase/server";
import { PagosVerificar, type Pago } from "@/components/pagos-verificar";

// 💸 Pagos por verificar: pedidos que Shopify marca "pagado" (checkout con Bold) antes de que la plata llegue de verdad.
// n8n los registra y no despacha ninguno sin recaudo hasta que aquí se confirme que llegó la plata.
// Solo el dueño y los socios.
export const dynamic = "force-dynamic";

export default async function PagosPage() {
  await exigirSocio();
  const supabase = await createClient();
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: pendientes, error: e1 }, { data: decididos, error: e2 }] = await Promise.all([
    supabase.from("pagos_por_verificar").select("*").eq("estado", "pendiente").order("creado", { ascending: true }),
    supabase.from("pagos_por_verificar").select("*").neq("estado", "pendiente").gte("creado", hace30)
      .order("decidido_en", { ascending: false }).limit(100),
  ]);
  const error = e1 || e2 ? "No se pudieron leer los pagos. Si es la primera vez, falta correr la migración en Supabase." : null;

  return (
    <>
      <div className="pt-6 sm:pt-10 mb-8 space-y-6">
        <div>
          <p className="fu text-[11px] uppercase tracking-[0.25em] text-muted/70 mb-5" style={{ animationDelay: "0.05s" }}>Effi Connect · Grupo RZ</p>
          <h1 className="fu text-5xl sm:text-6xl lg:text-[5rem] font-light leading-[0.95] tracking-tight" style={{ animationDelay: "0.2s" }}>
            Pagos<br />por verificar
          </h1>
          <p className="fu text-base text-muted mt-5 max-w-3xl" style={{ animationDelay: "0.4s" }}>
            Pedidos que Shopify marca como pagados. Revisa en Bold o en el banco si la plata llegó: solo los que confirmes
            salen sin recaudo. Los que no confirmes no se despachan.
          </p>
        </div>
        <div className="h-px bg-black/10" />
      </div>
      <PagosVerificar pendientes={(pendientes ?? []) as Pago[]} decididos={(decididos ?? []) as Pago[]} error={error} />
    </>
  );
}
