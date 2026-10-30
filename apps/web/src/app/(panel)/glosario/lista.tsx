"use client";

import { useState } from "react";

type Termino = { c: string; t: string; d: string; f: string; w: string };

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function GlosarioLista({ terminos }: { terminos: Termino[] }) {
  const [q, setQ] = useState("");
  const filtrados = q ? terminos.filter((t) => norm(`${t.t} ${t.d} ${t.f} ${t.w}`).includes(norm(q))) : terminos;
  const categorias = [...new Set(filtrados.map((t) => t.c))];
  return (
    <>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar: despachado, fulfillment, TRM…"
        className="mt-5 w-full max-w-md rounded-xl bg-panel-2 border border-line px-3.5 py-2.5 text-sm outline-none focus:border-blue/60 focus:ring-2 focus:ring-blue/20"
      />
      {categorias.length === 0 && <p className="text-sm text-muted mt-6">Ningún término coincide con “{q}”.</p>}
      <div className="mt-6 space-y-6">
        {categorias.map((c) => (
          <section key={c}>
            <h2 className="font-display text-lg font-semibold mb-3">{c}</h2>
            <div className="grid md:grid-cols-2 gap-3">
              {filtrados.filter((t) => t.c === c).map((t) => (
                <article key={t.t} className="card p-4">
                  <h3 className="font-medium">{t.t}</h3>
                  <p className="text-sm text-text/85 mt-1.5 leading-relaxed">{t.d}</p>
                  {t.f && (
                    <p className="text-xs mt-3 rounded-lg bg-black/[0.03] border border-line px-3 py-2">
                      <span className="text-muted">Cómo se calcula: </span>
                      {t.f}
                    </p>
                  )}
                  {t.w && <p className="text-[11px] text-muted mt-2">Aparece en: {t.w}</p>}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
