"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entero } from "@/lib/formato";
import { OBSERVACIONES, type CodigoObs } from "@/lib/oficina";
import { infoCuenta } from "@/lib/paises";
import { rangosRapidos, sumarDias } from "@/lib/filtros";
import { SelectorFechas, etiquetaRango } from "./selector-fechas";
import { Panel, TablaScroll } from "./ui";

// Estadística del CRM de oficina: qué dicen los clientes, por hora de la llamada y por número de intento (el
// resultado por día de llegada está en cuadre-oficina). Sirve para decidir a qué hora llamar y cuántas veces vale la pena insistir.
// Con calendario tipo Shopify (hoy, ayer, 7 días, el mes o cualquier rango), en el día local del país; arranca en los
// últimos 14 días.

type Dia = {
  dia: string; llegaron: number; llamadas: number; guias_llamadas: number; contesto: number; no_contesto: number; telefono_malo: number;
  entregadas: number; devueltas: number; en_oficina: number; llamadas_entregadas: number; llamadas_total: number; sin_llamar_entregadas: number; sin_llamar_total: number;
};
type Grupo = { llamadas: number; contesto: number; entregadas: number; guias: number };
type Obs = { codigo: CodigoObs; guias: number; entregadas: number; devueltas: number; en_oficina: number; con_fecha: number; cumplieron: number };
export type Estadisticas = { desde?: string; hasta?: string; dias: Dia[]; horas: (Grupo & { hora: number })[]; intentos: (Grupo & { intento: number })[]; observaciones: Obs[] };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export function EstadisticasOficina({ e: inicial, cuenta }: { e: Estadisticas; cuenta: string }) {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: infoCuenta(cuenta).zona }).format(new Date());
  const rangos = [
    ...rangosRapidos(hoy).filter((r) => ["hoy", "ayer", "7d"].includes(r.id)),
    { id: "14d", label: "Últimos 14 días", d: sumarDias(hoy, -13), h: hoy },
    ...rangosRapidos(hoy).filter((r) => ["mes", "mes-ant"].includes(r.id)),
  ];
  const [e, setE] = useState(inicial);
  const [rango, setRango] = useState({ d: inicial.desde ?? sumarDias(hoy, -13), h: inicial.hasta ?? hoy });
  const [cargando, setCargando] = useState(false);
  async function aplicar(d: string, h: string) {
    setRango({ d, h }); setCargando(true);
    const { data } = await createClient().rpc("oficina_estadisticas", { p_cuenta: cuenta, p_desde: d, p_hasta: h });
    setCargando(false);
    if (data) setE(data as Estadisticas);
  }
  const atajo = rangos.find((r) => r.d === rango.d && r.h === rango.h);
  const periodo = atajo ? atajo.label.toLowerCase() : etiquetaRango(rango.d, rango.h);
  const maxHora = Math.max(1, ...e.horas.map((h) => h.llamadas));
  return (
    <div className={`space-y-3 mt-6 transition-opacity ${cargando ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Estadística de llamadas y observaciones</h2>
        <div className="flex items-center gap-2">
          {cargando && <span className="text-xs text-muted">Actualizando…</span>}
          <SelectorFechas desde={rango.d} hasta={rango.h} rangos={rangos} hoy={hoy} onAplicar={aplicar} />
        </div>
      </div>
      <Panel titulo="¿Qué dicen los clientes?" detalle={`Observaciones puestas ${atajo?.id === "hoy" || atajo?.id === "ayer" ? periodo : `en ${periodo}`} y en qué terminaron esas guías (estado actual)`}>
        {e.observaciones?.length ? (
          <TablaScroll>
            <thead>
              <tr>
                <th>Observación</th><th className="text-right">Guías</th><th className="text-right">Entregadas</th><th className="text-right">Devueltas</th>
                <th className="text-right">Siguen en oficina</th><th className="text-right">Cumplieron la fecha</th>
              </tr>
            </thead>
            <tbody>
              {e.observaciones.map((o) => (
                <tr key={o.codigo}>
                  <td>
                    <span className="inline-block size-2 rounded-full mr-2" style={{ background: OBSERVACIONES[o.codigo]?.color }} />
                    {OBSERVACIONES[o.codigo]?.label ?? o.codigo}
                  </td>
                  <td className="text-right num">{entero(o.guias)}</td>
                  <td className="text-right num text-green">{entero(o.entregadas)} <span className="text-muted">· {pct(o.entregadas, o.guias)}</span></td>
                  <td className="text-right num text-red">{entero(o.devueltas)} <span className="text-muted">· {pct(o.devueltas, o.guias)}</span></td>
                  <td className="text-right num">{entero(o.en_oficina)}</td>
                  <td className="text-right num" title="Recogió a más tardar un día después de la fecha que prometió">
                    {o.con_fecha ? <>{entero(o.cumplieron)} de {entero(o.con_fecha)} <span className="text-muted">· {pct(o.cumplieron, o.con_fecha)}</span></> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </TablaScroll>
        ) : <p className="text-sm text-muted">No hay observaciones en este periodo.</p>}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel titulo="Mejor hora para contactar" detalle={`Contactos por hora local (${periodo}), % contactado y % de esas guías que terminó entregada`}>
          {e.horas.length ? (
            <div className="space-y-1.5">
              {e.horas.map((h) => (
                <div key={h.hora} className="grid grid-cols-[3.5rem_1fr_4.5rem_4.5rem] items-center gap-2 text-xs">
                  <span className="font-mono text-muted">{String(h.hora).padStart(2, "0")}:00</span>
                  <div className="h-2.5 rounded-full bg-black/[0.05] overflow-hidden">
                    <div className="h-full rounded-full bg-blue" style={{ width: `${(h.llamadas / maxHora) * 100}%` }} />
                  </div>
                  <span className="text-right text-green" title="Contactado">{pct(h.contesto, h.llamadas)} ✅</span>
                  <span className="text-right" title="Entregadas">{pct(h.entregadas, h.guias)} 📦</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted">No hay contactos en este periodo.</p>}
        </Panel>
        <Panel titulo="¿Cuántas veces insistir?" detalle={`Resultado de cada llamada (${periodo}): contacto 1, 2 y 3`}>
          {e.intentos.length ? (
            <TablaScroll>
              <thead><tr><th>Contacto</th><th className="text-right">Contactos</th><th className="text-right">% contactado</th><th className="text-right">% entregadas</th></tr></thead>
              <tbody>
                {e.intentos.map((i) => (
                  <tr key={i.intento}>
                    <td>Contacto {i.intento}</td>
                    <td className="text-right num">{entero(i.llamadas)}</td>
                    <td className="text-right num text-green">{pct(i.contesto, i.llamadas)}</td>
                    <td className="text-right num">{pct(i.entregadas, i.guias)}</td>
                  </tr>
                ))}
              </tbody>
            </TablaScroll>
          ) : <p className="text-sm text-muted">No hay contactos en este periodo.</p>}
        </Panel>
      </div>
    </div>
  );
}
