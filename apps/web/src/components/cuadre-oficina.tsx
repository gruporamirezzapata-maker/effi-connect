import { entero } from "@/lib/formato";
import { Panel, TablaScroll } from "./ui";

// Disponible en oficina como inventario: cuadre del día (inicio + llegaron − salidas = cierre). "Entregadas" =
// el cliente la recogió en la oficina (pasó a Entregada) y, por día de
// llegada, en qué terminaron esas guías, separando las contactadas de las que no. Datos de oficina_cuadre.

type DiaCuadre = { dia: string; inicio: number; llegaron: number; retiradas: number; devolucion: number; otro: number; cierre: number };
type DiaLlegada = {
  dia: string; llegaron: number; retiradas: number; devueltas: number; en_oficina: number; otro: number;
  contactadas: number; contactadas_retiradas: number; sin_contactar: number; sin_contactar_retiradas: number;
};
export type Cuadre = { cuadre: DiaCuadre[]; llegadas: DiaLlegada[] };

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const fecha = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}-${MESES[d.getUTCMonth()]}`; };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

// Franja de arriba: cómo cuadra hoy la oficina.
export function CuadreHoy({ c }: { c: Cuadre }) {
  const h = c.cuadre[0];
  if (!h) return null;
  const salieron = h.retiradas + h.devolucion + h.otro;
  const pasos = [
    { titulo: "Al empezar el día", valor: h.inicio, color: "var(--muted)", op: "" },
    { titulo: "Llegaron", valor: h.llegaron, color: "var(--blue-2)", op: "+" },
    { titulo: "Entregadas", valor: h.retiradas, color: "var(--green)", op: "−", ayuda: "El cliente la recogió: pasó de oficina a Entregada" },
    { titulo: "A devolución", valor: h.devolucion, color: "var(--red)", op: "−", ayuda: "Pasaron de oficina a Devolución" },
    { titulo: "Volvieron a tránsito", valor: h.otro, color: "var(--amber)", op: "−", ayuda: "Salieron de oficina a otro estado; casi siempre van camino a devolución" },
    { titulo: "En oficina ahora", valor: h.cierre, color: "var(--text)", op: "=" },
  ];
  return (
    <div className="card p-4 mb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <span className="font-display font-semibold">Hoy en la oficina</span>
        <span className="text-xs text-muted">
          Salieron {entero(salieron)} · {pct(h.retiradas, salieron)} entregadas
        </span>
      </div>
      <div className="flex flex-wrap items-stretch gap-2">
        {pasos.map((p) => (
          <div key={p.titulo} className="flex items-center gap-2 flex-1 min-w-[8.5rem]">
            {p.op && <span className="text-lg text-muted font-mono">{p.op}</span>}
            <div className={`flex-1 rounded-xl px-3 py-2.5 ${p.op === "=" ? "border border-line bg-black/[0.04]" : "bg-black/[0.02]"}`} title={p.ayuda}>
              <div className="text-[11px] uppercase tracking-wider font-mono text-muted whitespace-nowrap">{p.titulo}</div>
              <div className="num text-2xl font-semibold mt-0.5" style={{ color: p.color }}>{entero(p.valor)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Lo que pasó por la oficina en el periodo: de todas las guías que llegaron, cuántas se entregaron, cuántas se fueron a
// devolución y cuántas siguen allí. Es lo que sale de la lista de llamadas (la lista solo muestra las que siguen).
export function ResumenOficina({ c, dias }: { c: Cuadre; dias: number }) {
  const t = c.llegadas.reduce((a, d) => ({
    llegaron: a.llegaron + d.llegaron, retiradas: a.retiradas + d.retiradas, devueltas: a.devueltas + d.devueltas,
    otro: a.otro + d.otro, en_oficina: a.en_oficina + d.en_oficina,
  }), { llegaron: 0, retiradas: 0, devueltas: 0, otro: 0, en_oficina: 0 });
  const items = [
    { titulo: "Llegaron a oficina", valor: t.llegaron, color: "var(--blue-2)", sub: `últimos ${dias} días` },
    { titulo: "Entregadas", valor: t.retiradas, color: "var(--green)", sub: pct(t.retiradas, t.llegaron) },
    { titulo: "A devolución", valor: t.devueltas, color: "var(--red)", sub: pct(t.devueltas, t.llegaron) },
    { titulo: "Volvieron a tránsito", valor: t.otro, color: "var(--amber)", sub: pct(t.otro, t.llegaron) },
    { titulo: "Siguen en oficina", valor: t.en_oficina, color: "var(--text)", sub: pct(t.en_oficina, t.llegaron) },
  ];
  return (
    <div className="card p-4 mb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <span className="font-display font-semibold">Qué pasó con lo que llegó a oficina</span>
        <span className="text-xs text-muted">Las entregadas y las de devolución ya no aparecen en la lista para llamar</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {items.map((i) => (
          <div key={i.titulo} className="rounded-xl bg-black/[0.02] px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-wider font-mono text-muted">{i.titulo}</div>
            <div className="num text-2xl font-semibold mt-0.5" style={{ color: i.color }}>{entero(i.valor)}</div>
            <div className="text-[11px] text-muted">{i.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export type PorUsuario = {
  email: string; nombre: string; contactos: number; contactos_hoy: number; contactados: number; no_contesta: number; no_aplica: number;
  guias: number; gestiones: number; gestiones_hoy: number;
};
// Solo el dueño: quién marcó los contactos y las observaciones (gestiones), para repartir el trabajo y medirlo.
export function QuienHizoQue({ filas, dias }: { filas: PorUsuario[]; dias: number }) {
  const tot = filas.reduce((a, f) => ({ contactos: a.contactos + f.contactos, gestiones: a.gestiones + f.gestiones }), { contactos: 0, gestiones: 0 });
  return (
    <Panel titulo="👑 Quién hizo qué" detalle={`Solo lo ves tú · últimos ${dias} días: ${entero(tot.contactos)} contactos y ${entero(tot.gestiones)} gestiones`}>
      <TablaScroll>
        <thead>
          <tr>
            <th>Usuario</th><th className="text-right">Contactos</th><th className="text-right">Hoy</th><th className="text-right">Contactados</th>
            <th className="text-right">No contesta</th><th className="text-right">No aplica</th><th className="text-right">Guías trabajadas</th>
            <th className="text-right">Gestiones</th><th className="text-right">Gestiones hoy</th><th className="text-right">% de los contactos</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.email}>
              <td className="font-semibold" title={f.email}>{f.nombre}</td>
              <td className="text-right num">{entero(f.contactos)}</td>
              <td className="text-right num text-blue-2">{entero(f.contactos_hoy)}</td>
              <td className="text-right num text-green">{entero(f.contactados)} <span className="text-muted text-xs">{pct(f.contactados, f.contactos)}</span></td>
              <td className="text-right num text-red">{entero(f.no_contesta)}</td>
              <td className="text-right num">{entero(f.no_aplica)}</td>
              <td className="text-right num">{entero(f.guias)}</td>
              <td className="text-right num">{entero(f.gestiones)}</td>
              <td className="text-right num text-blue-2">{entero(f.gestiones_hoy)}</td>
              <td className="text-right num font-semibold">{pct(f.contactos, tot.contactos)}</td>
            </tr>
          ))}
          {!filas.length && <tr><td colSpan={10} className="text-center text-muted py-4">Nadie ha marcado contactos en este periodo.</td></tr>}
        </tbody>
      </TablaScroll>
    </Panel>
  );
}

// Tablas de abajo: cuadre de los últimos días y resultado por día de llegada (con el efecto del contacto).
export function CuadreTablas({ c }: { c: Cuadre }) {
  return (
    <div className="space-y-3 mt-6">
      <Panel titulo="Cuadre diario de la oficina" detalle="Inicio + llegaron − entregadas − a devolución − volvieron a tránsito = cierre. Según la hora en que Effi marcó cada cambio de estado.">
        <TablaScroll>
          <thead>
            <tr>
              <th>Día</th><th className="text-right">Inicio</th><th className="text-right">Llegaron</th>
              <th className="text-right">Entregadas</th><th className="text-right">A devolución</th><th className="text-right">Volvieron a tránsito</th>
              <th className="text-right">Cierre</th><th className="text-right">Cambio</th><th className="text-right">% entregadas de lo que salió</th>
            </tr>
          </thead>
          <tbody>
            {c.cuadre.map((d) => {
              const sal = d.retiradas + d.devolucion + d.otro, cambio = d.cierre - d.inicio;
              return (
                <tr key={d.dia}>
                  <td className="whitespace-nowrap">{fecha(d.dia)}</td>
                  <td className="text-right num text-muted">{entero(d.inicio)}</td>
                  <td className="text-right num text-blue-2">+{entero(d.llegaron)}</td>
                  <td className="text-right num text-green">−{entero(d.retiradas)}</td>
                  <td className="text-right num text-red">−{entero(d.devolucion)}</td>
                  <td className="text-right num text-amber">−{entero(d.otro)}</td>
                  <td className="text-right num font-semibold">{entero(d.cierre)}</td>
                  <td className={`text-right num text-xs ${cambio > 0 ? "text-amber" : "text-green"}`}>{cambio > 0 ? "▲ +" : cambio < 0 ? "▼ −" : ""}{cambio ? entero(Math.abs(cambio)) : "="}</td>
                  <td className="text-right num font-semibold">{pct(d.retiradas, sal)}</td>
                </tr>
              );
            })}
          </tbody>
        </TablaScroll>
        <p className="text-[11px] text-muted mt-2">▲ la oficina se está llenando (llegan más de las que salen); ▼ se está vaciando.</p>
      </Panel>

      <Panel titulo="Resultado por día de llegada" detalle="De las guías que llegaron a oficina cada día, en qué están hoy. Contactada = al menos un contacto marcado “Contactado” en este CRM.">
        <TablaScroll>
          <thead>
            <tr>
              <th>Llegaron el</th><th className="text-right">Guías</th><th className="text-right">Entregadas</th><th className="text-right">Devueltas</th>
              <th className="text-right">Volvieron a tránsito</th><th className="text-right">Siguen en oficina</th><th className="text-right">% entrega</th>
              <th className="text-right">Contactadas · % entrega</th><th className="text-right">Sin contactar · % entrega</th>
            </tr>
          </thead>
          <tbody>
            {c.llegadas.map((d) => {
              return (
                <tr key={d.dia}>
                  <td className="whitespace-nowrap">{fecha(d.dia)}</td>
                  <td className="text-right num font-semibold">{entero(d.llegaron)}</td>
                  <td className="text-right num text-green">{entero(d.retiradas)}</td>
                  <td className="text-right num text-red">{entero(d.devueltas)}</td>
                  <td className="text-right num text-amber">{entero(d.otro)}</td>
                  <td className="text-right num">{entero(d.en_oficina)}</td>
                  <td className="text-right num font-semibold">{pct(d.retiradas, d.llegaron)}</td>
                  <td className="text-right num">{d.contactadas ? <>{entero(d.contactadas)} · <span className="font-semibold text-green">{pct(d.contactadas_retiradas, d.contactadas)}</span></> : <span className="text-muted">—</span>}</td>
                  <td className="text-right num">{entero(d.sin_contactar)} · <span className="text-muted">{pct(d.sin_contactar_retiradas, d.sin_contactar)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </TablaScroll>
        <p className="text-[11px] text-muted mt-2">Las columnas de contactadas se llenan a medida que el equipo marca los contactos en esta pantalla. Comparando “Contactadas” contra “Sin contactar” se ve cuánto sube la entrega por llamar.</p>
      </Panel>
    </div>
  );
}
