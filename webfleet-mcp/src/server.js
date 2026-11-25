#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as api from './client.js';
import { pickBrand, pickModels } from './match.js';
import { resolveVehicle, compatibilityFor } from './resolve.js';
import { processExcel } from './excel.js';

const server = new McpServer({ name: 'webfleet-compat', version: '0.1.0' });
const text = o => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });
const guard = fn => async a => { try { return text(await fn(a)); } catch (e) { return { isError: true, ...text(String(e.message)) }; } };

server.tool('wf_list_models', 'Lista modelos de una marca del catálogo Webfleet VCC', { brand: z.string() },
  guard(async ({ brand }) => {
    const b = pickBrand(await api.brands(), brand);
    if (!b) return `Marca no encontrada: ${brand}`;
    return (await api.models(b.brandId)).map(m => m.modelName);
  }));

server.tool('wf_resolve_vehicle', 'Resuelve marca/modelo/año a generationId', { brand: z.string(), model: z.string(), year: z.number() },
  guard(resolveVehicle));

server.tool('wf_get_compatibility', 'Compatibilidad normalizada (LINK 140/2xx/6xx/7xx, OEM) por marca/modelo/año',
  { brand: z.string(), model: z.string(), year: z.number() },
  guard(async v => {
    const r = await resolveVehicle(v);
    return { match: r, compatibility: r.generationId ? await compatibilityFor(r.generationId) : null };
  }));

server.tool('wf_process_excel', 'Procesa un .xlsx (columnas Marca, Modelo, Año[, Combustible]) y genera un .xlsx con compatibilidades',
  { input_path: z.string(), output_path: z.string() },
  guard(({ input_path, output_path }) => processExcel(input_path, output_path)));

await server.connect(new StdioServerTransport());
