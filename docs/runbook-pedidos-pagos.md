# Runbook — Pedidos, pagos y despachos (Grupo Ramírez Zapata SAS)

**Versión:** 2.1 · **Fecha:** 3 nov 2026 (bloques 1–4 ejecutados; ver §10) · **Dueño:** Cristian
**Estados usados en este documento:** `HECHO` = existe y funciona · `PENDIENTE` = definido, falta ejecutar · `PROPUESTO` = diseño nuevo, requiere aprobación de Cristian antes de tocar producción.
**Historia del proyecto:** ver Anexo A (bitácora 30 oct – 3 nov 2026). Este runbook no cuenta historia; describe el estado actual y cómo operarlo.

> Ninguna clave ni token está en este documento. La sección 3 dice dónde vive cada uno y quién lo rota.

---

## 0. Léeme antes de tocar (para personas y para IA)

1. Cuenta de n8n vigente: `gruporamirezzapata.app.n8n.cloud`, proyecto `UQ2ETAAZptyCHNBc`. La cuenta `sebas777.app.n8n.cloud` está **retirada**: no se entra, no se exporta, no se reactiva.
2. Base de datos: Supabase proyecto `aqnmrtuvqahxozvongjj`. Es la única fuente de verdad de estado.
3. Panel: `effi-connect-five.vercel.app` (repo `gruporamirezzapata-maker/effi-connect`). Es el único frontend. La app de GitHub Pages `gruporamirezzapata-maker/despachos` ya solo redirige al panel (§5.4).
4. **Nada crea remisiones ni guías en Effi automáticamente.** El flujo principal está en fase sombra (§7). Pasar a vivo requiere cumplir §7.3 y aprobación escrita de Cristian.
5. Cambios en funciones SQL de Supabase (`pago_registrar`, `bold_registrar`, `pagos_cruzar_bold`): se proponen como migración en `supabase/migrations/`, se revisan, y solo después se aplican. Nunca se editan a mano en el SQL Editor.
6. Las claves las pega Cristian directamente en Bold, n8n, Supabase Vault, Vercel o GitHub Secrets. No se piden ni se leen en un chat.
7. `fecha_trans` de Effi llega en **UTC**. Siempre se lee con `'Z'`. Todas las horas al usuario se muestran en `America/Bogota`.
8. Effi devuelve 429 con consultas seguidas: mínimo 0,7 s entre consultas de detalle y 1,2 s entre páginas, con 3 reintentos.
9. Cualquier flujo nuevo en n8n lleva Error Workflow (§6.2) desde el primer día.
10. Antes de declarar algo "en producción", debe tener al menos un caso real verificado y anotado en §10.

---

## 1. Qué hace el sistema y qué no

**Hace**
- Detecta pedidos de Zenit y Noara con pago anticipado y los retiene en la página **Pagos por verificar** hasta que alguien marque "Llegó la plata" o Bold lo confirme solo.
- Confirma automáticamente pagos de Bold cuando el cruce es inequívoco (§4).
- Muestra en **Despachos** las guías generadas y no recogidas, con proveedor, antigüedad, artículos y estado real de Inter.
- Verifica cada mañana el estado real de las guías de Inter contra la página pública de Inter.
- Propone (en sombra) qué remisión y guía debería crearse por cada pedido, para compararlo con lo que hace Estefanía a mano.

**No hace (todavía)**
- No crea remisiones ni guías en Effi.
- No confirma transferencias ni pagos por WhatsApp: siguen siendo manuales.
- No avisa al cliente ni a la transportadora.

**Aclaración obligatoria sobre la "sombra":** la corrida en sombra **sí escribe** en `pagos_por_verificar` (vía `pago_registrar`) y esa tabla alimenta la página que el equipo usa para decidir qué despachar. La sombra es sombra respecto a Effi, no respecto a Supabase. Un bug en la lectura de pedidos se ve en producción (ya pasó: Anexo A, error 6).

---

## 2. Arquitectura

### 2.1 Diagrama (estado objetivo v2.0; las piezas `PROPUESTO` se marcan con *)

```
Shopify Zenit ──┐                    Bold (pasarela) ──webhook──► n8n: bold-pagos ──► Supabase: bold_registrar
Shopify Noara ──┼──► Effi (órdenes, remisiones, guías)                                  │ verifica firma (Vault)
Lucid (Zenit) ──┘        ▲                                                              │ cruza → pagos_por_verificar
                         │ (fase sombra: solo lectura)
n8n cuenta nueva ────────┤
  ├─ [Cycs1zhh2BcMM505] Principal, cada 30 min 7:00–20:30
  │     ├─ caché + Zenit + Noara ──► Hoja Google (propuesta sombra)
  │     ├─ ──────────────────────► Supabase: pago_registrar
  │     └─ ──────────────────────► Supabase: despachos_snapshot (JSON de guías)
  ├─ [EX41gmvXSrv8euib] Bold → Pagos por verificar
  ├─ [0LsTVI6qRbHKpt2Y] Inter ◄── GitHub Actions 6:30 lun–sáb ──► Supabase: inter_estado_real
  ├─ [BrdYkSbNT9QfAKaz] Sombra – aciertos diarios 6:50 ──► Supabase: sombra_aciertos
  ├─ [FweTmZa2lKdQwNkM] Resumen 7:17 lun–sáb ──► correo
  └─ [IAuRn9DH8wLBiUDs] Error Workflow ──► correo a Cristian en cualquier fallo

Supabase aqnmrtuvqahxozvongjj
  ├─ pagos_por_verificar, bold_pagos
  ├─ despachos_snapshot, inter_estado_real, sombra_aciertos (+ vista sombra_resumen), * config
  └─ Vault: bold_llave_secreta

Effi Connect (Vercel effi-connect-five.vercel.app)
  ├─ /pagos      → pagos_por_verificar
  └─ /despachos  → lectura directa de despachos_snapshot (sesión del usuario, sin n8n ni clave k)
```

