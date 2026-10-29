import { dinero } from "@/lib/formato";
import { infoCuenta } from "@/lib/paises";

// Montos de 📢 Publicidad: pesos (lo que cobra Meta) arriba y, debajo, la moneda del país (lo que se sube a Datos).
// El dólar va como "US$" para no confundirlo con los pesos ("$"). Colombia: solo pesos.
export const cop = (v: unknown, compacto = false) => dinero(v, "TIENDA_CO", compacto);
export const enLocal = (v: number | null | undefined, cuenta: string) =>
  v == null ? "sin TRM" : infoCuenta(cuenta).divisa === "USD"
    ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", currencyDisplay: "symbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
    : dinero(v, cuenta);

export function Doble({ local, enCop, cuenta, fuerte = false }: { local: number | null | undefined; enCop: number | null | undefined; cuenta: string; fuerte?: boolean }) {
  if (infoCuenta(cuenta).divisa === "COP") return <span className={fuerte ? "font-semibold" : undefined}>{cop(enCop)}</span>;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={fuerte ? "font-semibold" : undefined}>{cop(enCop)}</span>
      <span className="text-[11px] text-blue-2">{enLocal(local, cuenta)}</span>
    </span>
  );
}

// "meta_access_token" → Kora Basicos, "meta_access_token_zapi" → Zapi Corp 1; otros: el sufijo con mayúscula.
const PORTAFOLIOS: Record<string, string> = { "": "Kora Basicos", zapi: "Zapi Corp 1" };
export const portafolio = (t: string | null) => {
  if (!t) return "—";
  const s = t.replace(/^meta_access_token_?/, "");
  return PORTAFOLIOS[s] ?? s[0].toUpperCase() + s.slice(1);
};
