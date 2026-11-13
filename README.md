# Recaudo-ANI

Aplicación HTML interactiva para analizar y estimar el recaudo de los peajes de la
Agencia Nacional de Infraestructura (ANI), construida a partir de
`datos/Recaudo_Vehicular_ANI_20261113.csv`.

## Cómo usarla

Abra **`index.html`** en el navegador (doble clic). Es un único archivo autocontenido:
no necesita servidor, instalación ni conexión a internet.

- **Peaje**: escriba para buscar entre los 162 peajes, o deje «Total nacional».
- **Modelo de estimación** e **Intervalo**: cambian el modelo y el nivel de confianza.
- **Estimación**: recaudo real frente a estimado en el periodo de prueba, comparación de
  los cuatro modelos, resultado por año y detalle mensual.
- **Resumen estadístico**: promedio, mediana, dispersión, extremos, crecimiento,
  estacionalidad, distribución y calidad de los registros del peaje.
- **Todos los peajes**: tabla ordenable y filtrable con los estadísticos de cada peaje.
- **Datos y método**: cómo se limpiaron los datos y cómo funciona cada modelo.
- **Generar reporte**: arma el reporte del análisis del peaje seleccionado, para
  imprimir, guardar como PDF o descargar como HTML.

La selección queda en la dirección (por ejemplo `index.html#peaje=1&modelo=reg`), de modo
que se puede compartir un enlace a una vista concreta.

## Entrenamiento y prueba

Los datos van de enero de 2014 a mayo de 2026.

| Periodo | Meses | Uso |
|---|---|---|
| ene 2014 – dic 2023 (primeros 10 años) | 120 | Entrenamiento |
| ene 2024 – may 2026 | 29 | Prueba: el modelo no ve estos datos |

Cada modelo se ajusta solo con el entrenamiento, estima los 29 meses siguientes de una
vez y se compara con el recaudo real.

## Modelos

Todos trabajan sobre el logaritmo del recaudo mensual.

| Modelo | Idea |
|---|---|
| Holt-Winters | Suavizamiento exponencial con nivel, tendencia y estacionalidad |
| Regresión log-lineal | Tendencia de crecimiento constante más un efecto por mes del año |
| Estacional con crecimiento | Mismo mes del último año por el crecimiento interanual reciente |
| Estacional ingenuo | Mismo mes del último año (línea base) |

Medidas de error: WAPE, MAPE, sesgo, MAE, RMSE y cobertura del intervalo.

Resultado en el periodo de prueba:

| Modelo | WAPE total nacional | Sesgo total nacional | WAPE mediano por peaje |
|---|---|---|---|
| Holt-Winters | 6,6 % | −6,6 % | 14,1 % |
| Regresión log-lineal | 20,2 % | −20,2 % | 12,7 % |
| Estacional con crecimiento | 2,6 % | +0,3 % | 14,1 % |
| Estacional ingenuo | 19,7 % | −19,7 % | 21,6 % |

42 de los 162 peajes no se pueden estimar (sin registros o sin recaudo en el
entrenamiento); suman el 1,45 % del recaudo real del periodo de prueba. La aplicación
explica el motivo en cada caso.

## Limpieza de los datos

El archivo trae 17.134 registros; cada uno es un periodo dentro de un mes para un peaje.

- **Duplicados exactos** (164): se cuentan una sola vez.
- **Versiones contradictorias** (175 meses): cuando hay varias filas con valores
  distintos para el mismo periodo, no se suman; se conserva la más coherente con los
  meses vecinos.
- **Periodos consecutivos** de un mismo mes (8 casos): se suman.
- **Meses parciales** (79): se muestran, pero no se usan para ajustar ni para medir el
  error.
- **Ceros y valores atípicos** (por ejemplo abril y mayo de 2020): se muestran, pero se
  excluyen del ajuste.

Sumar todas las filas sin esta limpieza cuenta dos veces unos 300 meses.

## Estructura

```
index.html            Aplicación generada (el entregable)
build.js              Genera index.html a partir del CSV
datos/                Archivo fuente
src/limpieza.js       Lectura y limpieza del CSV (se ejecuta al generar)
src/modelos.js        Modelos, medidas de error y resumen estadístico (se ejecuta en el navegador)
src/app.js            Interfaz
src/plantilla.html, src/estilos.css, src/reporte.css
vendor/               Chart.js 4.6.1 (licencia MIT)
tests/                Pruebas de la limpieza y de los modelos
```

## Regenerar con datos nuevos

Requiere Node.js 18 o superior; no hay dependencias que instalar.

```
node build.js                      # usa el CSV más reciente de datos/
node build.js ruta/al/archivo.csv  # o uno específico
npm test
```

El archivo debe conservar las columnas `IdPeaje, Peaje, Desde, Hasta, RecaudoFsv,
RecaudoSobrante, Recaudo` y empezar en enero de 2014; el corte entre entrenamiento y
prueba está fijo en los primeros 120 meses.

Las estimaciones son un ejercicio estadístico y no constituyen cifras oficiales.
