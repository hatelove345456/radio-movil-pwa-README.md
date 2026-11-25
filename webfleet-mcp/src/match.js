const ALIASES = {
  vw: 'volkswagen', 'mercedes benz': 'mercedes', 'mercedes-benz': 'mercedes',
  citroën: 'citroen', 'land rover': 'land rover', opel: 'opel',
};
export const norm = s =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const brandKey = s => { const n = norm(s); return ALIASES[n] ?? n; };

// Puntúa nombre de modelo del Excel contra el del catálogo.
function score(wanted, cand) {
  const a = norm(wanted), b = norm(cand);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.replace(/ /g, '') === b.replace(/ /g, '')) return 0.95;
  if (a.startsWith(b + ' ') || b.startsWith(a + ' ')) return 0.8; // "Transit Custom 2.0" ~ "Transit Custom"
  return 0;
}

export function pickBrand(list, name) {
  const k = brandKey(name);
  return list.find(b => brandKey(b.brandName) === k) ?? null;
}

export function pickModels(list, name) {
  const scored = list.map(m => ({ m, s: score(name, m.modelName) })).filter(x => x.s > 0);
  const top = Math.max(0, ...scored.map(x => x.s));
  // En empates o prefijos, preferimos el nombre más largo (más específico).
  return scored.filter(x => x.s === top)
    .sort((x, y) => y.m.modelName.length - x.m.modelName.length)
    .map(x => ({ ...x.m, score: x.s }));
}

export function pickGenerations(gens, year) {
  const y = Number(year);
  return gens.filter(g => {
    const from = Number(g.yearFrom);
    const to = Number(g.yearTo) || 9999; // "presente"/vacío => abierto
    return Number.isFinite(y) && y >= from && y <= to;
  });
}