### 2.2 Componentes

| Componente | Identificador | Disparador | Estado |
|---|---|---|---|
| Flujo principal Zenit + Noara (sombra) | n8n `Cycs1zhh2BcMM505` | Cron `0,30 7-20 * * *` America/Bogota (última corrida 20:30) | HECHO · v3.2 (3 nov): espera 12 h, redondeo con descuento de línea, token Zenit en caché, rama snapshot |
| Bold → Pagos por verificar | n8n `EX41gmvXSrv8euib` | Webhook `/webhook/bold-pagos` (GET, POST, HEAD) | HECHO, no validado con pago real posterior al webhook nuevo |
| Inter – estado real | n8n `0LsTVI6qRbHKpt2Y` | Webhooks `inter-pendientes` (GET), `inter-resultado` (POST), token en `x-token` | HECHO |
| Verificador Inter | GitHub `gruporamirezzapata-maker/verificador-inter`, Actions `30 11 * * 1-6` UTC | 6:30 Bogotá lun–sáb | HECHO, corrida #7 y ejecuciones 15–16 exitosas |
| Despachos – datos | ~~n8n `Rfprd6antlxGCtmr`~~ | — | RETIRADO 3 nov (archivado); el panel lee `despachos_snapshot` |
| Panel Effi Connect | Vercel proyecto `effi-connect`, Production | — | HECHO (`/despachos` mostró 234 guías) |
| App GitHub Pages | `gruporamirezzapata-maker/despachos` | — | RETIRADA 3 nov: `index.html` redirige al panel |
| Estado real Inter | Supabase `inter_estado_real` (`inter_estado_guardar` / `inter_estado_leer`) | Flujo Inter | HECHO 3 nov; la Data Table vieja `ih43WH9mjiJiDrAi` queda sin uso (borrar) |
| Sombra – aciertos diarios | n8n `BrdYkSbNT9QfAKaz` | Cron `50 6 * * *` | HECHO 3 nov |
| Resumen 7:17 | n8n `FweTmZa2lKdQwNkM` | Cron `17 7 * * 1-6` | HECHO 3 nov (publicado; criterio de 6 días en curso) |
| Error Workflow | n8n `IAuRn9DH8wLBiUDs` | Error de cualquier flujo de producción | HECHO 3 nov, probado 2 veces |

### 2.3 Decisiones de arquitectura (y por qué)

| Decisión | Razón | Revisar cuando |
|---|---|---|
| Bold sigue pasando por n8n | n8n solo hace pasamanos; `bold_registrar` hace todo. Migrar a Edge Function de Supabase es ~1 día; no se justifica sin medir volumen | Plan de n8n ≤ 2.500 ejecuciones/mes, o una sola falla de cuota más, o > 50 pagos Bold/día |
| Despachos lee un snapshot, no Effi | Cada apertura costaba N consultas a Effi + 1 ejecución; colisionaba con el cron | Nunca volver a consultar Effi desde una página |
| Todo el estado en Supabase | n8n ya se perdió una vez con todo lo que tenía | — |
| Un solo frontend (panel) | Dos despliegues, dos secretos, misma respuesta | — |
| Sombra sale por criterio, no por fecha | Lo que se automatiza crea guías reales con costo de envío | — |

---

## 3. Inventario de secretos y rotación

### 3.1 Inventario

| Secreto | Dónde vive | Quién rota | Vence | Qué rompe al rotar | Estado |
|---|---|---|---|---|---|
| Token Header Auth de Effi | n8n cred `0gyvx4xZ2BFkASvk` | Cristian (en Effi) | No vence | Flujos principal, Despachos, Inter | **Copia viva en `sebas777`** → rotar |
| Clave service de Supabase | n8n cred `YhIThxEezibM3keU`; Vercel (panel) | Cristian (Supabase → Settings → API) | No vence | Flujos principal y Bold; panel | **Copia viva en `sebas777`** → rotar |
| Credencial Google Sheets | n8n cred `Hu5dgihmmp254tqx` | Cristian (Google Cloud) | No vence | Hoja sombra | **Copia viva en `sebas777`** → rotar |
| App Shopify Zenit "n8n despachos" (`client_id`/`client_secret`) | n8n cred `HD45u743wkgTIyAg` | Cristian (Dev Dashboard) | Token derivado dura 24 h | Lectura de pedidos Zenit | OK, solo en cuenta nueva |
| Auth Shopify Noara | **No aplica.** La rama Noara no consulta Shopify: lee órdenes, productos y guías de Effi, y el medio de pago de la nota de la orden. Las credenciales "Shopify account" y "Shopify Access Token account" no las usa ningún flujo | — | — | — | HECHO 3 nov (documentado) |
| Llave secreta del webhook de Bold | Supabase Vault `bold_llave_secreta` | Cristian (Bold → Integraciones) | No vence; cambia si se recrea el webhook | Confirmación automática | Validar con primer pago real |
| `N8N_TOKEN` (Inter) | GitHub Secrets de `verificador-inter`; nodo webhook en n8n | Cristian | No vence | Verificador Inter | OK |
| Clave `k` de Despachos | — | — | — | — | ELIMINADA 3 nov (el panel lee Supabase con la sesión). Borrar la variable `DESPACHOS_URL` de Vercel |
| Clave legacy JWT `service_role` de Supabase | Edge functions (`SUPABASE_SERVICE_ROLE_KEY`, 11 funciones) | Cristian | Supabase la retira a inicios de 2027 | Edge functions | **Abierto:** sigue viva; migrar las funciones a la clave nueva `sb_secret_` y desactivarla |

