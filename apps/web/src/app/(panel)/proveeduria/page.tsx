import Link from "next/link";
import { createClient, exigirModulo } from "@/lib/supabase/server";
import { infoCuenta, ordenCuenta } from "@/lib/paises";
import { haceCuanto } from "@/lib/formato";
import { TableroProveeduria, type DatosProveeduria } from "@/components/tablero-proveeduria";

// 🏭 Proveeduría: lo que nos compran las tiendas. Una empresa a la vez: aunque dos sean del mismo país, nunca se suman. Las cifras son los indicadores que Effi ya calcula,
// traídos cada 30 minutos (función proveeduria), para los periodos de abajo.
const PERIODOS = [
  { id: "hoy", label: "Hoy" }, { id: "ayer", label: "Ayer" }, { id: "7d", label: "Últimos 7 días" },
  { id: "mes", label: "Este mes" }, { id: "mes_ant", label: "Mes anterior" },
] as const;

export default async function ProveeduriaPage({ searchParams }: PageProps<"/proveeduria">) {
  await exigirModulo("proveeduria");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: cuentasData } = await supabase.from("effi_accounts").select("slug").eq("tipo", "proveeduria").eq("activa", true);
  const cuentas = (cuentasData ?? []).map((c) => c.slug as string).sort((a, b) => ordenCuenta(a) - ordenCuenta(b));
  const cuenta = typeof sp.c === "string" && cuentas.includes(sp.c) ? sp.c : cuentas[0];
  const periodo = PERIODOS.find((p) => p.id === sp.p)?.id ?? "mes";
  const { data } = cuenta ? await supabase.rpc("prov_tablero", { p_cuenta: cuenta, p_periodo: periodo }) : { data: null };
  const datos = (data ?? {}) as DatosProveeduria;
  const actualizado = datos.ventas?._actualizado ?? null;
  const href = (c: string, p: string) => `/proveeduria?c=${c}&p=${p}`;
  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${on ? "border-blue/50 bg-blue/15 text-text" : "border-line text-muted hover:text-text"}`;

  return (
    <div className="pt-8 space-y-4">
      <div>
        <h1 className="fu text-5xl sm:text-6xl lg:text-[5rem] font-light leading-[0.95] tracking-tight">Proveeduría</h1>
        <p className="text-sm text-muted mt-1.5">
          La proveeduría · lo que nos compran las tiendas, una empresa a la vez (nunca se suman). Cifras de Effi, actualizadas cada 30 min
          {actualizado ? ` · última ${haceCuanto(actualizado)}` : ""}.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {cuentas.map((c) => (
          <Link key={c} href={href(c, periodo)} className={chip(c === cuenta)}>{infoCuenta(c).bandera} {infoCuenta(c).nombre}</Link>
        ))}
        <div className="ml-auto inline-flex rounded-xl border border-line bg-white/[0.02] p-0.5 text-xs">
          {PERIODOS.map((p) => (
            <Link key={p.id} href={href(cuenta ?? "", p.id)}
              className={`rounded-lg px-3 py-1 font-semibold transition-colors ${p.id === periodo ? "bg-blue/25 text-text" : "text-muted hover:text-text"}`}>{p.label}</Link>
          ))}
        </div>
      </div>
      {!cuenta ? (
        <div className="card p-10 text-center text-sm text-muted">No tienes empresas de proveeduría asignadas.</div>
      ) : !datos.ventas ? (
        <div className="card p-10 text-center text-sm text-muted">Todavía no hay cifras de esta empresa: llegan de Effi en la próxima actualización (cada 30 min).</div>
      ) : (
        <TableroProveeduria cuenta={cuenta} datos={datos} />
      )}
    </div>
  );
}
