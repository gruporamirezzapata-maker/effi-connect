const FUENTE = {
  effi: { label: "Effi · API en vivo", color: "var(--green)", texto: "Los datos ya llegan en vivo; falta armar la pantalla." },
  archivo: { label: "Archivos (Meta)", color: "var(--amber)", texto: "Sin API: se alimenta subiendo los archivos de Meta Ads." },
  manual: { label: "Lo que escribes tú", color: "var(--blue-2)", texto: "Datos que hoy mantienes a mano; se pasan a la base y se editan aquí." },
} as const;

export function Proximamente({ titulo, emoji, fuentes, secciones }: { titulo: string; emoji: string; fuentes: (keyof typeof FUENTE)[]; secciones: string[] }) {
  return (
    <div className="pt-6 sm:pt-10" data-emoji={emoji}>
      <h1 className="fu text-5xl sm:text-6xl lg:text-[5rem] font-light leading-[0.95] tracking-tight">
        {titulo}
      </h1>
      <p className="text-sm text-muted mt-1.5">Pestaña en construcción</p>
      <div className="grid md:grid-cols-2 gap-3 mt-6">
        <section className="card p-5">
          <h2 className="font-display font-semibold">Secciones (como en tu dashboard)</h2>
          <ul className="mt-3 space-y-2">
            {secciones.map((s) => (
              <li key={s} className="flex items-center gap-2 text-sm">
                <span className="size-1.5 rounded-full bg-blue-2" />
                {s}
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="font-display font-semibold">De dónde salen los datos</h2>
          <div className="mt-3 space-y-3">
            {fuentes.map((f) => (
              <div key={f} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="size-2 rounded-full" style={{ background: FUENTE[f].color }} />
                  {FUENTE[f].label}
                </div>
                <p className="text-xs text-muted mt-1">{FUENTE[f].texto}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