### 3.2 Procedimiento de rotación de las copias en `sebas777` (EJECUTADO 3 nov; quedan cabos en §10-1)

Orden: **Effi → Supabase → Google → Bold viejo**. Hacer en horario sin corridas (antes de 7:00 o después de 20:30) o pausar `Cycs1zhh2BcMM505` durante 15 min.

1. Effi: generar token nuevo en Effi → actualizar cred `0gyvx4xZ2BFkASvk` en n8n → ejecutar manualmente `Rfprd6antlxGCtmr` (debe devolver `ok: true` con guías) → invalidar el token viejo en Effi.
2. Supabase: en Settings → API regenerar la service key → actualizar cred `YhIThxEezibM3keU` y la variable del panel en Vercel → redeploy → abrir `/pagos` (debe cargar) → la clave vieja queda inválida al regenerar.
3. Google: en Google Cloud revocar el cliente OAuth usado por `sebas777` → reconectar `Hu5dgihmmp254tqx` → ejecutar manualmente el flujo principal y ver que escribe en la hoja.
4. Bold: en Bold → Integraciones → webhooks, eliminar cualquier URL que contenga `sebas777`. Confirmar que queda solo `https://gruporamirezzapata.app.n8n.cloud/webhook/bold-pagos`.
5. Claude.ai: quitar el conector "n8n" viejo; dejar solo "n8n Grupo RZ".

**Criterio de aceptación:** las 4 credenciales de la cuenta nueva responden en una ejecución manual exitosa de cada flujo, y no existe ninguna URL `sebas777` en Bold ni en GitHub Secrets.

---

## 4. Pagos por verificar y confirmación automática de Bold

### 4.1 Reglas por medio de pago (HECHO)

| Medio | Regla |
|---|---|
| Contraentrega | No entra a Pagos por verificar |
| Addi y Sistecrédito por la página | Pasan directo, sin aprobación manual |
| Bold | Se confirma solo si el cruce es inequívoco (§4.2); si no, espera revisión manual |
| Transferencia / pago por WhatsApp | Manual: "Llegó la plata" / "No ha llegado" |

### 4.2 Flujo de Bold (HECHO)

1. Bold envía `SALE_APPROVED` o `VOID_APPROVED` al webhook `bold-pagos`.
2. n8n pasa el cuerpo exacto (base64) y la firma `x-bold-signature` a `bold_registrar`. n8n no verifica nada.
3. `bold_registrar` verifica HMAC-SHA256 contra `bold_llave_secreta` del Vault.
   - Firma inválida → no guarda nada, responde `firma_invalida`.
   - Firma con llave vacía → evento de prueba de Bold: se guarda como `prueba`, nunca confirma.
4. Guarda en `bold_pagos` y ejecuta `pagos_cruzar_bold()`.

Reglas de cruce vigentes:
1. **Por referencia** (coincide con pedido/orden/id Shopify o Lucid) y valor ±$1 → confirma.
2. **Por valor y hora**: valor ±$1, pasarela Bold o Lucid, pedido dentro de ±3 h del pago; confirma solo si hay **exactamente 1 pedido** candidato y **exactamente 1 pago Bold** de ese valor en ±6 h.
3. Duda → sigue pendiente. Esto es intencional.
4. Al confirmar: `estado='llego'`, `decidido_por='Bold (automático)'`, nota `Bold <id> · medio · correo · pagó dd/mm HH:MM`.
5. Anulación de un pago auto-confirmado → vuelve a pendiente con nota "Bold anuló el pago …".
6. Solo revisa pagos de los últimos 4 días.

### 4.3 Parche al cruce (HECHO 3 nov: migración `20261104120000_bold_cruce_v2.sql`, aplicada)

Lo que quedó, con lo que cambió frente al plan original:
- (a) Regla 1 mira todos los estados: si la referencia apunta a un pedido ya decidido, el pago se "consume" y no confirma otro. Regla 2 cuenta candidatos de todos los estados y solo confirma si el único candidato está pendiente. El bug de v1 (un pago asignado al pedido equivocado) se reprodujo y quedó corregido; prueba en bloque `DO` con 3 casos, revertida.
- (b) Idempotencia **por `(payment_id, tipo)`**, no por id de evento: el `id` de Bold cambia en cada reenvío, así que el índice único propuesto no deduplicaba nada. `bold_evento_id` se guarda solo para trazabilidad; `bold_registrar` responde `duplicado`.
- (c) **Bold no tiene evento de reembolso** en el webhook (solo venta y anulación, aprobadas o rechazadas). La anulación de un pedido confirmado a mano agrega nota ⚠. La columna `alerta` no se creó: no hay señal de "despachado" en Supabase con la cual decidirla. Reembolsos: revisión manual en el panel de Bold.
- (d) `pagos_por_verificar.regla_cruce` (`referencia` | `valor_hora`), con relleno de lo histórico.

