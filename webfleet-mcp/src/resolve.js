import * as api from './client.js';
import { pickBrand, pickModels, pickGenerations } from './match.js';

// -> { status: OK|AMBIGUO|NO ENCONTRADO, generationId?, candidates, note }
export async function resolveVehicle({ brand, model, year }) {
  const b = pickBrand(await api.brands(), brand);
  if (!b) return { status: 'NO ENCONTRADO', note: `Marca no encontrada: ${brand}`, candidates: [] };
  const ms = pickModels(await api.models(b.brandId), model);
  if (!ms.length) return { status: 'NO ENCONTRADO', note: `Modelo no encontrado: ${model}`, candidates: [] };
  const cands = [];
  for (const m of ms.slice(0, 3)) {
    for (const g of pickGenerations(await api.generations(m.modelId), year))
      cands.push({ brand: b.brandName, model: m.modelName, generationId: g.generationId,
                   yearFrom: g.yearFrom, yearTo: g.yearTo, score: m.score });
  }
  if (!cands.length) return { status: 'NO ENCONTRADO', note: `Sin generación para el año ${year}`, candidates: [] };
  if (cands.length > 1) return { status: 'AMBIGUO', candidates: cands, generationId: cands[0].generationId, note: 'Varias generaciones/modelos' };
  return { status: 'OK', generationId: cands[0].generationId, candidates: cands, note: '' };
}

const FAMILIES = [
  ['LINK 140', 'features1xxLink'], ['LINK 210/240/245', 'features2xxLink'],
  ['LINK 610/640', 'features6xxLink'], ['LINK 710/740', 'features7xxLink'],
];

// Normaliza la respuesta cruda de /api/compatibilities/{id}
export function summarize(raw) {
  const devices = FAMILIES.map(([name, key]) => ({
    device: name, supported: (raw[key]?.features?.length ?? 0) > 0,
    features: raw[key]?.features ?? [],
  }));
  devices.push({ device: 'OEM.connect', supported: !!raw.featuresOEM?.oemSupported, features: [] });
  const fit = raw.features2xxLink?.fitmentInformation ?? null;
  const flags = Object.entries(raw.featureList ?? {}).filter(([, v]) => v === true).map(([k]) => k);
  return { devices, fitment: fit, warnings: flags, yCable: !!raw.featureYCable?.enabled };
}

export async function compatibilityFor(generationId) {
  return summarize(await api.compatibility(generationId));
}
