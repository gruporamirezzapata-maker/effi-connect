import { createClient, exigirSocio } from "@/lib/supabase/server";
import { hoyBogota, leerFiltros, type Filtros } from "@/lib/filtros";
import { diaCorto, entero, haceCuanto, pct } from "@/lib/formato";
import { infoCuenta, ordenCuenta } from "@/lib/paises";
import { Encabezado } from "@/components/encabezado";
import { GastoPorDia } from "@/components/charts";
import { Kpi, Panel, TablaScroll, Vacio } from "@/components/ui";
import { TablaCuentasAds, type CuentaAds } from "@/components/publicidad-cuentas";
import { cop, enLocal, portafolio } from "@/components/publicidad-montos";
import { ExploradorAds, type AnuncioAds } from "@/components/publicidad-explorador";

// 📢 Publicidad: todo el gasto de Meta que tiene Effi Connect, por país, día, cuenta publicitaria y campaña. Casi todo llega
// por la API (meta-gasto, cada hora, un token por portafolio); lo que no, quedó de los CSV del BM. Meta cobra en COP;
// cada cifra va en pesos arriba y, debajo, en la moneda del país con la tasa del día del gasto (app_trm_dia):
// Guatemala en quetzales, Ecuador en dólares, Costa Rica en colones. Con un solo país sale el detalle por día con las tasas.
// Solo la ven el dueño y los socios (ni empleados ni proveedores).

type PorTienda = { cuenta: string; monto: number; local: number | null; sin_tasa: number; dias: number; ultimo: string; cuentas_ads: number };
type Campana = { campana: string; cuenta_ads: string; cuenta: string; monto: number; local: number | null; dias: number; ultimo: string };
type Dia = { fecha: string; cuenta: string; monto: number; local: number | null; usd_cop: number | null; usd_gtq: number | null; usd_crc: number | null };
type Conexion = {
  portafolios: { portafolio: string; cuentas: number; con_error: number; ultima_sync: string | null }[];
  cuentas_sin_gasto: { nombre: string; portafolio: string | null; estado: number | null; divisa: string | null }[];
  proxima: string;
};
type Resumen = {
  total: number; dias: number; ultimo_dia: string | null; por_tienda: PorTienda[]; por_dia: Dia[];
  por_cuenta_ads: CuentaAds[]; campanas: Campana[]; campanas_total: number; conexion: Conexion | null;
};

const COLOR: Record<string, string> = { CO: "#f5c542", EC: "#2f7bff", GT: "#36c5f0", CR: "#ff5a6a" };
// La publicidad de la sociedad empieza en julio de 2026: lo anterior no se cuenta.
const INICIO_PUBLICIDAD = "2026-07-01";

