/*
 * Limpieza del archivo "Recaudo Vehicular ANI" y construcción de series mensuales.
 * Se ejecuta al compilar (node build.js); el resultado queda incrustado en index.html.
 *
 * Reglas (cada una se cuenta y se muestra en la aplicación):
 *  1. Registros idénticos (mismo peaje, periodo y valores) -> se conserva uno.
 *  2. Registros del mismo peaje cuyos periodos se traslapan pero traen valores
 *     distintos se tratan como versiones alternativas del mismo periodo y NO se
 *     suman: se conserva la versión más coherente con los meses vecinos del peaje
 *     (menor distancia logarítmica a la mediana de hasta 3 meses anteriores y 3
 *     posteriores sin ambigüedad, dentro de un año). Las versiones en cero se
 *     descartan si hay alguna positiva. Sin referencia se conserva la mayor.
 *  3. Periodos que no se traslapan dentro de un mes (p. ej. 1–19 y 20–31) se suman.
 *  4. Un mes es "parcial" cuando los días reportados no cubren el mes completo.
 */
'use strict';

const MESES_EN = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const COLUMNAS = ['IdPeaje', 'Peaje', 'Desde', 'Hasta', 'RecaudoFsv', 'RecaudoSobrante', 'Recaudo'];

function parsearCSV(texto) {
  const filas = [];
  let fila = [], campo = '', enComillas = false;
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.length > 1 || fila[0] !== '') filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// "2015 Aug 21 12:00:00 AM" -> {a, m, d}
function parsearFecha(s) {
  const p = /^(\d{4}) ([A-Z][a-z]{2}) (\d{1,2}) /.exec(s);
  if (!p || !(p[2] in MESES_EN)) throw new Error('Fecha no reconocida: ' + s);
  return { a: +p[1], m: MESES_EN[p[2]], d: +p[3] };
}

// "11.852.100" -> 11852100 (punto como separador de miles)
function parsearValor(s) {
  if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(s)) throw new Error('Valor no reconocido: ' + s);
  return Number(s.replace(/\./g, ''));
}

const diasDelMes = (a, m) => new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
const mediana = (v) => {
  const o = [...v].sort((x, y) => x - y), n = o.length;
  return n % 2 ? o[(n - 1) / 2] : (o[n / 2 - 1] + o[n / 2]) / 2;
};

