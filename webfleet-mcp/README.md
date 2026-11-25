# webfleet-compat-mcp (MVP)

MCP (stdio) que consulta la API interna del Webfleet Vehicle Compatibility Checker. Ver `../docs/webfleet-compat/INFORME.md`.

**Usar solo con autorización de Webfleet.** Es una API no documentada ni contractual.

## Uso
    npm install && npm test
    node src/server.js        # servidor MCP por stdio

Config MCP: `{"command":"node","args":["<ruta>/src/server.js"]}`

Tools: `wf_list_models`, `wf_resolve_vehicle`, `wf_get_compatibility`, `wf_process_excel(input_path, output_path)`.
Excel de entrada: columnas `Marca`, `Modelo`, `Año` (opcional `Combustible`). Salida: .xlsx con estado `OK|AMBIGUO|NO ENCONTRADO|ERROR`, dispositivos, montaje OBD y funciones.

## Salvaguardas
- ≥1 s entre peticiones (`WF_MIN_INTERVAL_MS`), backoff en 429/5xx, caché 7 días en `.cache/`.
- Deduplica por marca+modelo+año.
- Ante 401/403 se detiene todo; no hay reintentos ni evasión.

## Pendiente
- Combustible: no se usa para filtrar (`fuelTypes` llegó vacío en la prueba).
- VIN/OEM (`/api/oemCompatibilities`) no implementado hasta tener autorización.
- Tras un proxy de empresa: `NODE_USE_ENV_PROXY=1` (+ `NODE_EXTRA_CA_CERTS`).
