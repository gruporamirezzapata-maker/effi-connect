"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, ShieldCheck, UserPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { haceCuanto } from "@/lib/formato";
import { infoCuenta } from "@/lib/paises";
import { MODULOS, ROLES, type Rol } from "@/lib/modulos";

// Administración de usuarios (solo el dueño). Flujo:
// 1. La persona abre el link /registro y deja nombre, cédula, correo y clave → queda "pendiente" sin ver nada.
// 2. Aquí el dueño la aprueba como Socio (toda(s) su(s) sociedad(es)), Empleado (tiendas + módulos) o Proveeduría
//    (cuentas de proveeduría + módulos), o la rechaza.
// 3. Después puede editar su acceso o desactivarla. Las confirmaciones van en la misma pantalla (el navegador de la
//    app bloquea las ventanas de confirmación).

type Permiso = { cuenta: string; modulos: string[] };
type UsuarioAdmin = {
  user_id: string; email: string; nombre: string | null; cedula: string | null; rol: Rol; activo: boolean; sociedades: string[];
  creado_en: string; aprobado_por: string | null; aprobado_en: string | null; ultimo_ingreso: string | null; permisos: Permiso[];
};
type Cuenta = { slug: string; nombre: string; tipo: "tienda" | "proveeduria"; pais: string; sociedad: string };
type Sociedad = { nombre: string; tipo: "tiendas" | "proveeduria" };
export type DatosAdmin = { usuarios: UsuarioAdmin[]; cuentas: Cuenta[]; sociedades: Sociedad[] };
type RolAprobado = "socio" | "empleado" | "proveedor";

const ETIQUETA_ROL: Record<Rol, { texto: string; color: string }> = {
  owner: { texto: "Dueño", color: "var(--blue-2)" },
  socio: { texto: "Socio", color: "#b48cff" },
  empleado: { texto: "Empleado", color: "var(--green)" },
  proveedor: { texto: "Proveeduría", color: "var(--amber)" },
  pendiente: { texto: "Pendiente", color: "var(--amber)" },
  rechazado: { texto: "Rechazado", color: "var(--red)" },
};
const bandera = (slug: string) => infoCuenta(slug)?.bandera ?? "🏳️";

