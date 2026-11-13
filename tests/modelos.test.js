'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/modelos.js');

const CORTE = 120, N = 149;
const modelo = (id) => M.MODELOS.find((m) => m.id === id);
const ESTACION = [1.10, 0.92, 0.98, 0.97, 0.96, 0.98, 1.03, 1.02, 0.95, 1.04, 1.00, 1.08];
// Serie sintética: crecimiento de 8 % anual con estacionalidad multiplicativa, sin ruido
const serieLimpia = (n = N) => ({
  y: Array.from({ length: n }, (_, t) => 1e9 * Math.pow(1.08, t / 12) * ESTACION[t % 12]),
  parcial: new Set(),
});

test('hay cuatro modelos con identificador y nombre', () => {
  assert.deepEqual(M.MODELOS.map((m) => m.id), ['hw', 'reg', 'crec', 'ing']);
  for (const m of M.MODELOS) assert.ok(m.nombre && typeof m.ajustar === 'function');
});

test('el entrenamiento usa solo los meses anteriores al corte', () => {
  const a = serieLimpia(), b = serieLimpia();
  for (let t = CORTE; t < N; t++) b.y[t] *= 5; // cambia solo el periodo de prueba
  for (const m of M.MODELOS) {
    const ra = M.estimar(a, CORTE, m, 95), rb = M.estimar(b, CORTE, m, 95);
    assert.ok(ra.ok && rb.ok, m.id);
    assert.deepEqual(ra.est, rb.est, `${m.id} no debe ver los datos de prueba`);
    assert.equal(ra.est.length, N - CORTE);
  }
});

test('regresión y estacional con crecimiento recuperan una serie exacta', () => {
  for (const id of ['reg', 'crec']) {
    const r = M.estimar(serieLimpia(), CORTE, modelo(id), 95);
    assert.ok(r.ok);
    assert.ok(r.metricas.wape < 1e-6, `${id}: WAPE ${r.metricas.wape}`);
    assert.equal(r.metricas.n, N - CORTE);
  }
});

test('Holt-Winters sigue de cerca una serie con tendencia y estacionalidad', () => {
  const r = M.estimar(serieLimpia(), CORTE, modelo('hw'), 95);
  assert.ok(r.ok);
  assert.ok(r.metricas.wape < 0.02, `WAPE ${r.metricas.wape}`);
});

test('el estacional ingenuo repite el último año de entrenamiento', () => {
  const s = serieLimpia();
  const r = M.estimar(s, CORTE, modelo('ing'), 95);
  for (let h = 0; h < N - CORTE; h++) {
    const esperado = s.y[CORTE - 12 + (h % 12)];
    assert.ok(Math.abs(r.est[h] / esperado - 1) < 1e-9);
  }
});

test('los intervalos se ordenan y se ensanchan con el nivel de confianza', () => {
  const s = serieLimpia();
  let x = 7; // ruido determinista
  s.y = s.y.map((v) => { x = (x * 16807) % 2147483647; return v * (0.9 + 0.2 * (x / 2147483647)); });
  for (const m of M.MODELOS) {
    const r80 = M.estimar(s, CORTE, m, 80), r95 = M.estimar(s, CORTE, m, 95);
    for (let h = 0; h < N - CORTE; h++) {
      assert.ok(r95.inf[h] < r95.est[h] && r95.est[h] < r95.sup[h], m.id);
      assert.ok(r95.sup[h] - r95.inf[h] > r80.sup[h] - r80.inf[h], m.id);
    }
  }
});

test('ceros, caídas y picos se marcan como atípicos y no entran al ajuste', () => {
  const y = new Array(24).fill(100);
  y[5] = 0; y[10] = 30; y[15] = 400;
  const marcas = M.detectarAtipicos(y);
  assert.equal(marcas[5], 'cero');
  assert.equal(marcas[10], 'caida');
  assert.equal(marcas[15], 'pico');
  assert.equal(marcas.filter(Boolean).length, 3);

  const s = serieLimpia();
  s.y[75] = 0; s.y[76] = 0; // suspensión del cobro
  const r = M.estimar(s, CORTE, modelo('reg'), 95);
  assert.equal(r.prep.nValidos, CORTE - 2);
  assert.ok(r.metricas.wape < 1e-6);
});

test('los meses parciales no se usan para ajustar ni para medir', () => {
  const s = serieLimpia();
  s.y[40] *= 0.9; s.parcial.add(40);
  s.y[130] *= 0.3; s.parcial.add(130);
  const r = M.estimar(s, CORTE, modelo('reg'), 95);
  assert.equal(r.prep.nValidos, CORTE - 1);
  assert.equal(r.metricas.n, N - CORTE - 1);
  assert.ok(r.metricas.wape < 1e-6);
});

test('series sin información suficiente no se estiman y explican el motivo', () => {
  const sinDatos = { y: new Array(N).fill(null), parcial: new Set() };
  const ceros = { y: new Array(N).fill(0), parcial: new Set() };
  const cerrada = serieLimpia();
  for (let t = 60; t < N; t++) cerrada.y[t] = null; // dejó de reportar en 2019
  for (const s of [sinDatos, ceros, cerrada]) {
    for (const m of M.MODELOS) {
      const r = M.estimar(s, CORTE, m, 95);
      assert.equal(r.ok, false);
      assert.ok(r.motivo.length > 10);
    }
  }
  const corta = serieLimpia();
  for (let t = 0; t < CORTE - 14; t++) corta.y[t] = null; // 14 meses de entrenamiento
  assert.equal(M.estimar(corta, CORTE, modelo('hw'), 95).ok, false);
  assert.equal(M.estimar(corta, CORTE, modelo('reg'), 95).ok, false);
  assert.equal(M.estimar(corta, CORTE, modelo('ing'), 95).ok, true);
});

test('métricas: definiciones', () => {
  const k = M.metricas([100, 200, 0, null], [110, 180, 10, 50], [90, 190, 5, 0], [120, 210, 20, 99], [true, true, true, false]);
  assert.equal(k.n, 3);
  assert.equal(k.totalReal, 300);
  assert.equal(k.totalEst, 300);
  assert.ok(Math.abs(k.wape - 40 / 300) < 1e-12);
  assert.ok(Math.abs(k.mape - (0.1 + 0.1) / 2) < 1e-12); // el mes con real = 0 no entra al MAPE
  assert.equal(k.sesgo, 0);
  assert.ok(Math.abs(k.mae - 40 / 3) < 1e-12);
  assert.ok(Math.abs(k.cobertura - 2 / 3) < 1e-12);
  assert.equal(M.metricas([0, 0], [5, 5], null, null, [true, true]).wape, null);
  assert.equal(M.metricas([null], [5], null, null, [false]).n, 0);
});

test('resumen estadístico de una serie conocida', () => {
  const y = [];
  for (let a = 0; a < 3; a++) for (let m = 0; m < 12; m++) y.push(100 * (a + 1));
  const r = M.resumen({ y, fsv: y.map(() => 1), sob: y.map(() => 0), parcial: new Set() }, 2014);
  assert.equal(r.total, 7200);
  assert.equal(r.mesesCompletos, 36);
  assert.equal(r.totalFsv, 36);
  assert.deepEqual(r.porAnio.map((o) => [o.anio, o.total]), [[2014, 1200], [2015, 2400], [2016, 3600]]);
  assert.ok(Math.abs(r.tcac.valor - (Math.sqrt(3) - 1)) < 1e-12);
  assert.equal(M.mediana([3, 1, 2, 10]), 2.5);
  assert.equal(M.cuantil([1, 2, 3, 4, 5], 0.5), 3);
});