Plan original (referencia):

Antes de escribir la migración, leer `pagos_cruzar_bold` y confirmar punto por punto. Lo que debe quedar:

```sql
-- (a) Universo de candidatos: solo pedidos aún pendientes.
--     Verificar que el SELECT de candidatos en pagos_cruzar_bold incluya:
--       AND p.estado = 'pendiente'
--     Si hoy no lo incluye, un pago puede "confirmar" un pedido ya decidido o ya despachado.

-- (b) Idempotencia: Bold reintenta webhooks.
alter table bold_pagos
  add column if not exists bold_evento_id text;
create unique index if not exists bold_pagos_evento_unico
  on bold_pagos (bold_evento_id)
  where bold_evento_id is not null;
-- bold_registrar debe extraer el id del evento del cuerpo (campo id / payment_id según el JSON de Bold)
-- y hacer INSERT ... ON CONFLICT (bold_evento_id) DO NOTHING; responder 'duplicado'.

-- (c) Reembolsos: suscribir el evento de reembolso en Bold (ver 4.4) y tratarlo igual que VOID_APPROVED:
--     si el pedido fue confirmado por 'Bold (automático)' y no ha sido despachado → vuelve a 'pendiente'
--     con nota 'Bold reembolsó el pago …'; si ya fue despachado → NO cambia estado, solo agrega la nota
--     y marca pagos_por_verificar.alerta = true para que salga en el Resumen 7:30.

-- (d) Trazabilidad: guardar en pagos_por_verificar.regla_cruce ('referencia' | 'valor_hora')
--     para poder medir cuántas confirmaciones vienen de cada regla.
```

**Criterio de aceptación:** reenviar manualmente el mismo evento de prueba dos veces → la segunda responde `duplicado`; un pedido con `estado='llego'` y valor igual a un pago nuevo **no** cambia; `regla_cruce` queda llena en #2442 (referencia) y en el caso de prueba de §4.5 (valor_hora).

### 4.4 Configuración en Bold (HECHO parcial)

- URL: `https://gruporamirezzapata.app.n8n.cloud/webhook/bold-pagos`
- Eventos: Venta aprobada, Anulación aprobada. Bold no ofrece evento de reembolso: los reembolsos se revisan a mano en el panel de Bold cada lunes.
- Webhook creado por Cristian el 3 nov 2026.

### 4.5 Validación en producción

| Caso | Resultado | Fecha |
|---|---|---|
| Pedido #2442, regla por referencia | Confirmado solo | antes del webhook nuevo |
| Primer pago real por el webhook nuevo (valida llave del Vault) | **PENDIENTE** | — |
| Regla 2 (valor y hora, sin referencia) | **PENDIENTE** — caso de prueba: hacer un pedido de prueba en Zenit por un valor único (ej. $47.300) sin referencia reconocible, pagar por Bold, confirmar que a los pocos segundos queda `llego` con `regla_cruce='valor_hora'`; luego anular en Bold y confirmar que vuelve a `pendiente` | — |

**Estado real de Bold hasta cerrar esta tabla: desplegado, no validado.** Medición 3 nov: de 6 pedidos Bold desde el 29 oct, 1 se confirmó solo (valor/hora) y 4 siguen pendientes; revisar si llegaron los avisos a `bold_pagos` y si la firma pasó. Si el primer pago real queda pendiente, la causa más probable es que Bold asignó otra llave al webhook nuevo: copiar la llave del webhook en Bold → pegarla en Vault `bold_llave_secreta` → reprocesar el evento con `reprocesar_b64`.

---

## 5. Despachos

### 5.1 Respuesta del flujo (HECHO)

`GET /webhook/despachos-datos?k=<clave>` → `{ ok, hoy, generado, inter_revisado_hoy, recogidas, guias[] }`.
Por guía: proveedor (vacío = inventario propio), fecha y horas desde creación (UTC→Bogotá), destinatario, ciudad, tipo de envío (con/sin recaudo por nombre de transportadora), estado, pendiente de aprobación del proveedor, artículos completos (si `contenido` viene truncado a ~100 letras, se consulta `detalle_remision_v`). Las guías de Inter ya recogidas se sacan de `guias` y se cuentan en `recogidas`.

Última prueba (ejecución 29): 234 guías · 60 propias, 52 MAC Blusas y Apliques, 50 Juanma.store, 44 Creaciones de Cielo, 28 Muy Bonitha · 164 Coordinadora, 69 Inter, 1 Servientrega · 0 incompletas.

### 5.2 Cómo funciona hoy y por qué cambia

Hoy cada apertura de la página consulta Effi (páginas de 100 a 1,2 s + detalle a 0,7 s por guía truncada) y gasta 1 ejecución de n8n. Con 234 guías son varios segundos y colisiona con el cron en punto y a la media.

### 5.3 Snapshot (HECHO 3 nov, pasos 1 y 2: el panel lee Supabase directo; `/despachos` carga en 0,8–1,9 s con 0 ejecuciones de n8n)

```sql
create table if not exists despachos_snapshot (
  id          smallint primary key default 1 check (id = 1),
  generado_en timestamptz not null,
  datos       jsonb not null
);
```

