// Se muestra al instante al cambiar de pestaña, mientras llegan los datos.
export default function Cargando() {
  return (
    <div className="pt-8 animate-pulse" aria-busy="true" aria-label="Cargando">
      <div className="h-10 w-64 rounded-xl bg-black/[0.06]" />
      <div className="h-4 w-96 max-w-full rounded-lg bg-black/[0.04] mt-3" />
      <div className="flex gap-2 mt-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-black/[0.04]" />
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mt-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card h-28" />
        ))}
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card h-64" />
        ))}
      </div>
    </div>
  );
}
