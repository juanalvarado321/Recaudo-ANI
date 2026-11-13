'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { limpiar, parsearCSV, parsearFecha, parsearValor } = require('../src/limpieza.js');

const CABECERA = '"IdPeaje","Peaje","Desde","Hasta","RecaudoFsv","RecaudoSobrante","Recaudo"';
const MES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DIAS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const fila = (id, nombre, a, m, d1, d2, valor) =>
  `"${id}","${nombre}","${a} ${MES[m]} ${d1} 12:00:00 AM","${a} ${MES[m]} ${d2} 12:00:00 AM","0","0","${valor}"`;
const mesCompleto = (id, nombre, a, m, valor) => fila(id, nombre, a, m, 1, DIAS[m], valor);
const csv = (filas) => [CABECERA, ...filas].join('\n') + '\n';

test('parsearValor interpreta el punto como separador de miles', () => {
  assert.equal(parsearValor('11.852.100'), 11852100);
  assert.equal(parsearValor('0'), 0);
  assert.equal(parsearValor('950'), 950);
  assert.throws(() => parsearValor('1,5'));
  assert.throws(() => parsearValor(''));
});

test('parsearFecha lee el formato del archivo', () => {
  assert.deepEqual(parsearFecha('2015 Aug 21 12:00:00 AM'), { a: 2015, m: 7, d: 21 });
  assert.throws(() => parsearFecha('21/08/2015'));
});

test('parsearCSV respeta comillas y comas internas', () => {
  assert.deepEqual(parsearCSV('"a","b"\n"1","x,y"\n'), [['a', 'b'], ['1', 'x,y']]);
});

test('los duplicados exactos se cuentan una sola vez', () => {
  const d = limpiar(csv([
    mesCompleto(1, 'UNO', 2014, 0, '1.000.000'),
    mesCompleto(1, 'UNO', 2014, 0, '1.000.000'),
    mesCompleto(1, 'UNO', 2014, 1, '1.100.000'),
  ]));
  assert.equal(d.calidad.duplicadosExactos, 1);
  assert.deepEqual(d.peajes[0].r.slice(0, 2), [1000000, 1100000]);
});

test('las versiones contradictorias no se suman: se conserva la coherente con los vecinos', () => {
  const filas = [];
  for (let m = 0; m < 6; m++) filas.push(mesCompleto(1, 'UNO', 2014, m, '1.000.000'));
  filas.push(mesCompleto(1, 'UNO', 2014, 3, '9.000.000')); // segunda versión de abril
  const d = limpiar(csv(filas));
  assert.equal(d.peajes[0].r[3], 1000000);
  assert.equal(d.calidad.versionesDescartadas, 1);
  assert.equal(d.peajes[0].versiones.length, 1);
});

test('los periodos consecutivos de un mismo mes se suman', () => {
  const d = limpiar(csv([
    fila(1, 'UNO', 2014, 0, 1, 15, '400.000'),
    fila(1, 'UNO', 2014, 0, 16, 31, '600.000'),
  ]));
  assert.equal(d.peajes[0].r[0], 1000000);
  assert.equal(Object.keys(d.peajes[0].parciales).length, 0);
});

test('un mes con menos días reportados queda marcado como parcial, sin escalar', () => {
  const d = limpiar(csv([
    fila(1, 'UNO', 2014, 0, 21, 31, '300.000'),
    mesCompleto(1, 'UNO', 2014, 1, '1.000.000'),
  ]));
  assert.equal(d.peajes[0].r[0], 300000);
  assert.deepEqual(d.peajes[0].parciales[0], [11, 31]);
});

test('los meses sin registro quedan en null', () => {
  const d = limpiar(csv([
    mesCompleto(1, 'UNO', 2014, 0, '1.000.000'),
    mesCompleto(1, 'UNO', 2014, 3, '1.000.000'),
  ]));
  assert.deepEqual(d.peajes[0].r.slice(0, 4), [1000000, null, null, 1000000]);
});

test('archivo real: dimensiones y casos verificados a mano', () => {
  const dir = path.join(__dirname, '..', 'datos');
  const archivo = fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort().pop();
  const d = limpiar(fs.readFileSync(path.join(dir, archivo), 'utf8'));
  assert.equal(d.anioInicio, 2014);
  assert.equal(d.mesInicio, 0);
  assert.equal(d.peajes.length, 162);
  assert.equal(d.calidad.registros, 17134);
  assert.equal(d.calidad.duplicadosExactos, 164);
  const valor = (nombre, a, m) => {
    const p = d.peajes.find((x) => x.nombre === nombre);
    return p.r[(a - 2014) * 12 + (m - 1) - p.ini];
  };
  const millones = (v) => Math.round(v / 1e6);
  assert.equal(millones(valor('IRACÁ', 2022, 11)), 1766);
  assert.equal(millones(valor('FUSCA', 2022, 8)), 741);
  assert.equal(millones(valor('BOQUERÓN I', 2023, 1)), 10230);
  // ningún mes puede quedar con más recaudo que la suma de todas sus filas
  for (const p of d.peajes) for (const v of p.r) assert.ok(v === null || (Number.isFinite(v) && v >= 0));
});
