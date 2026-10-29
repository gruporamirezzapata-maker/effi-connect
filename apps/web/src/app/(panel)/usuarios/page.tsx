import { redirect } from "next/navigation";
import { createClient, getUsuario } from "@/lib/supabase/server";
import { primeraRuta } from "@/lib/modulos";
import { AdminUsuarios, type DatosAdmin } from "@/components/admin-usuarios";

// 👥 Usuarios y permisos (solo el dueño): link de registro, solicitudes por aprobar y usuarios con su acceso.
export default async function UsuariosPage() {
  const u = await getUsuario();
  if (!u) redirect("/login");
  if (u.rol !== "owner") redirect(primeraRuta(u));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("app_admin_lista");
  return (
    <>
      <div className="pt-8 mb-6">
        <h1 className="fu text-5xl sm:text-6xl lg:text-[5rem] font-light leading-[0.95] tracking-tight">Usuarios y permisos</h1>
        <p className="text-sm text-muted mt-1.5">
          Comparte el link de registro; cada persona queda pendiente hasta que tú le digas qué sociedad, tiendas y módulos puede ver.
        </p>
      </div>
      {error && <p className="text-sm text-red mb-4">{error.message}</p>}
      {data && <AdminUsuarios datos={data as DatosAdmin} yo={u.id} />}
    </>
  );
}
