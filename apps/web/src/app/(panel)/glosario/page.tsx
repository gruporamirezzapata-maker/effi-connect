import glosario from "@/lib/glosario.json";
import { GlosarioLista } from "./lista";

// Definiciones de los términos del tablero (lib/glosario.json).
export default function GlosarioPage() {
  return (
    <div className="pt-8">
      <h1 className="fu text-5xl sm:text-6xl lg:text-[5rem] font-light leading-[0.95] tracking-tight">Glosario</h1>
      <p className="text-sm text-muted mt-1.5">Qué significa cada término, cómo se calcula y dónde aparece. Las definiciones que usa el tablero.</p>
      <GlosarioLista terminos={glosario as { c: string; t: string; d: string; f: string; w: string }[]} />
    </div>
  );
}
