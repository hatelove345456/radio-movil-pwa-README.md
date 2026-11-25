import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, pickBrand, pickModels, pickGenerations } from '../src/match.js';
import { summarize } from '../src/resolve.js';

test('alias de marca', () => {
  const l = [{ brandId: '1', brandName: 'Volkswagen' }, { brandId: '2', brandName: 'Citroen' }];
  assert.equal(pickBrand(l, 'VW').brandId, '1');
  assert.equal(pickBrand(l, 'Citroën').brandId, '2');
});
test('modelo: exacto > prefijo, más específico', () => {
  const l = [{ modelName: 'Transit' }, { modelName: 'Transit Custom' }, { modelName: 'Focus' }];
  assert.equal(pickModels(l, 'Transit Custom')[0].modelName, 'Transit Custom');
  assert.equal(pickModels(l, 'Transit Custom 2.0')[0].modelName, 'Transit Custom');
  assert.equal(pickModels(l, 'Fiesta').length, 0);
});
test('año dentro de rango', () => {
  const g = [{ yearFrom: '2012', yearTo: '2018' }, { yearFrom: '2019', yearTo: 'presente' }];
  assert.equal(pickGenerations(g, 2015).length, 1);
  assert.equal(pickGenerations(g, 2024)[0].yearFrom, '2019');
  assert.equal(pickGenerations(g, 2000).length, 0);
});
test('summarize con respuesta real', async () => {
  const fs = await import('node:fs');
  const raw = JSON.parse(fs.readFileSync(new URL('../../docs/webfleet-compat/evidence/compatibilities_1813.json', import.meta.url)));
  const s = summarize(raw);
  assert.equal(s.devices.length, 5);
  assert.ok(s.devices.find(d => d.device === 'LINK 140').supported);
  assert.equal(s.fitment.deviceMechanicalFit, 'EXTENSION_CABLE_REQUIRED');
});
