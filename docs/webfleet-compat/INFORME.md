# Análisis técnico: Webfleet Vehicle Compatibility Checker

Fecha: 2026-11-25 · URL: `https://link-compatibility.webfleet.com/?locale=es_es`
Método: Playwright (carga + interacción con selectores), lectura del bundle JS (`vehiclecompatibilitycheckerui.min.*.js`) y 1 petición directa a `/api/compatibilities/{id}`. Total ≈ 12 peticiones. Sin consultas masivas ni evasión de restricciones.

## 1. Conclusión corta
- **No hay API pública documentada.** `robots.txt`, `swagger.json`, `api-docs`, `openapi.json`, `security.txt` → 404. Es una **API interna del frontend** (Express/Node).
- **No requiere autenticación** para el flujo manual: sin cookies, sin `Authorization`, sin CSRF/token. Solo `Content-Type: application/json`.
- La consulta es **por generación de vehículo** (marca → modelo → generación/año → combustible), **no por matrícula/VIN**. El único flujo por VIN es OEM.connect (máx. 100 VIN).
- Existe un **flujo bulk por Excel** (subida .xlsx + informes), pero está **desactivado por Webfleet** (`GET /api/config` → `{"bulkUploadEnabled":false}`). No debe forzarse.
- Que sea técnicamente accesible **no equivale a estar autorizado** a automatizarlo. No he leído los T&C del servicio (hay que aceptarlos en la UI). Antes de producción: pedir autorización por escrito a Webfleet.

## 2. Endpoints observados
Base: `https://link-compatibility.webfleet.com`

| Método | Ruta | Parámetros | Observado | Uso |
|---|---|---|---|---|
| GET | `/api/config` | – | ✅ red | Feature flags |
| GET | `/api/translations` | `contextCode=VEHICLECOMPATIBILITYCHECKER&locale=es_ES&project=detail` | ✅ red | Textos/etiquetas de features |
| GET | `/api/brands` | – | ✅ red | Marcas (≈249) |
| GET | `/api/models` | `brandId` | ✅ red | Modelos de una marca |
| GET | `/api/generations` | `modelId` | ✅ red | Generaciones, años, combustibles |
| GET | `/api/compatibilities/{generationId}` | – | ✅ directo (misma URL que usa el bundle) | **Resultado de compatibilidad** |
| POST | `/api/oemCompatibilities` | body JSON: array de VIN (≤100) → `{uid}` | 📄 solo código, **no ejecutado** | Elegibilidad OEM.connect por VIN (asíncrono) |
| GET | `/api/oemCompatibilities/{uid}` | polling cada 3 s | 📄 solo código | Resultado: `[{vin, brand, status}]` |
| POST | `/api/compatibilityrequest` | formulario de vehículo faltante | 📄 solo código, **no ejecutado** | Solicitud comercial (contiene datos de contacto) |
| POST | `/api/compatibilityReport/upload` | multipart `file` (.xlsx) → `fileHash` | 📄 desactivado por flag | Bulk Excel |
| GET | `/api/bulkCompatibilityCheck/{hash}` | polling 1 s → `{status, progress}` | 📄 desactivado | Estado del bulk |
| GET | `/api/bulkCompatibilityCheck/report/{hash}?reportType=` | INPUT_TEMPLATE, SALES_VCC_LINK_1XX, SALES_VCC_LINK_2XX, SALES_VCC_LINK_6XX_7XX, VCC_CANALISATION_REQUEST, NEW_INSTALLATION_REVISION | 📄 desactivado | Informes .xlsx |

Cabeceras de respuesta: `x-powered-by: Express`, HSTS, `referrer-policy: no-referrer`. No se vieron cabeceras de rate-limit. `OPTIONS` devuelve 200 vacío.

## 3. Estructura JSON (evidencia real)
Ejemplo Ford B-Max 2012-2018 gasolina:

```jsonc
// GET /api/brands
[{"brandId":"1484","brandName":"ABARTH"}, ...]
// GET /api/models?brandId=54
[{"brandId":"54","modelId":"227","modelName":"B-max"}, ...]
// GET /api/generations?modelId=227
[{"fuelTypes":[],"generationId":"1813","generationNo":"Optional[348]","modelId":"227","yearFrom":"2012","yearTo":"2018"}]
```
Notas: `generationNo` viene como `"Optional[348]"` (bug de serialización Java, hay que limpiar). `fuelTypes` llegó vacío aquí; la UI mostró "Gasolina / Diésel (incl. MHEV)" → el combustible se deriva de otra parte (a verificar con otros modelos). `yearTo` puede ser texto tipo "presente" (la UI lo traduce).

