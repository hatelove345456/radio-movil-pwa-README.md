import ExcelJS from 'exceljs';
import { resolveVehicle, compatibilityFor } from './resolve.js';

const HEADERS = {
  brand: ['marca', 'brand', 'make', 'fabricante'],
  model: ['modelo', 'model'],
  year: ['año', 'ano', 'year', 'anio'],
  fuel: ['combustible', 'fuel'],
};
const cellText = v => (v && typeof v === 'object' ? (v.text ?? v.result ?? '') : v ?? '').toString().trim();

export async function processExcel(inPath, outPath, { maxRows = 2000, onProgress } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inPath);
  const ws = wb.worksheets[0];
  const head = {};
  ws.getRow(1).eachCell((c, i) => {
    const h = cellText(c.value).toLowerCase();
    for (const [k, names] of Object.entries(HEADERS)) if (names.includes(h)) head[k] = i;
  });
  const missing = ['brand', 'model', 'year'].filter(k => !head[k]);
  if (missing.length) throw new Error(`Faltan columnas: ${missing.join(', ')} (se esperan Marca, Modelo, Año)`);

  const rows = [];
  ws.eachRow((r, n) => { if (n > 1 && rows.length < maxRows) rows.push({ n, r }); });

  const cache = new Map(); // dedupe por marca|modelo|año
  const out = new ExcelJS.Workbook();
  const o = out.addWorksheet('Compatibilidad');
  o.columns = [
    { header: 'Marca', key: 'brand' }, { header: 'Modelo', key: 'model' }, { header: 'Año', key: 'year' },
    { header: 'Combustible', key: 'fuel' }, { header: 'Estado match', key: 'status' },
    { header: 'generationId', key: 'gen' }, { header: 'Dispositivos compatibles', key: 'devices' },
    { header: 'Montaje OBD', key: 'fit' }, { header: 'Funciones (por dispositivo)', key: 'features' },
    { header: 'Avisos', key: 'warn' }, { header: 'Nota', key: 'note' },
  ];
  let done = 0;
  for (const { r } of rows) {
    const v = { brand: cellText(r.getCell(head.brand).value), model: cellText(r.getCell(head.model).value),
                year: cellText(r.getCell(head.year).value), fuel: head.fuel ? cellText(r.getCell(head.fuel).value) : '' };
    const key = [v.brand, v.model, v.year].join('|').toLowerCase();
    if (!cache.has(key)) {
      try {
        const res = await resolveVehicle(v);
        const comp = res.generationId ? await compatibilityFor(res.generationId) : null;
        cache.set(key, { res, comp });
      } catch (e) {
        cache.set(key, { res: { status: 'ERROR', note: e.message }, comp: null });
        if (/Parada:/.test(e.message)) { /* bloqueado: el resto saldrá ERROR sin llamadas */ }
      }
    }
    const { res, comp } = cache.get(key);
    o.addRow({
      ...v, status: res.status, gen: res.generationId ?? '', note: res.note ?? '',
      devices: comp ? comp.devices.filter(d => d.supported).map(d => d.device).join(', ') : '',
      fit: comp?.fitment ? `${comp.fitment.deviceMechanicalFit ?? ''} ${comp.fitment.technicalComment ?? ''}`.trim() : '',
      features: comp ? comp.devices.filter(d => d.features.length).map(d => `${d.device}: ${d.features.join('|')}`).join('\n') : '',
      warn: comp ? comp.warnings.join(', ') : '',
    });
    onProgress?.(++done, rows.length);
  }
  o.getRow(1).font = { bold: true };
  await out.xlsx.writeFile(outPath);
  const stats = {};
  o.eachRow((r, n) => { if (n > 1) stats[r.getCell(5).value] = (stats[r.getCell(5).value] ?? 0) + 1; });
  return { rows: rows.length, uniqueVehicles: cache.size, stats, outPath };
}