- El flujo principal `Cycs1zhh2BcMM505` agrega al final una rama que ejecuta la misma lógica de "Armar guías" y hace `upsert` en `despachos_snapshot` (id=1).
- `Rfprd6antlxGCtmr` deja de consultar Effi: lee la fila y la devuelve con `generado = generado_en`.
- El panel muestra "Datos de Effi: HH:MM" con `generado_en`. Si tiene más de 45 min, muestra aviso amarillo "datos de hace más de 45 min".
- Paso 2 (opcional): el panel lee `despachos_snapshot` directo de Supabase y `Rfprd6antlxGCtmr` se elimina junto con la clave `k`.

**Criterio de aceptación:** abrir `/despachos` 10 veces seguidas tarda < 2 s cada vez y genera 0 consultas a Effi (verificar en Executions de n8n que no hay llamadas HTTP a Effi en `Rfprd6antlxGCtmr`).

### 5.4 Retiro de la app GitHub Pages (HECHO 3 nov)

1. Verificar si el commit "App de despachos lee de la cuenta nueva de n8n" ya está publicado. **Irrelevante para el plan:** se retira igual.
2. Reemplazar `index.html` por una redirección a `https://effi-connect-five.vercel.app/despachos`.
3. Avisar al equipo que el único enlace es el panel.

### 5.5 Clave `k` (HECHO 3 nov: eliminada junto con `Rfprd6antlxGCtmr`; falta borrar `DESPACHOS_URL` en Vercel)

- Rotar ahora (ya se compartió por chat con `#k=`), y cada 90 días.
- No volver a repartirla en enlaces: vive solo en Vercel `DESPACHOS_URL`; el equipo entra por el panel con su sesión.
- Desaparece cuando se complete §5.3 paso 2.

---

## 6. Métricas, alertas y Resumen 7:30

### 6.1 Métricas (las produce el Resumen 7:17 al pie del correo)

Primera medición, 3 nov (la tabla de pagos existe desde el 29 oct: son 6 días, no 14):

| Métrica | Valor | Lectura |
|---|---|---|
| Pedidos anticipados | 8 (Bold 6, otros 2); Bold 0,4/día | < 5/día → **no migrar Bold a Edge Function** |
| Bold auto-confirmados | 1 (valor/hora) | Muestra chica; ver §4.5 |
| Tiempo pendiente → decidido (7 días) | 6,1 h | **Incumple** el objetivo < 2 h |
| Pagos pendientes > 2 h | 6 (4 Bold) | Plata posiblemente recibida y pedido sin salir |
| Guías "Generada" > 48 h | 47 (Inter > 72 h: 14) | **> 15 → revisar con Yorman/transportadoras** |
| Sombra, 7 días | 83,1 % (138/166), 9 falsos positivos | Lejos del 95 % |
| Ejecuciones n8n/mes | sin revisar | §10-11 |

Consultas originales:

| Métrica | Consulta | Umbral de decisión |
|---|---|---|
| Pedidos anticipados/día por medio de pago | `select date(fecha_pedido at time zone 'America/Bogota') d, pasarela, count(*) from pagos_por_verificar where fecha_pedido > now()-interval '14 days' group by 1,2 order by 1,2;` | Si Bold < 5/día: no migrar Bold a Edge Function. Si > 50/día: migrar |
| Pagos Bold auto-confirmados/día y por regla | `select date(decidido_en at time zone 'America/Bogota') d, regla_cruce, count(*) from pagos_por_verificar where decidido_por='Bold (automático)' and decidido_en > now()-interval '14 days' group by 1,2;` | Si `valor_hora` > 30 % del total: revisar manualmente una muestra de 10 |
| Tiempo medio pendiente→decidido (h) | `select avg(extract(epoch from (decidido_en-fecha_pedido))/3600) from pagos_por_verificar where decidido_en > now()-interval '7 days';` | Objetivo < 2 h en horario 7–20 |
| Aperturas de Despachos/día | n8n → Executions de `Rfprd6antlxGCtmr` por día | Solo para dimensionar; desaparece con snapshot |
| Guías "Generada" > 48 h sin recoger | `jsonb_array_length` sobre `despachos_snapshot.datos->'guias'` filtrando `horas > 48` | > 15 → revisar con Yorman/transportadora |
| Aciertos de sombra (§7) | tabla `sombra_aciertos` | ≥ 95 % para salir de sombra |
| Ejecuciones n8n/mes | n8n → Settings → Usage | Si límite ≤ 2.500: migrar Bold directo a Supabase |

(Columnas `decidido_en` y `regla_cruce`: si `pagos_por_verificar` no las tiene con ese nombre, ajustar la consulta a la columna real; `regla_cruce` se crea en §4.3.)

### 6.2 Alertas (HECHO 3 nov, salvo el punto 3)

1. Crear en n8n un flujo "Error Workflow – Grupo RZ": Error Trigger → nodo de correo a Cristian con nombre del flujo, id de ejecución y mensaje. Asignarlo en Settings → Error Workflow de los 4 flujos y de los nuevos.
2. Regla de "latido" en el Resumen 7:30: si `despachos_snapshot.generado_en` tiene más de 60 min a las 7:17, o si no hubo ejecución exitosa de `Cycs1zhh2BcMM505` ayer entre 19:30 y 20:30, el resumen abre con "⚠ el flujo principal no corrió".
3. GitHub Actions: activar notificación por correo de corrida fallida en el repo `verificador-inter`.

