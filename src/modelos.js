/*
 * Modelos de estimación, métricas y estadísticos descriptivos.
 * Sin dependencias: funciona igual en el navegador (window.Modelos) y en Node (pruebas).
 *
 * Convenciones:
 *  - Las series son arreglos mensuales alineados a un calendario común (índice 0 = primer mes).
 *  - `null` significa "sin registro".
 *  - Los modelos trabajan sobre log(recaudo): la estacionalidad y el crecimiento son
 *    multiplicativos y la estimación nunca es negativa.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Modelos = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const S = 12; // periodo estacional (meses)

  // ---------------------------------------------------------------- utilidades
  const suma = (v) => v.reduce((a, b) => a + b, 0);
  const media = (v) => (v.length ? suma(v) / v.length : NaN);
  function cuantil(ordenado, q) {
    if (!ordenado.length) return NaN;
    const pos = (ordenado.length - 1) * q, i = Math.floor(pos), f = pos - i;
    return i + 1 < ordenado.length ? ordenado[i] + f * (ordenado[i + 1] - ordenado[i]) : ordenado[i];
  }
  const mediana = (v) => cuantil([...v].sort((a, b) => a - b), 0.5);
  function desviacion(v) {
    if (v.length < 2) return NaN;
    const m = media(v);
    return Math.sqrt(suma(v.map((x) => (x - m) ** 2)) / (v.length - 1));
  }

  // Cuantil de la normal estándar para un nivel de confianza bilateral
  const Z = { 80: 1.2816, 90: 1.6449, 95: 1.96 };

  // ------------------------------------------------------- meses atípicos
  // Solo se evalúa el tramo de entrenamiento (no se mira el periodo de prueba).
  //   'cero'  : mes sin recaudo
  //   'caida' : recaudo < 50 % de la mediana de los 6 meses anteriores y 6 posteriores
  //   'pico'  : recaudo > 250 % de esa mediana
  const UMBRAL_CAIDA = 0.5, UMBRAL_PICO = 2.5, VENTANA = 6;
  function detectarAtipicos(y) {
    const n = y.length, marcas = new Array(n).fill(null);
    for (let t = 0; t < n; t++) {
      if (y[t] === null) continue;
      if (y[t] === 0) { marcas[t] = 'cero'; continue; }
      const vecinos = [];
      for (let k = Math.max(0, t - VENTANA); k <= Math.min(n - 1, t + VENTANA); k++) {
        if (k !== t && y[k] !== null && y[k] > 0) vecinos.push(y[k]);
      }
      if (vecinos.length < 4) continue;
      const razon = y[t] / mediana(vecinos);
      if (razon < UMBRAL_CAIDA) marcas[t] = 'caida';
      else if (razon > UMBRAL_PICO) marcas[t] = 'pico';
    }
    return marcas;
  }

  // ---------------------------------------------------- mínimos cuadrados
  // Resuelve (X'X) b = X'y por Gauss-Jordan; devuelve coeficientes e inversa de X'X.
  function mco(X, y) {
    const n = X.length, p = X[0].length;
    const A = Array.from({ length: p }, () => new Array(2 * p + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const x = X[i];
      for (let a = 0; a < p; a++) {
        if (x[a] === 0) continue;
        for (let b = 0; b < p; b++) A[a][b] += x[a] * x[b];
        A[a][2 * p] += x[a] * y[i];
      }
    }
    for (let a = 0; a < p; a++) A[a][p + a] = 1;
    for (let c = 0; c < p; c++) {
      let piv = c;
      for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-9) return null; // matriz singular
      [A[c], A[piv]] = [A[piv], A[c]];
      const d = A[c][c];
      for (let k = 0; k <= 2 * p; k++) A[c][k] /= d;
      for (let r = 0; r < p; r++) {
        if (r === c) continue;
        const f = A[r][c];
        if (f !== 0) for (let k = 0; k <= 2 * p; k++) A[r][k] -= f * A[c][k];
      }
    }
    const beta = A.map((f) => f[2 * p]);
    const inv = A.map((f) => f.slice(p, 2 * p));
    let sse = 0;
    for (let i = 0; i < n; i++) {
      let e = y[i];
      for (let a = 0; a < p; a++) e -= X[i][a] * beta[a];
      sse += e * e;
    }
    return { beta, inv, sse, n, p };
  }

  // Fila de diseño: intercepto, tendencia (en años) y 11 indicadores de mes (enero = base)
  function filaTendenciaMes(t) {
    const x = new Array(S + 1).fill(0);
    x[0] = 1; x[1] = t / S;
    const m = t % S;
    if (m > 0) x[1 + m] = 1;
    return x;
  }

  const esValido = (v) => v === v; // no es NaN
  const indicesValidos = (z) => { const r = []; for (let t = 0; t < z.length; t++) if (esValido(z[t])) r.push(t); return r; };

  // -------------------------------------------------------------- modelos
  // Cada modelo recibe z (log del recaudo de entrenamiento, NaN = no usar) y el
  // horizonte H. Devuelve { ok, ajustado[T], mu[H], sd[H], detalle } en escala log,
  // o { ok:false, motivo }.

  // Último valor válido del mismo mes calendario, hasta 3 años atrás.
  function mismoMesAnterior(z, t) {
    for (let k = 1; k <= 3; k++) {
      const u = t - S * k;
      if (u < 0) break;
      if (u < z.length && esValido(z[u])) return { valor: z[u], saltos: k };
    }
    return null;
  }

  function estacionalIngenuo(z, H, conCrecimiento) {
    const T = z.length;
    const validos = indicesValidos(z);
    // Diferencias interanuales (log): z[t] - z[t-12]
    const difs = [], difsRecientes = [];
    for (const t of validos) {
      if (t - S >= 0 && esValido(z[t - S])) {
        difs.push(z[t] - z[t - S]);
        if (t >= T - 36) difsRecientes.push(z[t] - z[t - S]);
      }
    }
    let g = 0;
    if (conCrecimiento) {
      if (difsRecientes.length < 6) return { ok: false, motivo: 'Se requieren al menos 6 comparaciones interanuales en los últimos 3 años de entrenamiento.' };
      g = mediana(difsRecientes);
    }
    const ajustado = new Array(T).fill(NaN);
    for (let t = 0; t < T; t++) {
      const ant = mismoMesAnterior(z, t);
      if (ant) ajustado[t] = ant.valor + g * ant.saltos;
    }
    const residuos = difs.map((d) => d - g);
    const sigma = residuos.length >= 3 ? Math.sqrt(suma(residuos.map((e) => e * e)) / residuos.length) : NaN;
    const ultimos = validos.slice(-12).map((t) => z[t]);
    const mu = [], sd = [];
    let conRespaldo = 0;
    for (let h = 1; h <= H; h++) {
      const t = T + h - 1;
      let k = 1;
      while (t - S * k >= T) k++; // primer año hacia atrás dentro del entrenamiento
      let base = null, saltos = k;
      for (; saltos <= k + 2; saltos++) {
        const u = t - S * saltos;
        if (u >= 0 && esValido(z[u])) { base = z[u]; break; }
      }
      if (base === null) { base = media(ultimos); saltos = k; conRespaldo++; }
      mu.push(base + g * saltos);
      sd.push(sigma * Math.sqrt(saltos * (conCrecimiento ? 1 + saltos / Math.max(difsRecientes.length, 1) : 1)));
    }
    return {
      ok: true, ajustado, mu, sd,
      detalle: { crecimientoAnual: conCrecimiento ? Math.exp(g) - 1 : null, sigma, mesesConRespaldo: conRespaldo },
    };
  }

  function regresion(z, H) {
    const T = z.length;
    const validos = indicesValidos(z);
    if (validos.length < 24) return { ok: false, motivo: 'Se requieren al menos 24 meses válidos de entrenamiento.' };
    if (new Set(validos.map((t) => t % S)).size < S) return { ok: false, motivo: 'El entrenamiento no cubre los 12 meses del año.' };
    const aj = mco(validos.map(filaTendenciaMes), validos.map((t) => z[t]));
    if (!aj) return { ok: false, motivo: 'No fue posible ajustar la regresión.' };
    const gl = aj.n - aj.p;
    const s2 = gl > 0 ? aj.sse / gl : NaN;
    const pred = (t) => { const x = filaTendenciaMes(t); let v = 0; for (let a = 0; a < x.length; a++) v += x[a] * aj.beta[a]; return v; };
    const ajustado = new Array(T).fill(NaN);
    for (let t = validos[0]; t < T; t++) ajustado[t] = pred(t);
    const mu = [], sd = [];
    for (let h = 1; h <= H; h++) {
      const t = T + h - 1, x = filaTendenciaMes(t);
      let q = 0; // x' (X'X)^-1 x
      for (let a = 0; a < x.length; a++) { if (x[a] === 0) continue; for (let b = 0; b < x.length; b++) q += x[a] * aj.inv[a][b] * x[b]; }
      mu.push(pred(t));
      sd.push(Math.sqrt(s2 * (1 + q)));
    }
    return { ok: true, ajustado, mu, sd, detalle: { crecimientoAnual: Math.exp(aj.beta[1]) - 1, sigma: Math.sqrt(s2), n: aj.n } };
  }

  // Holt-Winters aditivo sobre log (= multiplicativo en pesos), en forma de corrección
  // de error:  nivel += tend + alfa·e ;  tend += beta·e ;  est[mes] += gamma·e.
  // Un mes sin dato no actualiza el estado (e = 0). Los parámetros se eligen en una
  // rejilla minimizando el error cuadrático a un paso dentro del entrenamiento.
  const REJILLA = {
    alfa: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8],
    beta: [0, 0.005, 0.02, 0.05, 0.1],
    gamma: [0, 0.05, 0.1, 0.2, 0.3],
  };
  function hwRecorrer(z, t0, ini, a, b, g, salida) {
    let nivel = ini.nivel, tend = ini.tend, sse = 0, n = 0;
    const est = ini.est.slice();
    for (let t = t0; t < z.length; t++) {
      const m = t % S, pred = nivel + tend + est[m];
      let e = 0;
      if (esValido(z[t])) { e = z[t] - pred; sse += e * e; n++; }
      if (salida) salida[t] = pred;
      nivel = nivel + tend + a * e;
      tend += b * e;
      est[m] += g * e;
    }
    return { sse, n, nivel, tend, est };
  }
  function holtWinters(z, H) {
    const T = z.length;
    const validos = indicesValidos(z);
    if (validos.length < 24) return { ok: false, motivo: 'Se requieren al menos 24 meses válidos de entrenamiento.' };
    const t0 = validos[0];
    // Estado inicial: regresión tendencia + mes sobre los primeros 36 meses válidos
    const base = validos.slice(0, 36);
    let ini = null;
    if (new Set(base.map((t) => t % S)).size === S) {
      const aj = mco(base.map(filaTendenciaMes), base.map((t) => z[t]));
      if (aj) {
        const coef = [0, ...aj.beta.slice(2)], prom = media(coef);
        ini = { nivel: aj.beta[0] + prom + aj.beta[1] * (t0 - 1) / S, tend: aj.beta[1] / S, est: coef.map((c) => c - prom) };
      }
    }
    if (!ini) ini = { nivel: media(base.slice(0, 12).map((t) => z[t])), tend: 0, est: new Array(S).fill(0) };

    let mejor = null;
    for (const a of REJILLA.alfa) for (const b of REJILLA.beta) {
      if (b > a) continue;
      for (const g of REJILLA.gamma) {
        if (g > 1 - a) continue;
        const r = hwRecorrer(z, t0, ini, a, b, g, null);
        if (!mejor || r.sse < mejor.sse) mejor = { sse: r.sse, a, b, g };
      }
    }
    const { a, b, g } = mejor;
    const ajustado = new Array(T).fill(NaN);
    const fin = hwRecorrer(z, t0, ini, a, b, g, ajustado);
    const sigma2 = fin.sse / Math.max(fin.n - 3, 1);
    const mu = [], sd = [];
    let varAcum = 1; // var(h) = sigma² · (1 + Σ_{j<h} c_j²),  c_j = alfa + beta·j + gamma·[j múltiplo de 12]
    for (let h = 1; h <= H; h++) {
      mu.push(fin.nivel + h * fin.tend + fin.est[(T + h - 1) % S]);
      sd.push(Math.sqrt(sigma2 * varAcum));
      const c = a + b * h + (h % S === 0 ? g : 0);
      varAcum += c * c;
    }
    return {
      ok: true, ajustado, mu, sd,
      detalle: { alfa: a, beta: b, gamma: g, crecimientoAnual: Math.exp(S * fin.tend) - 1, sigma: Math.sqrt(sigma2), n: fin.n },
    };
  }

  const MODELOS = [
    { id: 'hw', nombre: 'Holt-Winters', corto: 'Holt-Winters',
      descripcion: 'Suavizamiento exponencial triple: nivel, tendencia y estacionalidad multiplicativa. Da más peso a los meses recientes.',
      ajustar: (z, H) => holtWinters(z, H) },
    { id: 'reg', nombre: 'Regresión log-lineal', corto: 'Regresión',
      descripcion: 'Tendencia de crecimiento constante más un efecto fijo por mes del año, estimados por mínimos cuadrados sobre todo el entrenamiento.',
      ajustar: (z, H) => regresion(z, H) },
    { id: 'crec', nombre: 'Estacional con crecimiento', corto: 'Estac. + crecimiento',
      descripcion: 'Repite el último valor observado del mismo mes y le aplica el crecimiento interanual mediano de los últimos 3 años de entrenamiento.',
      ajustar: (z, H) => estacionalIngenuo(z, H, true) },
    { id: 'ing', nombre: 'Estacional ingenuo', corto: 'Estac. ingenuo',
      descripcion: 'Línea base: repite el último valor observado del mismo mes del año, sin crecimiento.',
      ajustar: (z, H) => estacionalIngenuo(z, H, false) },
  ];

  // --------------------------------------------------- estimación completa
  /*
   * serie: { y: [..] recaudo mensual alineado al calendario (null = sin registro),
   *          parcial: Set de índices con mes incompleto }
   * corte: número de meses de entrenamiento (los primeros `corte` meses del calendario).
   */
  const MIN_VALIDOS = 3, MESES_RECIENTES = 12;
  function prepararEntrenamiento(serie, corte) {
    const yTrain = serie.y.slice(0, corte);
    const atipicos = detectarAtipicos(yTrain);
    const z = yTrain.map((v, t) => (v === null || v <= 0 || atipicos[t] || serie.parcial.has(t) ? NaN : Math.log(v)));
    const validos = indicesValidos(z);
    let motivo = null;
    if (!yTrain.some((v) => v !== null)) motivo = 'El peaje no tiene registros en el periodo de entrenamiento.';
    else if (!yTrain.some((v) => v !== null && v > 0)) motivo = 'El peaje no registra recaudo (todos los meses en cero) en el periodo de entrenamiento.';
    else if (validos.length < MIN_VALIDOS) motivo = `El peaje tiene menos de ${MIN_VALIDOS} meses completos con recaudo en el entrenamiento.`;
    else if (validos[validos.length - 1] < corte - MESES_RECIENTES) motivo = 'El peaje no registra recaudo en los 12 meses previos al corte de entrenamiento, por lo que no hay base para estimar el periodo de prueba.';
    return { z, atipicos, nValidos: validos.length, motivo };
  }

  function estimar(serie, corte, modelo, nivelConfianza) {
    const H = serie.y.length - corte;
    const prep = prepararEntrenamiento(serie, corte);
    if (prep.motivo) return { ok: false, motivo: prep.motivo, prep };
    const r = modelo.ajustar(prep.z, H);
    if (!r.ok) return { ok: false, motivo: r.motivo, prep };
    const z = Z[nivelConfianza] || Z[95];
    const ajustado = r.ajustado.map((v) => (esValido(v) ? Math.exp(v) : null));
    const est = r.mu.map((m) => Math.exp(m));
    const inf = r.mu.map((m, i) => (esValido(r.sd[i]) ? Math.exp(m - z * r.sd[i]) : null));
    const sup = r.mu.map((m, i) => (esValido(r.sd[i]) ? Math.exp(m + z * r.sd[i]) : null));
    const real = serie.y.slice(corte);
    const comparable = real.map((v, i) => v !== null && !serie.parcial.has(corte + i));
    return {
      ok: true, prep, detalle: r.detalle, ajustado, est, inf, sup, real, comparable,
      metricas: metricas(real, est, inf, sup, comparable),
      metricasAjuste: metricas(serie.y.slice(0, corte), ajustado, null, null, prep.z.map(esValido)),
    };
  }

  // Métricas sobre los meses comparables (con registro real y mes completo)
  function metricas(real, est, inf, sup, comparable) {
    let n = 0, sAbs = 0, sCuad = 0, sErr = 0, sReal = 0, sEst = 0, sPct = 0, nPct = 0, dentro = 0, nInt = 0;
    for (let i = 0; i < real.length; i++) {
      if (!comparable[i] || est[i] === null || est[i] === undefined) continue;
      const e = est[i] - real[i];
      n++; sAbs += Math.abs(e); sCuad += e * e; sErr += e; sReal += real[i]; sEst += est[i];
      if (real[i] > 0) { sPct += Math.abs(e) / real[i]; nPct++; }
      if (inf && inf[i] !== null) { nInt++; if (real[i] >= inf[i] && real[i] <= sup[i]) dentro++; }
    }
    if (!n) return { n: 0 };
    return {
      n, mae: sAbs / n, rmse: Math.sqrt(sCuad / n),
      mape: nPct ? sPct / nPct : null,
      wape: sReal > 0 ? sAbs / sReal : null,
      sesgo: sReal > 0 ? sErr / sReal : null,
      totalReal: sReal, totalEst: sEst,
      cobertura: nInt ? dentro / nInt : null,
    };
  }

  // ------------------------------------------------- resumen estadístico
  /*
   * serie: { y, fsv, sob (alineados al calendario, null = sin registro), parcial: Set }
   * Los estadísticos de nivel (promedio, mediana, dispersión, extremos) se calculan sobre
   * los meses completos con recaudo; los totales incluyen todos los registros.
   */
  function resumen(serie, anioInicio) {
    const { y, fsv, sob, parcial } = serie;
    const conRegistro = [], completos = [];
    for (let t = 0; t < y.length; t++) {
      if (y[t] === null) continue;
      conRegistro.push(t);
      if (y[t] > 0 && !parcial.has(t)) completos.push(t);
    }
    if (!conRegistro.length) return null;
    const primero = conRegistro[0], ultimo = conRegistro[conRegistro.length - 1];
    const vals = completos.map((t) => y[t]);
    const ord = [...vals].sort((a, b) => a - b);
    const total = suma(conRegistro.map((t) => y[t]));
    const totalFsv = fsv ? suma(conRegistro.map((t) => fsv[t] || 0)) : null;
    const totalSob = sob ? suma(conRegistro.map((t) => sob[t] || 0)) : null;
    const prom = media(vals), de = desviacion(vals);
    let iMin = null, iMax = null;
    for (const t of completos) {
      if (iMin === null || y[t] < y[iMin]) iMin = t;
      if (iMax === null || y[t] > y[iMax]) iMax = t;
    }

    // Totales por año calendario y si el año está completo (12 meses completos con recaudo)
    const anios = new Map();
    for (const t of conRegistro) {
      const a = anioInicio + Math.floor(t / S);
      if (!anios.has(a)) anios.set(a, { anio: a, total: 0, meses: 0, completos: 0 });
      const o = anios.get(a);
      o.total += y[t]; o.meses++;
      if (y[t] > 0 && !parcial.has(t)) o.completos++;
    }
    const porAnio = [...anios.values()].sort((a, b) => a.anio - b.anio);
    const aniosCompletos = porAnio.filter((o) => o.completos === S);
    let tcac = null;
    if (aniosCompletos.length >= 2) {
      const a0 = aniosCompletos[0], a1 = aniosCompletos[aniosCompletos.length - 1];
      tcac = { desde: a0.anio, hasta: a1.anio, valor: (a1.total / a0.total) ** (1 / (a1.anio - a0.anio)) - 1 };
    }

    // Índice estacional: por mes del año, mediana (entre años completos) del recaudo del mes
    // relativo al promedio mensual de su año. La mediana evita que un año anómalo (2020) lo sesgue.
    let estacional = null;
    if (aniosCompletos.length >= 1) {
      const indices = [];
      for (let m = 0; m < S; m++) {
        indices.push(mediana(aniosCompletos.map((o) => y[(o.anio - anioInicio) * S + m] / (o.total / S))));
      }
      estacional = { indices, anios: aniosCompletos.length };
      estacional.mesPico = indices.indexOf(Math.max(...indices));
      estacional.mesValle = indices.indexOf(Math.min(...indices));
    }

    return {
      primero, ultimo,
      mesesConRegistro: conRegistro.length,
      mesesSinRegistro: ultimo - primero + 1 - conRegistro.length,
      mesesEnCero: conRegistro.filter((t) => y[t] === 0).length,
      mesesParciales: conRegistro.filter((t) => parcial.has(t)).length,
      mesesCompletos: completos.length,
      total, totalFsv, totalSob,
      promedio: prom, mediana: cuantil(ord, 0.5), desviacion: de,
      cv: prom > 0 && esValido(de) ? de / prom : null,
      p25: cuantil(ord, 0.25), p75: cuantil(ord, 0.75),
      minimo: iMin === null ? null : { valor: y[iMin], mes: iMin },
      maximo: iMax === null ? null : { valor: y[iMax], mes: iMax },
      porAnio, tcac, estacional,
    };
  }

  return { S, Z, MODELOS, detectarAtipicos, mco, prepararEntrenamiento, estimar, metricas, resumen, cuantil, mediana, media, desviacion };
});
