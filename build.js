#!/usr/bin/env node
/*
 * Genera index.html: un único archivo autocontenido (datos, estilos, código y Chart.js
 * incrustados) que se abre directamente en el navegador, sin servidor ni internet.
 *
 *   node build.js [ruta/al/archivo.csv]
 *
 * Sin argumento usa el CSV más reciente de la carpeta datos/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { limpiar } = require('./src/limpieza.js');

const raiz = __dirname;
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

function csvPorDefecto() {
  const dir = path.join(raiz, 'datos');
  const csv = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  if (!csv.length) throw new Error('No hay archivos .csv en datos/');
  return path.join(dir, csv[csv.length - 1]);
}

const rutaCSV = process.argv[2] ? path.resolve(process.argv[2]) : csvPorDefecto();
const datos = limpiar(fs.readFileSync(rutaCSV, 'utf8'));
datos.archivo = path.basename(rutaCSV);
if (datos.mesInicio !== 0) throw new Error('La aplicación asume que la serie empieza en enero.');

// El JSON va dentro de <script>: se neutraliza "<" para que ningún texto pueda cerrar la etiqueta.
const json = JSON.stringify(datos).replace(/</g, '\\u003c');

const piezas = {
  '/*__ESTILOS__*/': leer('src', 'estilos.css'),
  '/*__ESTILOS_REPORTE__*/': leer('src', 'reporte.css'),
  '/*__CHART__*/': leer('vendor', 'chart.umd.min.js'),
  '/*__DATOS__*/': json,
  '/*__MODELOS__*/': leer('src', 'modelos.js'),
  '/*__APP__*/': leer('src', 'app.js'),
};

let html = leer('src', 'plantilla.html');
for (const [marca, contenido] of Object.entries(piezas)) {
  if (marca !== '/*__DATOS__*/' && /<\/script/i.test(contenido) && !marca.includes('ESTILOS')) {
    throw new Error(`El contenido de ${marca} incluye "</script" y rompería el HTML.`);
  }
  if (html.split(marca).length !== 2) throw new Error(`La plantilla debe contener ${marca} exactamente una vez.`);
  html = html.replace(marca, () => contenido); // función: evita que "$&" del contenido se interprete
}

fs.writeFileSync(path.join(raiz, 'index.html'), html);
const c = datos.calidad;
console.log(`index.html generado (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB) a partir de ${datos.archivo}`);
console.log(`  ${c.registros} registros · ${datos.peajes.length} peajes · ${datos.nMeses} meses desde ${datos.anioInicio}-${String(datos.mesInicio + 1).padStart(2, '0')}`);
console.log(`  ${c.duplicadosExactos} duplicados exactos y ${c.versionesDescartadas} versiones alternativas descartadas`);