### 6.3 Resumen 7:17 (HECHO 3 nov: n8n `FweTmZa2lKdQwNkM`; reemplaza el monitor diario perdido `cwAi4xOgVuEfcH2g`)

Diferencias con el diseño: (1) la línea de sombra muestra los últimos 7 días, porque a las 7 a. m. casi todo lo de ayer sigue esperando a Estefanía; (2) el latido se mide por la edad del snapshot (> 60 min a las 7:17 = el flujo principal no corrió), sin leer n8n; (3) los lunes cubre sábado y domingo; (4) por ahora solo llega a los correos de Cristian: falta el de Estefanía. Diseño original:

Flujo n8n, cron `17 7 * * 1-6` Bogotá, lee Supabase y manda por correo (y por WhatsApp si hay API disponible) un mensaje de 6 líneas:

```
Resumen 7:17 · <fecha>
Pagos pendientes > 2 h: N  (Bold: n · Transferencia: n)
Bold auto-confirmados ayer: N  (referencia n · valor/hora n · reembolsos/anulaciones n)
Guías sin recoger > 48 h: N  (Inter > 72 h: n)
Sombra ayer: N propuestas · M aciertos · X % · falsos positivos: n
Último snapshot de despachos: HH:MM  ✓ / ⚠
```

Destinatarios: Cristian y Estefanía. **Criterio de aceptación:** 6 días seguidos recibido antes de 7:30 con los 5 números poblados.

---

## 7. Fase sombra y salida a vivo

### 7.1 Qué hace la sombra (HECHO)

Por cada pedido nuevo de Zenit y Noara, el flujo principal escribe en la hoja de Google la remisión y guía que **habría** creado (proveedor, artículos, transportadora, con/sin recaudo). Estefanía las crea a mano en Effi. No se crea nada en Effi.

### 7.2 Informe de aciertos (HECHO 3 nov: tabla `sombra_aciertos`, vista `sombra_resumen`, flujo `BrdYkSbNT9QfAKaz` 6:50)

Como quedó (difiere del diseño): llave `(tienda, orden)`; `resultado` ∈ acierto · fallo · excepcion · esperando · sin_remision. Acierto = mismo proveedor (Zenit), misma transportadora, mismo total y mismo recaudo (Noara); la dirección se reporta pero no cuenta. % = aciertos / (aciertos + fallos); las excepciones no cuentan como fallo. `sin_remision` (3+ días sin remisión) se verifica contra Effi: si se remisionó cuenta como `esperando`; si se anuló o sigue vigente sin despachar es falso positivo.

Primer informe (21 oct – 3 nov): Zenit 82,6 % (218/264), 24 falsos positivos (15 anuladas después de confirmadas, 9 vigentes que nadie despachó); Noara 82,9 % (29/35), 0 falsos positivos. Arreglos aplicados: espera de 12 h antes de proponer (v3.2) y redondeo con descuento de línea. Transportadora: la regla acierta 88 %; los fallos están en ciudades donde Estefanía alterna Inter y Coordinadora sin señal predecible (propuesta pendiente: contar como acierto una transportadora que ella usa ≥ 30 % en esa ciudad).

**Bloqueante para salir de sombra en Zenit:** no existe señal de "no despachar". Propuesta: estado de orden en Effi "EN ESPERA – NO DESPACHAR"; el flujo ya ignora todo lo que no esté en CONFIRMADO EFFICHAT (2) o MODIFICO (3). Estefanía lo marca en cuanto duda, no al cancelar (la nota de anulación no se puede leer por la API).

Diseño original:

Tabla:

```sql
create table if not exists sombra_aciertos (
  fecha           date not null,
  pedido          text not null,
  tienda          text not null,
  propuesta       jsonb not null,   -- lo que la sombra propuso
  real            jsonb,            -- lo que existe en Effi (remisión + guía)
  acierto         boolean,          -- iguales en proveedor, artículos, transportadora y tipo de envío
  falso_positivo  boolean,          -- la sombra propuso crear y Estefanía decidió NO crear (pago no llegó, cancelado, duplicado)
  diferencia      text,
  primary key (fecha, pedido)
);
```

Un flujo diario (puede ir dentro del Resumen 7:30) compara la hoja sombra de ayer contra las remisiones y guías de Effi del mismo pedido y llena la tabla. Definición de **acierto**: mismo proveedor, mismos artículos y cantidades, misma transportadora, mismo tipo (con/sin recaudo). Cualquier diferencia = no acierto, con `diferencia` escrita.

### 7.3 Criterio de salida de sombra (PROPUESTO, valores exactos)

Se puede pasar a vivo cuando se cumplan **todos**:
1. 7 días hábiles consecutivos con ≥ 95 % de aciertos por tienda (Zenit y Noara se evalúan por separado; cada una sale por su cuenta).
2. 0 falsos positivos en esos 7 días (una propuesta de crear guía sobre un pedido que no debía despacharse es más grave que 10 diferencias de artículos).
3. Mínimo 30 pedidos evaluados por tienda en el periodo.
4. §4.5 cerrado (Bold validado), porque en vivo la guía depende de que el pago esté confirmado.
5. Aprobación escrita de Cristian en §10.

### 7.4 Disyuntor en vivo (PROPUESTO, solo diseño; no activado)

