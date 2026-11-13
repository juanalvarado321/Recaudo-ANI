/* Interfaz de la aplicación. Depende de window.DATOS (series limpias), window.Modelos y Chart.js. */
(function () {
  'use strict';

  const D = window.DATOS, M = window.Modelos, Chart = window.Chart;
  const N = D.nMeses;
  const ANIOS_ENTRENAMIENTO = 10;
  const CORTE = ANIOS_ENTRENAMIENTO * 12; // meses de entrenamiento: los primeros 10 años
  const H = N - CORTE;                    // meses de prueba: el resto

  const MARINO = '#1d3557', NARANJA = '#d9661f', GRIS = '#4a5665', REJA = '#e9e5da';
  const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // ------------------------------------------------------------- formato
  const nf = [0, 1, 2, 3].map((d) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const num = (v, d = 0) => (v === null || v === undefined || !isFinite(v) ? '—' : nf[d].format(v).replace('-', '−'));
  const millones = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : num(v / 1e6, Math.abs(v) > 0 && Math.abs(v) < 1e7 ? 1 : 0));
  function pesos(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e12) return `$\u00a0${num(v / 1e12, 2)} billones`;
    if (a >= 1e9) return `$\u00a0${num(v / 1e6, 0)} millones`;
    if (a >= 1e6) return `$\u00a0${num(v / 1e6, 1)} millones`;
    return `$\u00a0${num(v, 0)}`;
  }
  const pct = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? '—' : `${num(v * 100, d)}\u00a0%`);
  const pctSigno = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${num(v * 100, d)}\u00a0%`);
  const anioDe = (i) => D.anioInicio + Math.floor(i / 12);
  const mesCorto = (i) => `${MESES_CORTO[i % 12]} ${anioDe(i)}`;
  const mesLargo = (i) => `${MESES_LARGO[i % 12]} de ${anioDe(i)}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const $ = (id) => document.getElementById(id);
  const plural = (n, uno, varios) => `${num(n)} ${n === 1 ? uno : varios}`;

  const PERIODO_ENTRENAMIENTO = `${mesCorto(0)} – ${mesCorto(CORTE - 1)}`;
  const PERIODO_PRUEBA = `${mesCorto(CORTE)} – ${mesCorto(N - 1)}`;

  // -------------------------------------------------------------- series
  function alinear(p, campo) {
    const v = new Array(N).fill(null);
    p[campo].forEach((x, i) => { v[p.ini + i] = x; });
    return v;
  }
  const peajes = D.peajes.map((p) => ({
    clave: String(p.id), id: p.id, nombre: p.nombre, titulo: `Peaje ${p.nombre}`, esTotal: false,
    y: alinear(p, 'r'), fsv: alinear(p, 'fsv'), sob: alinear(p, 'sob'),
    parcial: new Set(Object.keys(p.parciales).map(Number)), parciales: p.parciales,
    versiones: p.versiones, duplicados: p.duplicados,
  }));
  const total = {
    clave: 'TOTAL', id: null, nombre: 'Total nacional', titulo: `Total nacional (${D.peajes.length} peajes)`, esTotal: true,
    y: new Array(N).fill(0), fsv: new Array(N).fill(0), sob: new Array(N).fill(0),
    parcial: new Set(), parciales: {}, versiones: [], duplicados: D.calidad.duplicadosExactos,
    nPeajes: new Array(N).fill(0),
  };
  for (const p of peajes) {
    for (let t = 0; t < N; t++) {
      if (p.y[t] === null) continue;
      total.y[t] += p.y[t]; total.fsv[t] += p.fsv[t]; total.sob[t] += p.sob[t]; total.nPeajes[t]++;
    }
  }
  const series = [total, ...peajes];
  const porClave = new Map(series.map((s) => [s.clave, s]));
  const granTotal = total.y.reduce((a, b) => a + b, 0);

  // Resultados en caché: se calculan una vez por serie / modelo / nivel de confianza
  const cacheRes = new Map(), cacheEst = new Map();
  function resumenDe(s) {
    if (!cacheRes.has(s.clave)) cacheRes.set(s.clave, M.resumen(s, D.anioInicio));
    return cacheRes.get(s.clave);
  }
  function estimacionDe(s, modelo, ic) {
    const k = `${s.clave}|${modelo.id}|${ic}`;
    if (!cacheEst.has(k)) cacheEst.set(k, M.estimar(s, CORTE, modelo, ic));
    return cacheEst.get(k);
  }
  const modeloPorId = (id) => M.MODELOS.find((m) => m.id === id) || M.MODELOS[0];

  // -------------------------------------------------------------- estado
  const estado = { clave: 'TOTAL', modelo: M.MODELOS[0].id, ic: 95, tab: 'estimacion', rango: 'todo', orden: { col: 'total', dir: -1 }, filtro: '' };
  const TABS = ['estimacion', 'resumen', 'peajes', 'metodo'];

  function leerHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (porClave.has(q.get('peaje'))) estado.clave = q.get('peaje');
    if (M.MODELOS.some((m) => m.id === q.get('modelo'))) estado.modelo = q.get('modelo');
    if (M.Z[q.get('ic')]) estado.ic = Number(q.get('ic'));
    if (TABS.includes(q.get('tab'))) estado.tab = q.get('tab');
  }
  function escribirHash() {
    const q = new URLSearchParams({ peaje: estado.clave, modelo: estado.modelo, ic: estado.ic, tab: estado.tab });
    try { history.replaceState(null, '', `#${q}`); } catch (e) { /* p. ej. documentos sin historial */ }
  }

  function contexto() {
    const s = porClave.get(estado.clave);
    const modelo = modeloPorId(estado.modelo);
    const ests = M.MODELOS.map((m) => estimacionDe(s, m, estado.ic));
    return { s, modelo, ests, sel: ests[M.MODELOS.indexOf(modelo)], res: resumenDe(s), ic: estado.ic };
  }

  // ------------------------------------------------------------ gráficos
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = GRIS;
  Chart.defaults.animation = false;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxHeight = 7;
  Chart.defaults.plugins.tooltip.backgroundColor = '#18212c';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.boxPadding = 4;

  // Sombrea el periodo de prueba y marca el corte entrenamiento / prueba
  const pluginCorte = {
    id: 'corte',
    beforeDatasetsDraw(chart, _args, opc) {
      if (opc.indice === undefined || opc.indice === null) return;
      const { ctx, chartArea: a, scales: { x } } = chart;
      const xc = (x.getPixelForValue(opc.indice - 1) + x.getPixelForValue(opc.indice)) / 2;
      if (xc >= a.right) return;
      const x0 = Math.max(xc, a.left);
      ctx.save();
      ctx.fillStyle = 'rgba(29, 53, 87, .055)';
      ctx.fillRect(x0, a.top, a.right - x0, a.bottom - a.top);
      ctx.font = `600 11px ${Chart.defaults.font.family}`;
      ctx.fillStyle = GRIS;
      ctx.textBaseline = 'top';
      if (xc > a.left) {
        ctx.strokeStyle = 'rgba(29, 53, 87, .55)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xc, a.top); ctx.lineTo(xc, a.bottom); ctx.stroke();
        if (xc - a.left > 110) { ctx.textAlign = 'right'; ctx.fillText('ENTRENAMIENTO', xc - 8, a.top + 6); }
      }
      if (a.right - x0 > 60) { ctx.textAlign = 'left'; ctx.fillText('PRUEBA', x0 + 8, a.top + 6); }
      ctx.restore();
    },
  };

  const instancias = new Map();
  function dibujar(idLienzo, config, descripcion) {
    if (instancias.has(idLienzo)) instancias.get(idLienzo).destroy();
    const lienzo = $(idLienzo);
    lienzo.setAttribute('aria-label', descripcion);
    instancias.set(idLienzo, new Chart(lienzo, config));
  }
  // Renderiza un gráfico fuera de pantalla y lo devuelve como imagen PNG (para el reporte)
  function imagenDe(config, ancho, alto) {
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho; lienzo.height = alto;
    lienzo.style.width = `${ancho}px`; lienzo.style.height = `${alto}px`;
    $('taller').appendChild(lienzo);
    config.options = Object.assign({}, config.options, { responsive: false, devicePixelRatio: 2 });
    const g = new Chart(lienzo, config);
    const url = g.toBase64Image('image/png', 1);
    g.destroy(); lienzo.remove();
    return url;
  }

  const ejeMillones = { callback: (v) => num(v / 1e6, 0), maxTicksLimit: 7 };
  const tituloEje = (texto) => ({ display: true, text: texto, font: { size: 11 }, color: GRIS });

  function inicioRango(rango) {
    if (rango === '2020') return (2020 - D.anioInicio) * 12;
    if (rango === '2023') return (2023 - D.anioInicio) * 12;
    return 0;
  }

  function configPrincipal(ctx, rango) {
    const { s, sel, ic } = ctx;
    const ini = Math.max(0, Math.min(inicioRango(rango), N - 12));
    const visibles = N - ini;
    const vacioTrain = new Array(CORTE).fill(null), vacioTest = new Array(H).fill(null);
    // Un punto real aislado (sin vecinos) no formaría línea: se dibuja como punto
    const aislado = s.y.map((v, t) => v !== null && (t === 0 || s.y[t - 1] === null) && (t === N - 1 || s.y[t + 1] === null));
    const datasets = [{
      label: 'Recaudo real', data: s.y, order: 2, borderColor: MARINO, backgroundColor: MARINO, borderWidth: 1.8,
      pointRadius: (c) => (aislado[c.dataIndex] ? 2.5 : 0), pointHoverRadius: 4, pointStyle: 'line',
    }];
    if (sel.ok) {
      datasets.push({
        label: 'Estimación (prueba)', data: vacioTrain.concat(sel.est), order: 1, borderColor: NARANJA, backgroundColor: NARANJA,
        borderWidth: 2.4, pointRadius: 0, pointHoverRadius: 4, pointStyle: 'line',
      });
      if (sel.inf.some((v) => v !== null)) {
        datasets.push({ label: 'limite-inferior', oculto: true, data: vacioTrain.concat(sel.inf), order: 5, borderWidth: 0, pointRadius: 0, pointHitRadius: 0, fill: false });
        datasets.push({
          label: `Intervalo de ${ic} %`, banda: true, data: vacioTrain.concat(sel.sup), order: 5, borderWidth: 0, pointRadius: 0, pointHitRadius: 0,
          fill: '-1', backgroundColor: 'rgba(217, 102, 31, .17)', pointStyle: 'rect',
        });
      }
      datasets.push({
        label: 'Ajuste en entrenamiento', data: sel.ajustado.concat(vacioTest), order: 3, borderColor: 'rgba(217, 102, 31, .8)', backgroundColor: 'rgba(217, 102, 31, .8)',
        borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0, pointHoverRadius: 3, pointStyle: 'line',
      });
      const excl = s.y.map((v, t) => (t < CORTE && v !== null && sel.prep.z[t] !== sel.prep.z[t] ? v : null));
      if (excl.some((v) => v !== null)) {
        datasets.push({
          label: 'Mes excluido del ajuste', data: excl, order: 0, showLine: false, pointStyle: 'circle', pointRadius: 3.2, pointHoverRadius: 5,
          pointBackgroundColor: '#fff', pointBorderColor: MARINO, pointBorderWidth: 1.4, backgroundColor: '#fff', borderColor: MARINO,
        });
      }
    }
    // Si el intervalo es mucho más alto que las series, se recorta el eje para que real y
    // estimado sigan siendo legibles (los límites completos están en la tabla de detalle).
    let maxLineas = 0, maxBanda = 0;
    for (let t = ini; t < N; t++) {
      maxLineas = Math.max(maxLineas, s.y[t] || 0);
      if (sel.ok) {
        maxLineas = Math.max(maxLineas, t < CORTE ? (sel.ajustado[t] || 0) : sel.est[t - CORTE]);
        if (t >= CORTE) maxBanda = Math.max(maxBanda, sel.sup[t - CORTE] || 0);
      }
    }
    const ejeY = { beginAtZero: true, grace: '7%', grid: { color: REJA }, border: { display: false }, ticks: Object.assign({ includeBounds: false }, ejeMillones), title: tituloEje('Millones de pesos') };
    if (maxLineas === 0) ejeY.suggestedMax = 1e6;
    const recortado = maxBanda > 1.6 * maxLineas && maxLineas > 0;
    if (recortado) {
      const paso = 10 ** Math.floor(Math.log10(1.6 * maxLineas)) / 2;
      ejeY.max = Math.ceil(1.6 * maxLineas / paso) * paso;
      ejeY.grace = 0;
    }
    return {
      recortado,
      type: 'line',
      data: { labels: s.y.map((_, i) => i), datasets },
      plugins: [pluginCorte],
      options: {
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { right: 8 } },
        scales: {
          x: {
            min: ini,
            grid: { color: (c) => (c.tick && c.tick.value % 12 === 0 ? REJA : 'transparent') },
            ticks: {
              autoSkip: false, maxRotation: 0,
              callback(v) {
                const m = v % 12, estrecho = this.chart.width < 560;
                if (visibles > 60) return m === 0 && (!estrecho || visibles <= 84 || anioDe(v) % 2 === 0) ? String(anioDe(v)) : null;
                if (m === 0) return mesCorto(v);
                return m % (estrecho ? 6 : 3) === 0 ? MESES_CORTO[m] : null;
              },
            },
          },
          y: ejeY,
        },
        plugins: {
          corte: { indice: sel.ok ? CORTE : null },
          legend: { position: 'bottom', labels: { filter: (item, datos) => !datos.datasets[item.datasetIndex].oculto, sort: (a, b) => a.datasetIndex - b.datasetIndex, padding: 16 } },
          tooltip: {
            filter: (item) => !item.dataset.oculto && !item.dataset.banda,
            callbacks: {
              title: (items) => (items.length ? `${mesLargo(items[0].dataIndex)} · ${items[0].dataIndex < CORTE ? 'entrenamiento' : 'prueba'}` : ''),
              label: (item) => ` ${item.dataset.label}: ${pesos(item.parsed.y)}`,
              afterBody(items) {
                if (!items.length || !sel.ok) return [];
                const i = items[0].dataIndex - CORTE;
                if (i < 0) return [];
                const lineas = [];
                if (sel.inf[i] !== null) lineas.push(`Intervalo de ${ic} %: ${millones(sel.inf[i])} – ${millones(sel.sup[i])} millones`);
                if (sel.comparable[i] && sel.real[i] > 0) lineas.push(`Error: ${pctSigno((sel.est[i] - sel.real[i]) / sel.real[i])}`);
                else if (sel.real[i] !== null && !sel.comparable[i]) lineas.push('Mes parcial: no se compara');
                return lineas;
              },
            },
          },
        },
      },
    };
  }

  function configAnual(res) {
    const filas = res.porAnio;
    return {
      type: 'bar',
      data: {
        labels: filas.map((o) => String(o.anio)),
        datasets: [{ data: filas.map((o) => o.total), backgroundColor: filas.map((o) => (o.completos === 12 ? MARINO : '#9fb0c6')), borderRadius: 3, maxBarThickness: 46 }],
      },
      options: {
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: REJA }, border: { display: false }, ticks: ejeMillones, title: tituloEje('Millones de pesos') },
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (it) => ` ${pesos(it.parsed.y)}`, afterLabel: (it) => (filas[it.dataIndex].completos === 12 ? '' : `Año incompleto: ${filas[it.dataIndex].completos} meses completos con recaudo`) } },
        },
      },
    };
  }

  function configEstacional(res) {
    const idx = res.estacional.indices.map((v) => v * 100);
    return {
      type: 'bar',
      data: {
        labels: MESES_CORTO,
        datasets: [{ data: idx, base: 100, backgroundColor: idx.map((v) => (v >= 100 ? MARINO : '#9fb0c6')), borderRadius: 3, maxBarThickness: 40 }],
      },
      options: {
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: (c) => (c.tick && c.tick.value === 100 ? '#8d97a5' : REJA) }, border: { display: false },
            min: Math.min(90, Math.floor((Math.min(...idx) - 1) / 10) * 10), max: Math.max(110, Math.ceil((Math.max(...idx) + 1) / 10) * 10),
            ticks: { stepSize: Math.max(...idx) - Math.min(...idx) > 80 ? 20 : 10 }, title: tituloEje('Índice (100 = promedio del año)'),
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (it) => MESES_LARGO[it[0].dataIndex], label: (it) => ` Índice ${num(idx[it.dataIndex], 1)} (${pctSigno(idx[it.dataIndex] / 100 - 1)} frente al promedio)` } },
        },
      },
    };
  }

  function histograma(s) {
    const vals = [];
    for (let t = 0; t < N; t++) if (s.y[t] !== null && s.y[t] > 0 && !s.parcial.has(t)) vals.push(s.y[t]);
    if (vals.length < 5) return null;
    const min = Math.min(...vals), max = Math.max(...vals);
    if (max === min) return null;
    const k = Math.max(6, Math.min(14, Math.ceil(Math.sqrt(vals.length))));
    const ancho = (max - min) / k;
    const cuenta = new Array(k).fill(0);
    for (const v of vals) cuenta[Math.min(k - 1, Math.floor((v - min) / ancho))]++;
    return { cuenta, limites: cuenta.map((_, i) => [min + i * ancho, min + (i + 1) * ancho]), n: vals.length };
  }
  function configDistribucion(h) {
    return {
      type: 'bar',
      data: {
        labels: h.limites.map(([a]) => millones(a)),
        datasets: [{ data: h.cuenta, backgroundColor: MARINO, borderRadius: 2, barPercentage: 1, categoryPercentage: 0.94 }],
      },
      options: {
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 }, title: tituloEje('Recaudo mensual, límite inferior del rango (millones de pesos)') },
          y: { beginAtZero: true, grid: { color: REJA }, border: { display: false }, ticks: { precision: 0, maxTicksLimit: 6 }, title: tituloEje('Número de meses') },
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (it) => `${millones(h.limites[it[0].dataIndex][0])} – ${millones(h.limites[it[0].dataIndex][1])} millones`, label: (it) => ` ${plural(it.parsed.y, 'mes', 'meses')} (${pct(it.parsed.y / h.n, 0)})` } },
        },
      },
    };
  }

  // ------------------------------------------------- piezas de contenido
  // Estas funciones devuelven HTML y se usan tanto en pantalla como en el reporte.

  function mejorModelo(ests) {
    let mejor = -1;
    ests.forEach((e, i) => {
      if (e.ok && e.metricas.n && e.metricas.wape !== null && (mejor < 0 || e.metricas.wape < ests[mejor].metricas.wape)) mejor = i;
    });
    return mejor;
  }

  function tablaModelos(ctx, interactiva) {
    const mejor = mejorModelo(ctx.ests);
    const filas = M.MODELOS.map((m, i) => {
      const e = ctx.ests[i], sel = m.id === ctx.modelo.id;
      const nombre = interactiva ? `<button type="button" class="enlace" data-modelo="${m.id}" title="${esc(m.descripcion)}">${esc(m.nombre)}</button>` : esc(m.nombre);
      const marcas = i === mejor ? '<span class="insignia">menor error</span>' : '';
      const fila = `<tr class="${sel ? 'seleccionada' : ''}"${sel ? ' aria-current="true"' : ''}>`;
      if (!e.ok) return `${fila}<th scope="row">${nombre}${marcas}</th><td colspan="6" class="izq tenue envolver">No disponible. ${esc(e.motivo)}</td></tr>`;
      const k = e.metricas;
      if (!k.n) return `${fila}<th scope="row">${nombre}${marcas}</th><td colspan="6" class="izq tenue envolver">Sin meses reales comparables en el periodo de prueba.</td></tr>`;
      return `${fila}<th scope="row">${nombre}${marcas}</th><td>${pct(k.wape)}</td><td>${pct(k.mape)}</td><td>${pctSigno(k.sesgo)}</td><td>${millones(k.mae)}</td><td>${millones(k.rmse)}</td><td>${pct(k.cobertura, 0)}</td></tr>`;
    });
    return `<table class="compacta"><thead><tr><th scope="col">Modelo</th><th scope="col">WAPE</th><th scope="col">MAPE</th><th scope="col">Sesgo</th><th scope="col">MAE<br>(mill.)</th><th scope="col">RMSE<br>(mill.)</th><th scope="col">Cobertura<br>IC ${ctx.ic} %</th></tr></thead><tbody>${filas.join('')}</tbody></table>`;
  }

  function filasAnuales(sel) {
    const porAnio = new Map();
    sel.est.forEach((est, i) => {
      if (!sel.comparable[i]) return;
      const a = anioDe(CORTE + i);
      if (!porAnio.has(a)) porAnio.set(a, { anio: a, n: 0, real: 0, est: 0, primero: CORTE + i, ultimo: CORTE + i });
      const o = porAnio.get(a);
      o.n++; o.real += sel.real[i]; o.est += est; o.ultimo = CORTE + i;
    });
    return [...porAnio.values()];
  }
  function tablaAnual(sel) {
    const filas = filasAnuales(sel);
    if (!filas.length) return '<p class="nota">No hay meses reales comparables en el periodo de prueba.</p>';
    const cuerpo = filas.map((o) => {
      const etiqueta = o.n === 12 ? String(o.anio) : `${o.anio} <span class="tenue">(${MESES_CORTO[o.primero % 12]}–${MESES_CORTO[o.ultimo % 12]})</span>`;
      return `<tr><th scope="row">${etiqueta}</th><td>${millones(o.real)}</td><td>${millones(o.est)}</td><td>${millones(o.est - o.real)}</td><td>${o.real > 0 ? pctSigno((o.est - o.real) / o.real) : '—'}</td></tr>`;
    }).join('');
    const k = sel.metricas;
    return `<table><thead><tr><th scope="col">Año</th><th scope="col">Real<br>(mill.)</th><th scope="col">Estimado<br>(mill.)</th><th scope="col">Diferencia<br>(mill.)</th><th scope="col">Diferencia<br>%</th></tr></thead><tbody>${cuerpo}</tbody>` +
      `<tfoot><tr><th scope="row">Total <span class="tenue">(${plural(k.n, 'mes', 'meses')})</span></th><td>${millones(k.totalReal)}</td><td>${millones(k.totalEst)}</td><td>${millones(k.totalEst - k.totalReal)}</td><td>${pctSigno(k.sesgo)}</td></tr></tfoot></table>`;
  }

  function tablaDetalle(ctx) {
    const { sel, s, ic } = ctx;
    const hayIC = sel.inf.some((v) => v !== null);
    const cuerpo = sel.est.map((est, i) => {
      const t = CORTE + i, real = sel.real[i];
      const ic1 = hayIC ? `<td>${millones(sel.inf[i])}</td><td>${millones(sel.sup[i])}</td>` : '';
      if (real === null) return `<tr class="no-comparable"><th scope="row">${mesCorto(t)}</th><td>sin registro</td><td>${millones(est)}</td>${ic1}<td>—</td><td>—</td><td class="izq"></td></tr>`;
      if (!sel.comparable[i]) {
        const [d, dm] = s.parciales[t] || [];
        return `<tr class="no-comparable"><th scope="row">${mesCorto(t)}</th><td>${millones(real)}</td><td>${millones(est)}</td>${ic1}<td>—</td><td>—</td><td class="izq">mes parcial (${d} de ${dm} días)</td></tr>`;
      }
      const fuera = hayIC && sel.inf[i] !== null && (real < sel.inf[i] || real > sel.sup[i]);
      return `<tr class="${fuera ? 'fuera' : ''}"><th scope="row">${mesCorto(t)}</th><td>${millones(real)}</td><td>${millones(est)}</td>${ic1}<td>${millones(est - real)}</td><td>${real > 0 ? pctSigno((est - real) / real) : '—'}</td><td class="izq marca">${[real === 0 ? 'sin recaudo' : '', fuera ? 'fuera del intervalo' : ''].filter(Boolean).join(' · ')}</td></tr>`;
    }).join('');
    const k = sel.metricas;
    const pie = k.n ? `<tfoot><tr><th scope="row">Total comparable</th><td>${millones(k.totalReal)}</td><td>${millones(k.totalEst)}</td>${hayIC ? '<td></td><td></td>' : ''}<td>${millones(k.totalEst - k.totalReal)}</td><td>${pctSigno(k.sesgo)}</td><td></td></tr></tfoot>` : '';
    return `<table><thead><tr><th scope="col">Mes</th><th scope="col">Real</th><th scope="col">Estimado</th>${hayIC ? `<th scope="col">Límite inferior<br>(${ic} %)</th><th scope="col">Límite superior<br>(${ic} %)</th>` : ''}<th scope="col">Error<br>(estimado − real)</th><th scope="col">Error %</th><th scope="col" class="izq">Observación</th></tr></thead><tbody>${cuerpo}</tbody>${pie}</table>`;
  }

  function textoParametros(ctx) {
    const d = ctx.sel.detalle, id = ctx.modelo.id, p = [];
    if (id === 'hw') p.push(`Parámetros de suavizamiento: nivel α = <strong>${num(d.alfa, 2)}</strong>, tendencia β = <strong>${num(d.beta, 3)}</strong>, estacionalidad γ = <strong>${num(d.gamma, 2)}</strong>`, `Crecimiento anual implícito al cierre del entrenamiento: <strong>${pctSigno(d.crecimientoAnual)}</strong>`);
    if (id === 'reg') p.push(`Crecimiento anual estimado (tendencia): <strong>${pctSigno(d.crecimientoAnual)}</strong>`);
    if (id === 'crec') p.push(`Crecimiento interanual mediano aplicado (${anioDe(CORTE - 36)}–${anioDe(CORTE - 1)}): <strong>${pctSigno(d.crecimientoAnual)}</strong>`);
    if (id === 'ing') p.push('Modelo sin parámetros: repite el valor del mismo mes del último año disponible');
    if (d.mesesConRespaldo) p.push(`En ${plural(d.mesesConRespaldo, 'mes', 'meses')} de prueba no había un valor del mismo mes en entrenamiento y se usó el promedio de los últimos meses válidos`);
    if (isFinite(d.sigma)) p.push(`Desviación de los residuos en entrenamiento: <strong>${pct(d.sigma)}</strong> (escala logarítmica)`);
    return p.join('. ') + '.';
  }

  // Meses de entrenamiento con registro que el ajuste no usa, agrupados por motivo
  function excluidos(ctx) {
    const { s, sel } = ctx, r = { cero: [], caida: [], pico: [], parcial: [] };
    const prep = sel.prep;
    for (let t = 0; t < CORTE; t++) {
      if (s.y[t] === null) continue;
      if (prep.atipicos[t]) r[prep.atipicos[t]].push(t);
      else if (s.parcial.has(t)) r.parcial.push(t);
    }
    r.total = r.cero.length + r.caida.length + r.pico.length + r.parcial.length;
    return r;
  }
  function textoExcluidos(ctx) {
    const e = excluidos(ctx);
    if (!e.total) return 'No se excluyó ningún mes del ajuste.';
    const partes = [];
    if (e.cero.length) partes.push(`${plural(e.cero.length, 'mes', 'meses')} sin recaudo`);
    if (e.caida.length) partes.push(`${plural(e.caida.length, 'caída atípica', 'caídas atípicas')}`);
    if (e.pico.length) partes.push(`${plural(e.pico.length, 'pico atípico', 'picos atípicos')}`);
    if (e.parcial.length) partes.push(`${plural(e.parcial.length, 'mes parcial', 'meses parciales')}`);
    return `Se excluyeron del ajuste ${plural(e.total, 'mes', 'meses')} de entrenamiento (${partes.join(', ')}).`;
  }

  function listaMeses(indices, max) {
    const t = indices.slice(0, max).map(mesCorto).join(', ');
    return indices.length > max ? `${t} y ${indices.length - max} más` : t;
  }

  function filasEstadisticos(ctx) {
    const { res, s } = ctx, f = [];
    const hay = res.mesesCompletos > 0;
    f.push(['Promedio mensual', hay ? pesos(res.promedio) : '—']);
    f.push(['Mediana', hay ? pesos(res.mediana) : '—']);
    f.push(['Desviación estándar', res.mesesCompletos > 1 ? pesos(res.desviacion) : '—']);
    f.push(['Coeficiente de variación', pct(res.cv)]);
    f.push(['Mínimo', hay ? `${pesos(res.minimo.valor)} <small>${mesCorto(res.minimo.mes)}</small>` : '—']);
    f.push(['Percentil 25', hay ? pesos(res.p25) : '—']);
    f.push(['Percentil 75', hay ? pesos(res.p75) : '—']);
    f.push(['Máximo', hay ? `${pesos(res.maximo.valor)} <small>${mesCorto(res.maximo.mes)}</small>` : '—']);
    f.push(['Crecimiento anual compuesto', res.tcac ? `${pctSigno(res.tcac.valor)} <small>${res.tcac.desde}–${res.tcac.hasta}</small>` : '— <small>requiere dos años completos</small>']);
    f.push(['Recaudo acumulado', pesos(res.total)]);
    f.push(['Recaudo FSV (y % del recaudo)', `${pesos(res.totalFsv)} <small>${res.total > 0 ? pct(res.totalFsv / res.total, 2) : ''}</small>`]);
    f.push(['Recaudo sobrante (y % del recaudo)', `${pesos(res.totalSob)} <small>${res.total > 0 ? pct(res.totalSob / res.total, 3) : ''}</small>`]);
    if (!s.esTotal) f.push(['Participación nacional', pct(res.total / granTotal, 2)]);
    return f;
  }
  function filasCalidad(ctx) {
    const { res, s } = ctx, f = [];
    f.push(['Primer mes con registro', mesLargo(res.primero)]);
    f.push(['Último mes con registro', mesLargo(res.ultimo)]);
    if (s.esTotal) {
      const np = s.nPeajes;
      f.push(['Peajes con registro por mes', `entre ${Math.min(...np)} y ${Math.max(...np)}`]);
      f.push(['Peajes con registro en el último mes', String(np[N - 1])]);
      f.push(['Meses con registro', String(res.mesesConRegistro)]);
      f.push(['Registros en el archivo', num(D.calidad.registros)]);
      f.push(['Registros duplicados eliminados', num(D.calidad.duplicadosExactos)]);
      f.push(['Versiones alternativas descartadas', `${num(D.calidad.versionesDescartadas)} <small>en ${num(D.calidad.mesesConVersiones)} meses-peaje</small>`]);
      f.push(['Meses-peaje parciales', num(D.calidad.mesesParciales)]);
    } else {
      f.push(['Meses con registro', String(res.mesesConRegistro)]);
      f.push(['Meses completos con recaudo', String(res.mesesCompletos)]);
      f.push(['Meses en cero (sin recaudo)', String(res.mesesEnCero)]);
      f.push(['Meses parciales', String(res.mesesParciales)]);
      f.push(['Meses intermedios sin registro', String(res.mesesSinRegistro)]);
      f.push(['Registros duplicados eliminados', String(s.duplicados)]);
      f.push(['Meses con versiones contradictorias', String(s.versiones.length)]);
    }
    return f;
  }
  const tablaClave = (filas, titulo) => `<table class="tabla-clave"><caption class="solo-lector">${esc(titulo)}</caption><tbody>${filas.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;

  function notasCalidad(ctx) {
    const { s } = ctx, notas = [];
    if (s.esTotal) {
      notas.push('El total suma, mes a mes, el recaudo de todos los peajes con registro. El número de peajes cambia con el tiempo: la entrada o salida de peajes mueve el total aunque el tráfico no cambie.');
      return notas;
    }
    if (s.versiones.length) {
      const ej = s.versiones.slice(0, 3).map((v) => `${mesCorto(v.mes)}, entre ${v.candidatos.map(millones).join(' y ')} se conservó ${millones(v.elegido)}`).join('; ');
      notas.push(`En ${plural(s.versiones.length, 'mes', 'meses')} el archivo trae más de un valor para el mismo periodo. Se conservó el más coherente con los meses vecinos. En millones: ${ej}${s.versiones.length > 3 ? `; y ${s.versiones.length - 3} más` : ''}.`);
    }
    const parciales = Object.keys(s.parciales).map(Number);
    if (parciales.length) notas.push(`Meses parciales (días reportados): ${parciales.slice(0, 6).map((t) => `${mesCorto(t)} (${s.parciales[t][0]} de ${s.parciales[t][1]})`).join(', ')}${parciales.length > 6 ? ` y ${parciales.length - 6} más` : ''}. No se usan para ajustar ni para medir el error.`);
    return notas;
  }

  // Explica los meses de prueba con recaudo cero; distingue si el peaje ya venía en cero
  function textoCeros(ctx, ceros) {
    const { s } = ctx;
    let desde = CORTE;
    while (desde > 0 && s.y[desde - 1] === 0) desde--;
    const base = `El peaje reportó recaudo cero en ${ceros === 1 ? 'ese mes' : 'esos meses'} (suspensión o cierre).`;
    if (desde < CORTE) return `${base} Ya estaba en cero al cierre del entrenamiento (desde ${mesCorto(desde)}). Los modelos no usan los meses en cero, así que estiman como si el cobro se hubiera reanudado y por eso sobreestiman.`;
    return `${base} Ningún modelo entrenado hasta ${mesCorto(CORTE - 1)} puede anticiparlo, y esos meses elevan el error.`;
  }

  // ----------------------------------------------------- panel Estimación
  let ctxActual = null;

  function indicador(clase, rotulo, valor, detalle) {
    return `<div class="indicador ${clase}"><p class="rotulo">${rotulo}</p><p class="valor">${valor}</p><p class="detalle">${detalle}</p></div>`;
  }

  function pintarEstimacion(ctx) {
    const { s, sel, modelo, ic } = ctx;
    $('est-titulo').textContent = s.titulo;
    $('est-subtitulo').textContent = `Modelo ${modelo.nombre} · entrenamiento ${PERIODO_ENTRENAMIENTO} · prueba ${PERIODO_PRUEBA}`;

    let aviso = '';
    const alternativas = M.MODELOS.filter((m, i) => ctx.ests[i].ok);
    if (!sel.ok && !alternativas.length) {
      aviso = `<div class="aviso informativo" role="status"><div><strong>No es posible estimar el recaudo de este peaje</strong>${esc(sel.motivo)} El resumen estadístico sí está disponible.</div></div>`;
    } else if (!sel.ok) {
      aviso = `<div class="aviso" role="status"><div><strong>${esc(modelo.nombre)} no está disponible para este peaje</strong>${esc(sel.motivo)} Puede usar ${alternativas.map((m) => `<button type="button" class="enlace" data-modelo="${m.id}">${esc(m.nombre)}</button>`).join(' o ')}.</div></div>`;
    } else if (!sel.metricas.n) {
      aviso = '<div class="aviso informativo" role="status"><div><strong>Sin datos reales para comparar</strong>El peaje no tiene registros completos en el periodo de prueba, así que la estimación no se puede evaluar.</div></div>';
    } else {
      const ceros = sel.real.filter((v, i) => sel.comparable[i] && v === 0).length;
      if (ceros) aviso = `<div class="aviso" role="status"><div><strong>${capital(plural(ceros, 'mes', 'meses'))} de prueba sin recaudo</strong>${textoCeros(ctx, ceros)}</div></div>`;
    }
    $('est-aviso').innerHTML = aviso;

    const k = sel.ok ? sel.metricas : null;
    let ind = '';
    if (sel.ok && k.n) {
      const dif = k.totalEst - k.totalReal;
      ind = indicador('real', 'Recaudo real en prueba', pesos(k.totalReal), `${plural(k.n, 'mes comparable', 'meses comparables')} entre ${PERIODO_PRUEBA}`) +
        indicador('estimado', 'Recaudo estimado', pesos(k.totalEst), `Mismos meses · ${esc(modelo.nombre)}`) +
        indicador('', 'Diferencia total', pctSigno(k.sesgo), k.sesgo === null ? 'El recaudo real fue cero' : `El modelo ${dif < 0 ? 'subestima' : 'sobreestima'} en ${pesos(Math.abs(dif))}`) +
        indicador('', 'Error mensual (WAPE)', pct(k.wape), [k.mape !== null ? `MAPE ${pct(k.mape)}` : '', k.cobertura !== null ? `el intervalo de ${ic} % cubrió ${pct(k.cobertura, 0)} de los meses` : ''].filter(Boolean).join(' · ') || 'No se puede calcular: el recaudo real fue cero');
    } else if (sel.ok) {
      ind = indicador('estimado', 'Recaudo estimado en prueba', pesos(sel.est.reduce((a, b) => a + b, 0)), `${H} meses · ${esc(modelo.nombre)}`);
    }
    $('est-indicadores').innerHTML = ind;
    $('est-indicadores').hidden = !ind;

    const desc = sel.ok && k.n
      ? `Gráfico de líneas del recaudo mensual de ${s.titulo}. Real en prueba: ${pesos(k.totalReal)}; estimado: ${pesos(k.totalEst)}; WAPE ${pct(k.wape)}.`
      : `Gráfico de líneas del recaudo mensual histórico de ${s.titulo}.`;
    const cfg = configPrincipal(ctx, estado.rango);
    dibujar('graf-principal', cfg, desc);
    $('est-nota-grafico').textContent = sel.ok
      ? `${sel.prep.nValidos} meses de entrenamiento usados en el ajuste. ${textoExcluidos(ctx)} La zona sombreada es el periodo de prueba: el modelo no vio esos datos.${cfg.recortado ? ' El intervalo supera la escala del gráfico; sus límites están en la tabla de detalle.' : ''}`
      : 'Serie histórica del recaudo mensual.';

    const hayAlguno = alternativas.length > 0;
    $('est-tablas').hidden = !hayAlguno;
    $('est-detalle-tarjeta').hidden = !sel.ok;
    if (hayAlguno) {
      $('est-modelos').innerHTML = tablaModelos(ctx, true);
      $('est-anual').innerHTML = sel.ok ? tablaAnual(sel) : '<p class="nota">Seleccione un modelo disponible para ver la comparación anual.</p>';
      $('est-parametros').innerHTML = sel.ok ? `<p class="parametros">${textoParametros(ctx)}</p>` : '';
    }
    if (sel.ok) $('est-detalle').innerHTML = tablaDetalle(ctx);
  }

  // -------------------------------------------------------- panel Resumen
  function pintarResumen(ctx) {
    const { s, res } = ctx;
    $('res-titulo').textContent = `Resumen estadístico · ${s.titulo}`;
    $('res-subtitulo').textContent = `Registros entre ${mesLargo(res.primero)} y ${mesLargo(res.ultimo)}${s.id !== null ? ` · IdPeaje ${s.id}` : ''}`;
    const hay = res.mesesCompletos > 0;
    $('res-indicadores').innerHTML =
      indicador('real', 'Recaudo acumulado', pesos(res.total), `${plural(res.mesesConRegistro, 'mes', 'meses')} con registro`) +
      indicador('', 'Promedio mensual', hay ? pesos(res.promedio) : '—', hay ? `Mediana ${pesos(res.mediana)}` : 'Sin meses completos con recaudo') +
      indicador('', 'Crecimiento anual compuesto', res.tcac ? pctSigno(res.tcac.valor) : '—', res.tcac ? `Entre ${res.tcac.desde} y ${res.tcac.hasta} (años completos)` : 'Requiere dos años completos') +
      (s.esTotal
        ? indicador('', 'Peajes con registro', String(D.peajes.length), `${s.nPeajes[N - 1]} en ${mesCorto(N - 1)}`)
        : indicador('', 'Participación nacional', pct(res.total / granTotal, 2), 'Del recaudo acumulado de todos los peajes'));

    $('res-estadisticos').innerHTML = tablaClave(filasEstadisticos(ctx), 'Estadísticos del recaudo mensual');
    $('res-nota-estadisticos').textContent = (hay
      ? `Promedio, mediana, dispersión y extremos se calculan sobre ${plural(res.mesesCompletos, 'mes completo', 'meses completos')} con recaudo; los acumulados incluyen todos los registros.`
      : 'El peaje no tiene meses completos con recaudo, por lo que no se calculan promedio, mediana ni dispersión.') + ' FSV y sobrante corresponden a las columnas RecaudoFsv y RecaudoSobrante del archivo.';
    $('res-calidad').innerHTML = tablaClave(filasCalidad(ctx), 'Cobertura y calidad de los registros');
    const notas = notasCalidad(ctx);
    $('res-calidad-notas').innerHTML = notas.length ? `<ul class="lista-notas">${notas.map((n) => `<li>${n}</li>`).join('')}</ul>` : '';

    $('graf-anual').parentElement.hidden = res.total === 0;
    if (res.total === 0) {
      $('res-nota-anual').textContent = 'El peaje no registra recaudo en ningún año.';
    } else {
      dibujar('graf-anual', configAnual(res), `Barras del recaudo anual de ${s.titulo}: ${res.porAnio.map((o) => `${o.anio}, ${pesos(o.total)}`).join('; ')}.`);
      const incompletos = res.porAnio.filter((o) => o.completos < 12).map((o) => o.anio);
      $('res-nota-anual').textContent = incompletos.length ? `En tono claro, años sin 12 meses completos con recaudo: ${incompletos.join(', ')}.` : 'Todos los años tienen 12 meses completos con recaudo.';
    }

    const lienzoEst = $('graf-estacional');
    if (res.estacional) {
      lienzoEst.parentElement.hidden = false;
      const e = res.estacional;
      dibujar('graf-estacional', configEstacional(res), `Índice estacional por mes de ${s.titulo}. Mes más alto: ${MESES_LARGO[e.mesPico]}; más bajo: ${MESES_LARGO[e.mesValle]}.`);
      $('res-nota-estacional').textContent = `${capital(MESES_LARGO[e.mesPico])} es el mes más alto (${pctSigno(e.indices[e.mesPico] - 1)} frente al promedio del año) y ${MESES_LARGO[e.mesValle]} el más bajo (${pctSigno(e.indices[e.mesValle] - 1)}). Mediana de ${plural(e.anios, 'año completo', 'años completos')}.`;
    } else {
      lienzoEst.parentElement.hidden = true;
      $('res-nota-estacional').textContent = 'No hay ningún año con 12 meses completos con recaudo, por lo que no se calcula la estacionalidad.';
    }

    const h = histograma(s), lienzoDis = $('graf-distribucion');
    if (h) {
      lienzoDis.parentElement.hidden = false;
      dibujar('graf-distribucion', configDistribucion(h), `Histograma del recaudo mensual de ${s.titulo} en ${h.n} meses completos con recaudo.`);
      $('res-nota-distribucion').textContent = `${h.n} meses completos con recaudo. La mitad central de los meses está entre ${pesos(res.p25)} y ${pesos(res.p75)}.`;
    } else {
      lienzoDis.parentElement.hidden = true;
      $('res-nota-distribucion').textContent = 'No hay suficientes meses completos con recaudo para mostrar la distribución.';
    }
  }
  const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  // ----------------------------------------------- panel Todos los peajes
  const COLUMNAS = [
    { id: 'nombre', titulo: 'Peaje', texto: true },
    { id: 'primero', titulo: 'Primer<br>registro' },
    { id: 'ultimo', titulo: 'Último<br>registro' },
    { id: 'meses', titulo: 'Meses con<br>registro' },
    { id: 'total', titulo: 'Recaudo<br>acumulado' },
    { id: 'part', titulo: 'Part.<br>nacional' },
    { id: 'promedio', titulo: 'Promedio<br>mensual' },
    { id: 'mediana', titulo: 'Mediana<br>mensual' },
    { id: 'cv', titulo: 'CV' },
    { id: 'minimo', titulo: 'Mínimo<br>mensual' },
    { id: 'maximo', titulo: 'Máximo<br>mensual' },
    { id: 'wape', titulo: '' },
  ];
  function filasPeajes() {
    const modelo = modeloPorId(estado.modelo);
    return peajes.map((s) => {
      const r = resumenDe(s), e = estimacionDe(s, modelo, estado.ic);
      const hay = r.mesesCompletos > 0;
      return {
        s, nombre: s.nombre, primero: r.primero, ultimo: r.ultimo, meses: r.mesesConRegistro, total: r.total, part: r.total / granTotal,
        promedio: hay ? r.promedio : null, mediana: hay ? r.mediana : null, cv: r.cv,
        minimo: hay ? r.minimo.valor : null, maximo: hay ? r.maximo.valor : null,
        wape: e.ok && e.metricas.n && e.metricas.wape !== null ? e.metricas.wape : null,
        motivo: !e.ok ? e.motivo : (!e.metricas.n ? 'Sin meses reales comparables en el periodo de prueba.' : (e.metricas.wape === null ? 'El recaudo real en prueba fue cero.' : '')),
      };
    });
  }
  function pintarPeajes() {
    const modelo = modeloPorId(estado.modelo);
    const todas = filasPeajes();
    const filtro = sinTildes(estado.filtro.trim());
    const filas = todas.filter((f) => !filtro || sinTildes(f.nombre).includes(filtro));
    const { col, dir } = estado.orden;
    filas.sort((a, b) => {
      if (col === 'nombre') return dir * a.nombre.localeCompare(b.nombre, 'es');
      if (a[col] === null && b[col] === null) return a.nombre.localeCompare(b.nombre, 'es');
      if (a[col] === null) return 1;
      if (b[col] === null) return -1;
      return dir * (a[col] - b[col]) || a.nombre.localeCompare(b.nombre, 'es');
    });
    const cab = COLUMNAS.map((c) => {
      const titulo = c.id === 'wape' ? `WAPE prueba<br>${esc(modelo.corto)}` : c.titulo;
      const orden = c.id === col ? (dir > 0 ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" class="ordenable" aria-sort="${orden}"><button type="button" data-orden="${c.id}">${titulo}</button></th>`;
    }).join('');
    const cuerpo = filas.map((f) => `<tr class="${f.s.clave === estado.clave ? 'seleccionada' : ''}">` +
      `<th scope="row"><button type="button" class="enlace" data-peaje="${f.s.clave}">${esc(f.nombre)}</button></th>` +
      `<td>${mesCorto(f.primero)}</td><td>${mesCorto(f.ultimo)}</td><td>${f.meses}</td><td>${millones(f.total)}</td><td>${pct(f.part, 2)}</td>` +
      `<td>${millones(f.promedio)}</td><td>${millones(f.mediana)}</td><td>${pct(f.cv, 0)}</td><td>${millones(f.minimo)}</td><td>${millones(f.maximo)}</td>` +
      `<td${f.wape === null ? ` class="tenue" title="${esc(f.motivo)}"` : ''}>${f.wape === null ? 'n. d.' : pct(f.wape)}</td></tr>`).join('');
    $('pea-tabla').innerHTML = `<table><thead><tr>${cab}</tr></thead><tbody>${cuerpo || `<tr><td colspan="${COLUMNAS.length}" class="izq tenue">Ningún peaje coincide con «${esc(estado.filtro)}».</td></tr>`}</tbody></table>`;
    const conEst = todas.filter((f) => f.wape !== null);
    $('pea-conteo').textContent = filtro ? `${filas.length} de ${todas.length} peajes` : `${todas.length} peajes`;
    const wapes = conEst.map((f) => f.wape).sort((a, b) => a - b);
    $('pea-subtitulo').textContent = `${todas.length} peajes entre ${mesCorto(0)} y ${mesCorto(N - 1)}. ${conEst.length} tienen estimación evaluable con ${modelo.nombre}: WAPE mediano ${pct(M.cuantil(wapes, 0.5))} (la mitad de los peajes entre ${pct(M.cuantil(wapes, 0.25))} y ${pct(M.cuantil(wapes, 0.75))}). «n. d.» indica que no hay base para estimar o comparar; pase el cursor para ver el motivo.`;
  }

  // ------------------------------------------------- panel Datos y método
  function pintarMetodo() {
    const c = D.calidad;
    $('met-datos').innerHTML =
      `<p>Archivo <strong>${esc(D.archivo)}</strong> («Recaudo Vehicular ANI»): ${num(c.registros)} registros de ${D.peajes.length} peajes entre ${mesLargo(0)} y ${mesLargo(N - 1)}. Cada registro trae el recaudo de un peaje en un periodo (casi siempre un mes) y los valores RecaudoFsv y RecaudoSobrante.</p>` +
      '<p>Antes de analizar, los registros se convierten en una serie mensual por peaje con estas reglas:</p>' +
      '<ol>' +
      `<li><strong>Duplicados.</strong> Se eliminaron ${num(c.duplicadosExactos)} registros idénticos a otro (mismo peaje, periodo y valores).</li>` +
      `<li><strong>Versiones contradictorias.</strong> En ${num(c.mesesConVersiones)} meses-peaje hay varios registros con valores distintos para el mismo periodo (${num(c.versionesDescartadas)} registros de más). Sumarlos duplicaría el recaudo, así que se conserva uno: el más cercano a la mediana de hasta 3 meses anteriores y 3 posteriores del mismo peaje. Las versiones en cero se descartan si hay otra positiva.</li>` +
      `<li><strong>Meses divididos.</strong> En ${num(c.mesesDivididos)} meses-peaje el mes viene en dos periodos que no se traslapan (por ejemplo, 1–19 y 20–31); esos sí se suman.</li>` +
      `<li><strong>Meses parciales.</strong> ${num(c.mesesParciales)} meses-peaje no cubren el mes completo (inicio o fin de operación, sobre todo). Se muestran, pero no se usan para ajustar los modelos ni para medir el error.</li>` +
      `<li><strong>Meses sin registro.</strong> ${num(c.mesesSinRegistro)} meses-peaje quedan vacíos entre el primer y el último registro de su peaje; se tratan como dato faltante, no como cero.</li>` +
      '</ol>' +
      '<p>El <strong>total nacional</strong> es la suma mensual de todos los peajes con registro. Como entran y salen peajes, parte de su variación no es tráfico sino cambio en la cantidad de peajes.</p>';
    $('met-particion').innerHTML =
      `<p><strong>Entrenamiento:</strong> los primeros ${ANIOS_ENTRENAMIENTO} años, ${PERIODO_ENTRENAMIENTO} (${CORTE} meses). <strong>Prueba:</strong> ${PERIODO_PRUEBA} (${H} meses). Cada modelo se ajusta solo con el entrenamiento y estima de una vez todo el periodo de prueba, sin ver ningún dato real de esos meses.</p>` +
      '<p>Dentro del entrenamiento no se usan para ajustar: los meses en cero, los meses parciales y los meses atípicos (recaudo menor al 50 % o mayor al 250 % de la mediana de los 6 meses anteriores y 6 posteriores). Así, la suspensión del cobro de abril y mayo de 2020 no deforma la tendencia ni la estacionalidad. En el gráfico aparecen como puntos huecos.</p>' +
      '<p>Un peaje no se estima si no tiene recaudo en los 12 meses previos al corte o si tiene menos de 3 meses válidos de entrenamiento.</p>';
    $('met-modelos').innerHTML =
      '<p>Todos trabajan sobre el logaritmo del recaudo, de modo que el crecimiento y la estacionalidad son proporcionales y la estimación nunca es negativa.</p>' +
      `<dl class="definiciones">${M.MODELOS.map((m) => `<dt>${esc(m.nombre)}</dt><dd>${esc(m.descripcion)}</dd>`).join('')}</dl>` +
      '<p>El intervalo de estimación se calcula con la variabilidad de los residuos del entrenamiento y se ensancha con el horizonte. La columna «Cobertura» muestra qué tan bien se cumplió en la prueba.</p>';
  }

  // -------------------------------------------------------------- reporte
  function hallazgos(ctx) {
    const { s, res, sel, modelo, ests, ic } = ctx, h = [];
    const hay = res.mesesCompletos > 0;
    h.push(`Entre ${mesLargo(res.primero)} y ${mesLargo(res.ultimo)} ${s.esTotal ? 'los peajes registraron' : 'el peaje registró'} un recaudo acumulado de <strong>${pesos(res.total)}</strong>${!s.esTotal ? `, el ${pct(res.total / granTotal, 2)} del total nacional` : ''}.${hay ? ` El recaudo mensual típico fue de ${pesos(res.mediana)} (mediana; promedio ${pesos(res.promedio)}).` : ''}`);
    if (res.tcac) h.push(`Entre ${res.tcac.desde} y ${res.tcac.hasta} el recaudo anual ${res.tcac.valor >= 0 ? 'creció' : 'cayó'} a una tasa compuesta de <strong>${pct(Math.abs(res.tcac.valor))} anual</strong>.`);
    if (res.estacional) {
      const e = res.estacional;
      h.push(`${capital(MESES_LARGO[e.mesPico])} es el mes de mayor recaudo relativo (${pctSigno(e.indices[e.mesPico] - 1)} frente al promedio del año) y ${MESES_LARGO[e.mesValle]} el de menor (${pctSigno(e.indices[e.mesValle] - 1)}).`);
    }
    if (sel.ok && sel.metricas.n) {
      const k = sel.metricas;
      h.push(`Con el modelo ${esc(modelo.nombre)}, entrenado con ${PERIODO_ENTRENAMIENTO}, la estimación para los ${k.n} meses comparables de ${PERIODO_PRUEBA} fue de <strong>${pesos(k.totalEst)}</strong> frente a <strong>${pesos(k.totalReal)}</strong> reales${k.sesgo !== null ? `: ${k.sesgo < 0 ? 'una subestimación' : 'una sobreestimación'} de <strong>${pct(Math.abs(k.sesgo))}</strong>` : ''}.`);
      if (k.wape !== null) {
        let txt = `El error mensual ponderado (WAPE) fue de <strong>${pct(k.wape)}</strong>${k.mape !== null ? ` y el MAPE de ${pct(k.mape)}` : ''}.`;
        if (k.cobertura !== null) txt += ` El intervalo de ${ic} % contuvo el valor real en el ${pct(k.cobertura, 0)} de los meses.`;
        h.push(txt);
        const iBase = M.MODELOS.findIndex((m) => m.id === 'ing'), base = ests[iBase];
        const iMejor = mejorModelo(ests);
        const partes = [];
        if (modelo.id !== 'ing' && base.ok && base.metricas.n && base.metricas.wape !== null) {
          const d = (k.wape - base.metricas.wape) * 100;
          partes.push(`Frente a la línea base (estacional ingenuo, WAPE ${pct(base.metricas.wape)}), el modelo ${Math.abs(d) < 0.05 ? 'tiene el mismo error' : `${d < 0 ? 'reduce' : 'aumenta'} el error en ${num(Math.abs(d), 1)} puntos porcentuales`}.`);
        }
        if (iMejor >= 0) partes.push(M.MODELOS[iMejor].id === modelo.id ? 'Es el modelo con menor error en prueba de los comparados.' : `El menor error en prueba lo obtuvo ${esc(M.MODELOS[iMejor].nombre)} (WAPE ${pct(ests[iMejor].metricas.wape)}).`);
        if (partes.length) h.push(partes.join(' '));
      }
      const ceros = sel.real.filter((v, i) => sel.comparable[i] && v === 0).length;
      if (ceros) h.push(`<strong>${capital(plural(ceros, 'mes', 'meses'))} de prueba sin recaudo.</strong> ${textoCeros(ctx, ceros)}`);
    } else if (sel.ok) {
      h.push(`El modelo ${esc(modelo.nombre)} generó una estimación para ${PERIODO_PRUEBA}, pero el peaje no tiene registros completos en esos meses, por lo que no se puede evaluar.`);
    } else {
      h.push(`No se generó estimación con ${esc(modelo.nombre)}: ${esc(sel.motivo)}`);
    }
    return h;
  }

  function htmlReporte(ctx) {
    const { s, res, sel, modelo, ic } = ctx;
    const hoy = new Date();
    const fecha = `${hoy.getDate()} de ${MESES_LARGO[hoy.getMonth()]} de ${hoy.getFullYear()}`;
    const figura = (url, alt, pie) => `<figure><img src="${url}" alt="${esc(alt)}"><figcaption>${pie}</figcaption></figure>`;
    const cifra = (r, v, d) => `<div><p class="rotulo">${r}</p><p class="valor">${v}</p><p class="detalle">${d}</p></div>`;
    const hay = res.mesesCompletos > 0;

    let estimacion;
    if (sel.ok) {
      const k = sel.metricas;
      const cfg = configPrincipal(ctx, 'todo');
      const img = imagenDe(cfg, 980, 400);
      estimacion =
        (k.n ? `<div class="doc-cifras">${cifra('Real en prueba', pesos(k.totalReal), `${plural(k.n, 'mes comparable', 'meses comparables')}`)}${cifra('Estimado', pesos(k.totalEst), 'mismos meses')}${cifra('Diferencia total', pctSigno(k.sesgo), k.sesgo === null ? '' : (k.sesgo < 0 ? 'el modelo subestima' : 'el modelo sobreestima'))}${cifra('WAPE', pct(k.wape), [k.mape !== null ? `MAPE ${pct(k.mape)}` : '', k.cobertura !== null ? `cobertura ${pct(k.cobertura, 0)}` : ''].filter(Boolean).join(' · '))}</div>` : '') +
        figura(img, `Recaudo mensual real y estimado de ${s.titulo}`, `Recaudo mensual real y estimado. La zona sombreada es el periodo de prueba (${PERIODO_PRUEBA}); la banda es el intervalo de ${ic} %${cfg.recortado ? ' (supera la escala del gráfico; ver límites en el detalle mensual)' : ''}. ${textoExcluidos(ctx)}`) +
        `<p class="nota">${textoParametros(ctx)}</p>` +
        `<div class="junto"><h3>Comparación de modelos en el periodo de prueba</h3><div class="desplaza">${tablaModelos(ctx, false)}</div></div>` +
        `<div class="junto"><h3>Real frente a estimado por año (millones de pesos)</h3><div class="desplaza">${tablaAnual(sel)}</div></div>` +
        `<h2>4. Detalle mensual del periodo de prueba</h2><p class="nota">Millones de pesos. Estimación con ${esc(modelo.nombre)}.</p><div class="desplaza">${tablaDetalle(ctx)}</div>`;
    } else {
      estimacion = `<div class="aviso"><strong>Sin estimación.</strong> ${esc(sel.motivo)}</div>` +
        figura(imagenDe(configPrincipal(ctx, 'todo'), 980, 340), `Recaudo mensual histórico de ${s.titulo}`, 'Recaudo mensual histórico.');
    }

    const notas = notasCalidad(ctx);
    const h = histograma(s);
    return `<article class="doc">
      <header class="doc-cab"><p class="sobre">Recaudo vehicular ANI · Reporte de análisis</p><h1>${esc(s.titulo)}</h1></header>
      <div class="doc-carril"></div>
      <dl class="doc-ficha">
        <div><dt>${s.esTotal ? 'Alcance' : 'IdPeaje'}</dt><dd>${s.esTotal ? `${D.peajes.length} peajes` : s.id}</dd></div>
        <div><dt>Registros</dt><dd>${mesCorto(res.primero)} – ${mesCorto(res.ultimo)}</dd></div>
        <div><dt>Modelo</dt><dd>${esc(modelo.nombre)}</dd></div>
        <div><dt>Fecha del reporte</dt><dd>${fecha}</dd></div>
        <div><dt>Entrenamiento</dt><dd>${PERIODO_ENTRENAMIENTO}</dd></div>
        <div><dt>Prueba</dt><dd>${PERIODO_PRUEBA}</dd></div>
        <div><dt>Intervalo</dt><dd>${ic} %</dd></div>
        <div><dt>Fuente</dt><dd style="overflow-wrap:anywhere">${esc(D.archivo)}</dd></div>
      </dl>

      <h2>1. Hallazgos principales</h2>
      <ul>${hallazgos(ctx).map((t) => `<li>${t}</li>`).join('')}</ul>

      <h2>2. Resumen estadístico</h2>
      <div class="doc-cifras">
        ${cifra('Recaudo acumulado', pesos(res.total), `${plural(res.mesesConRegistro, 'mes', 'meses')} con registro`)}
        ${cifra('Promedio mensual', hay ? pesos(res.promedio) : '—', hay ? `mediana ${pesos(res.mediana)}` : '')}
        ${cifra('Coeficiente de variación', pct(res.cv), 'desviación ÷ promedio')}
        ${cifra('Crecimiento anual', res.tcac ? pctSigno(res.tcac.valor) : '—', res.tcac ? `compuesto, ${res.tcac.desde}–${res.tcac.hasta}` : 'requiere dos años completos')}
      </div>
      <div class="doc-dos">
        <div><h3>Estadísticos del recaudo mensual</h3>${tablaClave(filasEstadisticos(ctx), 'Estadísticos')}</div>
        <div><h3>Cobertura y calidad de los registros</h3>${tablaClave(filasCalidad(ctx), 'Calidad')}</div>
      </div>
      ${hay ? `<p class="nota">Promedio, mediana, dispersión y extremos se calculan sobre ${plural(res.mesesCompletos, 'mes completo', 'meses completos')} con recaudo.</p>` : ''}
      ${notas.length ? `<ul class="nota">${notas.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
      <div class="doc-dos">
        ${res.total > 0 ? figura(imagenDe(configAnual(res), 480, 250), 'Recaudo por año', 'Recaudo por año. En tono claro, años incompletos.') : ''}
        ${res.estacional ? figura(imagenDe(configEstacional(res), 480, 250), 'Índice estacional por mes', `Índice estacional (100 = promedio del año), mediana de ${plural(res.estacional.anios, 'año completo', 'años completos')}.`) : (h ? figura(imagenDe(configDistribucion(h), 480, 250), 'Distribución del recaudo mensual', 'Distribución del recaudo mensual.') : '')}
      </div>

      <h2>3. Estimación del recaudo</h2>
      ${estimacion}

      <h2>${sel.ok ? '5' : '4'}. Notas metodológicas</h2>
      <ul>
        <li><strong>Datos.</strong> Serie mensual construida a partir de ${esc(D.archivo)}. Se eliminan registros duplicados; cuando hay varios valores para el mismo periodo se conserva el más coherente con los meses vecinos; los meses parciales no se usan para ajustar ni para medir el error.</li>
        <li><strong>Partición.</strong> Entrenamiento con los primeros ${ANIOS_ENTRENAMIENTO} años (${PERIODO_ENTRENAMIENTO}); prueba con ${PERIODO_PRUEBA}. El modelo estima todo el periodo de prueba sin ver sus datos reales.</li>
        <li><strong>Modelo.</strong> ${esc(modelo.nombre)}: ${esc(modelo.descripcion)} Se ajusta sobre el logaritmo del recaudo y excluye los meses en cero y atípicos del entrenamiento.</li>
        <li><strong>Medidas.</strong> WAPE = suma de errores absolutos ÷ suma del recaudo real. MAPE = promedio del error porcentual absoluto mensual. Sesgo o diferencia total = (estimado − real) ÷ real. Cobertura = proporción de meses con el valor real dentro del intervalo.</li>
      </ul>
      <p class="doc-pie">Generado el ${fecha} con la aplicación «Estimación del recaudo de peajes» a partir de datos de recaudo vehicular de la ANI. Las estimaciones son un ejercicio estadístico y no constituyen cifras oficiales.</p>
    </article>`;
  }

  let ultimoFoco = null, reporteActual = null;
  function abrirReporte() {
    const ctx = contexto();
    reporteActual = { html: htmlReporte(ctx), titulo: `Reporte de recaudo · ${ctx.s.titulo}`, archivo: `reporte-recaudo-${sinTildes(ctx.s.nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${new Date().toISOString().slice(0, 10)}.html` };
    $('reporte-doc').innerHTML = reporteActual.html;
    $('reporte-barra-titulo').textContent = reporteActual.titulo;
    ultimoFoco = document.activeElement;
    $('reporte').hidden = false;
    $('app').inert = true;
    document.body.classList.add('con-reporte');
    document.body.style.overflow = 'hidden';
    $('reporte-desplaza').scrollTop = 0;
    $('rep-cerrar').focus();
  }
  function cerrarReporte() {
    $('reporte').hidden = true;
    $('app').inert = false;
    document.body.classList.remove('con-reporte');
    document.body.style.overflow = '';
    $('reporte-doc').innerHTML = '';
    if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
  }
  function descargarReporte() {
    if (!reporteActual) return;
    const css = $('css-reporte').textContent;
    const doc = `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(reporteActual.titulo)}</title>` +
      `<style>body{margin:0;padding:24px 12px;background:#e9e6df}@media print{body{padding:0;background:#fff}}\n${css}</style></head><body>${reporteActual.html}</body></html>`;
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = reporteActual.archivo;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ------------------------------------------------- selector de peajes
  const combo = { abierto: false, opciones: [], activo: -1 };
  function etiquetaOpcion(s) {
    if (s.esTotal) return `${D.peajes.length} peajes`;
    const r = resumenDe(s);
    return `${mesCorto(r.primero)} – ${mesCorto(r.ultimo)}`;
  }
  function pintarLista() {
    const lista = $('peaje-lista');
    if (!combo.opciones.length) {
      lista.innerHTML = '<li class="vacio" role="presentation">Ningún peaje coincide</li>';
      $('peaje-entrada').removeAttribute('aria-activedescendant');
      return;
    }
    lista.innerHTML = combo.opciones.map((s, i) => `<li role="option" id="op-${s.clave}" data-clave="${s.clave}" aria-selected="${s.clave === estado.clave}" class="${i === combo.activo ? 'activo' : ''}${s.esTotal ? ' total' : ''}"><span>${esc(s.esTotal ? 'TOTAL NACIONAL' : s.nombre)}</span><small>${etiquetaOpcion(s)}</small></li>`).join('');
    const act = combo.opciones[combo.activo];
    if (act) {
      $('peaje-entrada').setAttribute('aria-activedescendant', `op-${act.clave}`);
      const el = $(`op-${act.clave}`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }
  function abrirCombo(filtro) {
    const f = sinTildes((filtro || '').trim());
    combo.opciones = series.filter((s) => !f || sinTildes(s.esTotal ? 'total nacional' : s.nombre).includes(f));
    const iSel = combo.opciones.findIndex((s) => s.clave === estado.clave);
    combo.activo = f ? (combo.opciones.length ? 0 : -1) : iSel;
    combo.abierto = true;
    $('peaje-lista').hidden = false;
    $('peaje-entrada').setAttribute('aria-expanded', 'true');
    pintarLista();
  }
  function cerrarCombo(restaurar) {
    combo.abierto = false;
    $('peaje-lista').hidden = true;
    const entrada = $('peaje-entrada');
    entrada.setAttribute('aria-expanded', 'false');
    entrada.removeAttribute('aria-activedescendant');
    if (restaurar) entrada.value = nombreEnSelector(porClave.get(estado.clave));
  }
  const nombreEnSelector = (s) => (s.esTotal ? 'TOTAL NACIONAL' : s.nombre);
  function elegirPeaje(clave) {
    estado.clave = clave;
    cerrarCombo(true);
    actualizar();
  }
  function iniciarCombo() {
    const entrada = $('peaje-entrada'), lista = $('peaje-lista');
    entrada.addEventListener('focus', () => entrada.select());
    entrada.addEventListener('click', () => { if (!combo.abierto) abrirCombo(''); });
    entrada.addEventListener('input', () => abrirCombo(entrada.value));
    entrada.addEventListener('keydown', (ev) => {
      const n = combo.opciones.length;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!combo.abierto) { abrirCombo(''); return; }
        if (!n) return;
        combo.activo = ev.key === 'ArrowDown' ? (combo.activo + 1) % n : (combo.activo - 1 + n) % n;
        pintarLista();
      } else if (ev.key === 'Enter') {
        if (combo.abierto && combo.opciones[combo.activo]) { ev.preventDefault(); elegirPeaje(combo.opciones[combo.activo].clave); }
      } else if (ev.key === 'Escape') {
        if (combo.abierto) { ev.preventDefault(); cerrarCombo(true); entrada.select(); }
      } else if (ev.key === 'Home' && combo.abierto && n) { ev.preventDefault(); combo.activo = 0; pintarLista(); }
      else if (ev.key === 'End' && combo.abierto && n) { ev.preventDefault(); combo.activo = n - 1; pintarLista(); }
    });
    entrada.addEventListener('blur', () => cerrarCombo(true));
    lista.addEventListener('mousedown', (ev) => ev.preventDefault()); // conserva el foco en la entrada
    lista.addEventListener('click', (ev) => {
      const li = ev.target.closest('li[data-clave]');
      if (li) elegirPeaje(li.dataset.clave);
    });
    $('combo-flecha').addEventListener('mousedown', (ev) => ev.preventDefault());
    $('combo-flecha').addEventListener('click', () => {
      if (combo.abierto) cerrarCombo(true); else { entrada.focus(); abrirCombo(''); }
    });
  }

  // ------------------------------------------------------------ pestañas
  function activarTab(id, enfocar) {
    estado.tab = id;
    for (const t of TABS) {
      const sel = t === id, boton = $(`tab-${t}`);
      boton.setAttribute('aria-selected', String(sel));
      boton.tabIndex = sel ? 0 : -1;
      $(`panel-${t}`).hidden = !sel;
      if (sel && enfocar) boton.focus();
    }
  }
  function mostrarTab(id, enfocar) {
    activarTab(id, enfocar);
    pintarTab();
    escribirHash();
  }

  // Solo se pinta la pestaña visible: los gráficos necesitan un lienzo con tamaño real
  function pintarTab() {
    if (estado.tab === 'estimacion') pintarEstimacion(ctxActual);
    else if (estado.tab === 'resumen') pintarResumen(ctxActual);
    else if (estado.tab === 'peajes') pintarPeajes();
  }

  function actualizar() {
    ctxActual = contexto();
    $('peaje-entrada').value = nombreEnSelector(ctxActual.s);
    $('modelo').value = estado.modelo;
    $('confianza').value = String(estado.ic);
    document.title = `${ctxActual.s.titulo} · Recaudo de peajes ANI`;
    pintarTab();
    escribirHash();
  }

  // -------------------------------------------------------------- inicio
  function iniciar() {
    leerHash();
    $('cabecera-meta').innerHTML = `<strong>${D.peajes.length} peajes</strong> · ${mesCorto(0)} – ${mesCorto(N - 1)}<br>Entrenamiento ${PERIODO_ENTRENAMIENTO} · prueba ${PERIODO_PRUEBA}`;
    $('pie-texto').textContent = `Fuente: ${D.archivo} (Recaudo Vehicular ANI). Las estimaciones son un ejercicio estadístico y no constituyen cifras oficiales.`;
    $('modelo').innerHTML = M.MODELOS.map((m) => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('');
    pintarMetodo();
    iniciarCombo();

    $('modelo').addEventListener('change', (ev) => { estado.modelo = ev.target.value; actualizar(); });
    $('confianza').addEventListener('change', (ev) => { estado.ic = Number(ev.target.value); actualizar(); });
    $('btn-reporte').addEventListener('click', abrirReporte);
    $('rep-cerrar').addEventListener('click', cerrarReporte);
    $('rep-imprimir').addEventListener('click', () => window.print());
    $('rep-descargar').addEventListener('click', descargarReporte);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('reporte').hidden) cerrarReporte(); });

    document.querySelector('.pestanas').addEventListener('click', (ev) => {
      const b = ev.target.closest('[role="tab"]');
      if (b) mostrarTab(b.id.slice(4), false);
    });
    document.querySelector('.pestanas').addEventListener('keydown', (ev) => {
      const i = TABS.indexOf(estado.tab);
      let j = -1;
      if (ev.key === 'ArrowRight') j = (i + 1) % TABS.length;
      else if (ev.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
      else if (ev.key === 'Home') j = 0;
      else if (ev.key === 'End') j = TABS.length - 1;
      if (j >= 0) { ev.preventDefault(); mostrarTab(TABS[j], true); }
    });

    document.querySelector('.segmentos').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-rango]');
      if (!b) return;
      estado.rango = b.dataset.rango;
      document.querySelectorAll('.segmentos button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      pintarEstimacion(ctxActual);
    });

    // Cambiar de modelo desde la tabla comparativa o desde un aviso
    $('panel-estimacion').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-modelo]');
      if (b) { estado.modelo = b.dataset.modelo; actualizar(); }
    });

    $('pea-filtro').addEventListener('input', (ev) => { estado.filtro = ev.target.value; pintarPeajes(); });
    $('pea-tabla').addEventListener('click', (ev) => {
      const orden = ev.target.closest('button[data-orden]'), peaje = ev.target.closest('button[data-peaje]');
      if (orden) {
        const col = orden.dataset.orden;
        estado.orden = { col, dir: estado.orden.col === col ? -estado.orden.dir : (col === 'nombre' || col === 'wape' || col === 'cv' ? 1 : -1) };
        pintarPeajes();
        const nuevo = $('pea-tabla').querySelector(`button[data-orden="${col}"]`);
        if (nuevo) nuevo.focus();
      } else if (peaje) {
        estado.clave = peaje.dataset.peaje;
        activarTab('resumen', true);
        actualizar();
        window.scrollTo({ top: 0 });
      }
    });

    window.addEventListener('hashchange', () => { leerHash(); activarTab(estado.tab, false); actualizar(); });

    activarTab(estado.tab, false);
    actualizar();
  }

  iniciar();
})();