function limpiar(textoCSV) {
  const filas = parsearCSV(textoCSV);
  const enc = filas.shift();
  COLUMNAS.forEach((c, i) => { if (enc[i] !== c) throw new Error(`Columna inesperada: ${enc[i]} (se esperaba ${c})`); });

  const calidad = { registros: filas.length, duplicadosExactos: 0, versionesDescartadas: 0, mesesConVersiones: 0, mesesDivididos: 0, mesesParciales: 0, mesesSinRegistro: 0 };

  // 1) Lectura, validación y duplicados exactos
  const vistos = new Set();
  const peajes = new Map();
  let minMes = Infinity, maxMes = -Infinity;
  for (const f of filas) {
    if (f.length !== COLUMNAS.length) throw new Error('Fila con número de columnas inesperado: ' + f.join('|'));
    const clave = f.join('|');
    const desde = parsearFecha(f[2]), hasta = parsearFecha(f[3]);
    if (desde.a !== hasta.a || desde.m !== hasta.m || hasta.d < desde.d) throw new Error('Periodo que cruza meses: ' + clave);
    const id = Number(f[0]);
    if (!peajes.has(id)) peajes.set(id, { id, nombre: f[1].trim(), duplicados: 0, meses: new Map() });
    const p = peajes.get(id);
    if (p.nombre !== f[1].trim()) throw new Error('IdPeaje con más de un nombre: ' + id);
    if (vistos.has(clave)) { calidad.duplicadosExactos++; p.duplicados++; continue; }
    vistos.add(clave);
    const mes = desde.a * 12 + desde.m;
    minMes = Math.min(minMes, mes); maxMes = Math.max(maxMes, mes);
    if (!p.meses.has(mes)) p.meses.set(mes, []);
    p.meses.get(mes).push({ d1: desde.d, d2: hasta.d, fsv: parsearValor(f[4]), sob: parsearValor(f[5]), rec: parsearValor(f[6]) });
  }

  // 2) Por peaje y mes: agrupar periodos traslapados y resolver versiones
  const salida = [];
  for (const p of peajes.values()) {
    const info = new Map();
    for (const [mes, regs] of p.meses) {
      regs.sort((a, b) => a.d1 - b.d1 || a.d2 - b.d2);
      const grupos = [];
      for (const r of regs) {
        const g = grupos[grupos.length - 1];
        if (g && r.d1 <= g.d2) { g.regs.push(r); g.d2 = Math.max(g.d2, r.d2); }
        else grupos.push({ d1: r.d1, d2: r.d2, regs: [r] });
      }
      const dim = diasDelMes(Math.floor(mes / 12), mes % 12);
      const dias = grupos.reduce((s, g) => s + (g.d2 - g.d1 + 1), 0);
      info.set(mes, { grupos, dim, dias, ambiguo: grupos.some((g) => g.regs.length > 1) });
    }
    // Meses "limpios": un solo registro por periodo, mes completo y recaudo positivo.
    // Sirven de referencia; los meses ya resueltos también, para que una racha de
    // meses con versiones se resuelva de forma coherente (en orden cronológico).
    const limpio = new Map();
    for (const [mes, x] of info) {
      if (x.ambiguo || x.dias < x.dim) continue;
      const total = x.grupos.reduce((s, g) => s + g.regs[0].rec, 0);
      if (total > 0) limpio.set(mes, total);
    }
    const resuelto = new Map(limpio);
    const referencia = (mes) => {
      const v = [];
      for (const [dir, fuente] of [[-1, resuelto], [1, limpio]]) {
        let n = 0;
        for (let k = 1; k <= 12 && n < 3; k++) {
          const val = fuente.get(mes + dir * k);
          if (val !== undefined) { v.push(val); n++; }
        }
      }
      return v.length ? mediana(v) : null;
    };

    const mesesOrd = [...info.keys()].sort((a, b) => a - b);
    const ini = mesesOrd[0], fin = mesesOrd[mesesOrd.length - 1];
    const n = fin - ini + 1;
    const r = new Array(n).fill(null), fsv = new Array(n).fill(null), sob = new Array(n).fill(null);
    const parciales = {}, versiones = [];
    for (const mes of mesesOrd) {
      const x = info.get(mes);
      let rec = 0, f = 0, s = 0;
      const ref = x.ambiguo ? referencia(mes) : null;
      for (const g of x.grupos) {
        let elegido = g.regs[0];
        if (g.regs.length > 1) {
          const positivos = g.regs.filter((q) => q.rec > 0);
          if (positivos.length) {
            const refG = ref === null ? null : ref * (g.d2 - g.d1 + 1) / x.dim;
            elegido = positivos.reduce((mejor, q) => {
              if (refG === null) return q.rec > mejor.rec ? q : mejor;
              return Math.abs(Math.log(q.rec / refG)) < Math.abs(Math.log(mejor.rec / refG)) ? q : mejor;
            });
          }
          calidad.versionesDescartadas += g.regs.length - 1;
          versiones.push({ mes: mes - minMes, candidatos: g.regs.map((q) => q.rec), elegido: elegido.rec });
        }
        rec += elegido.rec; f += elegido.fsv; s += elegido.sob;
      }
      const i = mes - ini;
      r[i] = rec; fsv[i] = f; sob[i] = s;
      if (x.ambiguo) { calidad.mesesConVersiones++; if (rec > 0 && x.dias >= x.dim) resuelto.set(mes, rec); }
      if (x.grupos.length > 1) calidad.mesesDivididos++;
      if (x.dias < x.dim) { parciales[mes - minMes] = [x.dias, x.dim]; calidad.mesesParciales++; }
    }
    calidad.mesesSinRegistro += r.filter((v) => v === null).length;
    salida.push({ id: p.id, nombre: p.nombre, ini: ini - minMes, r, fsv, sob, parciales, versiones, duplicados: p.duplicados });
  }
  salida.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return {
    anioInicio: Math.floor(minMes / 12), mesInicio: minMes % 12, nMeses: maxMes - minMes + 1,
    calidad, peajes: salida,
  };
}

module.exports = { limpiar, parsearCSV, parsearFecha, parsearValor };