Ajustes al diseño tras la sombra: la espera de 12 h y la verificación de estado ya corren en sombra (v3.2); en vivo, justo antes de crear, se vuelve a leer la orden en Effi y solo se crea si sigue vigente, sin remisión y en estado 2 o 3. Tabla `config` con `automatizacion_viva_zenit` / `_noara` en `false`. Apagado automático si el % del día anterior < 95 % o hay un falso positivo.

```sql
create table if not exists config (
  clave text primary key,
  valor text not null,
  actualizado_en timestamptz default now()
);
insert into config values ('automatizacion_viva_zenit','false'),('automatizacion_viva_noara','false')
on conflict do nothing;
```

En cada corrida, antes de crear cualquier cosa en Effi, el flujo:
1. Lee `config`. Si la tienda no está en `true`, corre en sombra.
2. Lee `sombra_aciertos` de ayer. Si < 95 % o hay un falso positivo, **se apaga sola** (`update config set valor='false'`) y avisa por el Error Workflow.
3. Excluye y deja para Estefanía (con fila en la hoja marcada "MANUAL"): pedidos con nota del cliente, pago no confirmado, valor > $600.000, proveedor con aprobación pendiente, más de 1 remisión necesaria.
4. Crea remisión y guía en Effi con una marca en el campo de observaciones: `auto-n8n <id ejecución>` para poder auditar y anular en bloque.

Apagar todo en cualquier momento: `update config set valor='false' where clave like 'automatizacion_viva_%';` — no requiere tocar n8n.

---

## 8. Verificación y reparación

### 8.1 Verificación rutinaria

| Pieza | Cómo verificar | Frecuencia |
|---|---|---|
| Flujo principal | n8n → `Cycs1zhh2BcMM505` → Executions: 1 exitosa cada 30 min, 7:00–20:30 | Resumen 7:30 lo revisa solo |
| Bold | Tras un pago Bold: `EX41gmvXSrv8euib` con respuesta `ok`; en `/pagos` → Decididos → "Bold (automático)" | Cada pago, primera semana |
| Inter | GitHub Actions verde lun–sáb; `0LsTVI6qRbHKpt2Y` con 2 ejecuciones exitosas | Resumen 7:30 |
| Despachos | `/despachos` muestra guías y hora de "Datos de Effi" < 45 min en horario | Diario |
| Base de datos | Supabase: `pagos_por_verificar`, `bold_pagos`; Vault `bold_llave_secreta` | Al cambiar algo |

### 8.2 Síntoma → causa → acción

| Síntoma | Causa probable | Acción |
|---|---|---|
| Correo del Error Workflow con "Execution limit reached" | Cuota de n8n agotada | Settings → Usage; subir plan o migrar Bold a Supabase (§2.3). Los pedidos no se pierden: la siguiente corrida los lee de Effi |
| `/pagos` no muestra un pedido anticipado reciente | El flujo principal no corrió o Effi devolvió 429 | Ver última ejecución; ejecutar manualmente el flujo; si 429 repetido, subir espaciado a 2 s |
| Pago Bold queda pendiente aunque la referencia coincide | `firma_invalida` → llave del Vault distinta a la del webhook | Copiar llave del webhook en Bold → Vault → reprocesar con `reprocesar_b64` |
| Dos pedidos del mismo valor, ninguno confirmado | Regla 2 intencional | Decidir a mano con el correo del pagador en la nota de Bold |
| Un pedido se confirmó solo y no debía | Bug en universo de candidatos (§4.3a no aplicado) o pago de otro pedido | Marcar "No ha llegado"; revisar `regla_cruce`; aplicar §4.3 |
| Respuesta "Response body is not valid JSON" en Bold | El nodo HTTP espera JSON y Supabase responde texto | Nodo HTTP en formato texto (ya configurado); no cambiar `bold_registrar` para devolver JSON sin ajustar el nodo |
| Horas en `/pagos` corridas 5 h | `fecha_trans` leída como Bogotá | Leer con `'Z'`; revisar el nodo de la tienda afectada |
| Shopify "Authorization failed" en Zenit | Credencial equivocada o `client_secret` rotado | Usar cred `HD45u743wkgTIyAg`; regenerar secret en Dev Dashboard |
| `/despachos` muestra aviso amarillo "Datos de hace X" en horario | El flujo principal no corrió o falló la rama snapshot | Ver ejecuciones de `Cycs1zhh2BcMM505`; el Resumen 7:17 también lo avisa |
| GitHub Actions falla el sábado | Página de Inter cambió, o `N8N_URL_*` incorrecta | Ver log de Actions; correr manualmente; si cambió el HTML de Inter, ajustar el scraper |
| Bold dice "URL no válida" al crear webhook | Webhook sin GET/HEAD | Ya acepta GET, POST, HEAD; si vuelve a pasar, probar con `curl -I` a la URL |
| En vivo: se creó una guía que no debía | Exclusión no cubierta | `update config set valor='false'`; buscar en Effi observaciones `auto-n8n <id>`; anular; agregar la exclusión a §7.4 |

---

## 9. Riesgos aceptados