export function AdminUsuarios({ datos, yo }: { datos: DatosAdmin; yo: string }) {
  const router = useRouter();
  const [link, setLink] = useState("/registro");
  const [copiado, setCopiado] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [verManual, setVerManual] = useState(false);
  useEffect(() => setLink(`${window.location.origin}/registro`), []);

  const pendientes = datos.usuarios.filter((u) => u.rol === "pendiente");
  const resto = datos.usuarios.filter((u) => u.rol !== "pendiente");
  const copiar = async () => {
    try { await navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch { /* sin portapapeles */ }
  };

  return (
    <div className="space-y-4">
      {/* Link para compartir */}
      <div className="card p-5 flex flex-wrap items-center gap-4" style={{ background: "linear-gradient(90deg, rgb(47 123 255 / 0.10), transparent)" }}>
        <div className="flex size-11 items-center justify-center rounded-xl bg-blue/15 text-blue-2"><Link2 size={20} /></div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Link de registro</div>
          <div className="text-xs text-muted">Envíalo por WhatsApp o correo a socios, empleados o proveeduría. Se registran con nombre, cédula, correo y clave.</div>
          <div className="mt-2 font-mono text-sm text-blue-2 break-all">{link}</div>
        </div>
        <button onClick={copiar} className="inline-flex items-center gap-2 rounded-full border border-blue/50 bg-blue/15 px-4 py-2 text-sm font-semibold hover:bg-blue/25">
          {copiado ? <Check size={16} /> : <Copy size={16} />} {copiado ? "Copiado" : "Copiar link"}
        </button>
      </div>

      {/* Manual corto */}
      <div className="card p-4">
        <button onClick={() => setVerManual(!verManual)} className="flex w-full items-center justify-between text-left">
          <span className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-green" /> Cómo funcionan los usuarios y roles</span>
          <span className="text-xs text-muted">{verManual ? "Ocultar" : "Ver"}</span>
        </button>
        {verManual && <Manual />}
      </div>

      {/* Solicitudes */}
      <section className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <UserPlus size={18} className="text-amber" />
          <span className="font-display text-lg font-semibold">Solicitudes por aprobar</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pendientes.length ? "bg-amber/15 text-amber" : "bg-black/5 text-muted"}`}>{pendientes.length}</span>
        </div>
        {pendientes.length ? (
          <div className="space-y-3">
            {pendientes.map((u) => (
              <div key={u.user_id} className="rounded-2xl border border-amber/30 bg-amber/[0.04] p-4">
                <Persona u={u} />
                <Editor u={u} cuentas={datos.cuentas} sociedades={datos.sociedades} nuevo onListo={() => router.refresh()} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No hay solicitudes nuevas. Cuando alguien se registre con el link, aparece aquí.</p>
        )}
      </section>

      {/* Usuarios */}
      <section className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users size={18} className="text-blue-2" />
          <span className="font-display text-lg font-semibold">Usuarios</span>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-muted">{resto.length}</span>
        </div>
        <div className="divide-y divide-line">
          {resto.map((u) => (
            <div key={u.user_id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Persona u={u} />
                <div className="flex flex-wrap items-center gap-2">
                  {u.user_id !== yo && u.rol !== "owner" && (
                    <>
                      <button onClick={() => setEditando(editando === u.user_id ? null : u.user_id)}
                        className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted hover:text-text">
                        {editando === u.user_id ? "Cerrar" : u.rol === "rechazado" ? "Aprobar" : "Editar acceso"}
                      </button>
                      {u.rol !== "rechazado" && <BotonActivo u={u} onListo={() => router.refresh()} />}
                    </>
                  )}
                </div>
              </div>
              <Acceso u={u} cuentas={datos.cuentas} />
              {editando === u.user_id && (
                <Editor u={u} cuentas={datos.cuentas} sociedades={datos.sociedades} onListo={() => { setEditando(null); router.refresh(); }} />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Persona({ u }: { u: UsuarioAdmin }) {
  const r = ETIQUETA_ROL[u.rol];
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{u.nombre ?? u.email}</span>
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: r.color, background: "rgba(17,17,17,.06)" }}>{r.texto}</span>
        {!u.activo && <span className="rounded-full bg-red/15 px-2 py-0.5 text-[11px] font-semibold text-red">Desactivado</span>}
      </div>
      <div className="mt-0.5 text-xs text-muted">
        {u.email}{u.cedula ? ` · CC ${u.cedula}` : ""} · se registró {haceCuanto(u.creado_en)}
        {u.ultimo_ingreso ? ` · último ingreso ${haceCuanto(u.ultimo_ingreso)}` : " · nunca ha entrado"}
      </div>
    </div>
  );
}

// Resumen del acceso actual: sociedades (socio) o tiendas + módulos (empleado / proveeduría).
function Acceso({ u, cuentas }: { u: UsuarioAdmin; cuentas: Cuenta[] }) {
  if (u.rol === "owner") return <div className="mt-1.5 text-xs text-muted">Ve todo y administra los usuarios.</div>;
  if (u.rol === "socio") {
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
        {u.sociedades.map((s) => (
          <span key={s} className="rounded-full border border-line px-2 py-0.5">
            {s} · {cuentas.filter((c) => c.sociedad === s).map((c) => bandera(c.slug)).join(" ") || "sin tiendas conectadas"}
          </span>
        ))}
        <span className="text-muted">· todos los módulos</span>
      </div>
    );
  }
  if (!u.permisos.length) return null;
  const mods = [...new Set(u.permisos.flatMap((p) => p.modulos))];
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      {u.permisos.map((p) => <span key={p.cuenta} className="rounded-full border border-line px-2 py-0.5">{bandera(p.cuenta)} {cuentas.find((c) => c.slug === p.cuenta)?.nombre ?? p.cuenta}</span>)}
      <span className="text-muted">· {mods.map((m) => MODULOS.find((x) => x.id === m)?.nombre ?? m).join(", ")}</span>
    </div>
  );
}

// Aprobar o editar: rol, sociedades (socio) o cuentas + módulos (empleado y proveeduría).
function Editor({ u, cuentas, sociedades: listaSociedades, nuevo = false, onListo }: {
  u: UsuarioAdmin; cuentas: Cuenta[]; sociedades: Sociedad[]; nuevo?: boolean; onListo: () => void;
}) {
  const inicialRol: RolAprobado = u.rol === "socio" || u.rol === "proveedor" ? u.rol : "empleado";
  const [rol, setRol] = useState<RolAprobado>(inicialRol);
  const [sociedades, setSociedades] = useState<string[]>(u.sociedades ?? []);
  const [sel, setSel] = useState<string[]>(u.permisos.map((p) => p.cuenta));
  const [modulos, setModulos] = useState<string[]>([...new Set(u.permisos.flatMap((p) => p.modulos))]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [rechazar, setRechazar] = useState(false);

  const tipo = rol === "proveedor" ? "proveeduria" : "tienda";
  const porSociedad = useMemo(() => {
    const m = new Map<string, Cuenta[]>();
    for (const c of cuentas.filter((x) => x.tipo === tipo)) m.set(c.sociedad, [...(m.get(c.sociedad) ?? []), c]);
    return [...m.entries()];
  }, [cuentas, tipo]);
  const todasSociedades = listaSociedades.filter((s) => s.tipo === "tiendas").map((s) => s.nombre);
  const alternar = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

  async function guardar() {
    setGuardando(true); setError(null);
    const { error: e } = await createClient().rpc("app_admin_guardar", {
      p_user_id: u.user_id, p_rol: rol, p_sociedades: rol === "socio" ? sociedades : [],
      p_cuentas: rol === "socio" ? [] : sel.filter((s) => cuentas.find((c) => c.slug === s)?.tipo === tipo), p_modulos: rol === "socio" ? [] : modulos,
    });
    setGuardando(false);
    if (e) setError(e.message); else onListo();
  }
  async function hacerRechazo() {
    setGuardando(true); setError(null);
    const { error: e } = await createClient().rpc("app_admin_rechazar", { p_user_id: u.user_id });
    setGuardando(false);
    if (e) setError(e.message); else onListo();
  }

  const chip = (on: boolean) =>
    `rounded-xl border px-3 py-2 text-left text-xs transition-colors ${on ? "border-blue bg-blue/25 text-text ring-2 ring-blue/40" : "border-line text-muted opacity-70 hover:opacity-100 hover:text-text"}`;
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-black/[0.02] p-3">
      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-widest font-mono text-muted">1. Rol</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(ROLES) as RolAprobado[]).map((r) => (
            <button key={r} type="button" onClick={() => setRol(r)} className={chip(rol === r)}>
              <div className="font-semibold text-sm">{ROLES[r].nombre}</div>
              <div className="mt-0.5">{ROLES[r].detalle}</div>
            </button>
          ))}
        </div>
      </div>

      {rol === "socio" ? (
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-widest font-mono text-muted">2. Sociedad(es)</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {todasSociedades.map((s) => (
              <button key={s} type="button" onClick={() => setSociedades(alternar(sociedades, s))} className={chip(sociedades.includes(s))}>
                <div className="font-semibold text-sm">{sociedades.includes(s) ? "✓ " : ""}{s}</div>
                <div className="mt-0.5">{cuentas.filter((c) => c.sociedad === s && c.tipo === "tienda").map((c) => `${bandera(c.slug)} ${c.nombre}`).join(" · ") || "Tiendas aún sin conectar a Effi Connect"}</div>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted">Ve todos los módulos de esas tiendas, y las tiendas que se conecten después a su sociedad.</p>
        </div>
      ) : (
        <>
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest font-mono text-muted">2. {rol === "proveedor" ? "Cuentas de proveeduría" : "Tiendas"}</div>
            {porSociedad.length ? porSociedad.map(([soc, cs]) => (
              <div key={soc} className="mb-2">
                <div className="mb-1 text-xs text-muted">{soc}</div>
                <div className="flex flex-wrap gap-2">
                  {cs.map((c) => (
                    <button key={c.slug} type="button" onClick={() => setSel(alternar(sel, c.slug))} className={chip(sel.includes(c.slug))}>
                      {sel.includes(c.slug) ? "✓ " : ""}{bandera(c.slug)} {c.nombre}
                    </button>
                  ))}
                </div>
              </div>
            )) : <p className="text-xs text-amber">Todavía no hay cuentas de {rol === "proveedor" ? "la proveeduría" : "tiendas"} conectadas a Effi Connect.</p>}
          </div>
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest font-mono text-muted">3. Módulos que puede ver</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {MODULOS.map((m) => (
                <button key={m.id} type="button" onClick={() => setModulos(alternar(modulos, m.id))} className={chip(modulos.includes(m.id))}>
                  <div className="font-semibold">{modulos.includes(m.id) ? "✓ " : ""}{m.nombre}</div>
                  <div className="mt-0.5">{m.detalle}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {error && <p className="text-sm text-red">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={guardar} disabled={guardando} className="rounded-full bg-green px-5 py-2 text-sm font-bold text-black disabled:opacity-60">
          {nuevo ? "Aprobar y dar acceso" : "Guardar acceso"}
        </button>
        {nuevo && (rechazar ? (
          <>
            <span className="text-xs text-muted">¿Rechazar esta solicitud?</span>
            <button onClick={hacerRechazo} disabled={guardando} className="rounded-full bg-red px-4 py-2 text-sm font-bold text-white">Sí, rechazar</button>
            <button onClick={() => setRechazar(false)} className="rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-text">No</button>
          </>
        ) : (
          <button onClick={() => setRechazar(true)} className="rounded-full border border-red/40 px-4 py-2 text-sm font-semibold text-red hover:bg-red/10">Rechazar</button>
        ))}
      </div>
    </div>
  );
}

function BotonActivo({ u, onListo }: { u: UsuarioAdmin; onListo: () => void }) {
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cambiar() {
    const { error: e } = await createClient().rpc("app_admin_activo", { p_user_id: u.user_id, p_activo: !u.activo });
    setConfirmar(false);
    if (e) setError(e.message); else onListo();
  }
  if (confirmar) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        {u.activo ? "¿Quitarle el acceso?" : "¿Devolverle el acceso?"}
        <button onClick={cambiar} className={`rounded-full px-3 py-1 font-bold ${u.activo ? "bg-red text-white" : "bg-green text-black"}`}>Sí</button>
        <button onClick={() => setConfirmar(false)} className="rounded-full border border-line px-3 py-1 text-muted">No</button>
      </span>
    );
  }
  return (
    <>
      <button onClick={() => setConfirmar(true)}
        className={`rounded-full border px-3 py-1 text-xs font-semibold ${u.activo ? "border-red/40 text-red hover:bg-red/10" : "border-green/40 text-green hover:bg-green/10"}`}>
        {u.activo ? "Desactivar" : "Activar"}
      </button>
      {error && <span className="text-xs text-red">{error}</span>}
    </>
  );
}

function Manual() {
  return (
    <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
      <div className="space-y-2">
        <div className="font-semibold">Paso a paso</div>
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>Copia el <b className="text-text">link de registro</b> y envíaselo a la persona.</li>
          <li>Ella se registra con <b className="text-text">nombre, cédula, correo y clave</b>. Queda pendiente y no ve nada.</li>
          <li>Su solicitud aparece aquí en <b className="text-text">Solicitudes por aprobar</b>.</li>
          <li>Eliges el <b className="text-text">rol</b> y lo que puede ver, y pulsas <b className="text-text">Aprobar y dar acceso</b>.</li>
          <li>La persona entra con su correo y clave y solo ve lo que le diste. Puedes cambiarlo o desactivarla cuando quieras.</li>
        </ol>
      </div>
      <div className="space-y-2">
        <div className="font-semibold">Roles</div>
        <ul className="space-y-1 text-muted">
          <li><b className="text-text">Dueño (tú):</b> ve todas las sociedades, la proveeduría y administra usuarios, cargas y el Agente.</li>
          <li><b className="text-text">Socio:</b> entra a su sociedad completa (todas sus tiendas y todos los módulos). Si se conecta una tienda nueva de su sociedad, la ve sola.</li>
          <li><b className="text-text">Empleado:</b> solo las tiendas y los módulos que marques (por ejemplo, Disponible en oficina de Colombia).</li>
          <li><b className="text-text">Proveeduría:</b> solo las cuentas de proveeduría que marques, con sus módulos.</li>
        </ul>
        <p className="text-xs text-muted">Los países nunca se mezclan: cada persona solo ve los países de las tiendas que tiene asignadas.</p>
      </div>
    </div>
  );
}
