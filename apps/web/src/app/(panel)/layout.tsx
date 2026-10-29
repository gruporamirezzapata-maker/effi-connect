import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient, getUsuario } from "@/lib/supabase/server";
import { haceCuanto } from "@/lib/formato";
import { Sidebar } from "@/components/sidebar";
import { SinAcceso } from "@/components/sin-acceso";
import { AgenteFlotante } from "@/components/agente-flotante";
import { tieneModulo } from "@/lib/modulos";

export default async function PanelLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  // En paralelo: quién es el usuario, cuándo fue el último sync y las sociedades que puede ver.
  const [usuario, { data: ultimo }, { data: cuentas }, { data: lista }] = await Promise.all([
    getUsuario(),
    supabase.rpc("app_ultimo_sync"),
    supabase.from("effi_accounts").select("sociedad,tipo"),
    supabase.from("app_sociedades").select("nombre").order("orden"),
  ]);
  if (!usuario) redirect("/login");
  // Recién registrado (espera aprobación), rechazado o desactivado: no entra al panel.
  if (usuario.rol === "pendiente" || usuario.rol === "rechazado" || !usuario.activo) {
    return <SinAcceso motivo={usuario.rol === "pendiente" ? "pendiente" : "sin_acceso"} nombre={usuario.nombre} email={usuario.email} />;
  }
  const sociedades = [...new Set((cuentas ?? []).map((c) => c.sociedad as string))];
  const sociedad = sociedades.join(" · ") || "Sin tiendas asignadas";
  // El dueño escoge qué sociedad mira (todas o una sociedad); los demás ven solo la suya.
  const esOwner = usuario.rol === "owner";
  const [{ data: yo }, { count: porAceptar }] = esOwner
    ? await Promise.all([
      supabase.from("app_usuarios").select("sociedad_vista").eq("user_id", usuario.id).maybeSingle(),
      // Registros nuevos que esperan que el dueño los acepte (se avisan en "Solo para ti").
      supabase.from("app_usuarios").select("user_id", { count: "exact", head: true }).eq("rol", "pendiente"),
    ])
    : [{ data: null }, { count: 0 }];
  const opciones = esOwner ? (lista ?? []).map((x) => x.nombre as string) : null;

  return (
    <div className="min-h-dvh">
      <Suspense>
        <Sidebar acceso={usuario} email={usuario.email} sociedad={sociedad} ultimoSync={haceCuanto(ultimo as string | null)}
          sociedades={opciones} vista={(yo?.sociedad_vista as string | null) ?? null} porAceptar={porAceptar ?? 0}
          conProveeduria={(cuentas ?? []).some((c) => c.tipo === "proveeduria")}
          soloProveeduria={!!cuentas?.length && cuentas.every((c) => c.tipo === "proveeduria")} />
      </Suspense>
      {tieneModulo(usuario, "automatizacion") && <AgenteFlotante esOwner={esOwner} />}
      <main className="min-w-0 px-4 sm:px-8 lg:px-16 pt-24 pb-20 max-w-[1600px]">{children}</main>
    </div>
  );
}