| # | Riesgo | Por qué se acepta | Se revisa cuando |
|---|---|---|---|
| 1 | Bold pasa por n8n (cuota) | Volumen no medido; migración ~1 día | §6.1 umbrales |
| 2 | Regla 2 no confirma pedidos del mismo valor en ±3 h | Preferible revisión manual a confirmar mal | Nunca se relaja |
| 3 | Verificador Inter depende de la página pública de Inter | No hay API | Cuando falle 2 veces en un mes |
| 4 | Snapshot de Despachos puede tener hasta 30 min de retraso | Suficiente para operación | Si el equipo pide tiempo real, bajar el cron a 15 min en horario pico |
| 5 | Transferencias siguen manuales | Sin API bancaria | Cuando se mida que son > 50 % de los anticipados |

---

## 10. Pendientes (dueño, fecha, definición de hecho)

Estado al 3 nov 2026, 12:50 (cierre de los bloques 1–4).

| # | Pendiente | Dueño | Fecha | Hecho cuando | Estado |
|---|---|---|---|---|---|
| 1 | Rotación §3.2 y borrado del webhook viejo de Bold | Cristian | 4 nov | Los flujos corren con credenciales nuevas; sin `sebas777` en Bold ni GitHub | **Casi hecho (3 nov).** Webhook viejo borrado, clave nueva de Supabase en n8n, Google revocado y reconectado. Falta: Sebastián despublica los flujos de `sebas777` y borra sus credenciales; confirmar que el token de Effi de `sebas777` ya no sirve |
| 2 | Primer pago real por Bold validado | Cristian (revisa) | Con el próximo pago | "Bold (automático)" en Decididos; §4.5 fila 2 cerrada | **Abierto.** 1 confirmado solo, 4 pagos Bold pendientes > 2 h: revisar |
| 3 | Error Workflow en los flujos + alerta GitHub | IA | 4 nov | Un error forzado llega por correo en < 5 min | **Hecho 3 nov** (`IAuRn9DH8wLBiUDs`, probado 2 veces, asignado a todos los flujos publicados). Falta la alerta de GitHub Actions en `verificador-inter` |
| 4 | Parche cruce Bold §4.3 | IA propone, Cristian aprueba y aplica | 6 nov | Criterios §4.3 y §4.5 fila 3 | **Migración hecha 3 nov.** Falta la prueba real de la regla 2 (§4.5 fila 3) |
| 5 | Snapshot de Despachos §5.3 | IA | 7 nov | `/despachos` sin consultas a Effi | **Hecho 3 nov** (pasos 1 y 2) |
| 6 | Auth de Shopify Noara y token de Zenit en caché | IA | 7 nov | §3.1 fila Noara; Zenit pide token ≤ 2 veces/día | **Hecho 3 nov.** Noara no usa Shopify; token de Zenit en caché 23 h |
| 7 | Retirar GitHub Pages §5.4 y rotar `k` §5.5 | IA / Cristian | 7 nov | Enlace viejo redirige; sin `k` | **Hecho 3 nov.** Falta borrar `DESPACHOS_URL` en Vercel |
| 8 | Informe de aciertos §7.2 | IA | 10 nov | `sombra_aciertos` se llena sola | **Hecho 3 nov** |
| 9 | Resumen §6.3 | IA | 12 nov | 6 días seguidos recibido | **Publicado 3 nov**; corre desde el 4 nov. Falta el correo de Estefanía |
| 10 | `inter_estado_real` a Supabase | IA | 14 nov | Despachos lee de Supabase | **Hecho 3 nov.** Falta borrar la Data Table vieja `ih43WH9mjiJiDrAi` |
| 11 | Revisar plan de n8n (Settings → Usage) | Cristian | 7 nov | Decisión en §2.3 | Abierto. Con 0,4 pagos Bold/día la recomendación es dejar Bold en n8n |
| 12 | Quitar conector viejo "n8n" en claude.ai | Cristian | 4 nov | Solo existe "n8n Grupo RZ" | Abierto |
| 13 | Borrar filas con error de Shopify en la hoja sombra | Estefanía | 5 nov | Hoja sin "No se pudo leer el pedido" anteriores al 3 nov | Abierto |
| 14 | Lucid: medio de pago en la nota del pedido | Sebastián | 14 nov | Medio de pago visible en `/pagos` | Abierto |
| 15 | Decisión de salida de sombra Zenit / Noara | Cristian | Cuando §7.3 se cumpla | Firma con fecha y % | Abierto: Zenit 82,6 %, Noara 82,9 % |
| 16 | Estado "EN ESPERA – NO DESPACHAR" en Effi y regla para Estefanía | Cristian | — | Estefanía marca los pedidos en duda; los falsos positivos de Zenit bajan | Abierto (decidido crearlo más adelante) |
| 17 | Criterio "transportadora aceptable" (≥ 30 % en la ciudad) | Cristian aprueba | — | Anotado en §7.2 y aplicado en `BrdYkSbNT9QfAKaz` | Propuesto |
| 18 | Clave legacy JWT `service_role` | IA / Cristian | antes de 2027 | Edge functions con `sb_secret_`; legacy desactivada | Abierto |
| 19 | 47 guías "Generada" > 48 h | Cristian / Yorman | 5 nov | < 15 en el Resumen 7:17 | Abierto |

---

## 11. Reglas de trabajo que se mantienen

- Claves y tokens los pega Cristian directamente; no pasan por chats.
- Verificaciones de identidad (GitHub, Vercel, Bold) las hace Cristian.
- No se entra a la cuenta vieja de n8n.
- Nada crea remisiones ni guías en Effi hasta cumplir §7.3 y firmar §10-15.

---