```jsonc
// GET /api/compatibilities/1813  (resumen; ver evidence/compatibilities_1813.json)
{
  "vehicleGenerationNo": 348,
  "featureList": { "canFdRequired":false, "ip67BoxRequiredForLink":false, "j1708ConnectionRequired":false,
     "lidCoverCannotBePlacedBack":false, "noCanBusFound":false, "noGpsCoverageWithoutAntenna":false,
     "noInstallationManual":false, "noUsefulDataInCanBus":false, "weakGpsSignalInObdPort":false },
  "featureYCable": { "enabled": false },
  "features1xxLink": { "features": ["LogbookWithRealVehicleOdometer","Speeding", ...] },      // LINK 140
  "features2xxLink": { "features": ["ABS","ReportingOfFuelLevel", ...],                          // LINK 210/240/245
     "directFms": false, "link210Supported": true,
     "fitmentInformation": { "covered":true, "obdSupported":true, "obdPortLocation":"1",
        "deviceMechanicalFit":"EXTENSION_CABLE_REQUIRED", "technicalComment":"COVER_DOES_NOT_CLOSE_DONGLE_ATTACHED" } },
  "features6xxLink": { "features":[...], "canBusesCount":1, "directFms":false, "externalAntennaRequired":false }, // LINK 610/640
  "features7xxLink": { "features":[...], "canBusesCount":1, "directFms":false, "externalAntennaRequired":false }, // LINK 710/740
  "featuresOEM": { "oemSupported": false }
}
```
- Dispositivos: LINK 140 (`features1xxLink`), LINK 210/240/245 (`2xx`), LINK 610/640 (`6xx`), LINK 710/740 (`7xx`), OEM.connect (`featuresOEM`).
- `features[]` son códigos (p.ej. `ABS`, `Speeding`, `ReportingOfFuelLevel`); sus nombres legibles salen de `/api/translations` (`vcc_compatibility_<código en minúsculas>`).
- VIN/OEM: `status ∈ {SUPPORTED, MAY_BE_SUPPORTED, NOT_SUPPORTED, WRONG_VIN_NUMBER, CHECK_ERROR}`.

## 4. Avisos de la propia web (afectan a la fiabilidad)
- Stellantis: el check OEM puede dar falsos positivos/negativos; reintentar; desde mid-2023, confirmar con soporte.
- Renault Kangoo/Trafic/Clio desde mid-2024: posible fallo de GPS/odómetro.
- BMW y MAN RIO: contactar con soporte.
- Los datos son indicativos de **generación**, no de la unidad concreta.

## 5. Lo que NO he podido verificar
- Los T&C de uso (condición de aceptación en UI) y cualquier límite de uso/rate limit.
- El POST OEM y el bulk (no ejecutados a propósito).
- Si el resultado varía por país (hay selector de país en traducciones, pero no vi parámetro en las llamadas).
- Cómo se rellena `fuelTypes` en todos los modelos (sólo probé uno).
- Si existe una API oficial equivalente para partners: no la he podido confirmar. Webfleet tiene Webfleet.connect (API documentada para flotas ya clientes), pero **no incluye este checker** según lo observado.

## 6. Propuesta de implementación del MCP

**Ruta recomendada (por orden):**
1. **Pedir a Webfleet (gestor comercial/partner)** autorización escrita + el informe bulk oficial "Sales VCC Report" o acceso a la función bulk. Es su canal previsto y evita riesgo legal/técnico.
2. Mientras tanto, MCP que consume los endpoints GET con **cache agresiva y baja cadencia**, solo con autorización confirmada.

**Diseño (TypeScript, `@modelcontextprotocol/sdk`, transporte stdio):**

| Tool | Función |
|---|---|
| `wf_list_brands` / `wf_list_models(brand)` / `wf_list_generations(model)` | Catálogo con cache |
| `wf_resolve_vehicle(brand, model, year, fuel?)` | Match difuso → `generationId` (año ∈ [yearFrom, yearTo]); devuelve candidatos y confianza |
| `wf_get_compatibility(generationId)` | JSON normalizado por familia LINK + fitment + features traducidas |
| `wf_check_vins_oem(vins[])` | Lotes ≤100, polling 3 s (solo si hay autorización) |
| `wf_process_excel(path, mapping)` | Lee .xlsx, resuelve, enriquece y escribe .xlsx de salida |

**Pipeline del Excel (cientos de filas):**
1. Leer columnas (marca, modelo, año, combustible, opcional VIN) con `exceljs`.
2. Normalizar (minúsculas, sin acentos, alias: "VW"→"Volkswagen", "Mercedes-Benz"→"Mercedes"…).
3. **Deduplicar** por (marca, modelo, año, combustible): cientos de vehículos suelen ser <100 generaciones únicas.
4. Resolver contra catálogo cacheado (1 carga de brands + models por marca usada).
5. `compatibilities/{generationId}` solo por generación única; cache SQLite/JSON con TTL (7 días).
6. Salida: una fila por vehículo con LINK compatibles, `fitmentInformation`, features, avisos y columna de **estado de match** (`OK`, `AMBIGUO`, `NO ENCONTRADO`) para revisión humana.

**Límites de seguridad en código:** concurrencia 1–2, ≥1 s entre peticiones, backoff ante 429/5xx, parada ante 403/401 (no reintentar ni rotar IP/UA), `User-Agent` identificable, log de cada llamada, sin datos personales en peticiones.

**Riesgos:** API no contractual (puede cambiar sin aviso), match difuso erróneo (revisar `AMBIGUO`), falsos resultados Stellantis/Renault, posible incumplimiento de T&C si no hay autorización.

**Esfuerzo estimado:** MVP (catálogo + resolve + compat + Excel) ≈ 2-3 días; OEM por VIN +0,5 día si se autoriza.

## 7. Evidencias
- `evidence/compatibilities_1813.json`: respuesta real completa.
- `evidence/probe.js`: script Playwright de captura Fetch/XHR.
