import { createClient, exigirModulo } from "@/lib/supabase/server";
import { ordenCuenta } from "@/lib/paises";
import { EnVivo } from "@/components/en-vivo";

// ⚡ En vivo: la operación de todas las tiendas (o de una) latiendo con cada cambio de estado. La proveeduría
// también: sus ventas a las tiendas, las guías y los cambios de estado de esas guías.
export default async function EnVivoPage() {
  await exigirModulo("guias");
  const supabase = await createClient();
  const [{ data }, { data: soc }] = await Promise.all([
    supabase.from("effi_accounts").select("slug,sociedad,tipo").eq("activa", true).in("tipo", ["tienda", "proveeduria"]),
    supabase.from("app_sociedades").select("nombre,logo"),
  ]);
  // Un país sin movimiento (ni órdenes ni guías en 30 días, p. ej. Costa Rica conectada pero quieta) no sale hasta
  // que tenga el primero.
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const conMovimiento = await Promise.all((data ?? []).map(async (c) => {
    const [g, o] = await Promise.all([
      supabase.from("effi_guias").select("id").eq("cuenta", c.slug).gte("fecha_trans", hace30).limit(1),
      supabase.from("auto_ordenes").select("id").eq("cuenta", c.slug).gte("fecha_orden", hace30).limit(1),
    ]);
    return (g.data?.length ?? 0) + (o.data?.length ?? 0) > 0;
  }));
  const cuentas = (data ?? []).filter((_, i) => conMovimiento[i])
    .map((c) => c.slug as string).sort((a, b) => ordenCuenta(a) - ordenCuenta(b));
  // Logo al centro solo si todo lo que se ve es de una sola sociedad y esa sociedad tiene logo.
  const sociedades = [...new Set((data ?? []).map((c) => c.sociedad as string))];
  const logo = sociedades.length === 1 ? ((soc ?? []).find((x) => x.nombre === sociedades[0])?.logo as string | null) ?? null : null;
  return (
    <div className="pt-8">
      <div className="mb-5">
        <h1 className="fu text-5xl sm:text-6xl lg:text-[5rem] font-light leading-[0.95] tracking-tight">En vivo</h1>
        <p className="text-sm text-muted mt-1.5">
          Toda la operación palpitando: cada cambio de estado viaja del país a su estado. Elige todas las tiendas o una sola.
        </p>
      </div>
      {/* key: al cambiar de sociedad, En vivo arranca de nuevo con las cuentas de esa sociedad. */}
      <EnVivo key={cuentas.join(",")} cuentas={cuentas} logo={logo} />
    </div>
  );
}
