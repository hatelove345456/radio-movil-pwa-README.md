// Cliente prudente para la API interna de Webfleet VCC.
// Usar SOLO con autorización de Webfleet. Cadencia baja, caché, parada ante 401/403.
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.WF_BASE_URL || 'https://link-compatibility.webfleet.com';
const MIN_INTERVAL_MS = Number(process.env.WF_MIN_INTERVAL_MS || 1000);
const TTL_MS = Number(process.env.WF_CACHE_TTL_DAYS || 7) * 864e5;
const CACHE_DIR = process.env.WF_CACHE_DIR || path.resolve('.cache');
const UA = process.env.WF_USER_AGENT || 'webfleet-compat-mcp/0.1 (uso interno autorizado)';

let last = 0;
let blocked = null; // si Webfleet responde 401/403 paramos todo
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cacheFile(key) {
  return path.join(CACHE_DIR, key.replace(/[^a-z0-9._-]/gi, '_') + '.json');
}

export async function getJson(route, { retries = 3 } = {}) {
  if (blocked) throw new Error(blocked);
  const f = cacheFile(route);
  try {
    const st = fs.statSync(f);
    if (Date.now() - st.mtimeMs < TTL_MS) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(BASE + route, {
      headers: { accept: 'application/json', 'user-agent': UA },
    });
    if (res.status === 401 || res.status === 403) {
      blocked = `Webfleet respondió ${res.status} en ${route}. Parada: no se reintenta ni se evade.`;
      throw new Error(blocked);
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${route}`);
    const data = await res.json();
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(data));
    return data;
  }
  throw new Error(`Reintentos agotados en ${route}`);
}

export const brands = () => getJson('/api/brands');
export const models = id => getJson(`/api/models?brandId=${encodeURIComponent(id)}`);
export const generations = id => getJson(`/api/generations?modelId=${encodeURIComponent(id)}`);
export const compatibility = id => getJson(`/api/compatibilities/${encodeURIComponent(id)}`);