export default async function PublicidadPage({ searchParams }: PageProps<"/publicidad">) {
  await exigirSocio(); // solo dueño y socios
  const sp = await searchParams;
  const base = leerFiltros(sp);
  const lista = typeof sp.c === "string" ? sp.c.split(",").filter((x) => /^[A-Z0-9_]+$/.test(x)) : [];
  const desde = base.desde < INICIO_PUBLICIDAD ? INICIO_PUBLICIDAD : base.desde;
  const f: Filtros = { ...base, desde, hasta: base.hasta < desde ? desde : base.hasta, cuentas: lista.length ? lista : null };
  const hoy = hoyBogota();
  const hasta = f.hasta > hoy ? hoy : f.hasta;

  const supabase = await createClient();
  const [{ data, error }, { data: ads }] = await Promise.all([
    supabase.rpc("publicidad_resumen", { p_cuentas: f.cuentas, p_desde: f.desde, p_hasta: hasta }),
    supabase.rpc("publicidad_anuncios", { p_desde: f.desde, p_hasta: hasta }),
  ]);
  const anuncios = (ads as AnuncioAds[] | null) ?? [];
  const r = data as Resumen | null;
  const tiendas = [...(r?.por_tienda ?? [])].sort((a, b) => ordenCuenta(a.cuenta) - ordenCuenta(b.cuenta));
  const paises = tiendas.map((t) => ({ cuenta: t.cuenta, nombre: infoCuenta(t.cuenta).nombre, color: COLOR[infoCuenta(t.cuenta).pais] ?? "#7c6a66", divisa: infoCuenta(t.cuenta).divisa }));
  const conGasto = r?.por_dia.length ? new Set(r.por_dia.map((d) => d.fecha)).size : 0;
  const apiTotal = (r?.por_cuenta_ads ?? []).filter((c) => c.por_api).reduce((a, c) => a + Number(c.total), 0);
  // Un solo país en otra moneda: todo se muestra en esa moneda (con la TRM del día) y el COP queda de referencia.
  const unica = tiendas.length === 1 && infoCuenta(tiendas[0].cuenta).divisa !== "COP" ? tiendas[0].cuenta : null;
  const div = unica ? infoCuenta(unica).divisa : "COP";
  const totalLocal = unica ? Number(tiendas[0].local ?? 0) : null;
  // En el detalle por día, con centavos (es lo que se pasa al cuadro de datos).
  const exacto = (v: number | null | undefined) =>
    v == null ? "—" : new Intl.NumberFormat("es-CO", { style: "currency", currency: div, currencyDisplay: div === "USD" ? "symbol" : "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  return (
    <>
      <Encabezado
        titulo="📢 Publicidad"
        subtitulo="Gasto en Meta por país, día, cuenta publicitaria y campaña. Llega solo por la API de Meta cada hora (un token por portafolio); el país de entrega del anuncio decide la tienda. Meta cobra en pesos: cada cifra va en pesos y, debajo, en la moneda del país con la tasa del día del gasto."
        f={f}
        varios
        inicio={INICIO_PUBLICIDAD}
      />
      {error && <p className="text-sm text-red mb-4">{error.message}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Kpi
          etiqueta={unica ? `Gasto total · pesos y ${div}` : "Gasto total (COP)"}
          valor={unica ? <>{cop(r?.total)}<div className="text-base text-blue-2 mt-1">{enLocal(totalLocal, unica)}</div></> : cop(r?.total)}
          nota={`${entero(conGasto)} días con gasto · ${cop(conGasto ? Number(r?.total) / conGasto : 0)}${unica ? ` (${enLocal(conGasto && totalLocal != null ? totalLocal / conGasto : null, unica)})` : ""} por día`}
          acento
        />
        {tiendas.map((t) => (
          <Kpi
            key={t.cuenta}
            etiqueta={`${infoCuenta(t.cuenta).bandera} ${infoCuenta(t.cuenta).nombre}${infoCuenta(t.cuenta).divisa !== "COP" ? ` · ${infoCuenta(t.cuenta).divisa}` : ""}`}
            valor={infoCuenta(t.cuenta).divisa !== "COP" ? <>{cop(t.monto)}<div className="text-base text-blue-2 mt-1">{enLocal(t.local, t.cuenta)}</div></> : cop(t.monto)}
            nota={`${pct(Number(r?.total) ? t.monto / Number(r?.total) : 0)} del total · ${entero(t.cuentas_ads)} cuentas · hasta ${diaCorto(t.ultimo)}${t.sin_tasa ? ` · ${entero(t.sin_tasa)} días sin TRM` : ""}`}
          />
        ))}
      </div>

      <Panel titulo="Gasto por día" detalle={`Por país de entrega${r?.ultimo_dia ? ` · último día con gasto: ${diaCorto(r.ultimo_dia)}` : ""}`} className="mb-3">
        {r?.por_dia.length
          ? <GastoPorDia filas={r.por_dia} paises={paises} />
          : <Vacio>Sin gasto en este periodo.</Vacio>}
      </Panel>

      {unica && r?.por_dia.length ? (
        <Panel
          titulo={`Detalle por día en ${div}`}
          detalle={`Gasto de cada día pasado a ${div} con la tasa de ese día: pesos ÷ TRM (pesos por dólar, Banco de la República)${div === "GTQ" ? " × quetzales por dólar (Banguat)" : div === "CRC" ? " × colones por dólar (venta, publicada por Banguat)" : ""}`}
          className="mb-3"
        >
          <TablaScroll>
            <thead>
              <tr>
                <th>Día</th><th className="text-right">Gasto en pesos</th><th className="text-right">TRM (COP por USD)</th>
                {div !== "USD" && <th className="text-right">{div === "GTQ" ? "Q" : "₡"} por USD</th>}
                <th className="text-right">Gasto en {div}</th>
              </tr>
            </thead>
            <tbody>
              {r.por_dia.map((d) => (
                <tr key={d.fecha}>
                  <td>{diaCorto(d.fecha)}</td>
                  <td className="text-right num text-muted">{cop(d.monto)}</td>
                  <td className="text-right num text-muted">{d.usd_cop == null ? "—" : Number(d.usd_cop).toLocaleString("es-CO", { minimumFractionDigits: 2 })}</td>
                  {div !== "USD" && <td className="text-right num text-muted">{(div === "GTQ" ? d.usd_gtq : d.usd_crc) == null ? "—" : Number(div === "GTQ" ? d.usd_gtq : d.usd_crc).toLocaleString("es-CO", { minimumFractionDigits: div === "GTQ" ? 5 : 2 })}</td>}
                  <td className="text-right num font-semibold">{exacto(d.local)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>Total</td><td className="text-right num">{cop(r.total)}</td><td />{div !== "USD" && <td />}
                <td className="text-right num">{exacto(totalLocal)}</td>
              </tr>
            </tbody>
          </TablaScroll>
        </Panel>
      ) : null}

      {r?.conexion && (
        <Panel
          titulo="Conexión con Meta"
          detalle={`Solo tú ves esto. Se actualiza cada hora (minuto 20) con los últimos 3 días · próxima ${new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(new Date(r.conexion.proxima))}`}
          className="mb-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {r.conexion.portafolios.map((p) => (
              <div key={p.portafolio} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Portafolio {portafolio(p.portafolio)}</span>
                  <span className={`text-xs ${p.con_error ? "text-red" : "text-green"}`}>{p.con_error ? `${p.con_error} con error` : "● Conectado"}</span>
                </div>
                <div className="text-xs text-muted mt-1">{entero(p.cuentas)} cuentas publicitarias · actualizado {haceCuanto(p.ultima_sync)}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">
            {pct(Number(r.total) ? apiTotal / Number(r.total) : 0)} del gasto del periodo llegó por la API.
            {r.conexion.cuentas_sin_gasto.length > 0 && (
              <> Cuentas conectadas sin gasto en el periodo: {r.conexion.cuentas_sin_gasto.map((c) => c.nombre).join(", ")}.</>
            )}
          </p>
        </Panel>
      )}

      <Panel titulo="Cuentas publicitarias" detalle={`Gasto del periodo por cuenta y país: en pesos y, debajo, en la moneda de cada país${unica ? "" : " (el total suma países: solo pesos)"}`} className="mb-3">
        {r?.por_cuenta_ads.length ? (
          <TablaCuentasAds filas={r.por_cuenta_ads} tiendas={tiendas.map((t) => t.cuenta)} total={Number(r.total)} unica={unica} />
        ) : <Vacio>Sin gasto en este periodo.</Vacio>}
      </Panel>

      <Panel
        titulo="Campañas, conjuntos y anuncios"
        detalle="Como el Administrador de anuncios: escoge el nivel, filtra por cuenta, campaña o conjunto, o haz clic en una fila para ver su detalle. Se actualiza cada hora."
      >
        <ExploradorAds anuncios={anuncios} />
      </Panel>
    </>
  );
}
