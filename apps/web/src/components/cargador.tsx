"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readSheet } from "read-excel-file/browser";
import Papa from "papaparse";
import { FileUp, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { leerTabla, NOMBRE_TIPO, type Celda, type Lectura } from "@/lib/cargas";

type Item = {
  key: string;
  archivo: File;
  lectura?: Lectura;
  cuenta: string | null;
  error?: string;
  estado: "leido" | "subiendo" | "listo" | "error";
  avance: number;
  resultado?: string;
};

const BLOQUE = 1000;
const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

async function leerArchivo(f: File): Promise<Lectura> {
  if (/\.csv$/i.test(f.name)) {
    const txt = (await f.text()).replace(/^﻿/, "");
    const { data } = Papa.parse<Celda[]>(txt, { skipEmptyLines: true });
    return leerTabla(data);
  }
  if (/\.xlsx$/i.test(f.name)) return leerTabla((await readSheet(f)) as Celda[][]);
  throw new Error("Solo se aceptan archivos .csv o .xlsx de Meta Ads.");
}

export function Cargador() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);

  const cambiar = (key: string, cambio: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...cambio } : x)));

  async function agregar(lista: FileList | File[]) {
    const nuevos = await Promise.all(
      [...lista].map(async (archivo): Promise<Item> => {
        const key = `${archivo.name}-${archivo.size}-${archivo.lastModified}`;
        try {
          const lectura = await leerArchivo(archivo);
          return { key, archivo, lectura, cuenta: lectura.cuenta, estado: "leido", avance: 0 };
        } catch (e) {
          return { key, archivo, cuenta: null, error: (e as Error).message, estado: "error", avance: 0 };
        }
      }),
    );
    setItems((xs) => [...xs.filter((x) => !nuevos.some((n) => n.key === x.key)), ...nuevos]);
  }

  async function guardar() {
    setSubiendo(true);
    const supabase = createClient();
    // Del archivo más viejo al más nuevo: si dos archivos traen el mismo dato, queda el más reciente.
    const cola = items.filter((x) => x.estado === "leido" && x.lectura).sort((a, b) => a.archivo.lastModified - b.archivo.lastModified);
    for (const it of cola) {
      const l = it.lectura!;
      cambiar(it.key, { estado: "subiendo", avance: 0 });
      try {
        let carga: number | null = null;
        let filas = 0, omitidas = 0;
        const resumen = { desde: l.desde, hasta: l.hasta, totales: l.totales };
        for (let i = 0; i < l.filas.length || (i === 0 && !l.filas.length); i += BLOQUE) {
          const { data, error } = await supabase.rpc("app_cargar", {
            p_tipo: l.tipo, p_cuenta: null, p_archivo: it.archivo.name,
            p_filas: l.filas.slice(i, i + BLOQUE), p_carga: carga, p_resumen: resumen,
          });
          if (error) throw new Error(error.message);
          const r = data as { carga: number; filas: number; omitidas: number };
          carga = r.carga; filas += r.filas; omitidas += r.omitidas;
          cambiar(it.key, { avance: Math.min(1, (i + BLOQUE) / Math.max(1, l.filas.length)) });
          if (!l.filas.length) break;
        }
        cambiar(it.key, { estado: "listo", avance: 1, resultado: `${nf.format(filas)} filas guardadas${omitidas ? ` · ${nf.format(omitidas)} sin tienda` : ""}` });
      } catch (e) {
        cambiar(it.key, { estado: "error", error: (e as Error).message });
      }
    }
    setSubiendo(false);
    router.refresh();
  }

  const pendientes = items.filter((x) => x.estado === "leido").length;

  return (
    <div className="space-y-3">
      <label
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastrando(false); agregar(e.dataTransfer.files); }}
        className={`card flex flex-col items-center justify-center gap-2 p-8 text-center cursor-pointer border-dashed transition-colors ${arrastrando ? "border-blue bg-blue/10" : "hover:bg-black/[0.03]"}`}
      >
        <FileUp className="size-7 text-blue-2" aria-hidden />
        <div className="font-semibold">Arrastra aquí los archivos o haz clic para elegirlos</div>
        <div className="text-xs text-muted max-w-xl">
          Meta Ads: el CSV de cada Business Manager con país, cuenta, campaña, día y monto gastado en COP. Puedes subir varios a la vez.
        </div>
        <input id="archivos-carga" ref={input} type="file" multiple accept=".xlsx,.csv" className="sr-only"
          onChange={(e) => { if (e.target.files) agregar(e.target.files); e.target.value = ""; }} />
      </label>

      {items.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest font-mono text-muted">
                <th className="p-3">Archivo</th><th className="p-3">Tipo</th><th className="p-3">Tienda</th>
                <th className="p-3">Fechas</th><th className="p-3">Contenido</th><th className="p-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((it) => {
                const l = it.lectura;
                return (
                  <tr key={it.key} className="align-top">
                    <td className="p-3 max-w-[16rem] truncate" title={it.archivo.name}>{it.archivo.name}</td>
                    <td className="p-3 whitespace-nowrap">{l ? NOMBRE_TIPO[l.tipo] : "—"}</td>
                    <td className="p-3">
                      {l ? <span className="text-muted">Según el país de cada fila</span> : null}
                    </td>
                    <td className="p-3 whitespace-nowrap font-mono text-xs">{l?.desde ? `${l.desde} → ${l.hasta}` : "—"}</td>
                    <td className="p-3 text-xs text-muted">
                      {l?.totales.map((t) => <div key={t.etiqueta}>{t.etiqueta}: <span className="text-text font-mono">{nf.format(t.valor)}</span></div>)}
                      {l?.avisos.map((a) => <div key={a} className="text-amber">{a}</div>)}
                    </td>
                    <td className="p-3 text-xs whitespace-nowrap">
                      {it.estado === "leido" && <span className="text-muted">Listo para guardar</span>}
                      {it.estado === "subiendo" && <span className="inline-flex items-center gap-1 text-blue-2"><Loader2 className="size-3 animate-spin" />{Math.round(it.avance * 100)}%</span>}
                      {it.estado === "listo" && <span className="text-green">✓ {it.resultado}</span>}
                      {it.estado === "error" && <span className="text-red whitespace-normal">{it.error}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-3 border-t border-line p-3">
            <button type="button" onClick={() => setItems([])} disabled={subiendo} className="text-sm text-muted hover:text-text">Limpiar lista</button>
            <button type="button" onClick={guardar} disabled={subiendo || !pendientes}
              className="rounded-xl bg-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {subiendo ? "Guardando…" : `Guardar ${pendientes} archivo${pendientes === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
