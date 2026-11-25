/* =========================================================
   CONFIGURACIÓN
   ========================================================= */
// Orden de los géneros en todos los gráficos: de más a menos nominadas
// (Drama 222, Romance 140, Biopic 114, Bélico 44, Thriller 39, Musical 33, Otro 29)
const GENRES = ['Drama', 'Romance', 'Biopic', 'War', 'Thriller', 'Musical', 'Otro'];

const GENRE_LABELS = {          // nombre que se muestra sobre cada columna
  Drama: 'Drama', Romance: 'Romance', Biopic: 'Biopic', War: 'Bélico',
  Musical: 'Musical', Thriller: 'Thriller', Otro: 'Otro'
};

const GENRE_COLORS = {
  Drama: '#4e79a7', Romance: '#e15759', Biopic: '#f28e2b', War: '#59a14f',
  Musical: '#b07aa1', Thriller: '#76b7b2', Otro: '#9a9a9a'
};

/* Tinte del fondo por género: BG_TINT = cuánto color del género se mezcla con el
   fondo (0 = nada, 1 = el color puro). Bajo para no confundirse con los puntos. */
const BASE_BG = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f1115';
const BG_TINT = 0.12;

const WIN_COLOR = '#f2c230', NOM_COLOR = '#4a4f5a', NEUTRAL = '#8b8f98';
const MGM_COLOR = '#9ecbff';   // productora: color de las películas de MGM
// Productora: los estudios destacados (columna "estudio") y el resto en "Otros"
const STUDIOS = ['MGM', '20th Century Fox', 'Columbia', 'Paramount', 'Warner Bros.', 'Otros'];
const STUDIO_LABELS = { 'MGM': 'MGM', '20th Century Fox': 'Fox', 'Columbia': 'Columbia', 'Paramount': 'Paramount', 'Warner Bros.': 'Warner', 'Otros': 'Otros' };
// Sin colores propios: los cinco estudios en el gris neutro y "Otros" más oscuro
const STUDIO_COLORS = { 'MGM': NEUTRAL, '20th Century Fox': NEUTRAL, 'Columbia': NEUTRAL, 'Paramount': NEUTRAL, 'Warner Bros.': NEUTRAL, 'Otros': '#4a4f5a' };
const studioOf = d => STUDIOS.includes(d.studio) ? d.studio : 'Otros';
// Pósters de las ganadoras de Columbia (img/), en orden cronológico
const COLUMBIA_ROWS = 3;   // filas del bloque de Columbia cuando se destaca (menos filas = más apaisado)
const COLUMBIA_POSTERS = ['ithappened', 'youcanttakeit', 'allthekingsmen', 'fromhere', 'onthewaterfront', 'thebridge',
  'lawrenceofarabia', 'amanofallseasons', 'oliver', 'kramervskramer', 'gandhi', 'thelastemperor'].map(f => `img/${f}.jpg`);
// Arriba de cada bloque: nombre del estudio y cantidad de nominadas
const STUDIO_BLOCK_OPTS = {
  groupOf: studioOf, groups: STUDIOS,
  label: (g, items) => [{ text: STUDIO_LABELS[g], cls: 'label-block' }, { text: String(items.length), cls: 'label-sub' }]
};

/* Área útil del gráfico: franja superior de la pantalla, centrada en ancho.
   Los valores salen de style.css (:root):
   --chart-top = dónde empieza el gráfico (debajo de la barra de progreso)
   --text-top  = dónde termina el gráfico y empieza la zona de texto
   --margin    = margen a cada lado
   CHART_MAX_W = ancho máximo del gráfico en pantallas muy anchas
   CHART_GAP   = aire entre el gráfico y la zona de texto */
const cssNum = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
const CHART_MAX_W = 1280;
const CHART_GAP = 20;
// Mide una variable de longitud de :root (admite vh, px y calc) en px
const cssLen = (() => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:0;pointer-events:none';
  document.documentElement.appendChild(probe);
  return name => { probe.style.height = `var(${name})`; return probe.offsetHeight; };
})();
// Movimiento de los puntos-película entre pasos: largo y con aceleración y
// frenado suaves (seno). Cada punto sale apenas después del anterior (onda).
const DOT_MOVE_MS = 1300;      // cuando cambian de lugar
const DOT_FADE_MS = 900;       // cuando solo cambian color u opacidad
const DOT_EASE = d3.easeSinInOut;
const DOT_STAGGER = 1.4;       // demora entre un punto y el siguiente (ms)
const DOT_STAGGER_MAX = 600;   // demora máxima (el último punto)
const textTop = () => cssLen('--text-top');   // en px

/* Cada película tiene varios géneros en el CSV ("Drama, Romance, War"),
   pero en una columna solo puede estar una vez. Esta función elige UN
   género principal. El ORDEN de los if define la prioridad: cámbialo
   si quieres otro criterio. */
function classify(g) {
  if (g.includes('War'))       return 'War';
  if (g.includes('Musical'))   return 'Musical';
  if (g.includes('Biography')) return 'Biopic';
  if (g.includes('Thriller'))  return 'Thriller';
  if (g.includes('Romance'))   return 'Romance';
  if (g.includes('Drama'))     return 'Drama';
  return 'Otro';
}

/* =========================================================
   ESTADO Y ELEMENTOS
   ========================================================= */
const vis     = document.getElementById('vis');
const svg     = d3.select('#svg');
const gDots   = d3.select('#dots');
const gLabels = d3.select('#labels');
const gLines  = d3.select('#lines');
const gGlow   = d3.select('#glow');   // halos detrás de los puntos que brillan
const gExtra  = d3.select('#extra');  // puntos de relleno (no son películas)
const gZoom   = d3.select('#zoomlinks');   // línea y contorno del zoom in (por encima de los puntos)
const svgDefs = d3.select('#svg').insert('defs', ':first-child');   // máscaras para dibujar el punteado
let zoomMaskSeq = 0;
const GLOW_R  = 3.2;                  // radio del halo, en radios de punto
const legend  = d3.select('#legend');
const tooltip = d3.select('#tooltip');

let films = [], dots, currentStep = 0, prevLayout = null, prevBase = null;

/* =========================================================
   LAYOUTS: cada uno devuelve { pos: Map(id -> {x,y}), r, labels, lines }
   ========================================================= */

/* Barras horizontales de puntos, una por grupo (género). Todas las barras
   tienen el MISMO alto (ROW_K filas de puntos) y crecen hacia la derecha en
   orden cronológico (columna por columna), así que el LARGO de cada barra es
   proporcional a su cantidad de películas y se comparan de un vistazo.
   El nombre va a la izquierda y la cantidad al final de la barra.
   ROW_K se elige solo: el que da el punto más grande posible. */
const ROW_LABEL_W = 100;    // ancho reservado para los nombres (izquierda)
const ROW_VALUE_W = 120;    // ancho reservado para la cantidad (derecha)
const ROW_GAP = 1.4;        // separación entre barras, en tamaños de punto
const ROW_MAX_SIZE = 18;    // tamaño máximo de celda (px)

// first (opcional): las películas que lo cumplen van primero en cada barra (juntas
// desde la izquierda) y el resto después, cada grupo en orden cronológico
function rowLayout(data, keyFn, order, w, h, labelFn = k => k, spanFn = null, first = null) {
  const groups = order.map(k => ({ key: k, items: data.filter(d => keyFn(d) === k) }));
  const G = groups.length;
  const maxN = d3.max(groups, g => g.items.length) || 1;
  const availW = w - ROW_LABEL_W - ROW_VALUE_W;
  // Filas por barra (k): el que permite el punto más grande
  let size = 0, k = 1;
  for (let kk = 1; kk <= 16; kk++) {
    const s = Math.min(availW / Math.ceil(maxN / kk), h / (G * kk + (G - 1) * ROW_GAP), ROW_MAX_SIZE);
    if (s > size + 0.01) { size = s; k = kk; }
  }
  const bandH = k * size;
  const totalH = G * bandH + (G - 1) * ROW_GAP * size;
  let top = (h - totalH) / 2;   // bloque centrado en alto
  // Bloque centrado en ancho: nombres + barra más larga + cantidad
  const x0 = (w - (ROW_LABEL_W + Math.ceil(maxN / k) * size + ROW_VALUE_W)) / 2;

  const pos = new Map(), labels = [];
  groups.forEach(g => {
    g.items.forEach((d, i) => pos.set(d.id, {
      x: x0 + ROW_LABEL_W + Math.floor(i / k) * size + size / 2,
      y: top + (i % k) * size + size / 2
    }));
    const placed = first ? [...g.items.filter(first), ...g.items.filter(d => !first(d))] : g.items;
    if (first) placed.forEach((d, i) => pos.set(d.id, {
      x: x0 + ROW_LABEL_W + Math.floor(i / k) * size + size / 2,
      y: top + (i % k) * size + size / 2
    }));
    const cy = top + bandH / 2 + 5;   // línea base del texto, centrada en la barra
    labels.push({ text: labelFn(g.key), x: x0 + ROW_LABEL_W - 14, y: cy, key: g.key,
                  cls: 'label', anchor: 'end', color: GENRE_COLORS[g.key] });
    const barEnd = x0 + ROW_LABEL_W + Math.ceil(placed.length / k) * size;
    labels.push({ spans: spanFn ? spanFn(g) : [{ text: g.items.length, cls: 'label-value' }],
                  x: barEnd + 10, y: cy, key: g.key, cls: 'label-value', anchor: 'start' });
    top += bandH + ROW_GAP * size;
  });
  return { pos, r: DOT_R, labels, lines: [] };
}

function columnLayout(data, keyFn, order, w, h, labelFn = k => k, subFn = null) {
  const top = 85, bottom = 40, side = 30;
  const availH = h - top - bottom;
  const colW = (w - side * 2) / order.length;
  const groups = order.map(k => ({ key: k, items: data.filter(d => keyFn(d) === k) }));
  const maxN = d3.max(groups, g => g.items.length);

  // Busca el tamaño de punto más grande con el que quepa la columna más llena
  let size = 16;
  for (; size > 3; size -= 0.5) {
    const rows = Math.floor(availH / size);
    if (Math.ceil(maxN / rows) * size <= colW - 16) break;
  }
  const rows = Math.floor(availH / size);

  const pos = new Map(), labels = [];
  groups.forEach((g, gi) => {
    const subcols = Math.ceil(g.items.length / rows) || 1;
    const x0 = side + gi * colW + (colW - subcols * size) / 2;
    g.items.forEach((d, i) => {
      pos.set(d.id, {
        x: x0 + Math.floor(i / rows) * size + size / 2,
        y: top + (i % rows) * size + size / 2
      });
    });
    labels.push({
      text: labelFn(g.key),
      subs: subFn ? subFn(g) : [{ text: g.items.length, cls: 'label-sub' }],
      x: side + gi * colW + colW / 2, y: 36, cls: 'label',
      color: GENRE_COLORS[g.key]
    });
  });
  return { pos, r: DOT_R, labels, lines: [] };
}

/* Grilla horizontal ordenada por tiempo: se llena por FILAS, de izquierda a
   derecha y de arriba hacia abajo (la primera fila son las más antiguas).
   Sus medidas (columnas × filas) salen de gridDims: las mismas que el
   rectángulo por género, así ambos rectángulos son idénticos. */
// Radio de los puntos: el MISMO en todos los gráficos del sitio (px).
// Las palabras de puntos (OSCARS, Género…) usan su propio tamaño (WORD_R_FRAC).
const DOT_R = 4;
const GRID_MAX_SIZE = 18;   // separación máxima entre puntos en la grilla (px)

/* Medidas del rectángulo (columnas × filas). El alto sale de la proporción del
   área del gráfico (apaisada). El ancho es el del mosaico de géneros
   (blockPlan), así la grilla del paso 1 y el rectángulo por género miden lo mismo. */
function gridDims(data, w, h) {
  const n = data.length;
  const cols0 = Math.ceil(Math.sqrt(n * w / h));
  const rows = Math.ceil(n / cols0);
  const plan = blockPlan(data, rows, cols0);
  return { cols: plan ? Math.max(plan.maxW, Math.ceil(n / rows)) : Math.ceil(n / rows), rows, plan };
}

/* MOSAICO DE GÉNEROS (como un tetris): cada género es un rectángulo de cuatro
   lados y entre todos arman un rectángulo de `rows` filas. El alto se reparte
   en franjas horizontales (p. ej. 6 + 6 + 3 filas) y en cada franja los géneros
   van uno al lado del otro con el alto de la franja. Un género cuyo número de
   películas no es múltiplo de ese alto solo puede ir al final de su franja: su
   última columna queda incompleta en el borde derecho, y las franjas pueden
   terminar a distinto largo (como los renglones de un párrafo).
   Se prueban todas las combinaciones (hasta BLOCK_MAX_BANDS franjas) y se elige
   la que deja menos huecos y menos se aleja del ancho original (cols0). */
const BLOCK_MAX_BANDS = 3;
const blockPlanCache = new Map();

// groupOf / groups: por qué se agrupa (por defecto, el género principal)
function blockPlan(data, rows, cols0, groupOf = d => d.main, groups = GENRES) {
  const key = rows + '|' + cols0 + '|' + groups.join(',');
  if (blockPlanCache.has(key)) return blockPlanCache.get(key);
  const N = {};
  groups.forEach(g => { const k = data.filter(d => groupOf(d) === g).length; if (k) N[g] = k; });
  const gs = Object.keys(N);
  const comps = (total, k) => k === 1 ? [[total]]
    : d3.range(1, total - k + 2).flatMap(a => comps(total - a, k - 1).map(c => [a, ...c]));
  let best = null;
  for (let k = 1; k <= Math.min(BLOCK_MAX_BANDS, rows, gs.length); k++) {
    for (const hs of comps(rows, k)) {
      for (let m = 0; m < k ** gs.length; m++) {
        let x = m;
        const bands = hs.map(() => []);
        gs.forEach(g => { bands[x % k].push(g); x = Math.floor(x / k); });
        if (bands.some(b => !b.length)) continue;
        // En cada franja, como mucho un género con columna incompleta
        if (bands.some((b, i) => b.filter(g => N[g] % hs[i]).length > 1)) continue;
        const widths = bands.map((b, i) => d3.sum(b, g => Math.ceil(N[g] / hs[i])));
        const maxW = d3.max(widths);
        const holes = d3.sum(bands, (b, i) => maxW * hs[i] - d3.sum(b, g => N[g]));
        const score = holes + 3 * Math.abs(maxW - cols0) + 4 * (k - 1);
        if (!best || score < best.score) best = { score, hs, bands: bands.map(b => [...b]), widths, maxW };
      }
    }
  }
  if (best) {
    // Orden: la franja del drama arriba y las demás de más larga a más corta;
    // dentro de cada franja, los géneros en el orden de GENRES y el de columna
    // incompleta al final
    const idx = best.bands.map((_, i) => i).sort((a, b) =>
      best.bands[b].includes('Drama') - best.bands[a].includes('Drama') || best.widths[b] - best.widths[a]);
    best.bands = idx.map(i => ({
      h: best.hs[i],
      genres: [...best.bands[i]].sort((a, b) =>
        (N[a] % best.hs[i] ? 1 : 0) - (N[b] % best.hs[i] ? 1 : 0) || groups.indexOf(a) - groups.indexOf(b))
    }));
  }
  blockPlanCache.set(key, best);
  return best;
}

function gridLayout(data, w, h) {
  const { cols, rows, plan } = gridDims(data, w, h);
  const size = Math.min(w / cols, h / rows, GRID_MAX_SIZE);   // que quepa en ancho y en alto
  const x0 = (w - cols * size) / 2, y0 = (h - rows * size) / 2;
  const pos = new Map();
  data.forEach((d, i) => pos.set(d.id, {
    x: x0 + (i % cols) * size + size / 2,
    y: y0 + Math.floor(i / cols) * size + size / 2
  }));
  return { pos, r: DOT_R, labels: [], lines: [], size, cols, rows, x0, y0, plan };
}

/* Palabra dibujada con puntos. El texto se pinta en un canvas oculto con la
   tipografía indicada y se toma una muestra cada WORD_SPACING px: cada muestra
   que cae dentro de una letra se convierte en un punto. */
const WORD_FONT    = '600 280px Outfit';
const WORD_SPACING = 10;    // distancia mínima entre puntos (px): más chica = más puntos
const WORD_R_FRAC  = 0.24;  // radio del punto como fracción de la distancia entre puntos
const WORD_COLOR   = '#ffffff';
// Palabra de la portada: más grande, con puntos casi pegados para que el video
// se vea a través de ellos
const OSCARS_WORD = { font: '700 320px Outfit', spacing: 14, rFrac: 0.38 };
const wordCache = {};

/* Como cada punto es una película, la palabra no puede tener más puntos que
   películas: si con WORD_SPACING no alcanzan, se separan un poco más. */
/* Palabras largas (p. ej. "Productora"): si a WORD_FONT no caben en maxW,
   se achica la tipografía hasta que entren. */
/* Silueta de la estatuilla dibujada con puntos (paso de las ganadoras).
   La silueta es un path SVG (STATUE_PATH, en un lienzo de STATUE_VIEW px): se
   dibuja una sola vez en un canvas oculto y se guarda qué píxeles quedan
   dentro. Luego se toma una muestra en grilla con la separación justa para que
   haya exactamente un punto por ganadora (si sobran algunos, se quitan). */
const STATUE_VIEW = { w: 219, h: 690 };   // viewBox del SVG
const STATUE_PATH = 'M106.566 0.0369189C113.453 -0.12174 124.109 0.0821928 130.089 3.71195C138.161 8.61152 135.064 23.8108 135.425 31.7856C135.588 35.3686 136.744 38.8156 136.191 42.4314C135.512 46.8628 133.481 50.9953 132.004 55.1943C129.38 62.6561 127.66 72.9358 129.716 80.7416C132.611 91.7191 150.583 101.235 160.538 105.308C166.966 107.94 173.91 109.645 179.941 113.167C185.007 116.123 188.736 120.256 190.217 126.06C191.55 131.294 191.623 137.623 190.983 142.97C190.138 150.085 186.347 155.976 184.942 162.82C183.648 169.106 184.953 175.809 184.046 182.207C182.651 192.033 178.311 201.456 176.133 211.161C174.687 217.598 175.428 226.001 172.31 231.79C168.198 239.426 157.231 237.634 153.109 244.995C148.408 253.386 154.001 293.459 154.825 305.07C155.262 311.831 155.414 318.608 155.273 325.381C154.944 338.672 153.123 351.882 149.846 364.764C146.417 378.295 142.598 386.949 141.882 401.222C140.751 423.75 149.008 441.174 145.94 463.811C143.06 485.079 132.358 503.727 132.152 525.027C132.076 533.038 134.919 541.301 139.302 547.91C141.98 551.953 144.137 554.941 145.456 559.668L145.597 560.181C150.883 560.318 180.096 561.026 182.459 563.714L182.3 564.415C181.39 564.788 181.119 564.853 180.324 565.405C179.811 568.654 180.064 572.018 180.002 575.263C179.912 580.043 180.996 577.792 182.235 579.486C182.098 584.523 184.573 582.684 188.208 584.48C191.232 585.976 192.089 587.844 193.281 590.792C190.394 591.75 189.133 591.887 186.21 592.05L186.069 647.001C194.633 648.085 207.994 649.295 215.048 653.866C215.568 662.209 209.512 663.091 218.206 667.318L218.177 679.679C203.81 688.542 130.258 689.916 111.075 689.912C88.3833 689.977 18.9472 689.012 0.0472293 679.769C-0.0449094 675.73 0.0252029 671.426 0.0306228 667.365C4.38607 665.114 7.05339 664.117 3.09179 659.427L3.20488 653.862C9.31494 649.469 24.1753 648.041 32.097 646.918L32.1238 592.086C29.3643 591.754 27.5555 591.443 24.8376 590.854C28.095 581.203 30.8548 586.106 34.5176 581.644C34.6455 580.448 34.6086 580.339 35.0682 579.187C35.8256 578.767 36.7314 578.413 36.8185 577.445C37.0107 575.317 37.6507 566.714 36.6057 565.333C35.4787 564.889 35.3056 564.997 34.6206 564.137L34.871 563.469C39.5227 560.882 65.6792 560.376 72.8646 560.072C77.6013 546.526 86.5868 540.467 86.6775 525.58C86.7674 510.805 79.9116 495.445 76.0031 481.021C71.76 465.95 70.9225 450.124 73.5508 434.688C75.3112 424.657 77.3397 417.604 77.1257 407.1C76.7973 390.996 71.8706 377.688 67.9317 362.404C65.3031 352.204 64.063 340.67 63.4574 330.162C62.6195 315.633 64.1226 300.454 65.281 285.99C66.2046 274.456 68.4781 261.786 66.7441 250.453C64.8485 238.061 57.024 240.726 49.1871 235.746C47.5792 234.724 45.898 232.015 45.3433 230.111C43.9226 225.234 44.3374 219.824 43.2017 214.821C40.6634 203.642 35.8469 192.513 34.3904 181.143C33.6164 175.103 34.6433 169.434 33.3891 163.15C31.9044 155.711 27.7485 147.982 27.153 140.702C26.2435 129.584 28.4361 117.235 39.7398 112.217C44.4548 110.125 48.9942 109.017 53.7561 107.208C63.5684 103.481 78.9244 95.482 85.7958 87.5299C92.4876 79.7855 89.1807 63.5966 86.4849 54.6624C85.3875 51.0256 82.9258 45.9822 82.6729 41.9639C82.4936 39.1199 82.873 35.0885 82.9756 31.9175C83.1592 26.2504 82.5009 9.1619 85.5862 5.01143C88.349 1.29531 102.089 0.197385 106.566 0.0369189Z';
const STATUE_FILL = 0.98;   // alto de la silueta como fracción del alto del gráfico
// Densidad de la silueta: 1 = la separación justa para un punto por ganadora;
// un poco menos agrega los puntos de RELLENO indispensables (no son películas)
// para que la figura sea algo más precisa. Más chico = más puntos.
const STATUE_DENSITY = 0.85;
const STATUE_EXTRA_OPACITY = 1;   // los de relleno se ven igual que las ganadoras
let statueMask = null;      // { w, h, ink: Uint8Array }: 1 = píxel dentro de la silueta
const statueCache = {};

function loadStatue() {
  try {
    const { w, h } = STATUE_VIEW;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fill(new Path2D(STATUE_PATH));
    const px = ctx.getImageData(0, 0, w, h).data;
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ink[i] = px[i * 4 + 3] > 128 ? 1 : 0;
    statueMask = { w, h, ink };
  } catch (e) { console.warn('No se pudo dibujar la silueta de la estatuilla', e); }
  return Promise.resolve();
}

function sampleStatue(count, w, h) {
  if (!statueMask) return null;
  const key = [count, Math.round(w), Math.round(h)].join('|');
  if (statueCache[key]) return statueCache[key];
  const M = statueMask;
  const k = Math.min(h * STATUE_FILL / M.h, w / M.w);   // escala imagen -> pantalla
  const W = M.w * k, H = M.h * k;
  // Muestra SIMÉTRICA: las columnas se ubican en espejo a ambos lados del eje
  // central y se decide con la mitad izquierda de la silueta; cada punto de la
  // izquierda tiene su gemelo a la derecha.
  const inkAt = (x, y) => M.ink[Math.min(M.h - 1, Math.floor(y / k)) * M.w + Math.max(0, Math.min(M.w - 1, Math.floor(x / k)))];
  const sample = s => {
    const pts = [], cx = W / 2;
    for (let y = s / 2; y < H; y += s)
      for (let u = s / 2; u < cx; u += s)
        if (inkAt(cx - u, y)) pts.push({ x: cx - u, y }, { x: cx + u, y });
    return pts;
  };
  // Separación justa para un punto por ganadora (se achica de a poco hasta que
  // alcancen) y luego un poco más chica según STATUE_DENSITY
  const inkArea = M.ink.reduce((a, b) => a + b, 0) * k * k;
  let s = Math.sqrt(inkArea / count) * 1.4, pts = sample(s);
  while (pts.length < count && s > 2) { s -= 0.25; pts = sample(s); }
  if (STATUE_DENSITY < 1) { s *= STATUE_DENSITY; pts = sample(s); }
  // Centrada en el área del gráfico; de arriba hacia abajo (cabeza -> base)
  pts.forEach(p => { p.x += (w - W) / 2; p.y += (h - H) / 2; });
  pts.sort((a, b) => a.y - b.y || a.x - b.x);
  // Las ganadoras ocupan `count` lugares repartidos al azar (siempre los mismos)
  // por toda la silueta; el resto son puntos de relleno
  const order = d3.shuffler(d3.randomLcg(0.42))(d3.range(pts.length));
  const mine = new Set(order.slice(0, count));
  const res = { main: pts.filter((_, i) => mine.has(i)), extra: pts.filter((_, i) => !mine.has(i)) };
  return (statueCache[key] = res);
}

function sampleWord(text, maxPts, maxW, maxH, opts = {}) {
  const baseFont = opts.font || WORD_FONT;
  const key = [text, maxPts, Math.round(maxW), Math.round(maxH), baseFont, opts.spacing].join('|');
  if (wordCache[key]) return wordCache[key];
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = baseFont;
  const mm = ctx.measureText(text);
  // Que entre en el ancho y en el alto del área del gráfico
  const scale = Math.min(1, maxW / mm.width,
                         maxH / (mm.actualBoundingBoxAscent + mm.actualBoundingBoxDescent));
  const font = baseFont.replace(/(\d+)px/, (_, px) => Math.floor(px * scale) + 'px');
  let spacing = opts.spacing || WORD_SPACING, pts;
  while (true) {
    pts = sampleWordAt(text, spacing, font);
    if (pts.length <= maxPts) break;
    spacing += 0.5;
  }
  return (wordCache[key] = { pts, spacing });
}

function sampleWordAt(text, WORD_SPACING, font) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  ctx.font = font;
  const m = ctx.measureText(text);
  const pad = 40;
  c.width  = Math.ceil(m.width) + pad * 2;
  c.height = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + pad * 2;
  ctx.font = font;                 // al cambiar el tamaño del canvas se reinicia el contexto
  ctx.fillStyle = '#000';
  ctx.fillText(text, pad, pad + m.actualBoundingBoxAscent);
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  const pts = [];
  for (let y = WORD_SPACING / 2; y < c.height; y += WORD_SPACING)
    for (let x = WORD_SPACING / 2; x < c.width; x += WORD_SPACING)
      if (img[(Math.round(y) * c.width + Math.round(x)) * 4 + 3] > 128) pts.push({ x, y });
  // Centrar los puntos en (0,0)
  const [x0, x1] = d3.extent(pts, p => p.x), [y0, y1] = d3.extent(pts, p => p.y);
  pts.forEach(p => { p.x -= (x0 + x1) / 2; p.y -= (y0 + y1) / 2; });
  return pts;
}

// opts (opcional): font, spacing y rFrac propios para esa palabra
// Subtítulo debajo de una palabra hecha de puntos (centrado, letra común)
const OSCARS_SUBTITLE = '100 años del Premio a Mejor Película';
const SUBTITLE_GAP = 70;   // distancia entre la base de la palabra y el subtítulo (px)
function withSubtitle(L, text) {
  const ys = [], xs = [];
  L.pos.forEach((p, id) => { if (!L.hidden.has(id)) { ys.push(p.y); xs.push(p.x); } });
  L.labels.push({ text, x: (d3.min(xs) + d3.max(xs)) / 2, y: d3.max(ys) + L.r + SUBTITLE_GAP,
                  cls: 'label-subtitle', anchor: 'middle' });
  return L;
}

function wordLayout(data, w, h, text, opts = {}) {
  // Tamaño máximo: el área del gráfico
  const { pts, spacing } = sampleWord(text, data.length, Math.max(200, w), Math.max(80, h), opts);
  // Centrada en la PANTALLA completa (no solo en el área del gráfico)
  const r = vis.getBoundingClientRect();
  const cx = window.innerWidth / 2 - r.left - (r.width - w) / 2;
  const cy = h / 2;
  const pos = new Map(), hidden = new Set();
  data.forEach((d, i) => {
    // Si hay más películas que puntos en la palabra, las sobrantes se apilan
    // sobre algún punto y quedan invisibles
    const p = pts[i % pts.length];
    pos.set(d.id, { x: cx + p.x, y: cy + p.y });
    if (i >= pts.length) hidden.add(d.id);
  });
  return { pos, r: spacing * (opts.rFrac || WORD_R_FRAC), labels: [], lines: [], hidden };
}

/* Géneros en forma radial: el nombre de cada género (Outfit bold, en su color)
   con sus películas en círculos concéntricos que salen del centro de la
   palabra. Cada círculo está corrido medio lugar respecto del anterior
   (intercalados, como un semitono). Los puntos van detrás de la palabra con
   un degradado radial de opacidad: ORBIT_FAINT en el centro de la palabra,
   subiendo de a poco hasta 1 al llegar al borde de la palabra.
   Géneros: 4 arriba y 3 abajo, todos a la misma distancia entre sí.
   Movimiento: cada ORBIT_PERIOD_MS, cada círculo gira un lugar despacio
   (círculos vecinos en sentidos opuestos) y vuelve a quedarse quieto. */
const ORBIT_FONT      = '700 30px Outfit';   // misma tipografía que .label-orbit (style.css)
const ORBIT_GAP       = 10;    // distancia entre círculos (px)
const ORBIT_SPACING   = 10;    // distancia entre puntos de un mismo círculo (px)
const ORBIT_FAINT     = 0.15;  // opacidad de los puntos en el centro de la palabra
const ORBIT_WORD_PAD  = 14;    // el degradado llega a opacidad 1 a esta distancia más allá del borde de la palabra (px)
const ORBIT_CURVE     = 2;     // curva del degradado: 1 = lineal, más alto = se aclara más tarde (más tenue sobre la palabra)
const ORBIT_PERIOD_MS = 4500;  // cada cuánto giran los círculos
const ORBIT_MOVE_MS   = 1600;  // cuánto dura cada giro (lento)
const ORBIT_STAGGER   = 120;   // demora entre un círculo y el siguiente (efecto onda)
const ORBIT_WAIT_MS   = 1600;  // espera a que los puntos lleguen antes de empezar

// Posición de un punto de la órbita después de `moved` giros de un lugar
function orbitPoint(o, moved = 0) {
  const a = o.a0 + o.dir * moved * o.da;
  return { x: o.cx + o.r * Math.cos(a), y: o.cy + o.r * Math.sin(a) };
}
// Opacidad según la distancia al centro de la palabra (degradado radial suave).
// Como cada punto gira sobre su círculo, su distancia al centro no cambia.
function orbitOpacity(o) {
  const t = Math.min(1, o.r / (o.hw + ORBIT_WORD_PAD));
  return ORBIT_FAINT + (1 - ORBIT_FAINT) * Math.pow(t, ORBIT_CURVE);
}

function orbitLayout(data, w, h) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = ORBIT_FONT;
  const step = w / 4;                       // misma distancia horizontal en ambas filas
  const rows = [GENRES.slice(0, 4), GENRES.slice(4)];
  const pos = new Map(), orbit = new Map(), opacity = new Map(), labels = [];
  rows.forEach((row, ri) => {
    const cy = h * (ri === 0 ? 0.25 : 0.75);
    row.forEach((g, i) => {
      const cx = w / 2 + (i - (row.length - 1) / 2) * step;
      const m = ctx.measureText(GENRE_LABELS[g]);
      const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
      const hw = m.width / 2, hh = (asc + desc) / 2;   // media caja de la palabra (centrada en cx, cy)
      const items = data.filter(d => d.main === g);
      let k = 0, ring = 1, prevPhase = 0, prevDa = 0;
      while (k < items.length) {
        const r = ring * ORBIT_GAP;
        const fit = Math.max(1, Math.floor(2 * Math.PI * r / ORBIT_SPACING));
        const n = Math.min(fit, items.length - k);       // el último círculo reparte parejo los que quedan
        const da = 2 * Math.PI / n;
        const phase = prevPhase + prevDa / 2;              // intercalado con el círculo anterior
        const base = { cx, cy, hw, hh, r, da, dir: ring % 2 ? 1 : -1, delay: ring * ORBIT_STAGGER };
        for (let j = 0; j < n; j++, k++) {
          const o = { ...base, a0: phase + j * da };
          const p = orbitPoint(o);
          orbit.set(items[k].id, o);
          pos.set(items[k].id, p);
          opacity.set(items[k].id, orbitOpacity(o));
        }
        prevPhase = phase; prevDa = da;
        ring++;
      }
      labels.push({ text: GENRE_LABELS[g], x: cx, y: cy + (asc - desc) / 2, cls: 'label-orbit',
                    anchor: 'middle', color: GENRE_COLORS[g] });
    });
  });
  return { pos, r: DOT_R, labels, lines: [], orbit, opacity };
}

// Animación (d3.timer): quietos la mayor parte del tiempo; al final de cada
// período, cada círculo gira un lugar con una curva suave.
let orbitTimer = null, orbitWait = null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function stopOrbit() {
  clearTimeout(orbitWait);
  if (orbitTimer) orbitTimer.stop();
  orbitTimer = null;
}
function startOrbit(orbit, wait) {
  stopOrbit();
  if (reduceMotion) return;                 // sin movimiento continuo si el sistema lo pide
  orbitWait = setTimeout(() => {
    const sel = dots.filter(d => orbit.has(d.id));
    orbitTimer = d3.timer(t => {
      sel.each(function (d) {
        const o = orbit.get(d.id);
        const tt = Math.max(0, t - o.delay);
        const n = Math.floor(tt / ORBIT_PERIOD_MS), p = tt - n * ORBIT_PERIOD_MS;
        const moved = n + d3.easeCubicInOut(Math.max(0, (p - (ORBIT_PERIOD_MS - ORBIT_MOVE_MS)) / ORBIT_MOVE_MS));
        const pt = orbitPoint(o, moved);
        this.setAttribute('cx', pt.x);
        this.setAttribute('cy', pt.y);
      });
    });
  }, wait);
}

// Grilla con las películas de un solo género (las demás conservan su columna)
function soloGenreLayout(data, w, h, genre) {
  const G = gridLayout(data, w, h);
  const { size, cols, x0 } = G;
  const L = LAYOUTS.genre(data, w, h);
  const items = data.filter(d => d.main === genre);
  const rows = Math.ceil(items.length / cols);
  const y0 = (h - rows * size) / 2;
  items.forEach((d, i) => L.pos.set(d.id, {
    x: x0 + (i % cols) * size + size / 2,
    y: y0 + Math.floor(i / cols) * size + size / 2
  }));
  L.r = G.r;
  L.labels = [];
  return L;
}

/* Rectángulo por género: el MISMO rectángulo del paso 1 (mismas columnas,
   filas, tamaño y espaciado; ver gridDims), partido en un bloque por género,
   de izquierda a derecha en el orden de GENRES, encastrados como en un tetris:
   las celdas se llenan columna por columna (de arriba hacia abajo) y cada
   género empieza justo donde terminó el anterior, completando su columna.
   Así no queda ningún hueco entre bloques: solo la última columna del
   rectángulo queda incompleta (como un renglón sin terminar).
   side = true: el rectángulo se desliza a la izquierda (si no cabe, se achica
   un poco sin cambiar su forma) y deja libre la derecha para el círculo de una
   película (L.spot = centro y diámetro del círculo). */
const SPOT_GRID_FRAC = 0.56;   // ancho máximo del rectángulo cuando se desliza (fracción del gráfico)
const SPOT_GAP = 56;           // aire entre el rectángulo y el círculo (px)

/* Separación entre bloques: dentro de un género los puntos se juntan un poco
   (BLOCK_TIGHT) y entre bloques queda un espacio extra (BLOCK_GAP), el mismo
   entre géneros de una franja y entre franjas. Como todos los bloques son
   rectángulos, la separación es igual en todos los bordes. */
const BLOCK_TIGHT = 0.85;   // distancia entre puntos del mismo género (fracción de la del paso 1)
const BLOCK_GAP = 1.1;      // espacio extra entre bloques, en distancias entre puntos

/* opts (opcional):
   - first: las películas que lo cumplen van primero dentro de su bloque
     (p. ej. d => d.winner: las ganadoras juntas al principio)
   - label: función (género, sus películas) -> spans del texto que va arriba
     de cada bloque; se reserva BLOCK_LABEL_U celdas de alto sobre cada franja */
const BLOCK_LABEL_U = 1.7;   // alto del texto sobre cada franja, en distancias entre puntos

// Bloques de la tasa de victoria: ganadoras primero; arriba, género y tasa
const RATE_BLOCK_OPTS = {
  first: d => d.winner,
  label: (g, items) => {
    const wins = items.filter(d => d.winner).length;
    const pct = items.length ? Math.round(wins / items.length * 100) : 0;
    return [{ text: GENRE_LABELS[g], cls: 'label-block' }, { text: `${pct}%`, cls: 'label-block-rate' }];
  }
};

// opts.groupOf / opts.groups: agrupar por otra cosa (p. ej. productora) en vez del género
function genreBlockLayout(data, w, h, side = false, opts = {}) {
  const G = gridLayout(data, w, h);
  const { rows } = G;
  const first = opts.first || (() => false);
  const byGenre = g => data.filter(d => (opts.groupOf || (d => d.main))(d) === g)
    .sort((a, b) => first(b) - first(a) || a.year - b.year || a.id - b.id);
  const groups = opts.groups || GENRES;
  const plan = opts.groups
    ? blockPlan(data, rows, Math.ceil(Math.sqrt(data.length * w / h)), opts.groupOf, opts.groups)
    : G.plan;
  // Sin mosaico posible (no debería pasar): una sola franja con todos los grupos
  const bands = plan ? plan.bands : [{ h: rows, genres: groups }];
  const labU = opts.label ? BLOCK_LABEL_U : 0;

  // Medidas en distancias entre puntos (con las separaciones y los textos)
  const bandW = b => d3.sum(b.genres, g => Math.ceil(byGenre(g).length / b.h)) + (b.genres.length - 1) * BLOCK_GAP;
  const unitsW = d3.max(bands, bandW);
  const unitsH = d3.sum(bands, b => b.h + labU) + (bands.length - 1) * BLOCK_GAP;
  const size = Math.min(G.size * BLOCK_TIGHT, w * (side ? SPOT_GRID_FRAC : 1) / unitsW, h / unitsH);
  const gw = unitsW * size;
  const x0 = side ? 0 : (w - gw) / 2, y0 = (h - unitsH * size) / 2;

  // Cada género ocupa el mismo bloque de siempre (b.h filas y las columnas que
  // necesite), pero se llena por filas: el tiempo avanza hacia la derecha y,
  // al terminar una fila, sigue en la de abajo. Primero las que cumplen
  // `first` y luego el resto, cada grupo en orden cronológico
  const pos = new Map(), labels = [];
  let by = 0;
  bands.forEach(b => {
    let bx = 0;
    by += labU;
    b.genres.forEach(g => {
      const items = byGenre(g);
      const cols = Math.ceil(items.length / b.h);   // ancho del bloque (no cambia)
      items.forEach((d, i) => pos.set(d.id, {
        x: x0 + (bx + i % cols) * size + size / 2,
        y: y0 + (by + Math.floor(i / cols)) * size + size / 2
      }));
      if (opts.label) labels.push({ text: '', spans: opts.label(g, items), key: g,
        x: x0 + bx * size, y: y0 + by * size - 7, cls: 'label-block', anchor: 'start' });
      bx += Math.ceil(items.length / b.h) + BLOCK_GAP;
    });
    by += b.h + BLOCK_GAP;
  });
  data.forEach(d => { if (!pos.has(d.id)) pos.set(d.id, G.pos.get(d.id)); });
  const L = { pos, r: Math.min(DOT_R, size * 0.42), labels, lines: [] };
  if (side) {
    const rest = w - gw - SPOT_GAP;
    L.spot = { x: gw + SPOT_GAP + rest / 2, y: h / 2, D: Math.max(160, Math.min(rest, h + 40)) };
  }
  return L;
}

/* Zoom in al trío de un género: el bloque del género (mismo tamaño que en el
   rectángulo por género) se centra en la pantalla y, debajo, aparecen los tres
   círculos de las películas en línea. Los demás géneros se ocultan con `hide`
   y quedan en su lugar. L.trioGeo = centro y diámetro de cada círculo.
   Como el trío baja hasta la zona de texto, la composición se mide con la
   pantalla completa (no solo con el área del gráfico). */
const ZOOM_STACK_GAP = 56;   // aire entre el bloque y los círculos (px)
const ZOOM_STACK_PAD = 32;   // margen inferior de la pantalla (px)
// Zoom in: contorno blanco de los círculos y líneas hasta su punto, mismo grosor
// (el grosor se define en style.css: --zoom-stroke)
const ZOOM_LINK_OPACITY = 1;      // opacidad de la línea y del contorno (1 = blanco pleno)
const ZOOM_RING_OUT = 1;          // el contorno va este tanto (px) por fuera del círculo

// single = true: una película a la vez. El círculo va a la izquierda y el
// título, año y descripción a la derecha (L.info); el par queda centrado en la
// pantalla, debajo del bloque. Todas las películas comparten ese lugar.
const ZOOM_INFO_W = 400;     // ancho máximo del texto al lado del círculo (px)
const ZOOM_INFO_GAP = 48;    // aire entre el círculo y el texto (px)

function genreZoomLayout(data, w, h, genre, films, single = false, opts = {}) {
  const L = genreBlockLayout(data, w, h, false, opts);   // opts: mismo orden que el paso anterior
  L.labels = [];
  const items = data.filter(d => (opts.groupOf || (x => x.main))(d) === genre);   // groupOf: p. ej. por estudio
  const ps = items.map(d => L.pos.get(d.id));
  const bx0 = d3.min(ps, p => p.x) - L.r, bx1 = d3.max(ps, p => p.x) + L.r;
  const by0 = d3.min(ps, p => p.y) - L.r, by1 = d3.max(ps, p => p.y) + L.r;
  const bh = by1 - by0;

  const top = cssNum('--chart-top');            // y del área del gráfico en la pantalla
  const margin = cssNum('--margin');
  const n = films.length;
  const availW = Math.max(300, innerWidth - margin * 2);
  const availH = innerHeight - top - ZOOM_STACK_PAD - bh - ZOOM_STACK_GAP;
  const D = single
    ? Math.max(100, Math.min(availW * 0.42, availH, innerHeight * 0.5))
    : Math.max(100, Math.min((availW - TRIO_GAP * (n - 1)) / n, availH, innerHeight * 0.5));
  // Bloque + círculos centrados en alto (sin subir por encima del gráfico)
  const total = bh + ZOOM_STACK_GAP + D;
  const yTop = Math.max(top, (innerHeight - total) / 2) - top;   // en coordenadas del gráfico

  const dx = w / 2 - (bx0 + bx1) / 2, dy = yTop - by0;
  items.forEach(d => { const p = L.pos.get(d.id); L.pos.set(d.id, { x: p.x + dx, y: p.y + dy }); });
  const cy = yTop + bh + ZOOM_STACK_GAP + D / 2;
  if (single) {
    // Dupla círculo + texto, centrada en el ancho
    const textW = Math.max(160, Math.min(ZOOM_INFO_W, availW - D - ZOOM_INFO_GAP));
    const x0 = w / 2 - (D + ZOOM_INFO_GAP + textW) / 2;
    L.trioGeo = films.map(() => ({ x: x0 + D / 2, y: cy, D }));
    L.info = { x: x0 + D + ZOOM_INFO_GAP, y: cy, w: textW };
  } else {
    L.trioGeo = films.map((_, i) => ({ x: w / 2 + (i - (n - 1) / 2) * (D + TRIO_GAP), y: cy, D }));
  }
  return L;
}

/* Zoom in a los extremos de duración (como el drama): el histograma se achica
   en alto y sube, y debajo aparecen a la vez los dos círculos (la más corta a
   la izquierda y la más larga a la derecha), con la diferencia entre ellos.
   Igual que en el drama, la composición se mide con la pantalla completa. */
const DURATION_ZOOM_LIFT = 110;   // cuánto más arriba van el histograma y los círculos (px)
function durationZoomLayout(data, w, h, films, base = 'durationStrip') {
  const top = cssNum('--chart-top');
  const margin = cssNum('--margin');
  const n = films.length, gap = films.between ? TRIO_BETWEEN_GAP : TRIO_GAP;
  const availW = Math.max(300, innerWidth - margin * 2);
  const availH = innerHeight - top - ZOOM_STACK_PAD;
  const D = Math.max(100, Math.min((availW - gap * (n - 1)) / n, innerHeight * 0.4, availH * 0.5));
  // Alto del histograma: lo que queda arriba de los círculos (nunca más que el original)
  const gh = Math.max(160, Math.min(h, availH - ZOOM_STACK_GAP - D));
  const L = LAYOUTS[base](data, w, gh);
  const total = gh + ZOOM_STACK_GAP + D;
  // Todo sube DURATION_ZOOM_LIFT px respecto del centrado (puede pasar por
  // encima de --chart-top: en este paso no hay leyenda arriba)
  const dy = Math.max(top, (innerHeight - total) / 2) - top - DURATION_ZOOM_LIFT;   // en coordenadas del gráfico
  L.pos.forEach(p => { p.y += dy; });
  L.labels.forEach(l => { l.y += dy; });
  L.lines.forEach(l => { ['y', 'y1', 'y2'].forEach(k => { if (l[k] != null) l[k] += dy; }); });
  const cy = dy + gh + ZOOM_STACK_GAP + D / 2;
  L.trioGeo = films.map((_, i) => ({ x: w / 2 + (i - (n - 1) / 2) * (D + gap), y: cy, D }));
  return L;
}

function scatterZoomLayout(data, w, h, films) {
  const top = cssNum('--chart-top');
  const availW = Math.max(300, innerWidth - cssNum('--margin') * 2);
  const availH = innerHeight - top - ZOOM_STACK_PAD;
  const D = Math.max(100, Math.min(availW * 0.42, innerHeight * 0.32, availH * 0.45));
  const gh = Math.max(160, Math.min(h, availH - ZOOM_STACK_GAP - D));   // alto del gráfico
  const L = LAYOUTS.scatterDecade(data, w, gh);
  const total = gh + ZOOM_STACK_GAP + D;
  const dy = Math.max(top, (innerHeight - total) / 2) - top - DURATION_ZOOM_LIFT;
  L.pos.forEach((p, id) => L.pos.set(id, { x: p.x, y: p.y + dy }));
  L.labels.forEach(l => { l.y += dy; });
  L.lines.forEach(l => { ['y', 'y1', 'y2'].forEach(k => { if (l[k] != null) l[k] += dy; }); });
  (L.rects || []).forEach(r => { r.y += dy; });
  (L.trends || []).forEach(t => {
    if (t.points) t.points = t.points.map(([x, y]) => [x, y + dy]);
    else { t.y1 += dy; t.y2 += dy; }
  });
  // Círculo + texto, centrados en el ancho, debajo del gráfico
  const cy = dy + gh + ZOOM_STACK_GAP + D / 2;
  const textW = Math.max(160, Math.min(ZOOM_INFO_W, availW - D - ZOOM_INFO_GAP));
  const x0 = w / 2 - (D + ZOOM_INFO_GAP + textW) / 2;
  L.trioGeo = films.map(() => ({ x: x0 + D / 2, y: cy, D }));
  L.info = { x: x0 + D + ZOOM_INFO_GAP, y: cy, w: textW };
  return L;
}

/* Dónde la línea toca el círculo: en la dirección del punto visto desde el
   centro del círculo, redondeada a un ángulo "limpio" (múltiplo de
   ZOOM_ANGLE_STEP: 0°, 15°, 30°, 45°…). Así la línea llega casi en la
   dirección del radio, es decir, perpendicular (o casi) al contorno; si el
   punto está muy a un costado, la línea entra en diagonal. */
const ZOOM_ANGLE_STEP = 15;   // grados
// joint (opcional, por película: cfg.joint): ángulo fijo en grados, como en
// un reloj: 0 = arriba, 90 = derecha, 180 = abajo, 270 = izquierda
function zoomJoint(p, c, R, joint = null) {
  const step = ZOOM_ANGLE_STEP * Math.PI / 180;
  const a = joint != null
    ? (joint - 90) * Math.PI / 180
    : Math.round(Math.atan2(p.y - c.y, p.x - c.x) / step) * step;
  return { x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) };
}

/* Línea del zoom in: un solo trazo fino que sale del borde del punto (centro
   p, radio r), del lado que mira al círculo, y llega al contorno del círculo
   de su película (centro c, radio R) en zoomJoint.
   (Se dibuja en ese sentido: del punto hacia el círculo.) */
function zoomLinkPath(p, r, c, R, joint = null) {
  const q = zoomJoint(p, c, R, joint);
  const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const sx = p.x + (q.x - p.x) / d * r, sy = p.y + (q.y - p.y) / d * r;
  return `M${sx},${sy}L${q.x},${q.y}`;
}

/* Contorno del círculo como path: empieza donde llega la línea (zoomJoint) y
   da la vuelta completa, así se puede dibujar "de principio a fin". Va apenas
   por fuera del círculo para que el video no lo tape. */
function zoomRingPath(p, c, R, joint = null) {
  const q = zoomJoint(p, c, R, joint), o = { x: 2 * c.x - q.x, y: 2 * c.y - q.y };   // o: el punto opuesto
  return `M${q.x},${q.y}A${R},${R} 0 1 1 ${o.x},${o.y}A${R},${R} 0 1 1 ${q.x},${q.y}`;
}

/* Secuencia del zoom in (ms): 1) los puntos blancos se encienden, 2) la línea
   baja hasta el círculo, 3) se dibuja el contorno, 4) aparecen el video y el texto.
   Las etapas se encadenan: cada una empieza antes de que termine la anterior
   (ZOOM_START = en qué fracción de la etapa anterior arranca). El contorno sí
   empieza justo cuando la línea llega (la línea acelera al bajar y el contorno
   sale con esa velocidad, como un solo trazo). Además, cada película arranca
   ZOOM_STAGGER ms después de la anterior, para que no vayan las tres a la par. */
const ZOOM_SEQ   = { move: 800, glow: 700, line: 650, ring: 1300, content: 900 };
const ZOOM_START = { glow: 0.55, line: 0.4, content: 0.45 };
const ZOOM_STAGGER = 240;   // demora entre una película y la siguiente (ms)
const ZOOM_GLOW_R = 2.2;    // cuánto crece el punto al encenderse (en radios)
// moving = false: el bloque ya está en su lugar (p. ej. al pasar de una
// película a la siguiente), así que el punto se enciende enseguida
function zoomTimes(animate, moving = true) {
  if (!animate) return { glow: 0, line: 0, ring: 0, content: 0, stagger: 0 };
  const glow = moving ? ZOOM_SEQ.move * ZOOM_START.glow : 200;
  const line = glow + ZOOM_SEQ.glow * ZOOM_START.line;
  const ring = line + ZOOM_SEQ.line;
  const content = ring + ZOOM_SEQ.ring * ZOOM_START.content;
  return { glow, line, ring, content, stagger: ZOOM_STAGGER };
}
/* Texto del zoom in de a una película (#zoom-info): título, año y descripción
   a la derecha del círculo, centrado en su alto. Al cambiar de película, el
   texto anterior se esfuma y el nuevo aparece junto con su video (delay). */
const zoomInfoEl = document.getElementById('zoom-info');
const zoomInfo = { film: null, timer: null, swap: null };

// era = true: solo la era del cine de la película (cfg.era), grande y en el
// color del género (--zi-era-color). En el paso siguiente (era = false) la era
// no desaparece: sube y debajo aparecen el título, el año y la descripción.
// Une la última palabra a la anterior (sin palabras huérfanas)
const glueLast = s => s.replace(/ (\S+)\s*$/, '\u00A0$1');
const ZI_ERA_MOVE_MS = 800;   // lo que tarda la era en subir (o bajar)
function showZoomInfo(cfg, x, y, w, delay, animate, era = false) {
  if (!zoomInfoEl) return;
  Object.assign(zoomInfoEl.style, { left: x + 'px', top: y + 'px', width: w + 'px' });
  const base = cfg.key || cfg.film;
  const key = base + (era ? '#era' : '');
  if (zoomInfo.film === key) return;   // misma película y mismo texto: solo se reubica
  const prevBase = zoomInfo.base, prevEra = zoomInfo.era;
  zoomInfo.film = key; zoomInfo.base = base; zoomInfo.era = era;
  clearTimeout(zoomInfo.timer); clearTimeout(zoomInfo.swap); clearTimeout(zoomInfo.rest);
  const wasOn = zoomInfoEl.classList.contains('on');
  // Misma película, de la era al título (o al revés): la era se queda y se desliza
  if (animate && wasOn && prevBase === base && prevEra !== era && cfg.era) {
    const h1 = zoomInfoEl.querySelector('.zi-era');
    const slide = () => {
      const before = h1.getBoundingClientRect().top;
      zoomInfoEl.classList.toggle('era', era);
      const after = h1.getBoundingClientRect().top;
      h1.style.transition = 'none';
      h1.style.transform = `translateY(${before - after}px)`;
      h1.getBoundingClientRect();   // aplica el punto de partida antes de animar
      h1.style.transition = `transform ${ZI_ERA_MOVE_MS}ms cubic-bezier(.45,0,.2,1)`;
      h1.style.transform = '';
    };
    if (!era) {
      // Sube la era y después aparecen título, año y descripción
      zoomInfoEl.querySelector('h3').textContent = cfg.title || '';
      zoomInfoEl.querySelector('.zi-year').textContent = cfg.year || '';
      zoomInfoEl.querySelector('.zi-desc').textContent = glueLast(cfg.caption || '');
      zoomInfoEl.classList.add('rest-hidden');
      slide();
      zoomInfo.rest = setTimeout(() => zoomInfoEl.classList.remove('rest-hidden'), ZI_ERA_MOVE_MS * 0.6);
    } else {
      // Al volver: primero se van título, año y descripción; después baja la era
      zoomInfoEl.classList.add('rest-hidden');
      zoomInfo.rest = setTimeout(() => { slide(); zoomInfoEl.classList.remove('rest-hidden'); }, 400);
    }
    return;
  }
  zoomInfoEl.classList.remove('on');
  const fill = () => {
    zoomInfoEl.classList.remove('rest-hidden');
    zoomInfoEl.classList.toggle('era', era);
    zoomInfoEl.querySelector('.zi-era').textContent = cfg.era || '';
    zoomInfoEl.querySelector('h3').textContent = cfg.title || '';
    zoomInfoEl.querySelector('.zi-year').textContent = cfg.year || '';
    zoomInfoEl.querySelector('.zi-desc').textContent = glueLast(cfg.caption || '');
  };
  // Cambia el texto cuando el anterior ya se esfumó
  if (animate && wasOn) zoomInfo.swap = setTimeout(fill, 350); else fill();
  zoomInfo.timer = setTimeout(() => zoomInfoEl.classList.add('on'), animate ? Math.max(delay, 400) : 0);
}

function hideZoomInfo() {
  if (!zoomInfoEl || zoomInfo.film === null) return;
  zoomInfo.film = null; zoomInfo.base = null;
  clearTimeout(zoomInfo.timer); clearTimeout(zoomInfo.swap); clearTimeout(zoomInfo.rest);
  zoomInfoEl.classList.remove('on');
}

/* Marcas de año de un bloque de género (step.years): "1927 →" a la izquierda
   del primer punto y "← 2026" a la derecha del último. Los bloques se llenan
   por filas, así que el primero es el de la izquierda de la fila de arriba y el
   último, el de la derecha de la fila de abajo. Si del lado de la marca hay puntos de
   otro género a la vista, la marca va en vertical: arriba del primer punto
   (flecha hacia abajo) o debajo del último (flecha hacia arriba). */
const gYears = svg.append('g').attr('id', 'years');
const YEAR_GAP = 10;     // aire entre el punto y la punta de la flecha (px)
const YEAR_ARROW = 40;   // largo de la flecha (px)
const YEAR_TEXT_GAP = 8; // aire entre la flecha y el año (px)

// Flecha de (x1,y1) a (x2,y2) con la punta en (x2,y2)
function arrowPath(x1, y1, x2, y2) {
  const a = Math.atan2(y2 - y1, x2 - x1), k = 5, s = 0.5;
  const p = t => `${x2 - k * Math.cos(a + t)},${y2 - k * Math.sin(a + t)}`;
  return `M${x1},${y1}L${x2},${y2}M${p(-s)}L${x2},${y2}L${p(s)}`;
}

function yearMarks(step, L) {
  if (!step.years) return [];
  // step.years: un género ('Drama'), true (todas las películas) o una función (p. ej. d => d.winner)
  const sel = typeof step.years === 'function' ? step.years : step.years === true ? () => true : d => d.main === step.years;
  const prefix = typeof step.years === 'string' ? step.years : 'y';
  const isHidden = d => (step.hide && step.hide(d)) || (L.hidden && L.hidden.has(d.id));
  const items = films.filter(d => sel(d) && !isHidden(d));
  if (!items.length) return [];
  const P = d => L.pos.get(d.id);
  // Los bloques se llenan por filas: el primero es el de más a la izquierda de
  // la fila de arriba y el último, el de más a la derecha de la fila de abajo
  const first = items.reduce((a, d) => P(d).y < P(a).y - 0.5 || (Math.abs(P(d).y - P(a).y) <= 0.5 && P(d).x < P(a).x) ? d : a);
  const last  = items.reduce((a, d) => P(d).y > P(a).y + 0.5 || (Math.abs(P(d).y - P(a).y) <= 0.5 && P(d).x > P(a).x) ? d : a);
  const others = films.filter(d => !sel(d) && !isHidden(d)).map(P);
  const ys = items.map(d => P(d).y);
  const top = d3.min(ys) - L.r, bottom = d3.max(ys) + L.r;
  const reach = YEAR_GAP + YEAR_ARROW + YEAR_TEXT_GAP + 40;   // espacio que ocupa la marca
  const blocked = (x0, x1, y0, y1) => others.some(p => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1);
  const marks = [];

  const f = P(first);
  if (!blocked(f.x - L.r - reach, f.x - L.r, f.y - 12, f.y + 12)) {
    const x2 = f.x - L.r - YEAR_GAP, x1 = x2 - YEAR_ARROW;
    marks.push({ key: 'start', path: arrowPath(x1, f.y, x2, f.y), text: first.year,
                 tx: x1 - YEAR_TEXT_GAP, ty: f.y, anchor: 'end' });
  } else {
    const y2 = top - YEAR_GAP, y1 = y2 - YEAR_ARROW * 0.6;
    marks.push({ key: 'start', path: arrowPath(f.x, y1, f.x, y2), text: first.year,
                 tx: f.x, ty: y1 - YEAR_TEXT_GAP - 6, anchor: 'middle' });
  }
  const l = P(last);
  if (!blocked(l.x + L.r, l.x + L.r + reach, l.y - 12, l.y + 12)) {
    const x2 = l.x + L.r + YEAR_GAP, x1 = x2 + YEAR_ARROW;
    marks.push({ key: 'end', path: arrowPath(x1, l.y, x2, l.y), text: last.year,
                 tx: x1 + YEAR_TEXT_GAP, ty: l.y, anchor: 'start' });
  } else {
    const y2 = Math.max(l.y + L.r, bottom) + YEAR_GAP, y1 = y2 + YEAR_ARROW * 0.6;
    marks.push({ key: 'end', path: arrowPath(l.x, y1, l.x, y2), text: last.year,
                 tx: l.x, ty: y1 + YEAR_TEXT_GAP + 6, anchor: 'middle' });
  }
  return marks.map(m => ({ ...m, key: `${prefix}-${m.key}` }));
}

function drawYearMarks(step, L, animate, samePos) {
  const marks = yearMarks(step, L);
  const dur = animate ? (samePos ? DOT_FADE_MS : DOT_MOVE_MS) : 0;
  gYears.selectAll('g.year-mark').data(marks, d => d.key).join(
    enter => {
      const g = enter.append('g').attr('class', 'year-mark').attr('opacity', 0);
      g.append('path');
      g.append('text');
      g.transition().delay(animate ? dur * 0.8 : 0).duration(animate ? 500 : 0).attr('opacity', 1);
      return g;
    },
    update => update.call(u => u.interrupt().transition().duration(animate ? 300 : 0).attr('opacity', 1)),
    exit => exit.interrupt().transition().duration(animate ? 300 : 0).attr('opacity', 0).remove()
  ).each(function (d) {
    const g = d3.select(this);
    const fresh = !this.__yearInit;   // recién creada: va directo a su lugar
    this.__yearInit = true;
    const t = sel => fresh || !animate ? sel : sel.transition().duration(dur).ease(d3.easeCubicInOut);
    t(g.select('path')).attr('d', d.path);
    t(g.select('text')).attr('x', d.tx).attr('y', d.ty);
    g.select('text').attr('text-anchor', d.anchor).text(d.text);
  });
}

/* Texto flotante: un texto de paso que, en vez de ir en la zona de texto,
   aparece centrado en el espacio vacío debajo del gráfico (cuando este sube). */
const floatNoteEl = document.getElementById('float-note');
const FLOAT_CENTER_Y = 0.5;    // floatNote: 'center' -> altura del texto (fracción de la pantalla; 0.5 = centro)
let floatNoteTimer = null;
// adjust (opcional): se llama con el contenido ya puesto (p. ej. para ubicarlo según su alto).
// Si ya había otro texto a la vista, se esfuma, cambia y vuelve a aparecer.
function showFloatNote(html, x, y, delay, adjust = null) {
  if (!floatNoteEl) return;
  clearTimeout(floatNoteTimer);
  const apply = () => {
    Object.assign(floatNoteEl.style, { left: x + 'px', top: y + 'px',
      width: Math.min(innerWidth - 2 * cssNum('--margin'), 1000) + 'px' });   // ancho máximo del texto flotante
    if (floatNoteEl.dataset.html !== html) { floatNoteEl.innerHTML = html; floatNoteEl.dataset.html = html; }
    if (adjust) adjust();
  };
  const on = floatNoteEl.classList.contains('on');
  if (on && floatNoteEl.dataset.html !== html) {
    floatNoteEl.classList.remove('on');
    floatNoteTimer = setTimeout(() => {
      apply();
      floatNoteTimer = setTimeout(() => floatNoteEl.classList.add('on'), Math.max(0, delay - 500));
    }, 500);   // lo que tarda en esfumarse (#float-note: .6s)
    return;
  }
  apply();
  floatNoteTimer = setTimeout(() => floatNoteEl.classList.add('on'), delay);
}
// Textos a los costados de la estatuilla: el h1 a la izquierda (termina a
// STATUE_SIDE.gapL de la estatuilla) y el resto a la derecha (a STATUE_SIDE.gapR);
// los dos apoyados en la base de la estatuilla
const sideNoteEl = document.getElementById('side-note');
let sideNoteTimer = null;
function showSideNote(src, x0, x1, bottom, delay) {
  if (!sideNoteEl || !src) return;
  clearTimeout(sideNoteTimer);
  fillSideNote(src);
  const [l, r] = sideNoteEl.children;
  // El texto izquierdo no acompaña el corrimiento (shift) de la estatuilla
  Object.assign(l.style, { left: x0 - innerWidth * (STATUE_SIDE.gapL + (STATUE_SIDE.shift || 0)) + 'px', top: bottom + 'px' });
  Object.assign(r.style, { left: x1 + innerWidth * STATUE_SIDE.gapR + 'px', top: bottom + 'px' });
  sideNoteTimer = setTimeout(() => sideNoteEl.classList.add('on'), delay);
}
// Ancho de los dos textos (para centrar el conjunto): se cargan y se miden
function fillSideNote(src) {
  const [l, r] = sideNoteEl.children;
  const h = src.querySelector('h1, h2');
  l.innerHTML = h ? h.innerHTML : '';
  r.innerHTML = [...src.children].filter(el => el !== h).map(el => el.innerHTML).join('<br>');
}
function sideNoteSizes() {
  const src = document.querySelector('.card.side-src');
  if (!sideNoteEl || !src) return { lw: 0, rw: 0 };
  fillSideNote(src);
  const [l, r] = sideNoteEl.children;
  return { lw: l.offsetWidth, rw: r.offsetWidth };
}
function hideSideNote() {
  if (!sideNoteEl) return;
  clearTimeout(sideNoteTimer);
  sideNoteEl.classList.remove('on');
}

// Texto arriba de la grilla: x = borde izquierdo, y = base (el texto queda encima)
const HEAD_NOTE_GAP = 64;   // espacio entre el texto y la primera fila de puntos (px)
const headNoteEl = document.getElementById('head-note');
let headNoteTimer = null;
function showHeadNote(html, x, y, delay) {
  if (!headNoteEl) return;
  clearTimeout(headNoteTimer);
  Object.assign(headNoteEl.style, { left: x + 'px', top: y + 'px' });
  setHeadNote(html);
  headNoteTimer = setTimeout(() => headNoteEl.classList.add('on'), delay);
}
// Cambia el contenido. Si ya había una cifra a la vista, la cifra cuenta de la
// anterior a la nueva (p. ej. 621 → 98) y el título cambia con un fundido
const HEAD_COUNT_MS = 1300;
// Estatuilla con textos a los costados (statueSide): base (fracción del alto) y
// separación con cada texto (fracción del ancho)
const STATUE_SIDE = { bottom: 0.79, gapL: 0.04, gapR: 0.09, shift: -0.02 };   // shift: corre la estatuilla y el texto derecho (fracción del ancho; negativo = izquierda), el texto izquierdo queda   // (el conjunto texto + estatuilla + texto se centra en el ancho)
function setHeadNote(html) { setNumNote(headNoteEl, html); }
// el: #head-note o #foot-note. La cifra conserva lo que no es número (p. ej. "%")
function setNumNote(el, html) {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const oldNum = el.querySelector('.big-num'), newNum = tmp.querySelector('.big-num');
  const oldH = el.querySelector('h1'), newH = tmp.querySelector('h1');
  const from = oldNum ? parseInt(oldNum.textContent.replace(/\D/g, ''), 10) : NaN;
  const to = newNum ? parseInt(newNum.textContent.replace(/\D/g, ''), 10) : NaN;
  if (!el.classList.contains('on') || !oldNum || !newNum || !oldH || !newH || isNaN(from) || isNaN(to)) {
    el.innerHTML = html;
    return;
  }
  // Cifra: cuenta hasta la nueva (frena al final) y toma su color (clases)
  oldNum.className = newNum.className;
  d3.select(oldNum).interrupt().transition().duration(HEAD_COUNT_MS).ease(d3.easeCubicOut)
    .tween('text', () => {
      const i = d3.interpolateRound(from, to), suffix = newNum.textContent.replace(/[\d.,\s]/g, '');
      return t => { oldNum.textContent = i(t) + suffix; };
    });
  // Título: se esfuma, cambia y vuelve
  oldH.style.transition = 'opacity .35s ease';
  oldH.style.opacity = 0;
  setTimeout(() => { oldH.className = newH.className; oldH.innerHTML = newH.innerHTML; oldH.style.opacity = 1; }, 350);
}
// Textos a los costados del ícono del género (corazón, estrella, máscara): el
// título (h1, con su color) termina a SOLO_GAP del ícono por la izquierda y la
// descripción empieza a SOLO_GAP por la derecha. Al cambiar de género, los
// textos se esfuman y vuelven con el contenido nuevo.
const soloNoteEl = document.getElementById('solo-note');
const solo = { timer: null, html: '' };
// Ajusta el ancho de un texto al de su línea más larga (un texto partido en
// varias líneas deja la caja más ancha que el texto, y eso lo aleja del ícono)
function shrinkWrap(el) {
  el.style.width = '';
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter(r => r.width > 0);
  if (!rects.length) return;
  el.style.width = Math.ceil(d3.max(rects, r => r.right) - d3.min(rects, r => r.left)) + 1 + 'px';
}
function showSoloNote(src, delay) {
  if (!soloNoteEl || !src) return;
  const [l, r] = soloNoteEl.children;
  const iconW = Math.round(Math.max(70, Math.min(HEART_SIZE, innerHeight * 0.27)));
  const cx = innerWidth / 2, cy = innerHeight * HEART_Y, gap = innerWidth * SOLO_GAP;
  const place = () => {
    Object.assign(l.style, { left: cx - iconW / 2 - gap + 'px', top: cy + 'px' });
    Object.assign(r.style, { left: cx + iconW / 2 + gap + 'px', top: cy + 'px' });
    shrinkWrap(l); shrinkWrap(r);   // la caja mide lo mismo que su línea más larga: la distancia al ícono es la real
  };
  const fill = () => {
    const h = src.querySelector('h1, h2');
    l.className = 'sl-left ' + (h ? h.className : '');
    l.innerHTML = h ? h.innerHTML : '';
    r.innerHTML = [...src.children].filter(el => el !== h).map(el => el.innerHTML).join('<br>');
    solo.html = src.innerHTML;
    place();
  };
  clearTimeout(solo.timer);
  const on = soloNoteEl.classList.contains('on');
  if (on && solo.html === src.innerHTML) { place(); return; }
  if (on) {   // otro género: se esfuma, cambia y vuelve
    soloNoteEl.classList.remove('on');
    solo.timer = setTimeout(() => { fill(); soloNoteEl.classList.add('on'); }, 450);
  } else {
    fill();
    solo.timer = setTimeout(() => soloNoteEl.classList.add('on'), delay);
  }
}
function hideSoloNote() {
  if (!soloNoteEl) return;
  clearTimeout(solo.timer);
  soloNoteEl.classList.remove('on');
}

// Texto debajo de los bloques: x = centro, y = borde de arriba
const FOOT_NOTE_GAP = 48;   // espacio entre la última fila de puntos y el texto (px)
const FOOT_OVERLAP_X = 0.04;   // footNote 'overlap': cuánto sobresale la cifra a la izquierda de los bloques (fracción del ancho)
const footNoteEl = document.getElementById('foot-note');
let footNoteTimer = null;
function showFootNote(html, x, y, delay) {
  if (!footNoteEl) return;
  clearTimeout(footNoteTimer);
  Object.assign(footNoteEl.style, { left: x + 'px', top: y + 'px' });
  setNumNote(footNoteEl, html);   // entre dos pasos con footNote: la cifra cuenta de una a otra
  footNoteTimer = setTimeout(() => footNoteEl.classList.add('on'), delay);
}
function hideFootNote() {
  if (!footNoteEl) return;
  clearTimeout(footNoteTimer);
  footNoteEl.classList.remove('on');
}
// Alto del texto de arriba de la grilla (para centrar el conjunto): se mide con su contenido
function headNoteHeight() {
  if (!headNoteEl) return 0;
  if (!headNoteEl.innerHTML) {
    const card = document.querySelector('.step .card[data-float] .big-num');
    if (card) headNoteEl.innerHTML = card.parentElement.innerHTML;
  }
  return headNoteEl.offsetHeight;
}
function hideHeadNote() {
  if (!headNoteEl) return;
  clearTimeout(headNoteTimer);
  headNoteEl.classList.remove('on');
}
function hideFloatNote() {
  if (!floatNoteEl) return;
  clearTimeout(floatNoteTimer);
  floatNoteEl.classList.remove('on');
}

// Duración del contorno de cada película: apenas distinta, para que no terminen igual
const zoomRingDur = i => ZOOM_SEQ.ring * (1 + 0.12 * ((i % 3) - 1));

// Busca la película de un zoom/trío. Si hay títulos repetidos (p. ej. dos
// Cleopatra), cfg.filmYear indica cuál (año de la película en el CSV).
function findFilm(cfg) {
  return films.find(d => d.film === cfg.film && (!cfg.filmYear || d.year === cfg.filmYear));
}

/* Ganadoras vs. nominadas que no ganaron, sobre la dispersión año × minutos.
   Una polilínea por grupo con su duración promedio en cada década (el punto va
   en la mitad de la década) y el promedio general escrito al comienzo de cada
   línea. Con `decade`, además se resalta esa década con una franja y se
   escriben los promedios de ambos grupos en ella. */
const NOM_LINE_COLOR = NEUTRAL;   // gris de la línea de nominadas (NOM_COLOR se pierde sobre el fondo)

function winNomLayout(data, w, h, decade = null) {
  const L = LAYOUTS.scatter(data, w, h);
  const dec = d => Math.floor(d.year / 10) * 10;
  const groups = [
    { key: 'win', items: data.filter(d => d.winner),  color: WIN_COLOR,      name: 'Ganadoras' },
    { key: 'nom', items: data.filter(d => !d.winner), color: NOM_LINE_COLOR, name: 'Nominadas que no ganaron' }
  ];
  groups.forEach(g => {
    g.byDec = d3.rollups(g.items, v => d3.mean(v, d => d.dur), dec).sort((a, b) => a[0] - b[0]);
    g.avg = d3.mean(g.items, d => d.dur);
  });
  L.trends = groups.map(g => ({
    key: g.key, color: g.color,
    points: g.byDec.map(([dc, m]) => [L.x(dc + 5), L.y(m)])
  }));
  // Promedio general de cada grupo junto al comienzo de su línea: el de las
  // ganadoras por encima del tramo inicial de su línea (primeras 3 décadas) y el
  // de las nominadas por debajo del suyo, así no se pisan con las líneas
  groups.forEach((g, i) => {
    const first = L.trends[i].points.slice(0, 3).map(p => p[1]);
    const x0 = L.trends[i].points[0][0];
    L.labels.push({ text: `${g.name}: ${Math.round(g.avg)} min de promedio`,
      x: x0, y: i === 0 ? d3.min(first) - 14 : d3.max(first) + 26, cls: 'label-trend', anchor: 'start', color: g.color });
  });
  if (decade != null) {
    const top = L.m.t, bottom = h - L.m.b;
    L.rects = [{ x: L.x(decade), y: top, w: L.x(decade + 10) - L.x(decade), h: bottom - top, cls: 'decade-band' }];
    // Promedios de la década resaltada, arriba dentro de la franja: primero el
    // más largo y debajo el más corto (cada uno en el color de su línea)
    const cx = (L.x(decade) + L.x(decade + 10)) / 2;
    groups.map(g => ({ g, m: g.byDec.find(([dc]) => dc === decade)[1] }))
      .sort((a, b) => b.m - a.m)
      .forEach(({ g, m }, i) => L.labels.push({ text: `${Math.round(m)} min`, x: cx, y: top + 24 + i * 22,
                                                cls: 'label-trend', anchor: 'middle', color: g.color }));
  }
  return L;
}

const HIGHLIGHT_DECADE = 1960;   // década resaltada en la dispersión de duración
const COMMON_RUNTIME = 110;      // franja de 10 min más común (110–119: 111 de 621 nominadas)
const DUR_BIN = 10;              // ancho de cada columna del histograma de duración (minutos)
// Décadas del histograma "explotado": la inicial, la de las películas más
// largas y la actual (y cómo se nombran en el título de cada gráfico)
const DURATION_DECADES = [1930, 1960, 2020];
const DURATION_DECADE_NAMES = { 1930: "Años 30", 1960: "Años 60", 2020: "Años 2020" };

// Corre un layout en vertical (puntos, textos, líneas y franjas)
function shiftLayout(L, dy) {
  L.pos.forEach((p, id) => L.pos.set(id, { x: p.x, y: p.y + dy }));
  L.labels.forEach(l => { l.y += dy; });
  L.lines.forEach(l => { ['y', 'y1', 'y2'].forEach(k => { if (l[k] != null) l[k] += dy; }); });
  (L.rects || []).forEach(r => { r.y += dy; });
  if (L.m) L.m = { ...L.m, t: L.m.t + dy };
  if (L.base != null) L.base += dy;
  return L;
}
const DUR_DOWN = 60;   // cuánto bajan el histograma de duración y su franja (px)
// Cierre: estatuilla a la derecha (centro, fracción del ancho; base, fracción del alto)
const FORMULA_STATUE = { x: 0.8, bottom: 0.76 };
const TIMELINE_TALL_PAD = 20;   // timelineTall: aire entre el eje X y el borde inferior de la pantalla (px)
const TIMELINE_TOP = 44;        // pasos con texto: la línea de tiempo empieza a esta altura de la pantalla (sin leyenda arriba, px)
const TIMELINE_W_FRAC = 0.75;   // ancho de toda la tabla (nombres + puntos + eje), centrada en la pantalla
const TIMELINE_TALL_Y = [0.11, 0.88];   // tall (sin texto): de dónde a dónde va la tabla, en fracción del alto de la pantalla
const TIMELINE_NAMES_W = 110;   // espacio para los nombres de los géneros (px)
const ROMANCE_Y = [0.5, 0.74];   // romanceSolo: de dónde a dónde va la fila del romance con su eje (fracción del alto)
const HEART_Y = 0.4;            // altura del centro del corazón (fracción del alto)
const HEART_SIZE = 140;         // tamaño máximo del corazón (px)
const ROMANCE_TEXT_Y = 0.7;     // altura del centro del texto, debajo del corazón (fracción del alto)
const SOLO_GAP = 0.06;          // soloNote: espacio entre el ícono y cada texto (fracción del ancho)
// Un género solo (romance, drama): su fila con el eje, arriba (ROMANCE_Y), con el ancho de la tabla
function genreSoloLayout(data, w, genre) {
  const top = cssNum('--chart-top');
  const y0 = innerHeight * ROMANCE_Y[0], bottom = innerHeight * ROMANCE_Y[1];
  const tw = Math.min(w, innerWidth * TIMELINE_W_FRAC);
  return LAYOUTS.timeline(data, w, bottom - y0, y0 - top, [(w - tw) / 2, (w + tw) / 2], genre);
}
// Marco de la línea de tiempo. En ancho: TIMELINE_W_FRAC de la pantalla,
// centrada. En alto: en pasos con texto, desde TIMELINE_TOP hasta el final del
// área del gráfico; sin texto (tall), entre TIMELINE_TALL_Y, centrada.
function timelineFrame(w, h, tall) {
  const top = cssNum('--chart-top');
  const y0 = tall ? innerHeight * TIMELINE_TALL_Y[0] : TIMELINE_TOP;
  const bottom = tall ? innerHeight * TIMELINE_TALL_Y[1] + 16 : top + h;   // +16: los años del eje cuelgan debajo
  const tw = Math.min(w, innerWidth * TIMELINE_W_FRAC);
  return { oy: y0 - top, h: bottom - y0, xr: [(w - tw) / 2, (w + tw) / 2] };
}
const LAYOUTS = {
  // Momento intermedio: los puntos forman la palabra Género
  // Portada: OSCARS con puntos grandes y casi pegados (cada uno es una
  // "ventana" al video de la introducción)
  wordOscars: (data, w, h) => withSubtitle(wordLayout(data, w, h, 'OSCARS', OSCARS_WORD), OSCARS_SUBTITLE),
  wordGenre: (data, w, h) => wordLayout(data, w, h, 'Género'),

  // Instancia intermedia: el nombre de cada género (en su color) con sus
  // películas orbitando alrededor. 4 géneros arriba y 3 abajo, a igual distancia.
  genreOrbit: (data, w, h) => orbitLayout(data, w, h),
  wordDuration: (data, w, h) => wordLayout(data, w, h, 'Duración'),
  wordProducer: (data, w, h) => wordLayout(data, w, h, 'Productora'),
  wordFormula: (data, w, h) => wordLayout(data, w, h, 'La fórmula'),
  // La estatuilla (mismo tamaño) a la derecha: centro en FORMULA_STATUE.x del ancho
  // y base en FORMULA_STATUE.bottom del alto. L.statueBox: sus bordes
  statueFormula: (data, w, h) => {
    const L = LAYOUTS.statue(data, w, h);
    const win = data.filter(d => d.winner);
    const pts = [...win.map(d => L.pos.get(d.id)), ...(L.extra || [])];
    const S = getSize(), box = getBox(S.w, S.h);
    const x0 = d3.min(pts, p => p.x), x1 = d3.max(pts, p => p.x), y0 = d3.min(pts, p => p.y), y1 = d3.max(pts, p => p.y);
    const dx = innerWidth * FORMULA_STATUE.x - box.x - (x0 + x1) / 2, dy = innerHeight * FORMULA_STATUE.bottom - box.y - y1;
    win.forEach(d => { const p = L.pos.get(d.id); L.pos.set(d.id, { x: p.x + dx, y: p.y + dy }); });
    (L.extra || []).forEach(p => { p.x += dx; p.y += dy; });
    L.statueBox = { x0: x0 + dx, x1: x1 + dx, y0: y0 + dy, y1: y1 + dy };
    return L;
  },

  // Pasos 0 y 1: todas juntas en una grilla horizontal, en orden cronológico
  all: (data, w, h) => gridLayout(data, w, h),
  // La misma grilla (mismo tamaño), con el texto de arriba (headNote): el conjunto
  // texto + grilla queda centrado en el alto de la pantalla
  allHead: (data, w, h) => {
    const L = gridLayout(data, w, h);
    const hh = headNoteHeight(), gridH = L.rows * L.size;
    const gTop = (innerHeight - (hh + HEAD_NOTE_GAP + gridH)) / 2 + hh + HEAD_NOTE_GAP - cssNum('--chart-top');
    const dy = gTop - L.y0;
    L.pos.forEach(p => { p.y += dy; });
    L.y0 += dy;
    return L;
  },

  // Solo las ganadoras, ordenadas por año en filas con el MISMO tamaño y
  // espaciado que la grilla completa (si no caben en una fila, bajan a la siguiente).
  // Las nominadas conservan su lugar en la grilla (el paso las oculta con `hide`).
  winnersLine: (data, w, h) => {
    const L = gridLayout(data, w, h);
    const { size, cols, x0 } = L;
    const winners = data.filter(d => d.winner);
    const rows = Math.ceil(winners.length / cols);
    const y0 = (h - rows * size) / 2;
    winners.forEach((d, i) => L.pos.set(d.id, {
      x: x0 + (i % cols) * size + size / 2,
      y: y0 + Math.floor(i / cols) * size + size / 2
    }));
    return L;
  },

  // Solo las ganadoras dibujan la silueta de la estatuilla (en orden
  // cronológico de la cabeza a la base). Las nominadas conservan su lugar en
  // la grilla (el paso las oculta con `hide`).
  statue: (data, w, h) => {
    const winners = data.filter(d => d.winner);
    const S = sampleStatue(winners.length, w, h);
    if (!S) return LAYOUTS.winnersLine(data, w, h);   // si la silueta no se pudo dibujar
    const L = gridLayout(data, w, h);
    // Copias: render() desplaza las posiciones y no debe tocar las guardadas en caché
    winners.forEach((d, i) => L.pos.set(d.id, { x: S.main[i].x, y: S.main[i].y }));
    L.extra = S.extra.map(p => ({ x: p.x, y: p.y }));   // puntos de relleno
    return L;
  },

  // La misma estatuilla (mismo tamaño), corrida: el conjunto texto izquierdo +
  // estatuilla + texto derecho queda centrado en el ancho (mismo margen a cada
  // lado) y la base en STATUE_SIDE.bottom del alto. L.statueBox: sus bordes
  statueSide: (data, w, h) => {
    const L = LAYOUTS.statue(data, w, h);
    const pts = [...data.filter(d => d.winner).map(d => L.pos.get(d.id)), ...(L.extra || [])];
    const S = getSize(), box = getBox(S.w, S.h);
    const x0 = d3.min(pts, p => p.x), x1 = d3.max(pts, p => p.x), y0 = d3.min(pts, p => p.y), y1 = d3.max(pts, p => p.y);
    const { lw, rw } = sideNoteSizes();
    const sw = x1 - x0 + 2 * L.r, gl = innerWidth * STATUE_SIDE.gapL, gr = innerWidth * STATUE_SIDE.gapR;
    const left = (innerWidth - (lw + gl + sw + gr + rw)) / 2;   // margen igual a los dos lados
    const dx = left + lw + gl + sw / 2 + innerWidth * (STATUE_SIDE.shift || 0) - box.x - (x0 + x1) / 2;
    const dy = innerHeight * STATUE_SIDE.bottom - box.y - y1;
    data.filter(d => d.winner).forEach(d => { const p = L.pos.get(d.id); L.pos.set(d.id, { x: p.x + dx, y: p.y + dy }); });
    (L.extra || []).forEach(p => { p.x += dx; p.y += dy; });
    L.statueBox = { x0: x0 + dx - L.r, x1: x1 + dx + L.r, y0: y0 + dy - L.r, y1: y1 + dy + L.r };
    return L;
  },

  // Foco en un género: solo sus películas, en la misma grilla horizontal
  // (mismo tamaño y espaciado), sin fondo. El resto se oculta con
  // `hide` y queda en su columna de género, listo para el paso siguiente.
  dramaGrid: (data, w, h) => soloGenreLayout(data, w, h, 'Drama'),
  warGrid:   (data, w, h) => soloGenreLayout(data, w, h, 'War'),

  // ¿Cuál es el género más común?: el rectángulo del paso 1 dividido por género.
  // genreBlockSide: el mismo rectángulo deslizado a la izquierda (círculo a la derecha)
  genreBlock:     (data, w, h) => genreBlockLayout(data, w, h),
  // Productora: el mismo mosaico de bloques, pero por estudio (las cinco grandes y "Otros")
  studioBlock: (data, w, h) => genreBlockLayout(data, w, h, false, STUDIO_BLOCK_OPTS),
  genreBlockSide: (data, w, h) => genreBlockLayout(data, w, h, true),
  // Grilla de puntos grandes que cubre toda la pantalla (máscara del video)
  videoGrid: (data, w, h) => videoGridLayout(data, w, h),
  // Portada: OSCARS escrito con las celdas de la grilla de video
  oscarsGrid: (data, w, h) => oscarsGridLayout(data, w, h),
  // Zoom in: el bloque de drama centrado y el trío de dramas debajo
  dramaZoom: (data, w, h) => genreZoomLayout(data, w, h, 'Drama', DRAMA_TRIO),
  // Tasa de victoria con la misma lógica de bloques: en cada género, las
  // ganadoras primero (juntas al principio del bloque) y arriba de cada
  // bloque su nombre y su tasa de victoria
  genreRateBlock: (data, w, h) => genreBlockLayout(data, w, h, false, RATE_BLOCK_OPTS),
  // Bélico (como el drama): el bloque se centra arriba y los demás desaparecen…
  warZoom: (data, w, h) => genreZoomLayout(data, w, h, 'War', WAR_TRIO, true, { first: d => d.winner }),
  // Desde «¿Por qué gana la guerra?»: el mismo bloque, con los puntos otra vez en orden cronológico
  warZoomChrono: (data, w, h) => genreZoomLayout(data, w, h, 'War', WAR_TRIO, true),
  // Columbia (como el bélico): su bloque de estudio, mismo tamaño, centrado arriba;
  // debajo queda el lugar para el texto flotante o la tira de pósters
  // El bloque se rearma más apaisado: COLUMBIA_ROWS filas (misma separación entre
  // puntos, orden cronológico por filas), centrado en el ancho y con su borde de
  // arriba en el mismo lugar; lo de abajo (texto o pósters) sube con él
  columbiaZoom: (data, w, h) => {
    const L = genreZoomLayout(data, w, h, 'Columbia', [{}], true, STUDIO_BLOCK_OPTS);
    const items = data.filter(d => studioOf(d) === 'Columbia').sort((a, b) => a.year - b.year || a.id - b.id);
    const ps = items.map(d => L.pos.get(d.id));
    const xs = [...new Set(ps.map(p => Math.round(p.x * 10) / 10))].sort((a, b) => a - b);
    const size = xs.length > 1 ? d3.min(d3.pairs(xs), ([a, b]) => b - a) : L.r * 3;   // separación entre puntos
    const top = d3.min(ps, p => p.y), oldBottom = d3.max(ps, p => p.y);
    const cols = Math.ceil(items.length / COLUMBIA_ROWS);
    const x0 = w / 2 - (cols - 1) * size / 2;
    items.forEach((d, i) => L.pos.set(d.id, { x: x0 + (i % cols) * size, y: top + Math.floor(i / cols) * size }));
    const dy = (COLUMBIA_ROWS - 1) * size - (oldBottom - top);   // cuánto cambió el alto del bloque
    L.trioGeo.forEach(g => { g.y += dy; });
    return L;
  },
  // Zoom in de a una película: círculo a la izquierda y su texto a la derecha
  dramaZoomSingle: (data, w, h) => genreZoomLayout(data, w, h, 'Drama', DRAMA_TRIO, true),
  // Extremos de duración: el histograma sube y los dos círculos aparecen debajo
  durationZoom: (data, w, h) => durationZoomLayout(data, w, h, EXTREMES),
  // Intro: la grilla de todas las nominadas sube y debajo, la primera y la última ganadora
  firstLastZoom: (data, w, h) => durationZoomLayout(data, w, h, FIRST_LAST, 'all'),
  // Pantalla dividida: los puntos se quedan en la grilla y se esfuman (todos ocultos)
  splitHide: (data, w, h) => {
    const L = gridLayout(data, w, h);
    L.hidden = new Set(data.map(d => d.id));
    return L;
  },

  // Filas horizontales por género (mismo número de líneas para todos)
  genre: (data, w, h) =>
    rowLayout(data, d => d.main, GENRES, w, h, k => GENRE_LABELS[k]),

  // Mismas filas con la tasa de victoria bajo cada nombre
  genreRate: (data, w, h) =>
    rowLayout(data, d => d.main, GENRES, w, h, k => GENRE_LABELS[k], g => {
      const n = g.items.length, wins = g.items.filter(d => d.winner).length;
      const pct = n ? Math.round(wins / n * 100) : 0;
      return [{ text: `${pct}%`, cls: 'label-rate' }, { text: `${wins} de ${n}`, cls: 'label-sub' }];
    }),

  // Mismas barras de géneros, pero con las ganadoras primero (juntas desde la
  // izquierda) y las nominadas después: se ve la proporción ganadoras/nominadas
  genreWinners: (data, w, h) =>
    rowLayout(data, d => d.main, GENRES, w, h, k => GENRE_LABELS[k], g => {
      const n = g.items.length, wins = g.items.filter(d => d.winner).length;
      const pct = n ? Math.round(wins / n * 100) : 0;
      return [{ text: `${pct}%`, cls: 'label-rate' }, { text: `${wins} de ${n}`, cls: 'label-sub' }];
    }, d => d.winner),

  // Columnas por década (ya no se usa en STEPS; se deja por si se necesita)
  decade: (data, w, h) => {
    const decades = [...new Set(data.map(d => d.decade))].sort();
    return columnLayout(data, d => d.decade, decades, w, h);
  },

  // Línea de tiempo por género: eje X = año, una fila de puntos por género.
  // Si un género tiene varias nominadas el mismo año, se apilan alrededor de
  // la línea de su fila (arriba, abajo, arriba…).
  // oy: corrimiento vertical (negativo = más arriba del área del gráfico; ver timelineFrame)
  // xr: [x0, x1] franja horizontal que ocupa todo (nombres, puntos y flecha del eje)
  // only: un solo género (una sola fila; las demás películas quedan ocultas arriba)
  timeline: (data, w, h, oy = 0, xr = null, only = null) => {
    const rows = only ? [only] : GENRES;
    const m = { t: 10 + oy, r: 18, b: 58, l: 90 };   // l: espacio para los nombres; b: eje X (años)
    if (xr) { m.l = xr[0] + TIMELINE_NAMES_W; m.r = w - xr[1] + 14; }
    const hb = oy + h - m.b;   // borde inferior del área de los puntos
    const x = d3.scaleLinear().domain([1926, 2025]).range([m.l, w - m.r]);
    const band = (hb - m.t) / rows.length;
    // Radio: que no se pisen años vecinos y que la pila más alta entre en su fila
    const maxStack = d3.max(d3.rollup(data.filter(d => rows.includes(d.main)), v => v.length, d => d.main, d => d.year),
                            ([, byYear]) => d3.max(byYear.values()));
    const r = DOT_R;
    const cell = Math.min((x(1927) - x(1926)) * 0.42, (band - 4) / (maxStack * 2.3), 4.5);
    const dy = Math.max(DOT_R * 2.2, cell * 2.3);       // separación vertical al apilar
    // Base de cada fila (abajo): los puntos se apilan desde ahí hacia ARRIBA,
    // como las columnas de duración
    const rowBase = g => m.t + band * (rows.indexOf(g) + 1) - 6;

    const pos = new Map(), labels = [], lines = [];
    // Varias nominadas del mismo género el mismo año: se apilan hacia arriba
    d3.group(data, d => d.main, d => d.year).forEach(byYear =>
      byYear.forEach(items => items.forEach((d, k) => {
        pos.set(d.id, { x: x(d.year), y: rowBase(d.main) - r - k * dy });
      })));

    rows.forEach(g => {
      // El nombre apoyado sobre la base de su fila
      labels.push({ text: GENRE_LABELS[g], x: m.l - 14, y: rowBase(g),
                    cls: 'label', anchor: 'end', color: GENRE_COLORS[g] });
      lines.push({ x1: m.l, x2: w - m.r, y: rowBase(g) + 3 });   // línea base, justo debajo de los puntos
    });
    // Eje X: la línea del tiempo, marcada (línea clara con flecha al final,
    // marcas y años de cada década destacados)
    const axisY = hb + 12;
    lines.push({ x1: m.l, x2: w - m.r + 10, y: axisY, cls: 'axis-x' });
    lines.push({ x1: w - m.r + 3, x2: w - m.r + 10, y1: axisY - 5, y2: axisY, cls: 'axis-x' });   // flecha
    lines.push({ x1: w - m.r + 3, x2: w - m.r + 10, y1: axisY + 5, y2: axisY, cls: 'axis-x' });
    d3.range(1930, 2030, 10).forEach(t => {
      labels.push({ text: t, x: x(t), y: axisY + 26, cls: 'tick-axis', anchor: 'middle' });
      lines.push({ x1: x(t), x2: x(t), y1: axisY, y2: axisY + 7, cls: 'axis-x' });   // marca
      // Línea vertical fina en cada década para separar las épocas
      lines.push({ x1: x(t), x2: x(t), y1: m.t, y2: axisY, cls: 'gridline-v' });
    });
    return { pos, r, labels, lines, x, rowBase, dy };
  },

  // Distribución por duración: histograma de puntos. Una columna por cada franja
  // de DUR_BIN minutos (60–69, 70–79…); cada columna tiene el mismo ancho (DUR_K
  // puntos) y crece hacia ARRIBA desde una base común, así que su ALTURA es
  // proporcional a la cantidad. Encima de cada columna, su cantidad.
  // La misma línea de tiempo, estirada hacia abajo (para pasos sin texto explicativo)
  timelineTall: (data, w, h) => { const f = timelineFrame(w, h, true); return LAYOUTS.timeline(data, w, f.h, f.oy, f.xr); },
  // El romance solo: su fila y el eje, arriba (ROMANCE_Y); debajo va el corazón (showHeart)
  romanceSolo: (data, w, h) => genreSoloLayout(data, w, 'Romance'),
  // Lo mismo con el drama (debajo, la máscara de teatro: showMaskIcon)
  biopicSolo: (data, w, h) => genreSoloLayout(data, w, 'Biopic'),
  dramaSolo: (data, w, h) => genreSoloLayout(data, w, 'Drama'),

  durationStrip: (data, w, h) => {
    const m = { t: 34, r: 10, b: 46, l: 10 };
    const bin = d => Math.floor(d.dur / DUR_BIN) * DUR_BIN;
    const [b0, b1] = d3.extent(data, bin);
    const bins = d3.range(b0, b1 + DUR_BIN, DUR_BIN);
    const byBin = d3.group(data, bin);
    const maxN = d3.max(bins, b => (byBin.get(b) || []).length);
    const colW = (w - m.l - m.r) / bins.length;
    const plotH = h - m.t - m.b;
    // Puntos por fila en cada columna (k): el que da el punto más grande
    let size = 0, k = 1;
    for (let kk = 1; kk <= 16; kk++) {
      const s = Math.min(colW * 0.84 / kk, plotH / Math.ceil(maxN / kk));
      if (s > size + 0.01) { size = s; k = kk; }
    }
    const base = h - m.b;   // línea base de las columnas
    const colX = bi => m.l + bi * colW;

    const pos = new Map(), labels = [], lines = [];
    const every = colW < 34 ? 2 : 1;   // en pantallas angostas, una etiqueta cada dos
    bins.forEach((b, bi) => {
      // Dentro de cada columna: de la más corta (abajo) a la más larga (arriba)
      const items = (byBin.get(b) || []).slice().sort((p, q) => p.dur - q.dur || p.year - q.year);
      const x0 = colX(bi) + (colW - k * size) / 2;
      items.forEach((d, i) => pos.set(d.id, {
        x: x0 + (i % k) * size + size / 2,
        y: base - Math.floor(i / k) * size - size / 2
      }));
      const top = base - Math.ceil(items.length / k) * size;
      if (items.length) labels.push({ text: items.length, x: colX(bi) + colW / 2, y: top - 8,
                                      cls: 'label-count', anchor: 'middle' });   // cantidad: secundaria
      if (bi % every === 0)   // minutos (eje X): lo principal
        labels.push({ text: b, x: colX(bi) + colW / 2, y: base + 22, cls: 'tick-dur', anchor: 'middle' });
    });
    lines.push({ x1: m.l, x2: w - m.r, y: base + 4 });
    labels.push({ text: 'minutos', x: w - m.r, y: base + 44, cls: 'tick-dur-unit', anchor: 'end' });
    return { pos, r: DOT_R, labels, lines, bins, colX, colW, base, m };
  },

  // Misma distribución con la franja más común resaltada (como la década de los 60):
  // rectángulo de fondo que cubre su columna + rango en minutos debajo
  // El histograma de duración "explota" en tres, apilados de arriba hacia abajo:
  // la década inicial (30), la de las películas más largas (60) y la actual
  // (2020). Mismas columnas de minutos y mismo tamaño de punto en los tres,
  // para poder compararlos; las películas de otras décadas se ocultan.
  durationDecades: (data, w, h) => {
    const m = { t: 6, r: 10, b: 46, l: 10 };
    const panelGap = 18, titleH = 22;   // aire entre gráficos y alto del título de cada uno
    const bin = d => Math.floor(d.dur / DUR_BIN) * DUR_BIN;
    const [b0, b1] = d3.extent(data, bin);
    const bins = d3.range(b0, b1 + DUR_BIN, DUR_BIN);   // las mismas columnas que el histograma completo
    const colW = (w - m.l - m.r) / bins.length;
    const colX = bi => m.l + bi * colW;
    const panelH = (h - m.t - m.b - panelGap * (DURATION_DECADES.length - 1)) / DURATION_DECADES.length;
    const plotH = panelH - titleH;
    const panels = DURATION_DECADES.map(dec => {
      const items = data.filter(d => d.year >= dec && d.year < dec + 10);
      const byBin = d3.group(items, bin);
      return { dec, items, byBin, maxN: d3.max(bins, b => (byBin.get(b) || []).length) || 1 };
    });
    // Puntos por fila en cada columna (k) y tamaño: los mismos en los tres gráficos
    let size = 0, k = 1;
    for (let kk = 1; kk <= 16; kk++) {
      const s = Math.min(colW * 0.84 / kk, d3.min(panels, p => plotH / Math.ceil(p.maxN / kk)));
      if (s > size + 0.01) { size = s; k = kk; }
    }

    const pos = new Map(), labels = [], lines = [];
    const hidden = new Set(data.map(d => d.id));
    const every = colW < 34 ? 2 : 1;
    panels.forEach((p, pi) => {
      const top = m.t + pi * (panelH + panelGap);
      const base = top + panelH;   // línea base de las columnas de este gráfico
      bins.forEach((b, bi) => {
        const items = (p.byBin.get(b) || []).slice().sort((a, c) => a.dur - c.dur || a.year - c.year);
        const x0 = colX(bi) + (colW - k * size) / 2;
        items.forEach((d, i) => {
          pos.set(d.id, { x: x0 + (i % k) * size + size / 2, y: base - Math.floor(i / k) * size - size / 2 });
          hidden.delete(d.id);
        });
      });
      lines.push({ x1: m.l, x2: w - m.r, y: base + 4 });
      // Título: la década y cuántas películas tuvo
      labels.push({ text: '', x: m.l, y: top + 14, cls: 'label', anchor: 'start',
                    spans: [{ text: DURATION_DECADE_NAMES[p.dec] || `${p.dec}s`, cls: 'label' },
                            { text: `${p.items.length} películas`, cls: 'label-sub' }] });
      // Minutos solo debajo del último gráfico
      if (pi === panels.length - 1) {
        bins.forEach((b, bi) => {
          if (bi % every === 0) labels.push({ text: b, x: colX(bi) + colW / 2, y: base + 22, cls: 'tick-dur', anchor: 'middle' });
        });
        labels.push({ text: 'minutos', x: w - m.r, y: base + 44, cls: 'tick-dur-unit', anchor: 'end' });
      }
    });
    // Las películas de otras décadas quedan (ocultas) en su lugar del histograma completo
    const S = LAYOUTS.durationStrip(data, w, h);
    hidden.forEach(id => pos.set(id, S.pos.get(id)));
    return { pos, r: DOT_R, labels, lines, hidden };
  },

  // El histograma de duración, un poco más abajo (DUR_DOWN): más lejos del menú de arriba
  durationStripLow: (data, w, h) => shiftLayout(LAYOUTS.durationStrip(data, w, h), DUR_DOWN),

  durationStripBand: (data, w, h) => {
    const L = shiftLayout(LAYOUTS.durationStrip(data, w, h), DUR_DOWN);
    const lo = COMMON_RUNTIME, hi = lo + 10;
    const x0 = L.colX(L.bins.indexOf(lo)), x1 = L.colX(L.bins.indexOf(hi - DUR_BIN) + 1);
    const top = L.m.t - 30, bottom = L.base + 28;
    L.rects = [{ x: x0, y: top, w: x1 - x0, h: bottom - top, cls: 'decade-band' }];
    L.labels.push({ text: `${lo}–${hi - 1} min`, x: (x0 + x1) / 2, y: bottom + 16,
                    cls: 'label-trend', anchor: 'middle' });
    L.headAnchor = { x: x0, y: top };   // headNote: el texto va arriba de la franja, alineado a su borde izquierdo
    return L;
  },

  // Paso 3: ganadoras vs nominadas
  winner: (data, w, h) =>
    columnLayout(data, d => d.winner ? 'Ganadoras' : 'Nominadas', ['Ganadoras', 'Nominadas'], w, h),

  // Paso 4: dispersión año × duración
  scatter: (data, w, h) => {
    const m = { t: 60, r: 45, b: 50, l: 60 };
    const x = d3.scaleLinear().domain([1925, 2025]).range([m.l, w - m.r]);
    const y = d3.scaleLinear().domain([60, 240]).range([h - m.b, m.t]);
    const pos = new Map(), labels = [], lines = [];
    data.forEach(d => pos.set(d.id, { x: x(d.year), y: y(d.dur) }));
    d3.range(1930, 2030, 10).forEach(t =>
      labels.push({ text: t, x: x(t), y: h - m.b + 24, cls: 'tick', anchor: 'middle' }));
    [60, 90, 120, 150, 180, 210, 240].forEach(t => {
      labels.push({ text: t, x: m.l - 10, y: y(t) + 4, cls: 'tick', anchor: 'end' });
      lines.push({ x1: m.l, x2: w - m.r, y: y(t) });
    });
    labels.push({ text: 'minutos', x: m.l - 10, y: m.t - 24, cls: 'tick', anchor: 'end' });
    return { pos, r: DOT_R, labels, lines, x, y, m };
  },

  // Dispersión con una década resaltada: franja de fondo + promedio de duración
  scatterDecade: (data, w, h) => {
    const L = LAYOUTS.scatter(data, w, h);
    const d0 = HIGHLIGHT_DECADE, d1 = d0 + 10;
    const top = L.m.t, bottom = h - L.m.b;
    L.rects = [{ x: L.x(d0), y: top, w: L.x(d1) - L.x(d0), h: bottom - top, cls: 'decade-band' }];
    const avg = d3.mean(data.filter(d => d.year >= d0 && d.year < d1), d => d.dur);
    // Línea del promedio dentro de la franja y su valor encima
    L.trends = [{ x1: L.x(d0), y1: L.y(avg), x2: L.x(d1), y2: L.y(avg), color: WIN_COLOR }];
    L.labels.push({ text: `${Math.round(avg)} min de promedio`, x: L.x(d0 + 5), y: L.y(avg) - 12,
                    cls: 'label-trend', anchor: 'middle' });
    return L;
  },

  // Zoom de a una a los épicos de los 60 (como el drama y el bélico): la dispersión
  // (con la década resaltada) se achica en alto y sube; debajo, el círculo de la
  // película a la izquierda y su texto a la derecha
  scatterZoom: (data, w, h) => scatterZoomLayout(data, w, h, SIXTIES_ZOOM),

  // Ganadoras vs. nominadas que no ganaron: sobre la misma dispersión, una línea
  // con el promedio de duración por década para cada grupo (polilínea) y el
  // promedio general de cada uno escrito junto al comienzo de su línea.
  scatterWinNom: (data, w, h) => winNomLayout(data, w, h),
  // Misma comparación con foco en una década (franja + promedios de esa década)
  scatterWinNom2010: (data, w, h) => winNomLayout(data, w, h, 2010),

  // Dispersión + línea de tendencia (regresión lineal duración ~ año)
  scatterTrend: (data, w, h) => {
    const L = LAYOUTS.scatter(data, w, h);
    const mx = d3.mean(data, d => d.year), my = d3.mean(data, d => d.dur);
    const b = d3.sum(data, d => (d.year - mx) * (d.dur - my)) /
              d3.sum(data, d => (d.year - mx) ** 2);
    const a = my - b * mx;
    const [x0, x1] = d3.extent(data, d => d.year);
    const t = { x1: L.x(x0), y1: L.y(a + b * x0), x2: L.x(x1), y2: L.y(a + b * x1) };
    L.trends = [t];
    // Valores de la tendencia en los extremos, junto a la línea
    L.labels.push(
      { text: `${Math.round(a + b * x0)} min`, x: t.x1, y: t.y1 - 14, cls: 'label-trend', anchor: 'start' },
      { text: `${Math.round(a + b * x1)} min`, x: t.x2, y: t.y2 - 14, cls: 'label-trend', anchor: 'end' });
    return L;
  },

  // Línea de tiempo por género + una línea de tendencia por género: regresión
  // lineal de cuántas nominadas tuvo el género cada año. Como los puntos cuelgan
  // hacia abajo desde el nombre, la línea marca la "profundidad" media de cada
  // año: más baja = más películas de ese género.
  timelineTrend: (data, w, h) => {
    const f = timelineFrame(w, h, false);
    const L = LAYOUTS.timeline(data, w, f.h, f.oy, f.xr);
    const [y0, y1] = d3.extent(data, d => d.year);
    const years = d3.range(y0, y1 + 1);
    L.trends = GENRES.map(g => {
      const byYear = d3.rollup(data.filter(d => d.main === g), v => v.length, d => d.year);
      const pts = years.map(yr => [yr, byYear.get(yr) || 0]);
      const mx = d3.mean(pts, p => p[0]), my = d3.mean(pts, p => p[1]);
      const b = d3.sum(pts, p => (p[0] - mx) * (p[1] - my)) / d3.sum(pts, p => (p[0] - mx) ** 2);
      const a = my - b * mx;
      // A la altura de los puntos: pasa por la última fila de una pila "promedio"
      // (con menos de una película por año, queda sobre la primera fila)
      // TREND_LIFT acerca todas las líneas a la base una fracción de fila
      const yAt = yr => L.rowBase(g) - L.r - (Math.max(0, a + b * yr - 1) - TREND_LIFT) * L.dy;
      return { key: g, color: GENRE_COLORS[g],
               x1: L.x(y0), y1: yAt(y0), x2: L.x(y1), y2: yAt(y1) };
    });
    return L;
  }
};

/* Cómo se colorean los puntos en cada paso */
const COLOR_FNS = {
  neutral: () => NEUTRAL,
  genre:   d => GENRE_COLORS[d.main],
  genreOrbit: d => GENRE_COLORS[d.main],
  winner:  d => d.winner ? WIN_COLOR : NOM_COLOR,
  highlight: d => d.winner ? WIN_COLOR : NEUTRAL,  // foco: ganadoras en amarillo
  studioMGM: d => d.studio === 'MGM' ? MGM_COLOR : NEUTRAL,   // productora: las de MGM en su color
  studio: d => STUDIO_COLORS[studioOf(d)],   // productora: cada estudio en su color, el resto gris
  word: () => WORD_COLOR,
  drama: d => GENRE_COLORS[d.main],
  dramaWin: d => d.winner ? WIN_COLOR : GENRE_COLORS[d.main],  // ganadoras en amarillo
  // Rectángulo por género con foco en el drama: los demás géneros en gris
  genreDrama: d => d.main === 'Drama' ? GENRE_COLORS.Drama : NEUTRAL,
  // …y además las ganadoras de drama en amarillo
  genreDramaWin: d => d.main !== 'Drama' ? NEUTRAL : d.winner ? WIN_COLOR : GENRE_COLORS.Drama,
  // …y las tres películas del trío de drama en amarillo ganador
  dramaTrio: d => isTrioFilm(d) ? WIN_COLOR : COLOR_FNS.genreDramaWin(d),   // las del trío, en amarillo ganador
  extremes: d => isExtreme(d) ? '#fff' : (d.winner ? WIN_COLOR : NOM_COLOR)   // más corta y más larga en blanco
};

// La nominada más corta y la más larga (las de los zoom in SHORTEST y LONGEST)
const isExtreme = d => d.film === SHORTEST[0].film || d.film === LONGEST[0].film;

const LEGENDS = {
  neutral: [],
  word: [],
  drama: [],
  dramaWin: [],
  extremes: [],
  genre: GENRES.map(g => ({ text: GENRE_LABELS[g], color: GENRE_COLORS[g] })),
  genreOrbit: [],   // los nombres ya están escritos en pantalla
  // Misma leyenda que el rectángulo por género: los demás géneros quedan grises y tenues
  genreDrama: GENRES.map(g => g === 'Drama'
    ? { text: GENRE_LABELS[g], color: GENRE_COLORS[g] }
    : { text: GENRE_LABELS[g], color: NEUTRAL, dim: true }),
  dramaTrio: [{ text: GENRE_LABELS.Drama, color: GENRE_COLORS.Drama }],   // solo el drama: los demás géneros sobran
  genreDramaWin: [{ text: GENRE_LABELS.Drama, color: GENRE_COLORS.Drama },
    ...GENRES.filter(g => g !== 'Drama').map(g => ({ text: GENRE_LABELS[g], color: NEUTRAL, dim: true }))],
  winner: [],      // sin leyenda de ganadora / nominada
  studioMGM: [],
  studio: [],
  highlight: []
};

/* Un paso por sección de index.html (data-step = índice aquí).
   focus: función opcional. Los puntos que la cumplen se resaltan (más grandes,
   opacidad 1) y todo lo demás —puntos y textos— baja su opacidad. */
const FOCUS_OPACITY = 0.12;   // opacidad de los puntos que no son foco
const LABEL_OPACITY = 0.25;   // opacidad de los textos cuando hay foco

// Películas de los Movie-Zoom-In (video de YouTube: tramo de start a end, en segundos)
const HAMLET = {
  film: 'Hamlet', video: 'tsPPI_7x1dk', start: 8520, end: 8580,   // 2:22:00 a 2:23:00
  title: 'Hamlet', year: '1948'
};
const GODFATHER2 = {
  film: 'The Godfather Part II', video: 'CyFxxiKlGlA', start: 300, end: 360,
  title: 'The Godfather II', year: '1974'
};

// Trío de drama: tres ganadoras a la vez (caption = breve descripción)
const DRAMA_TRIO = [
  // era: la era del cine a la que pertenece (paso intermedio antes del título)
  { ...HAMLET, era: 'El cine joven y la herencia teatral', joint: 0,   // joint: la línea llega arriba del círculo (0°)
    caption: 'Primera película no estadounidense (británica) en ganar Mejor Película. Los inicios del cine, la herencia teatral y la preferencia por los clásicos definieron esta época.' },
  { ...GODFATHER2, era: 'La decadencia del sueño americano',
    caption: 'Primera secuela de la historia en ganar Mejor Película. Fue la época de EEUU post Vietnam, el desencanto del sueño americano, y la búsqueda de narrativas alternativas en el Nuevo Hollywood.' },
  { film: 'Moonlight', video: '9NJj12tJzqc', start: 46, end: 106,     // 0:46 a 1:46
    title: 'Moonlight', year: '2016', era: 'Cine de identidad y visibilización',
    scale: 1.45,   // video ampliado: el original tiene franjas negras arriba y abajo
    image: 'img/moonlight.jpg', imagePos: '42% 35%',
    caption: 'La primera ganadora con una historia LGBT, la vida de un joven negro y gay en Miami. La definió un momento de renovación para la Academia, con la intención de diversificar y ampliar las voces reconocidas y premiadas.' },
];

// Moonlight, el sobre equivocado: el momento de la ceremonia en que se anunció
// por error a La La Land. Se muestra en un círculo enorme que se sale de la
// pantalla por la izquierda, con el texto a la derecha (showBigCircle). Con sonido.
const MOONLIGHT_OSCAR = { film: 'Moonlight', key: 'moonlight-oscar', video: '8KeOxeuiZjs', start: 160, end: 280,   // 2:40 a 4:40
    title: 'El sobre equivocado', label: 'Ceremonia de 2017',
    caption: 'Al anunciar Mejor Película, Warren Beatty y Faye Dunaway leyeron "La La Land": les habían dado el sobre de Mejor Actriz por accidente. En pleno discurso de agradecimiento, el staff tuvo que intervenir para corregir el error. La verdadera ganadora era Moonlight.' }

// Hattie McDaniel: la primera persona negra en ganar un Óscar (por Gone with the
// Wind). Mismo formato que el sobre equivocado, pero con el video a la derecha
// (side: 'right') y el texto a la izquierda. labelColor: color de la etiqueta.
const HATTIE = { film: 'Gone with the Wind', key: 'hattie', video: 'e7t4pTNZshA', start: 60, end: 100,   // 1:00 a 1:40
    side: 'right', labelColor: '#c9a7ff',
    title: 'La primera mujer negra en ganar un Óscar', label: 'Ceremonia de 1940',
    caption: 'Hattie McDaniel ganó Mejor Actriz de Reparto por su papel de Mammy en Lo que el viento se llevó, y fue la primera persona negra en ganar un Óscar. La ceremonia se hizo en un hotel que no admitía personas negras: la dejaron entrar, pero tuvo que sentarse en una mesa aparte, lejos del resto del elenco. Pasaron más de 50 años hasta que otra mujer negra, Whoopi Goldberg, ganara un Óscar de actuación.' };

// It Happened One Night: la primera en ganar los cinco premios principales. Mismo
// formato que Hattie McDaniel y el sobre equivocado (video a la izquierda, texto a la
// derecha). clips: pedazos al azar de la película completa, de 8 segundos cada uno.
const IHON = { film: 'It Happened One Night', key: 'ihon', video: 'uSdpOIFh9h8', start: 120, end: 6200, clips: 8,
    labelColor: '#9cc3ff',
    title: 'La primera en ganar cinco Óscar', label: 'Ceremonia de 1935',
    caption: 'La comedia de Frank Capra fue la primera película en ganar los cinco premios principales: Mejor Película, Director, Actor (Clark Gable), Actriz (Claudette Colbert) y Guion. Era una producción modesta de Columbia que nadie esperaba ver triunfar. Solo dos películas lo repitieron después: One Flew Over the Cuckoo\'s Nest y The Silence of the Lambs.' };

// Trío bélico: tres ganadoras a la vez (caption = breve descripción)
// Zoom in: la nominada más corta de la historia (un solo círculo)
const SHORTEST = [
  { film: 'She Done Him Wrong', video: 'w6_7rd0s60s', start: 60, end: 120,   // 1:00 a 2:00
    title: 'She Done Him Wrong', year: '1933',
    image: 'img/she-done-him-wrong.jpg', imagePos: '55% 30%',
    stat: '1h 6 min', caption: 'La nominada más corta de la historia.' }
];

// Trío de los 60: tres épicos de la década más larga
const SIXTIES_TRIO = [
  { film: 'Lawrence of Arabia', video: 'P2g9H8vz3QM', start: 20, end: 80,      // 0:20 a 1:20
    title: 'Lawrence of Arabia', year: '1962',
    image: 'img/lawrence-of-arabia.jpg', imagePos: '55% 30%',
    scale: 1.6,    // video muy panorámico: se amplía para tapar las franjas negras
    stat: '3h 48 min', statSize: 'title',
    caption: 'Casi cuatro horas filmadas en 70 mm en el desierto. Ganó 7 Óscar, entre ellos Mejor Película.' },
  { film: 'Doctor Zhivago', video: 'P4kQvkvGi9M', start: 20, end: 80,          // 0:20 a 1:20
    title: 'Doctor Zhivago', year: '1965',
    image: 'img/doctor-zhivago.jpg', imagePos: '40% 35%',
    scale: 1.4,
    stat: '3h 17 min', statSize: 'title',
    caption: 'Un amor en plena Revolución rusa. Ganó 5 Óscar, pero perdió Mejor Película ante The Sound of Music.' },
  { film: 'Cleopatra', filmYear: 1963, video: 'vB5Wv8IHVf0', start: 20, end: 80, // 0:20 a 1:20
    title: 'Cleopatra', year: '1963',
    image: 'img/cleopatra.jpg', imagePos: '50% 30%',
    scale: 1.4,
    stat: '3h 12 min', statSize: 'title',
    caption: 'Una de las producciones más caras de la historia: casi lleva a la quiebra a 20th Century Fox.' }
];

// Zoom in: la nominada (y ganadora) más larga de la historia
const LONGEST = [
  { film: 'Gone with the Wind', video: '_k55c7P3Sfs', start: 60, end: 120,   // 1:00 a 2:00
    title: 'Gone with the Wind', year: '1939',
    image: 'img/gone-with-the-wind.jpg', imagePos: '55% 40%',
    stat: '3h 58 min', caption: 'La nominada y ganadora más larga de la historia.' }
];

// Los épicos de los 60 en el zoom de a una: arriba del título, en color, su
// duración en horas y minutos (en el lugar de la era del drama; key: otra instancia)
const SIXTIES_ZOOM = SIXTIES_TRIO.map(f => ({ ...f, key: f.film + '#zoom', era: f.stat }));

// Los dos extremos a la vez: la más corta a la izquierda y la más larga a la
// derecha (como en el histograma). Entre los círculos se muestra la diferencia
// de duración en horas y minutos (se calcula con los datos).
const EXTREMES = [SHORTEST[0], LONGEST[0]];
EXTREMES.between = 'de diferencia';

// Intro: la primera y la última ganadora del premio, a la vez (como los extremos de duración)
const FIRST_LAST = [
  // label: el texto en amarillo debajo del año (pantalla dividida)
  { film: 'Wings', key: 'wings-first', video: '8iCdCHmc_ro', start: 6420, end: 6480,   // 1:47:00 a 1:48:00
    title: 'Wings', year: '1927', label: 'El primer Óscar',
    poster: 'img/wings-poster.jpg',
    // bgVideo: video de fondo en la mitad derecha (pantalla dividida), el póster encima se desvanece
    bgVideo: { video: 'ho2Vdqo_1-Y', start: 6600, end: 6660 },   // 1:50:00 a 1:51:00 (película completa en HD)
    stat: 'La primera', statSize: 'title',
    caption: 'Un drama mudo sobre pilotos de la Primera Guerra Mundial: la primera ganadora de Mejor Película.' },
  { film: 'One Battle After Another', key: 'obaa-last', video: 'EUd2SSdFrWc', start: 60, end: 120,   // 1:00 a 2:00
    title: 'One Battle After Another', year: '2025', label: 'El último Óscar',
    poster: 'img/one-battle-poster.jpg',
    bgVideo: { video: '_dPcLEg7PsU', start: 60, end: 120 },   // 1:00 a 2:00 (escena de 3 min)
    stat: 'La última', statSize: 'title',
    caption: 'De Paul Thomas Anderson: la ganadora más reciente, en la ceremonia de 2026.' }
];
const isFirstLast = d => FIRST_LAST.some(c => c.film === d.film);

const WAR_TRIO = [
  { film: 'Wings', video: '8iCdCHmc_ro', start: 6420, end: 6480,        // 1:47:00 a 1:48:00
    title: 'Wings', year: '1927',
    era: 'El recuerdo de la Primera Guerra Mundial',   // era: paso intermedio con el título en verde bélico
    caption: 'La primera ganadora de la historia del Óscar, con tomas áereas revolucionarias para la época.' },
  { film: 'The Best Years of Our Lives', video: 'nCE6BeYJEtE', start: 20, end: 80,   // 0:20 a 1:20
    title: 'The Best Years of Our Lives', year: '1946',
    era: 'El trauma de la Segunda Guerra',
    image: 'img/best-years.jpg', imagePos: '50% 30%',   // foto propia (la miniatura tenía el logo de WB)
    caption: 'Estrenada un año después del fin de la guerra, retrata el difícil regreso de tres veteranos a casa.' },
  { film: 'The Hurt Locker', video: 'HsFVDM1lffM', start: 75, end: 135,  // 1:15 a 2:15
    title: 'The Hurt Locker', year: '2009',
    era: 'Conflictos contemporáneos',
    image: 'img/hurt-locker.jpg', imagePos: '28% 50%',  // encuadre sobre el rostro del protagonista
    caption: 'Un escuadrón antibombas en Irak. Con ella, Kathryn Bigelow fue la primera mujer en ganar como Mejor Director.' }
];

// Foco en el drama dentro del rectángulo por género
const isDrama = d => d.main === 'Drama';
// Las películas del trío de drama (sus puntos van en amarillo ganador)
const isTrioFilm = d => DRAMA_TRIO.some(f => f.film === d.film && (!f.filmYear || f.filmYear === d.year));
// Las del trío bélico (se destacan; el resto del bloque bélico queda tenue)
const isWarTrioFilm = d => WAR_TRIO.some(f => f.film === d.film && (!f.filmYear || f.filmYear === d.year));
const WAR_TRIO_DIM = 0.35;
const DRAMA_DIM = 0.28;   // opacidad de los demás géneros (grises)

const STEPS = [
  // Portada: la grilla de video con "And the Oscar goes to" (con sonido)
  // (alternativa descartada: OSCARS pintado sobre la grilla de video →
  //  { layout: 'oscarsGrid', color: 'word', maskVideo: 'word' })
  { layout: 'videoGrid', color: 'word', maskVideo: true },
  // Después del video: la palabra OSCARS hecha de puntos
  { layout: 'wordOscars', color: 'word' },
  // years: flechas con el año de la primera y la última ganadora
  // headNote: el texto va arriba de la grilla, alineado a su borde izquierdo
  // (cifra grande + título al lado), en vez de en la zona de texto de abajo
  { layout: 'allHead', base: 'all', color: 'neutral', headNote: true },
  // Igual que el anterior (texto arriba, conjunto centrado): la cifra pasa de 621
  // a las ganadoras con una animación de cambio de cifra (showHeadNote)
  { layout: 'allHead', base: 'all', color: 'highlight', focus: d => d.winner, years: d => d.winner, headNote: true },
  // Pantalla dividida en dos (sin línea visible): la grilla desaparece y se muestra
  // una película por paso, con texto a la izquierda y póster a la derecha. De
  // Wings a One Battle After Another todo se desliza en horizontal y la línea
  // de tiempo recorre los años (showSplit)
  { layout: 'splitHide', color: 'highlight', split: { films: FIRST_LAST, idx: 0 } },
  { layout: 'splitHide', color: 'highlight', split: { films: FIRST_LAST, idx: 1 } },
  // Las nominadas desaparecen (hide) y las ganadoras se ordenan en una línea
  // sideNote: el texto a los costados de la estatuilla (corrida a la derecha):
  // a la izquierda la pregunta grande en amarillo, a la derecha la bajada
  { layout: 'statueSide', base: 'statue', color: 'highlight', hide: d => !d.winner, sideNote: true },
  // Grilla de video: los puntos de la estatuilla se agrandan hasta una grilla
  // de 30 × 10 que cubre la pantalla; cada punto es una ventana al video.
  // DESACTIVADO (hidden en index.html): su video ahora está en la portada
  { layout: 'videoGrid', color: 'word', maskVideo: true },
  // Momento intermedio: la palabra Género hecha de puntos
  { layout: 'wordGenre', color: 'word' },
  // Instancia intermedia: los puntos salen de la palabra y orbitan el nombre de su género
  { layout: 'genreOrbit', color: 'genreOrbit' },
  // ¿Cuál es el género más común?: el rectángulo del paso 1, dividido en
  // bloques de color por género, con la leyenda arriba
  { layout: 'genreBlock', color: 'genre' },
  // Desde aquí la disposición NO cambia: solo cambian colores y opacidades.
  // Se destaca el drama: los demás géneros quedan grises y tenues
  { layout: 'genreBlock', bg: 'Drama', color: 'genreDrama', focus: isDrama, dimOpacity: DRAMA_DIM, footNote: true },   // footNote: texto debajo de los bloques
  // …y se iluminan las ganadoras de drama (amarillo)
  { layout: 'genreBlock', bg: 'Drama', color: 'genreDramaWin', focus: isDrama, dimOpacity: DRAMA_DIM },
  // Tres dramas ganadores: mismo rectángulo; sus tres puntos en amarillo y la
  // leyenda solo con el drama (para que un punto brille, agregar glow: [películas])
  { layout: 'genreBlock', bg: 'Drama', color: 'dramaTrio', focus: isDrama, dimOpacity: DRAMA_DIM, noLegend: true },
  // Zoom in: el bloque de drama (mismo tamaño) se centra, los demás géneros
  // desaparecen y debajo aparecen los tres círculos a la vez, creciendo desde
  // sus puntos (que siguen en amarillo). Una línea amarilla une cada
  // punto con su círculo (zoomLinks). Luego cada película muestra su
  // descripción por turno (active). noLegend: sin leyenda (el drama ya está aislado). years: marca el primer y el último año del bloque.
  // active -1 = primero las tres solo con foto, título y año (ningún video);
  // después cada una muestra su video y descripción.
  // De a una película (single): círculo a la izquierda con su video y, a la
  // derecha, título, año y descripción; la dupla centrada debajo del bloque.
  // Al pasar a la siguiente, el círculo anterior se esfuma y el nuevo se
  // dibuja desde su punto (punto que se enciende, línea, contorno, video).
  // Instancia intermedia: el bloque de drama queda solo y sube; en el espacio
  // vacío de abajo aparece el texto del paso (floatNote), antes de las películas
  { layout: 'dramaZoomSingle', base: 'genreBlock', bg: 'Drama', color: 'dramaTrio',
    hide: d => !isDrama(d), noLegend: true, years: 'Drama', floatNote: true },
  // Cada película en dos pasos: primero (era: true) su círculo con la era del
  // cine a la que pertenece (h1 en azul drama, cfg.era) y después su título,
  // año y descripción en el mismo lugar
  ...[0, 1, 2].flatMap(i => [true, false].map(era => ({
    layout: 'dramaZoomSingle', base: 'genreBlock', bg: 'Drama', color: 'dramaTrio',
    hide: d => !isDrama(d), noLegend: true, years: 'Drama', zoomLinks: true,
    trio: { films: DRAMA_TRIO, active: i, single: true, era }
  }))),
  // Moonlight, una instancia más: en el mismo círculo, el video de la ceremonia
  // (con sonido) y a la derecha el incidente del sobre con La La Land
  // (video a media pantalla a la izquierda con la grilla de puntos, texto a la derecha: showBigCircle)
  { layout: 'dramaZoomSingle', base: 'genreBlock', bgColor: '#ff0000', color: 'dramaTrio',   // fondo levemente rojo
    hide: () => true, noLegend: true, bigCircle: MOONLIGHT_OSCAR, labelOp: 0 },
  // Vuelta a la instancia inicial de bloques por género (colores de cada
  // género y leyenda arriba), para marcar que empieza otro análisis
  { layout: 'genreBlock', color: 'genre' },
  // ¿Cuál es el género más ganador? Los mismos bloques por género, con las
  // ganadoras (amarillo) primero en cada bloque y su tasa de victoria arriba.
  // labelOp: 1 = los textos NO se esfuman
  { layout: 'genreRateBlock', color: 'winner', labelOp: 1 },
  // Se destaca el drama: la mayor cantidad de ganadoras
  { layout: 'genreRateBlock', color: 'winner', focus: d => d.main === 'Drama',
    dimOpacity: 0.15, labelOp: 1, labelFocus: 'Drama', footNote: true },
  // Se destaca el bélico: la mejor tasa de victoria
  { layout: 'genreRateBlock', color: 'winner', focus: d => d.main === 'War',
    dimOpacity: 0.15, labelOp: 1, labelFocus: 'War', footNote: true },
  // Bélico, como el drama: los demás bloques desaparecen y el bélico (mismo
  // tamaño y orden) se centra arriba
  { layout: 'warZoom', base: 'genreRateBlock', bg: 'War', color: 'winner', hide: d => d.main !== 'War', years: 'War' },
  // ¿Por qué gana la guerra? Se destacan las tres ganadoras del trío
  { layout: 'warZoomChrono', base: 'genreRateBlock', bg: 'War', color: 'winner', hide: d => d.main !== 'War', years: 'War', floatNote: true,
    focus: isWarTrioFilm, dimOpacity: WAR_TRIO_DIM },
  // Zoom in de a una película (igual que el drama): círculo a la izquierda y su
  // texto a la derecha, debajo del bloque; línea y contorno amarillos desde su punto
  // Como en el drama, cada película en dos pasos: primero la era (h1 en verde
  // bélico, cfg.era) y después, debajo de ella, título, año y descripción
  ...[0, 1, 2].flatMap(i => [true, false].map(era => ({
    layout: 'warZoomChrono', years: 'War', base: 'genreRateBlock', bg: 'War', color: 'winner',
    hide: d => d.main !== 'War', focus: isWarTrioFilm, dimOpacity: WAR_TRIO_DIM, zoomLinks: true,
    trio: { films: WAR_TRIO, active: i, single: true, era }
  }))),
  // Sin grilla ni puntos: solo un texto centrado, un poco más arriba (floatNote: 'center')
  { layout: 'warZoomChrono', base: 'genreRateBlock', color: 'winner', hide: () => true,   // sin bg: fondo neutro
    noLegend: true, floatNote: 'center' },
  // Evolución de cada género en el tiempo: una fila por género, año en el eje X
  // noLegend: desde «el futuro de los géneros» hasta el fin de la sección, sin leyenda
  // (los nombres de cada género ya están en el gráfico)
  { layout: 'timelineTall', base: 'timeline', color: 'genre', noLegend: true },   // sin texto: usa toda la pantalla hacia abajo
  // El romance aislado (fondo rosado): su fila arriba, un corazón de puntos que se
  // parte y debajo el texto de su caída con porcentajes (se calculan: data-stat)
  { layout: 'romanceSolo', base: 'timeline', bg: 'Romance', color: 'genre', hide: d => d.main !== 'Romance',
    noLegend: true, heart: true, soloNote: true, fadeSwap: true },
  // La biopic aislada, con las mismas reglas: su fila arriba, una estrella de
  // puntos y debajo el texto de su crecimiento
  { layout: 'biopicSolo', base: 'timeline', bg: 'Biopic', color: 'genre', hide: d => d.main !== 'Biopic',
    noLegend: true, icon: 'star', soloNote: true, fadeSwap: true },
  // El drama aislado, con las mismas reglas que el romance: su fila arriba, una
  // máscara de teatro de puntos y debajo el texto de su continuidad
  { layout: 'dramaSolo', base: 'timeline', bg: 'Drama', color: 'genre', hide: d => d.main !== 'Drama',
    noLegend: true, icon: 'mask', soloNote: true, fadeSwap: true },
  // Entrada a la sección Duración: la palabra hecha de puntos
  { layout: 'wordDuration', color: 'word' },
  // Distribución por duración: columnas ordenadas por minutos, apiladas hacia abajo
  { layout: 'durationStripLow', base: 'durationStrip', color: 'winner' },   // un poco más abajo (DUR_DOWN)
  // La franja más común (110–119 min): franja de fondo; el resto queda tenue
  { layout: 'durationStripBand', base: 'durationStrip', color: 'winner',
    focus: d => d.dur >= COMMON_RUNTIME && d.dur < COMMON_RUNTIME + 10,
    dimOpacity: 0.12, labelOp: 1, headNote: true },   // headNote: texto arriba de la franja
  // ¿Cuáles son los extremos? La más corta y la más larga se encienden en blanco
  // (y crecen un poco); el resto queda tenue
  { layout: 'durationStripLow', base: 'durationStrip', color: 'extremes', focus: isExtreme, focusScale: 2,
    dimOpacity: 0.15, labelOp: 1 },
  // Los dos extremos a la vez (misma lógica que el zoom in del drama): el
  // histograma se achica y sube y, al mismo tiempo, debajo aparecen los dos
  // círculos con foto, título y año (línea y contorno desde su punto); entre
  // ellos, la diferencia en horas y minutos. La tarjeta de texto queda vacía.
  { layout: 'durationZoom', color: 'extremes', focus: isExtreme, dimOpacity: 0.15, labelOp: 1,
    zoomLinks: true, trio: { films: EXTREMES, active: -1, together: true } },
  // Los dos pasan al video con su dato (1h 6 min y 3h 58 min) al mismo tiempo
  { layout: 'durationZoom', color: 'extremes', focus: isExtreme, dimOpacity: 0.15, labelOp: 1,
    zoomLinks: true, trio: { films: EXTREMES, active: 'all', together: true } },
  // Hattie McDaniel (fondo púrpura): texto a la izquierda y video a la derecha, con
  // la grilla de puntos y el degradado (showBigCircle, como el sobre equivocado)
  { layout: 'durationZoom', color: 'extremes', hide: () => true, noLegend: true, labelOp: 0,   // labelOp 0: sin números, ejes ni líneas
    bgColor: '#8a5cd6', bigCircle: HATTIE },
  // Duración a través de los años: dispersión año × duración
  // El histograma "explota" en tres: años 30, 60 y 2020, apilados
  { layout: 'durationDecades', color: 'winner' },
  { layout: 'scatter', color: 'winner'  },
  // Misma dispersión con la línea de tendencia encima; los puntos se atenúan
  // (focus que nadie cumple) y los ejes se mantienen visibles (labelOp: 1).
  // De aquí se pasa directo a la década de los 60.
  { layout: 'scatterTrend', base: 'scatter', color: 'winner', focus: () => false, labelOp: 1 },
  // La década de los épicos: se resalta 1960–1969 (franja + promedio); el resto
  // de los puntos queda tenue
  { layout: 'scatterDecade', base: 'scatter', color: 'winner',
    focus: d => d.year >= HIGHLIGHT_DECADE && d.year < HIGHLIGHT_DECADE + 10,
    dimOpacity: 0.12, labelOp: 1 },
  // Trío de los 60 (como el drama y el bélico): el gráfico sube y en el espacio de
  // abajo aparece primero un texto (floatNote) y después, de a una, Lawrence of
  // Arabia, Doctor Zhivago y Cleopatra (1963): círculo desde su punto y texto al lado
  { layout: 'scatterZoom', base: 'scatter', color: 'winner',
    focus: d => d.year >= HIGHLIGHT_DECADE && d.year < HIGHLIGHT_DECADE + 10, dimOpacity: 0.12, labelOp: 1,
    noLegend: true, floatNote: true },
  ...[0, 1, 2].map(i => ({
    layout: 'scatterZoom', base: 'scatter', color: 'winner',
    focus: d => SIXTIES_TRIO.some(f => f.film === d.film && (!f.filmYear || f.filmYear === d.year)),
    dimOpacity: 0.12, labelOp: 1, noLegend: true, zoomLinks: true,
    eraColor: WIN_COLOR,   // la duración, arriba del título, en amarillo
    trio: { films: SIXTIES_ZOOM, active: i, single: true }
  })),
  // Ganadoras vs. nominadas: promedio por década de cada grupo sobre la
  // dispersión; foco en las ganadoras (los puntos no se mueven: base scatter)
  { layout: 'scatterWinNom', base: 'scatter', color: 'winner', focus: d => d.winner,
    dimOpacity: 0.15, labelOp: 1 },
  // La excepción: los 2010, única década en que las ganadoras fueron más cortas
  { layout: 'scatterWinNom2010', base: 'scatter', color: 'winner',
    focus: d => d.winner && d.year >= 2010 && d.year < 2020, dimOpacity: 0.12, labelOp: 1 },
  // Entrada a la sección Productora: la palabra hecha de puntos
  { layout: 'wordProducer', color: 'word' },
  // Prueba: el bloque dividido por estudio, como el de género: MGM, Fox, Columbia,
  // Paramount y Warner, cada uno en su color, y un bloque gris con "Otros"
  { layout: 'studioBlock', color: 'studio', labelOp: 1, footNote: true },   // footNote: cifra + texto debajo, como el drama
  // Columbia aislada (como el drama y el bélico): su bloque arriba, con las ganadoras
  // en amarillo, y debajo el texto centrado (floatNote)
  { layout: 'columbiaZoom', base: 'studioBlock', color: 'highlight', hide: d => studioOf(d) !== 'Columbia',
    noLegend: true, floatNote: true },
  // Mismo bloque arriba; debajo, los pósters de sus ganadoras pasan solos en horizontal
  // (la grilla desaparece y el texto pasa arriba, en su lugar: floatNote 'aboveStrip')
  { layout: 'columbiaZoom', base: 'studioBlock', color: 'highlight', hide: d => true,
    noLegend: true, posterStrip: COLUMBIA_POSTERS, floatNote: 'aboveStrip' },
  // La tira vuelve sola hasta It Happened One Night (la primera, posterFocus: 0), se
  // esfuma y aparece su instancia: video a la izquierda y texto a la derecha (fondo azul)
  { layout: 'columbiaZoom', base: 'studioBlock', color: 'highlight', hide: () => true, noLegend: true, labelOp: 0,
    posterStrip: COLUMBIA_POSTERS, posterFocus: 0, bgColor: '#3d6fd8', bigCircle: IHON, bigDelay: 1500 },
  // MGM: vuelve el bloque de las 621 (como al principio) y se resaltan las
  // producidas por MGM; arriba, su cantidad y el título (headNote)
  { layout: 'allHead', base: 'all', color: 'studioMGM', focus: d => d.studio === 'MGM', dimOpacity: 0.15, headNote: true },
  // CIERRE: LA FÓRMULA GANADORA
  // El título hecho de puntos
  { layout: 'wordFormula', color: 'word' },
  // Los puntos se esfuman y queda un texto centrado (floatNote)
  { layout: 'wordFormula', color: 'word', hide: () => true, floatNote: 'center' },
  // La fórmula: la estatuilla a la derecha y a la izquierda el género, la duración y
  // el estudio más probables, en amarillo (formulaNote)
  { layout: 'statueFormula', base: 'statue', color: 'highlight', hide: d => !d.winner, formulaNote: true },
  // Cuenta regresiva a la próxima ceremonia (countdown)
  { layout: 'statueFormula', base: 'statue', color: 'highlight', hide: () => true, noExtra: true, countdown: true },
  // Cierre: el video que estaba en la portada, visto a través de la grilla de puntos
  { layout: 'statueFormula', base: 'statue', color: 'highlight', hide: () => true, noExtra: true, outro: true },
  // Fuentes y créditos (el video sigue detrás, más oscuro)
  { layout: 'statueFormula', base: 'statue', color: 'highlight', hide: () => true, noExtra: true, outro: 'dim' }
];
/* =========================================================
   MOVIE-ZOOM-IN: video de YouTube dentro de un círculo que crece
   ========================================================= */
const ZOOM_MS = 1600;          // duración de la animación de la máscara
const ZOOM_SIZE = 0.42;        // radio final como fracción del lado menor de la pantalla
const zoomEl = document.getElementById('zoom');
const zoom = {
  open: false, origin: null, cfg: null, player: null, ready: false,
  video: null,   // id del video cargado en el reproductor
  timer: null, switchTimer: null, loop: null
};

// La API de YouTube llama a esta función cuando termina de cargar
function initPlayer() {
  if (zoom.player || !window.YT || !YT.Player) return;
  const first = STEPS.find(s => s.zoom);       // si ningún paso usa zoom, no se crea
  if (!first) return;
  const cfg = first.zoom;                       // se precarga el primer video
  zoom.video = cfg.video;
  zoom.player = new YT.Player('zoom-player', {
    videoId: cfg.video,
    playerVars: {
      start: cfg.start, end: cfg.end, mute: 1, controls: 0, disablekb: 1,
      playsinline: 1, rel: 0, iv_load_policy: 3, modestbranding: 1, fs: 0
    },
    events: {
      onReady: e => {
        e.target.mute();
        zoom.ready = true;
        if (zoom.open) playZoom();
      },
      onStateChange: e => {
        zoomEl.classList.toggle('playing', e.data === YT.PlayerState.PLAYING);   // oculta la interfaz de YouTube
        if (e.data === YT.PlayerState.ENDED && zoom.open) playZoom();
      }
    }
  });
}
window.onYouTubeIframeAPIReady = () => { initPlayer(); initTrioPlayers(); initIntroPlayer(); };
initPlayer();   // por si la API ya estaba cargada

// Reproduce el tramo [start, end] del video del zoom actual, en loop
function playZoom() {
  if (!zoom.ready) return;
  const { video, start, end } = zoom.cfg;
  zoom.player.mute();
  if (zoom.video !== video) {
    zoom.video = video;
    zoom.player.loadVideoById({ videoId: video, startSeconds: start, endSeconds: end });
  } else {
    zoom.player.seekTo(start, true);
    zoom.player.playVideo();
  }
  // Vigila el final del tramo y vuelve al inicio
  clearInterval(zoom.loop);
  zoom.loop = setInterval(() => {
    const t = zoom.player.getCurrentTime ? zoom.player.getCurrentTime() : 0;
    if (zoom.open && t >= end - LOOP_LEAD) zoom.player.seekTo(start, true);
  }, 250);
}

function setClip(x, y, r, ms) {
  zoomEl.style.transition = ms ? `clip-path ${ms}ms cubic-bezier(.65,0,.35,1)` : 'none';
  zoomEl.style.clipPath = `circle(${r}px at ${x}px ${y}px)`;
}

function openZoom(cfg, x, y, r, animate) {
  clearTimeout(zoom.switchTimer);
  // Otra película con el círculo abierto: primero se cierra hacia su punto
  // y después se abre el nuevo círculo desde el punto de la otra película.
  if (zoom.open && zoom.cfg.film !== cfg.film) {
    closeZoom(animate);
    zoom.switchTimer = setTimeout(() => openZoom(cfg, x, y, r, animate),
                                  animate ? ZOOM_MS * 0.7 + 100 : 0);
    return;
  }
  clearTimeout(zoom.timer);
  zoom.cfg = cfg;
  zoom.origin = { x, y, r };
  zoomEl.querySelector('#zoom-title h2').textContent = cfg.title || '';
  zoomEl.querySelector('#zoom-title p').textContent = cfg.year || '';
  if (cfg.caption) zoomEl.querySelector('#zoom-caption').textContent = cfg.caption;
  zoomEl.classList.toggle('dimmed', !!cfg.dim);
  // Filtro de color: el color del género de la película
  const film = findFilm(cfg);
  zoomEl.style.setProperty('--tint', film ? GENRE_COLORS[film.main] : 'transparent');
  // Primero se esfuma el texto que había; luego aparece el que corresponde.
  // Si el círculo recién se abre, espera a que casi termine de crecer.
  zoomEl.classList.remove(cfg.caption ? 'titled' : 'captioned');
  const delay = !animate ? 0 : zoom.open ? 500 : ZOOM_MS * 0.7;
  zoom.timer = setTimeout(() => zoomEl.classList.add(cfg.caption ? 'captioned' : 'titled'), delay);
  const R = Math.min(innerWidth, innerHeight) * ZOOM_SIZE;
  if (!zoom.open) {
    zoomEl.classList.add('open');
    setClip(x, y, r, 0);            // empieza exactamente sobre el punto
    zoomEl.getBoundingClientRect(); // fuerza el reflow antes de animar
    zoom.open = true;
    playZoom();
  }
  setClip(innerWidth / 2, innerHeight / 2, R, animate ? ZOOM_MS : 0);
}

function closeZoom(animate) {
  clearTimeout(zoom.timer);
  clearTimeout(zoom.switchTimer);
  zoom.open = false;
  zoomEl.classList.remove('titled', 'captioned', 'dimmed');
  const o = zoom.origin || { x: innerWidth / 2, y: innerHeight / 2, r: 0 };
  setClip(o.x, o.y, o.r, animate ? ZOOM_MS * 0.7 : 0);
  zoom.timer = setTimeout(() => {
    if (zoom.open) return;            // se volvió a abrir mientras se cerraba
    zoomEl.classList.remove('open');
    clearInterval(zoom.loop);
    if (zoom.ready) zoom.player.pauseVideo();
  }, animate ? ZOOM_MS * 0.7 : 0);
}

/* =========================================================
   TRÍO: tres círculos con video a la vez, en línea al centro
   Cada círculo nace en el punto de su película (transform: translate+scale)
   y crece hasta su lugar. Con `active` una película muestra su descripción
   (video oscurecido) y las demás conservan título y año.
   Puede haber varios tríos (drama, bélico…): uno por cada lista de películas
   usada en STEPS.
   ========================================================= */
const TRIO_MS  = 1600;
const TRIO_GAP = 40;     // separación entre círculos (px)
const TRIO_BETWEEN_GAP = 280;   // separación cuando hay un texto entre los círculos (films.between)
const LOOP_LEAD = 0.4;   // vuelve al inicio un poco antes del final (evita la pantalla de "fin" de YouTube)
const trioEl = document.getElementById('trio');

// Un "set" por cada lista de películas distinta usada en STEPS
const TRIO_SETS = [...new Set(STEPS.filter(s => s.trio).map(s => s.trio.films))].map((films, si) => {
  const el = document.createElement('div');
  el.className = 'trio-set';
  el.innerHTML = films.map((_, i) => `
    <div class="trio-item">
      <div class="trio-photo"></div>
      <div class="trio-video"><div id="trio-player-${si}-${i}"></div></div>
      <div class="trio-tint"></div>
      <div class="trio-dim"></div>
      <div class="trio-title"><h3></h3><p></p></div>
      <div class="trio-caption"></div>
    </div>`).join('');
  trioEl.appendChild(el);
  // Texto entre los círculos (p. ej. la diferencia de duración entre los extremos)
  let betweenEl = null;
  if (films.between) {
    betweenEl = document.createElement('div');
    betweenEl.className = 'trio-between';
    betweenEl.innerHTML = '<strong></strong><span></span>';
    betweenEl.querySelector('span').textContent = films.between;
    el.appendChild(betweenEl);
  }
  const items = films.map((cfg, i) => {
    const itemEl = el.children[i];
    itemEl.querySelector('h3').textContent = cfg.title;
    itemEl.querySelector('.trio-title p').textContent = cfg.year;
    const capEl = itemEl.querySelector('.trio-caption');
    if (cfg.stat) {
      // Dato destacado: cifra grande y una línea debajo
      capEl.innerHTML = '<strong class="trio-stat"></strong><span></span>';
      if (cfg.statSize === 'title') capEl.classList.add('stat-title');   // cifra del tamaño del título
      capEl.querySelector('strong').textContent = cfg.stat;
      capEl.querySelector('span').textContent = cfg.caption;
    } else capEl.textContent = cfg.caption;
    // Foto fija: cfg.image si se define (p. ej. 'img/wings.jpg'); si no, la miniatura del video en YouTube
    const photoEl = itemEl.querySelector('.trio-photo');
    const setPhoto = src => { photoEl.style.backgroundImage = `url("${src}")`; };
    if (cfg.imagePos) photoEl.style.backgroundPosition = cfg.imagePos;   // encuadre dentro del círculo
    // Las fotos propias no traen franjas ni interfaz: sin ampliación extra
    if (cfg.image) { setPhoto(cfg.image); photoEl.style.transform = 'none'; }
    else {
      // La miniatura grande no existe en todos los videos: si falla (YouTube
      // devuelve una imagen gris de 120px), se usa la de calidad media
      const hi = `https://i.ytimg.com/vi/${cfg.video}/maxresdefault.jpg`;
      const img = new Image();
      img.onload = () => setPhoto(img.naturalWidth > 120 ? hi : `https://i.ytimg.com/vi/${cfg.video}/hqdefault.jpg`);
      img.onerror = () => setPhoto(`https://i.ytimg.com/vi/${cfg.video}/hqdefault.jpg`);
      img.src = hi;
    }
    return { cfg, el: itemEl, playerId: `trio-player-${si}-${i}`, player: null, ready: false };
  });
  return { films, el, items, betweenEl, open: false, origins: [], timer: null, loop: null };
});

/* "Calentamiento" de los videos: YouTube muestra su interfaz (título, ícono de
   pausa, ruedita de carga) justo al empezar a reproducir o al cargar. Para que
   no se vea, cada trío empieza a reproducirse en silencio e invisible
   PRELOAD_STEPS pasos antes de aparecer, y cada video recién se muestra cuando
   lleva WARMUP_MS reproduciéndose sin interrupción. */
const PRELOAD_STEPS = 2;     // cuántos pasos antes del trío se empiezan a reproducir
const WARMUP_MS     = 2500;  // tiempo reproduciendo antes de mostrarse
const HIDE_GRACE_MS = 400;   // cortes más breves que esto (p. ej. el salto del loop) no lo ocultan

function initTrioPlayers() {
  if (!window.YT || !YT.Player) return;
  TRIO_SETS.forEach(set => set.items.forEach(it => {
    if (it.player) return;
    it.player = new YT.Player(it.playerId, {
      videoId: it.cfg.video,
      playerVars: {
        start: it.cfg.start, mute: 1, controls: 0, disablekb: 1,
        playsinline: 1, rel: 0, iv_load_policy: 3, modestbranding: 1, fs: 0
      },
      events: {
        onReady: e => {
          e.target.mute();
          it.ready = true;
          if (set.warm) startItem(it);
          if (it.wantSound) setItemSound(it, true);   // su paso ya estaba activo
        },
        onStateChange: e => {
          const S = YT.PlayerState;
          if (e.data === S.PLAYING) {
            clearTimeout(it.hideTimer);
            if (!it.el.classList.contains('playing')) {
              clearTimeout(it.showTimer);
              it.showTimer = setTimeout(() => it.el.classList.add('playing'), WARMUP_MS);
            }
          } else {
            clearTimeout(it.showTimer);
            clearTimeout(it.hideTimer);
            it.hideTimer = setTimeout(() => it.el.classList.remove('playing'), HIDE_GRACE_MS);
          }
          if (e.data === S.ENDED && set.warm) { it.player.seekTo(it.cfg.start, true); it.player.playVideo(); }
        },
        // Si YouTube no deja reproducir el video, queda la foto y se avisa en la
        // consola del navegador (101/150 = el dueño no permite incrustarlo;
        // 100 = no existe o es privado; 5 = error del reproductor HTML5)
        onError: e => {
          console.warn(`Video de "${it.cfg.title}" (${it.cfg.video}) no se puede reproducir: error ${e.data}`);
          it.el.classList.remove('playing');
        }
      }
    });
  }));
}
initTrioPlayers();   // por si la API ya estaba cargada

// Arranca un video (una sola vez) desde el inicio de su tramo
function startItem(it) {
  if (!it.ready || it.started) return;
  it.started = true;
  it.player.mute();
  it.player.seekTo(it.cfg.start, true);
  it.player.playVideo();
}

// Empieza a reproducir los videos de un trío (aunque todavía no se vean)
function warmSet(set) {
  if (set.warm) return;
  set.warm = true;
  sizeSet(set);
  set.items.forEach(startItem);
  clearInterval(set.loop);
  set.loop = setInterval(() => set.items.forEach(it => {
    if (!it.ready || !it.started) return;
    if (it.player.getCurrentTime() >= it.cfg.end - LOOP_LEAD) it.player.seekTo(it.cfg.start, true);
    // Vigilante: si el video quedó sin arrancar o en pausa (p. ej. el navegador
    // frenó la reproducción automática), se vuelve a pedir que reproduzca
    const st = it.player.getPlayerState();
    if ((st === YT.PlayerState.UNSTARTED || st === YT.PlayerState.CUED || st === YT.PlayerState.PAUSED)
        && Date.now() - (it.kicked || 0) > 1500) {
      it.kicked = Date.now();
      if (!it.soundOn) it.player.mute();   // el video con sonido (cfg.sound) sigue con volumen
      it.player.playVideo();
    }
  }), 200);
}

/* Sonido: los videos de los círculos van en silencio, salvo el de una película
   con cfg.sound mientras su paso está activo. Al activarse vuelve al inicio de
   su tramo y suena. Como en la grilla de video, solo si el navegador lo permite
   (la persona ya hizo clic o tocó una tecla en la página). */
function setItemSound(it, on) {
  it.wantSound = on;
  if (!it.ready || !it.player) return;   // se aplica cuando el reproductor esté listo
  if (on === !!it.soundOn) return;
  if (on) {
    const canSound = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
    if (!canSound) return;
    it.soundOn = true;
    it.player.seekTo(it.cfg.start, true);
    it.player.unMute();
    it.player.setVolume(100);
    it.player.playVideo();
  } else {
    it.soundOn = false;
    it.player.mute();
  }
}

// Detiene los videos de un trío lejano
function coolSet(set) {
  if (!set.warm) return;
  set.warm = false;
  clearInterval(set.loop);
  set.items.forEach(it => {
    it.started = false;
    clearTimeout(it.showTimer);
    clearTimeout(it.hideTimer);
    it.el.classList.remove('playing');
    if (it.ready) it.player.pauseVideo();
  });
}

// Minutos en formato "2h 52 min" (o "52 min" si es menos de una hora)
function formatHM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${m} min` : `${m} min`;
}

// Posición final de cada círculo: en línea, centrados en la pantalla
function trioGeometry(n, gap = TRIO_GAP) {
  const margin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--margin')) || 0;
  const availW = Math.max(300, innerWidth - margin * 2);
  // Una sola película: un círculo más grande (zoom in); varias: en línea
  const D = n === 1 ? Math.min(availW, innerHeight * 0.72)
                    : Math.min((availW - gap * (n - 1)) / n, innerHeight * 0.5);
  return Array.from({ length: n }, (_, i) => ({
    x: innerWidth / 2 + (i - (n - 1) / 2) * (D + gap),
    y: innerHeight / 2,
    D
  }));
}

const dotTransform = (o, g) =>
  `translate(${o.x - g.x}px, ${o.y - g.y}px) scale(${Math.max(o.r * 2 / g.D, 0.001)})`;

// Tamaño y posición final de los círculos (también al precargar: YouTube no
// reproduce en reproductores demasiado chicos)
function sizeSet(set, geoOverride = null) {
  // geoOverride: posiciones dadas por el layout (p. ej. el trío debajo del drama)
  const geo = geoOverride || trioGeometry(set.items.length, set.betweenEl ? TRIO_BETWEEN_GAP : TRIO_GAP);
  set.geo = geo;
  set.el.style.setProperty('--d', geo[0].D + 'px');
  if (set.betweenEl) {
    // Diferencia de duración entre la primera y la última película, en "Xh Y min"
    const fs = set.items.map(it => findFilm(it.cfg)).filter(Boolean);
    if (fs.length > 1) set.betweenEl.querySelector('strong').textContent =
      formatHM(Math.abs(fs[fs.length - 1].dur - fs[0].dur));
    set.betweenEl.style.width = (TRIO_BETWEEN_GAP - 24) + 'px';
    // Centrado entre el primer y el último círculo (que pueden no estar en el medio de la pantalla)
    set.betweenEl.style.left = (geo[0].x + geo[geo.length - 1].x) / 2 + 'px';
    set.betweenEl.style.top = geo[0].y + 'px';
  }
  set.items.forEach((it, i) => {
    const g = geo[i], el = it.el;
    el.style.left = (g.x - g.D / 2) + 'px';
    el.style.top = (g.y - g.D / 2) + 'px';
    el.style.width = el.style.height = g.D + 'px';
    const f = findFilm(it.cfg);
    el.style.setProperty('--tint', f ? GENRE_COLORS[f.main] : 'transparent');
    if (it.cfg.scale) el.style.setProperty('--vscale', it.cfg.scale);
  });
  return geo;
}

// reveal (ms): en vez de crecer desde su punto, los círculos ya están en su
// lugar, invisibles, y su video y texto aparecen recién después de `reveal` ms
// (lo usa el zoom in, cuando la línea y el contorno ya se dibujaron)
// single = true (con reveal): una película a la vez; solo se ve la activa
function openTrio(set, active, origins, animate, geoOverride = null, reveal = null, single = false) {
  clearTimeout(set.timer);
  set.origins = origins;
  const geo = sizeSet(set, geoOverride);
  const wasOpen = set.open;
  set.reveal = reveal != null;

  set.items.forEach((it, i) => {
    const g = geo[i], el = it.el;
    el.classList.toggle('active', active === 'all' || i === active);   // 'all': todas muestran su dato
    if (!wasOpen) {
      el.style.transition = 'none';
      if (set.reveal) { el.style.transform = 'none'; el.style.opacity = 0; }   // en su lugar, invisible
      else el.style.transform = dotTransform(origins[i], g);                  // sobre su punto
    }
  });

  if (!wasOpen) {
    set.el.classList.remove('titled');
    set.el.classList.add('open');
    set.el.getBoundingClientRect();   // fuerza el reflow antes de animar
    warmSet(set);   // normalmente ya venía reproduciéndose desde pasos anteriores
  }
  set.open = true;

  if (set.reveal) {
    // Cada círculo aparece por su cuenta (escalonados: ZOOM_STAGGER) con un
    // fundido suave; los textos, cuando ya apareció el último
    (set.revealTimers || []).forEach(clearTimeout);
    set.revealTimers = [];
    const fade = `opacity ${ZOOM_SEQ.content}ms ease-in-out`;
    set.el.classList.toggle('single', single);
    if (single) {
      // De a una: la anterior se esfuma; la activa aparece cuando la línea y
      // el contorno ya se dibujaron (reveal)
      set.items.forEach((it, i) => {
        if (i !== active) {
          it.el.style.transition = animate ? 'opacity .35s ease' : 'none';
          it.el.style.opacity = 0;
          it.shown = false;
          return;
        }
        if (it.shown) return;   // ya estaba a la vista
        it.shown = true;
        const show = () => { it.el.style.transition = animate ? fade : 'none'; it.el.style.opacity = 1; };
        if (!animate) show(); else set.revealTimers.push(setTimeout(show, reveal));
      });
      return;
    }
    const now = wasOpen || !animate;   // ya estaba abierto (cambia la película activa): enseguida
    set.items.forEach((it, i) => {
      const show = () => { it.el.style.transition = animate ? fade : 'none'; it.el.style.opacity = 1; };
      if (now) show(); else set.revealTimers.push(setTimeout(show, reveal + i * ZOOM_STAGGER));
    });
    const last = now ? 0 : reveal + (set.items.length - 1) * ZOOM_STAGGER + ZOOM_SEQ.content * 0.4;
    set.timer = setTimeout(() => set.el.classList.add('titled'), last);
    return;
  }
  set.items.forEach(it => {
    it.el.style.transition = animate ? `transform ${TRIO_MS}ms cubic-bezier(.65,0,.35,1)` : 'none';
    it.el.style.transform = 'none';
  });
  // Los títulos aparecen cuando los círculos casi terminaron de crecer
  if (!set.el.classList.contains('titled'))
    set.timer = setTimeout(() => set.el.classList.add('titled'), animate ? TRIO_MS * 0.7 : 0);
}

/* SPOT: un solo círculo a la vez, al costado del rectángulo (trio.spot).
   El círculo de la película activa nace en su punto y crece hasta `spot`
   ({x, y, D} en px de pantalla); el que estaba abierto vuelve a su punto.
   delay: espera antes de crecer (p. ej. a que el rectángulo termine de deslizarse). */
const SPOT_EASE = 'cubic-bezier(.65,0,.35,1)';

function openSpot(set, active, origins, spot, animate, delay) {
  clearTimeout(set.timer);
  (set.spotTimers || []).forEach(clearTimeout);
  set.spotTimers = [];
  warmSet(set);   // antes de ubicar los círculos (warmSet los ubica en línea)
  set.origins = origins;
  set.spotGeo = spot;
  set.el.classList.remove('titled');
  set.el.classList.add('spot');
  set.el.style.setProperty('--d', spot.D + 'px');
  const g = spot;

  set.items.forEach((it, i) => {
    const el = it.el;
    el.style.left = (g.x - g.D / 2) + 'px';
    el.style.top = (g.y - g.D / 2) + 'px';
    el.style.width = el.style.height = g.D + 'px';
    const f = findFilm(it.cfg);
    el.style.setProperty('--tint', f ? GENRE_COLORS[f.main] : 'transparent');
    if (it.cfg.scale) el.style.setProperty('--vscale', it.cfg.scale);

    if (i !== active) {
      el.classList.remove('active', 'shown');
      if (it.spotOn && animate) {
        // Vuelve a su punto y se esfuma al llegar
        el.style.transition = `transform ${TRIO_MS * 0.7}ms ${SPOT_EASE}, opacity .3s ${TRIO_MS * 0.55}ms`;
      } else el.style.transition = 'none';
      el.style.transform = dotTransform(origins[i], g);
      el.style.opacity = 0;
      it.spotOn = false;
      return;
    }

    if (!it.spotOn) {
      // Empieza exactamente sobre su punto (que ya brilla) y luego crece
      el.style.transition = 'none';
      el.style.transform = dotTransform(origins[i], g);
      el.style.opacity = 0;
      el.getBoundingClientRect();   // fuerza el reflow antes de animar
      const grow = () => {
        el.style.transition = animate ? `transform ${TRIO_MS}ms ${SPOT_EASE}, opacity .25s` : 'none';
        el.style.opacity = 1;
        el.style.transform = 'none';
        el.classList.add('active');
      };
      if (animate && delay) set.spotTimers.push(setTimeout(grow, delay)); else grow();
      set.spotTimers.push(setTimeout(() => el.classList.add('shown'),
                                     animate ? (delay || 0) + TRIO_MS * 0.7 : 0));
      it.spotOn = true;
    } else {
      // Ya estaba abierto (p. ej. al cambiar el tamaño de la ventana)
      el.style.transition = 'none';
      el.style.transform = 'none';
      el.style.opacity = 1;
      el.classList.add('active', 'shown');
    }
  });

  set.el.classList.add('open');
  set.open = true;
}

function closeTrio(set, animate) {
  clearTimeout(set.timer);
  (set.spotTimers || []).forEach(clearTimeout);
  (set.revealTimers || []).forEach(clearTimeout);
  set.open = false;
  set.el.classList.remove('titled');
  const spot = set.el.classList.contains('spot');
  const geo = set.geo || trioGeometry(set.items.length);
  set.items.forEach((it, i) => {
    const g = spot ? set.spotGeo : geo[i], o = set.origins[i] || { x: g.x, y: g.y, r: 0 };
    it.el.classList.remove('active', 'shown');
    if (set.reveal) {   // zoom in: se esfuman en su lugar (la línea y el contorno también)
      it.el.style.transition = animate ? 'opacity .3s' : 'none';
      it.el.style.opacity = 0;
      it.shown = false;
      return;
    }
    it.el.style.transition = animate ? `transform ${TRIO_MS * 0.7}ms ${SPOT_EASE}` +
      (spot ? `, opacity .3s ${TRIO_MS * 0.55}ms` : '') : 'none';
    it.el.style.transform = dotTransform(o, g);
    if (spot) it.el.style.opacity = 0;
    it.spotOn = false;
  });
  set.timer = setTimeout(() => {
    if (set.open) return;
    set.el.classList.remove('open', 'spot', 'single');
    set.activeIdx = null;
    set.items.forEach(it => { it.el.style.opacity = ''; });
    if (!set.near) coolSet(set);   // si el trío sigue cerca, sus videos siguen calientes
  }, animate ? TRIO_MS * 0.7 : 0);
}

/* =========================================================
   RENDER
   ========================================================= */
function getSize() {
  const r = vis.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

// Rectángulo útil del gráfico: centrado en ancho, entre la barra de progreso
// y la zona de texto
function getBox(w, h) {
  const bw = Math.min(w - 2 * cssNum('--margin'), CHART_MAX_W);
  const top = cssNum('--chart-top');
  const bh = Math.max(120, textTop() - CHART_GAP - top);
  return { x: (w - bw) / 2, y: top, w: bw, h: bh };
}

// Opacidad de una línea de tendencia: si el paso destaca una (trendFocus),
// las demás quedan tenues
const TREND_DIM = 0.15;
const TREND_LIFT = 0.6;   // cuánto se bajan (hacia la base) las tendencias por género, en filas de puntos
/* =========================================================
   VIDEO DE LA PORTADA: de fondo, a pantalla completa y en blanco y negro,
   detrás de la palabra "OSCARS" hecha de puntos (que queda encima).
   ========================================================= */
// VIDEO ANTERIOR DE LA PORTADA (ya no se usa; se guarda por si se necesita):
// "Amazing Shots of CINEMA", https://www.youtube.com/watch?v=jb9daxcYYJk
// tramo de 5:00 a 10:00, en loop. Para volver a usarlo, en el primer paso de
// STEPS: { layout: 'wordOscars', color: 'word', introVideo: true }
const INTRO_VIDEO = { video: 'jb9daxcYYJk', start: 300, end: 600 };
const INTRO_DELAY_MS = 1100;   // espera a que los puntos lleguen a la palabra
const introEl = document.getElementById('intro-video');
const intro = { player: null, ready: false, wanted: false, timer: null, showTimer: null };

// Reproductor de YouTube de la portada (mismo "calentamiento" que los tríos:
// el video se muestra cuando lleva WARMUP_MS reproduciéndose, sin interfaz)
function initIntroPlayer() {
  if (intro.player || !introEl || !window.YT || !YT.Player) return;
  intro.player = new YT.Player('intro-player', {
    videoId: INTRO_VIDEO.video,
    playerVars: {
      start: INTRO_VIDEO.start, mute: 1, controls: 0, disablekb: 1,
      playsinline: 1, rel: 0, iv_load_policy: 3, modestbranding: 1, fs: 0
    },
    events: {
      onReady: e => {
        e.target.mute();
        intro.ready = true;
        if (intro.wanted) e.target.playVideo();
      },
      onStateChange: e => {
        const S = YT.PlayerState;
        console.info(`Portada: estado del video = ${e.data} (1 = reproduciendo, 3 = cargando, -1/5 = sin arrancar, 2 = pausa)`);
        clearTimeout(intro.showTimer);
        if (e.data === S.PLAYING) {
          if (!introEl.classList.contains('playing'))
            intro.showTimer = setTimeout(() => introEl.classList.add('playing'), WARMUP_MS);
        } else if (e.data !== S.BUFFERING) {
          introEl.classList.remove('playing');
        }
        // Loop: al terminar, vuelve al segundo de inicio
        if (e.data === S.ENDED && intro.wanted) {
          intro.player.seekTo(INTRO_VIDEO.start, true);
          intro.player.playVideo();
        }
      },
      // Si YouTube no deja reproducirlo, no se muestra su pantalla de error:
      // la portada queda con los puntos sobre el fondo oscuro
      onError: e => {
        console.warn(`Video de la portada no se puede reproducir: error ${e.data}`);
        intro.failed = true;
        introEl.classList.remove('playing');
      }
    }
  });
}

// Por si la API de YouTube cargó antes que este script (o todavía no cargó):
// se reintenta hasta que exista YT.Player
(function waitForYT() {
  if (window.YT && YT.Player) initIntroPlayer();
  else setTimeout(waitForYT, 300);
})();

// El video va de fondo a pantalla completa, detrás de la palabra de puntos
function showIntroVideo(L, animate) {
  if (!introEl) return;
  clearTimeout(intro.timer);
  intro.wanted = true;
  if (intro.ready) intro.player.playVideo();
  // Vigilante: si el navegador frenó la reproducción automática, reintenta
  clearInterval(intro.watch);
  intro.watch = setInterval(() => {
    if (!intro.wanted) return clearInterval(intro.watch);
    // Loop del tramo: al llegar al final, vuelve al inicio
    if (intro.ready && intro.player.getCurrentTime() >= INTRO_VIDEO.end - LOOP_LEAD)
      intro.player.seekTo(INTRO_VIDEO.start, true);
    const st = intro.ready ? intro.player.getPlayerState() : null;
    if (st === YT.PlayerState.UNSTARTED || st === YT.PlayerState.CUED || st === YT.PlayerState.PAUSED) {
      intro.player.mute();
      intro.player.playVideo();
    }
  }, 500);
  intro.timer = setTimeout(() => introEl.classList.add('on'), animate ? INTRO_DELAY_MS : 0);
  // Respaldo: si en unos segundos YouTube no confirmó que reproduce, el video
  // se muestra igual (mejor ver algo que una pantalla vacía)
  clearTimeout(intro.fallback);
  intro.fallback = setTimeout(() => {
    if (!intro.wanted || intro.failed) return;
    if (!introEl.classList.contains('playing'))
      console.warn('Portada: el video no confirmó la reproducción; se muestra igual.',
                   intro.player ? '' : '(El reproductor de YouTube no se creó.)');
    introEl.classList.add('playing');
  }, INTRO_DELAY_MS + 5000);
}

function hideIntroVideo() {
  if (!introEl || !intro.wanted) return;
  clearTimeout(intro.timer);
  intro.wanted = false;
  introEl.classList.remove('on');
  intro.timer = setTimeout(() => { if (intro.ready && !intro.wanted) intro.player.pauseVideo(); }, 1000);
}

/* =========================================================
   GRILLA DE VIDEO: entre la estatuilla y "Género", los puntos se agrandan hasta
   una grilla de puntos muy pequeños (uno por película) que cubre toda la pantalla, y cada punto
   es una ventana a un video en blanco y negro, con sonido (máscara CSS de
   círculos repetidos, alineada con los puntos).
   Los navegadores no dejan reproducir con sonido si la persona todavía no
   tocó la página (un clic o una tecla; el scroll no cuenta): en ese caso el
   video sigue en silencio.
   ========================================================= */
// El video es video/andtheoscargoesto.mp4 (elemento <video id="mask-player"> en index.html)
// Grilla de celdas CUADRADAS que cubre TODA la pantalla: puntos del tamaño de
// siempre (DOT_R) con MASK_GAP px de separación entre uno y otro, igual en
// horizontal y en vertical. Son miles de puntos: las 621 películas son puntos
// reales (con tooltip), repartidos por toda la grilla, y el resto de las
// celdas se dibuja con un patrón CSS liviano (#dot-grid, sin tooltip) que
// coincide exactamente con la grilla.
const MASK_GAP = 4;           // separación entre puntos (px): menos de 5
const MASK_DELAY_MS = 1300;   // espera a que los puntos lleguen a la grilla antes de mostrar el video
const MASK_DOTS_DELAY = 700;  // cuándo aparece el patrón de puntos de relleno
const dotGridEl = document.getElementById('dot-grid');
const MASK_PRELOAD = 2;       // cuántos pasos antes se empieza a reproducir (en silencio, oculto)
const maskEl = document.getElementById('mask-video');
const maskV = { player: null, ready: false, warm: false, on: false, loop: null, timer: null, showTimer: null };

// Celdas de la grilla en px de pantalla: lado, filas y desplazamiento vertical
function maskGeometry() {
  const cols = Math.max(1, Math.round(innerWidth / (2 * DOT_R + MASK_GAP)));
  const cell = innerWidth / cols;                 // de borde a borde de la pantalla
  const rows = Math.ceil(innerHeight / cell);     // las filas que hagan falta para cubrir todo el alto
  return { cell, cols, rows, oy: (innerHeight - rows * cell) / 2, r: DOT_R };
}

// Las películas, en orden cronológico, se reparten de forma pareja por toda
// la grilla (una cada tantas celdas); las demás celdas son el patrón de relleno
function videoGridLayout(data, w, h) {
  const L = gridLayout(data, w, h);
  const { cell, cols, rows, oy, r } = maskGeometry();
  const S = getSize(), box = getBox(S.w, S.h);   // el layout se dibuja relativo al área del gráfico
  const at = c => ({ x: (c % cols + 0.5) * cell - box.x, y: oy + (Math.floor(c / cols) + 0.5) * cell - box.y });
  const total = cols * rows, n = data.length;
  data.forEach((d, i) => L.pos.set(d.id, at(Math.floor((i + 0.5) * total / n))));
  L.r = r;
  return L;
}

/* PORTADA: la palabra OSCARS escrita con los mismos círculos de la grilla de
   video. Se pinta OSCARS en un canvas del tamaño de la pantalla y se toman las
   celdas de la grilla cuyo centro cae dentro de una letra. La grilla de video
   es la de siempre (cubre toda la pantalla); esas celdas se pintan de blanco
   encima del video (#dot-grid con la máscara --word-mask). */
// weight: grosor de la tipografía (más grueso = trazos de más celdas, curvas más limpias)
// cover: qué parte de una celda tiene que cubrir la letra para que se pinte
const OSCARS_GRID = { text: 'OSCARS', weight: 800, widthFrac: 0.84, heightFrac: 0.46, cy: 0.46, cover: 0.5 };
let oscarsCache = null;
function oscarsGridCells() {
  const key = `${innerWidth}x${innerHeight}`;
  if (oscarsCache && oscarsCache.key === key) return oscarsCache;
  const G = maskGeometry();
  const c = document.createElement('canvas');
  c.width = innerWidth; c.height = innerHeight;
  const ctx = c.getContext('2d');
  const fontAt = s => `${OSCARS_GRID.weight} ${s}px Outfit`;
  ctx.font = fontAt(400);
  let m = ctx.measureText(OSCARS_GRID.text);
  const size = 400 * Math.min(innerWidth * OSCARS_GRID.widthFrac / m.width,
    innerHeight * OSCARS_GRID.heightFrac / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent));
  ctx.font = fontAt(size);
  m = ctx.measureText(OSCARS_GRID.text);
  ctx.textAlign = 'center';
  const th = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  ctx.fillText(OSCARS_GRID.text, innerWidth / 2, innerHeight * OSCARS_GRID.cy - th / 2 + m.actualBoundingBoxAscent);
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  // Cada celda entra si la letra cubre al menos OSCARS_GRID.cover de su área
  // (no solo su centro): así las curvas (C, S) y los trazos finos quedan
  // parejos en la grilla, sin dientes ni huecos
  const cells = [];
  for (let row = 0; row < G.rows; row++)
    for (let col = 0; col < G.cols; col++) {
      const cx0 = Math.round(col * G.cell), cy0 = Math.round(G.oy + row * G.cell);
      const cx1 = Math.min(c.width, Math.round((col + 1) * G.cell));
      const cy1 = Math.min(c.height, Math.round(G.oy + (row + 1) * G.cell));
      if (cx0 < 0 || cy0 < 0 || cx1 <= cx0 || cy1 <= cy0) continue;
      let on = 0;
      for (let yy = cy0; yy < cy1; yy++)
        for (let xx = cx0; xx < cx1; xx++) on += img[(yy * c.width + xx) * 4 + 3] > 128;
      if (on / ((cx1 - cx0) * (cy1 - cy0)) >= OSCARS_GRID.cover)
        cells.push({ x: (col + 0.5) * G.cell, y: G.oy + (row + 0.5) * G.cell });
    }
  // Máscara: un círculo por celda de la palabra (a la densidad de la pantalla)
  const dpr = window.devicePixelRatio || 1;
  const mc = document.createElement('canvas');
  mc.width = Math.round(innerWidth * dpr); mc.height = Math.round(innerHeight * dpr);
  const mx = mc.getContext('2d');
  mx.scale(dpr, dpr);
  mx.fillStyle = '#000';
  cells.forEach(p => { mx.beginPath(); mx.arc(p.x, p.y, G.r + 0.5, 0, 2 * Math.PI); mx.fill(); });
  return oscarsCache = { key, cells, G, mask: `url(${mc.toDataURL()})` };
}

// Las películas se reparten de forma pareja por las celdas de la palabra
// (quedan debajo del video); las que sobran se ocultan
function oscarsGridLayout(data, w, h) {
  const L = gridLayout(data, w, h);
  const { cells, G } = oscarsGridCells();
  const S = getSize(), box = getBox(S.w, S.h);   // el layout se dibuja relativo al área del gráfico
  const n = data.length, nc = cells.length;
  L.hidden = new Set();
  if (!nc) return L;
  data.forEach((d, i) => {
    const p = n <= nc ? cells[Math.floor((i + 0.5) * nc / n)] : cells[i % nc];
    L.pos.set(d.id, { x: p.x - box.x, y: p.y - box.y });
    if (i >= nc) L.hidden.add(d.id);
  });
  L.r = G.r;
  return L;
}

// Video local (en blanco y negro con CSS). Solo se reproduce el tramo
// MASK_CLIP (en segundos), en loop: al llegar al final vuelve al inicio
const MASK_CLIP = { start: 13.3, end: 26.9 };   // 0:13,3 a 0:26,9
const maskVideoEl = document.getElementById('mask-player');
maskVideoEl.loop = false;   // el loop lo maneja MASK_CLIP
const toClipStart = () => { maskVideoEl.currentTime = MASK_CLIP.start; };
maskVideoEl.addEventListener('loadedmetadata', () => {
  if (maskVideoEl.currentTime < MASK_CLIP.start) toClipStart();
});
maskVideoEl.addEventListener('ended', () => { toClipStart(); if (maskV.warm) playMask(); });
setInterval(() => {
  if (maskVideoEl.paused) return;
  const t = maskVideoEl.currentTime;
  if (t >= MASK_CLIP.end || t < MASK_CLIP.start - 0.5) toClipStart();
}, 100);

maskVideoEl.addEventListener('playing', () => maskEl.classList.add('playing'));
maskVideoEl.addEventListener('error', () =>
  console.warn(`Grilla de video: no se pudo cargar ${maskVideoEl.currentSrc || maskVideoEl.src}`));

// Reproduce; si el navegador no deja hacerlo con sonido, sigue en silencio
function playMask() {
  const p = maskVideoEl.play();
  if (p && p.catch) p.catch(() => {
    if (maskVideoEl.muted) return;
    maskVideoEl.muted = true;
    maskVideoEl.play().catch(() => {});
  });
}
function warmMask() {   // precarga: reproduce en silencio y oculto
  if (maskV.warm) return;
  maskV.warm = true;
  maskVideoEl.muted = true;
  playMask();
}
function coolMask() {
  if (!maskV.warm) return;
  maskV.warm = false;
  maskVideoEl.pause();
  maskVideoEl.muted = true;
}

// word = true: portada (el video solo se ve en las celdas de la palabra OSCARS)
function showMaskVideo(animate, word = false) {
  if (!maskEl) return;
  const { cell, oy, r } = maskGeometry();
  // La grilla de video es la de siempre; en la portada, además, los círculos
  // de la palabra OSCARS se pintan de blanco encima del video (#dot-grid.word)
  dotGridEl.classList.toggle('word', word);
  maskEl.classList.toggle('dark', word);   // en la portada el video va más oscuro (contraste con el título)
  if (word) {
    const { mask } = oscarsGridCells();
    dotGridEl.style.setProperty('--word-mask', mask);
  }
  // La máscara del video y el patrón de puntos de relleno usan la misma grilla
  [maskEl, dotGridEl].forEach(el => {
    el.style.setProperty('--cell', cell + 'px');
    el.style.setProperty('--oy', oy + 'px');
  });
  maskEl.style.setProperty('--mr', (r + 0.5) + 'px');   // apenas más grande que el punto: lo tapa justo
  dotGridEl.style.setProperty('--mr', (word ? r + 0.5 : r) + 'px');   // en la portada tapa justo el círculo de video
  const entering = !maskV.on;
  clearTimeout(maskV.dotsTimer);
  maskV.dotsTimer = setTimeout(() => dotGridEl.classList.add('on'), animate && entering ? MASK_DOTS_DELAY : 0);
  maskV.on = true;
  maskV.warm = true;
  if (entering) {
    toClipStart();   // al entrar, desde el inicio del tramo
    // Con sonido si el navegador lo permite (la persona ya hizo clic o tocó
    // una tecla en la página); si no, en silencio
    const canSound = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
    maskVideoEl.muted = !canSound;
    maskVideoEl.volume = 1;
    playMask();
  }
  updateSoundBtn();
  clearTimeout(maskV.timer);
  maskV.timer = setTimeout(() => maskEl.classList.add('on'), animate && entering ? MASK_DELAY_MS : 0);
}

/* PRIMERA Y ÚLTIMA GANADORA (step.split = { films, idx }): la pantalla se divide
   en dos mitades (sin línea visible). A la izquierda, una línea de tiempo con el
   año (el actual en blanco; los vecinos tenues y difuminados hacia los bordes) y
   debajo "El primer/último Óscar" en amarillo ganador, título y descripción; a
   la derecha, el póster. Una película por paso. Al pasar de una a otra:
   - la línea de tiempo se desliza en horizontal, en su lugar
   - el texto no se mueve: cambia con un fundido
   - los pósters cambian en vertical: el actual sube y se esfuma, y el nuevo
     surge desde abajo
   La línea de tiempo no tiene todos los años: los SPLIT_EDGE_YEARS primeros y
   últimos, y entre ellos un tramo punteado (la omisión). */
const SPLIT_YEAR_GAP = 280;    // distancia entre años de la línea de tiempo (px)
const SPLIT_EDGE_YEARS = 3;    // años que se muestran en cada punta (1927 1928 1929 ··· 2023 2024 2025)
const SPLIT_SLIDE_MS = 1600;   // duración del deslizamiento de la línea de tiempo
const SPLIT_DELAY_MS = 600;    // al entrar: espera a que los puntos se esfumen
const splitEl = document.getElementById('split');
const split = { on: false, films: null, idx: -1, timer: null, pos: null, players: [], ready: [], fadeTimer: null, watch: null };
const SPLIT_POSTER_HOLD_MS = 2500;   // con video de fondo (bgVideo): cuánto se ve el póster antes de desvanecerse

function buildSplit(films) {
  const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const y0 = +films[0].year, y1 = +films[films.length - 1].year;
  // Años visibles: las puntas, y un hueco (omisión) en el medio si hace falta
  const head = d3.range(y0, Math.min(y0 + SPLIT_EDGE_YEARS, y1 + 1));
  const tail = d3.range(Math.max(y1 - SPLIT_EDGE_YEARS + 1, head[head.length - 1] + 1), y1 + 1);
  const gapped = tail.length && tail[0] > head[head.length - 1] + 1;
  const slots = [...head, ...(gapped ? [null] : []), ...tail];   // null = la omisión
  split.pos = new Map(slots.map((y, i) => [y, i * SPLIT_YEAR_GAP]).filter(([y]) => y != null));
  const X = i => i * SPLIT_YEAR_GAP;
  const years = slots.map((y, i) => y == null ? '' :
    `<span class="split-tl-year" data-year="${y}" style="left:${X(i)}px">${y}</span>`).join('');
  // Línea: continua en las puntas y punteada en la omisión
  const hEnd = X(head.length - 1), tStart = X(slots.length - tail.length);
  const lines = gapped
    ? `<span class="split-tl-line" style="left:0;width:${hEnd}px"></span>` +
      `<span class="split-tl-line gap" style="left:${hEnd}px;width:${tStart - hEnd}px"></span>` +
      `<span class="split-tl-line" style="left:${tStart}px;width:${X(slots.length - 1) - tStart}px"></span>`
    : `<span class="split-tl-line" style="left:0;width:${X(slots.length - 1)}px"></span>`;
  splitEl.querySelector('.split-tl-track').innerHTML = years + lines;
  // Textos (uno encima del otro, en el mismo lugar) y pósters
  splitEl.querySelector('.split-texts').innerHTML = films.map(f =>
    `<div class="split-text"><p class="split-label">${esc(f.label)}</p><h3>${esc(f.title)}</h3>` +
    `<p class="split-desc">${esc(glueLast(f.caption || ''))}</p></div>`).join('');
  splitEl.querySelector('.split-posters').innerHTML = films.map(f =>
    `<div class="split-poster"><img src="${esc(f.poster)}" alt="Póster de ${esc(f.title)}"></div>`).join('');
  // Videos de fondo (bgVideo): mitad derecha, debajo del póster
  splitEl.querySelector('.split-bgvideos').innerHTML = films.map((f, i) =>
    `<div class="split-bgvideo">${f.bgVideo ? `<div id="split-bg-${i}"></div>` : ''}</div>`).join('');
  split.players = []; split.ready = [];
  initSplitBg(films);
}

// Lleva todo a la película idx (con o sin animación)
function placeSplit(idx, animate) {
  const year = +split.films[idx].year;
  splitEl.classList.toggle('instant', !animate);
  splitEl.style.setProperty('--slide-ms', SPLIT_SLIDE_MS + 'ms');
  splitEl.querySelector('.split-tl-track').style.transform =
    `translateX(${innerWidth / 4 - split.pos.get(year)}px)`;   // el año actual, en el centro de la mitad izquierda
  splitEl.querySelectorAll('.split-tl-year').forEach(el => el.classList.toggle('cur', +el.dataset.year === year));
  // Textos: solo el actual visible. Pósters: los anteriores arriba, los siguientes abajo
  splitEl.querySelectorAll('.split-text').forEach((el, i) => el.classList.toggle('cur', i === idx));
  splitEl.querySelectorAll('.split-bgvideo').forEach((el, i) => el.classList.toggle('cur', i === idx));
  splitEl.querySelectorAll('.split-poster').forEach((el, i) => {
    el.classList.toggle('cur', i === idx);
    el.classList.toggle('before', i < idx);
    el.classList.toggle('after', i > idx);
  });
  if (!animate) { splitEl.offsetWidth; requestAnimationFrame(() => splitEl.classList.remove("instant")); }   // sin animación: se aplica y se vuelven a activar las transiciones
  split.idx = idx;
  playSplitBg();
}

function showSplit(cfg, animate) {
  if (!splitEl) return;
  if (split.films !== cfg.films) { split.films = cfg.films; buildSplit(cfg.films); split.idx = -1; }
  const entering = !split.on;
  split.on = true;
  // Al entrar se ubica sin animación; entre películas, se anima
  if (entering || split.idx === -1) placeSplit(cfg.idx, false);
  else if (split.idx !== cfg.idx) placeSplit(cfg.idx, animate);
  clearTimeout(split.timer);
  if (entering) split.timer = setTimeout(() => splitEl.classList.add('on'), animate ? SPLIT_DELAY_MS : 0);
  if (entering) sizeSplitBg();   // máscara de puntos del video de fondo y tamaño del video
  if (entering || split.posterIdx !== cfg.idx) schedulePosterFade(cfg.idx, (entering && animate ? SPLIT_DELAY_MS : 0) + (entering ? 0 : 400));
}

function hideSplit() {
  if (!splitEl || !split.on) return;
  split.on = false;
  clearTimeout(split.timer);
  splitEl.classList.remove('on');
  clearTimeout(split.fadeTimer);
  split.posterIdx = -1;
  setTimeout(() => { if (!split.on) splitEl.querySelectorAll('.split-poster').forEach(el => el.classList.remove('faded')); }, 800);
  playSplitBg();   // fuera del paso: se pausan
}
addEventListener('resize', () => { if (split.on) { placeSplit(split.idx, false); sizeSplitBg(); } });

// Póster encima del video de fondo: se ve un rato y se desvanece (solo si la película tiene bgVideo)
function schedulePosterFade(idx, delay) {
  clearTimeout(split.fadeTimer);
  split.posterIdx = idx;
  splitEl.querySelectorAll('.split-poster').forEach(el => el.classList.remove('faded'));
  if (!split.films[idx].bgVideo) return;
  const poster = splitEl.querySelectorAll('.split-poster')[idx];
  split.fadeTimer = setTimeout(() => poster.classList.add('faded'), delay + SPLIT_POSTER_HOLD_MS);
}

// Reproductores de YouTube de los videos de fondo (en silencio, en loop del tramo)
function initSplitBg(films) {
  if (!window.YT || !YT.Player) { setTimeout(() => initSplitBg(films), 300); return; }
  films.forEach((f, i) => {
    if (!f.bgVideo || split.players[i]) return;
    const v = f.bgVideo;
    split.players[i] = new YT.Player(`split-bg-${i}`, {
      videoId: v.video,
      playerVars: { start: v.start, mute: 1, controls: 0, disablekb: 1, playsinline: 1,
                    rel: 0, iv_load_policy: 3, modestbranding: 1, fs: 0 },
      events: {
        onReady: e => { e.target.mute(); split.ready[i] = true; sizeSplitBg(); playSplitBg(); },
        onStateChange: e => {
          const box = splitEl.querySelectorAll('.split-bgvideo')[i];
          if (e.data === YT.PlayerState.PLAYING) {
            try { e.target.setPlaybackQuality('hd1080'); } catch (_) {}
            setTimeout(() => box.classList.add('playing'), WARMUP_MS);   // sin la interfaz de YouTube
          }
          if (e.data === YT.PlayerState.ENDED) { e.target.seekTo(v.start, true); e.target.playVideo(); }
        },
        onError: e => console.warn(`Pantalla dividida: el video ${v.video} no se puede reproducir (error ${e.data})`)
      }
    });
  });
}

// El video cubre toda la mitad derecha sin deformarse (16:9 recortado)
/* Borde del video de fondo hecho con la grilla de puntos de la portada (misma
   celda y radio, alineada con la pantalla). A la derecha el video es entero; en
   la franja SPLIT_BG_FADE (del lado del centro de la pantalla) se ve a través
   de puntos que primero se achican hasta el tamaño de siempre y después son
   cada vez menos (se eligen al azar, siempre los mismos) hasta no quedar ninguno. */
const SPLIT_BG_FADE = 0.35;   // ancho de la franja de puntos, en fracción de la mitad derecha
const SPLIT_BG_SHRINK = 0.3;  // parte de la franja (del lado del video) donde los puntos se achican
let splitBgMaskKey = '';
function splitBgMask() {
  const W = Math.ceil(innerWidth / 2), H = innerHeight, x0 = innerWidth / 2;
  const key = W + 'x' + H;
  if (key === splitBgMaskKey) return;
  splitBgMaskKey = key;
  const { cell, oy, r } = maskGeometry();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#fff';
  const fadeW = W * SPLIT_BG_FADE;
  ctx.fillRect(fadeW, 0, W - fadeW, H);   // el video entero
  const rand = (c, k) => { const s = Math.sin(c * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
  const full = cell * 0.75;   // radio que cubre la celda entera (empalma con el video entero)
  const rows = Math.ceil(H / cell) + 1, c0 = Math.floor(x0 / cell), c1 = Math.ceil((x0 + fadeW) / cell);
  for (let c = c0; c <= c1; c++) {
    const cx = (c + 0.5) * cell - x0;   // en la grilla de la pantalla
    if (cx < -cell || cx > fadeW + cell) continue;
    const t = Math.min(1, Math.max(0, cx / fadeW));   // 0 = centro de la pantalla, 1 = video entero
    const s = SPLIT_BG_SHRINK;
    const rad = t > 1 - s ? (r + 0.5) + (full - r - 0.5) * ((t - (1 - s)) / s) : r + 0.5;
    const density = Math.min(1, t / (1 - s));   // cantidad de puntos: de 0 a todos
    for (let k = -1; k < rows; k++) {
      if (rand(c, k) >= density * density) continue;   // cada vez menos hacia el centro
      ctx.beginPath();
      ctx.arc(cx, oy + (k + 0.5) * cell, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  splitEl.style.setProperty('--bg-dots', `url(${cv.toDataURL()})`);
  splitEl.style.setProperty('--bg-left', '50vw'); splitEl.style.setProperty('--bg-w', '50vw'); splitDotsKey = '';
}

/* Video de fondo de la pantalla dividida: todo visto a través de la grilla de
   puntos de la portada (misma celda y radio, alineada con la pantalla). La
   mitad de la película queda entera en puntos; el video se pasa un poco del
   centro hacia la izquierda (SPLIT_BG_EXT columnas) y en esas columnas la
   opacidad de los puntos baja de columna en columna hasta desaparecer.
   (Alternativa desactivada: SPLIT_BG_DOT_EDGE = true, puntos que se ralean
   dentro de la mitad derecha, splitBgMask) */
const SPLIT_BG_DOT_EDGE = false;
const SPLIT_BG_EXT = 6;   // columnas de puntos que se pasan del centro (la transición)
let splitDotsKey = '';   // (sin uso: la máscara se guarda en dotsMaskCache)
// Máscara de puntos para un video que ocupa una mitad de la pantalla (side:
// 'right' o 'left') y se pasa SPLIT_BG_EXT columnas del centro hacia el otro
// lado, donde los puntos pierden opacidad columna a columna. Devuelve el borde
// izquierdo (x0), el ancho (W) y la imagen de la máscara (url).
const dotsMaskCache = {};
function halfDotsMask(side) {
  const { cell, oy, r } = maskGeometry();
  const ext = SPLIT_BG_EXT * cell, mid = innerWidth / 2;
  const x0 = side === 'right' ? mid - ext : 0;
  const W = Math.ceil(side === 'right' ? innerWidth - x0 : mid + ext), H = innerHeight;
  const key = side + W + 'x' + H;
  if (!dotsMaskCache[key]) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const rows = Math.ceil(H / cell) + 1;
    for (let c = Math.floor(x0 / cell - 0.5); (c + 0.5) * cell < x0 + W + cell; c++) {
      const sx = (c + 0.5) * cell;                  // x del punto en la pantalla
      // Del lado del video: opacidad plena; pasado el centro, baja columna a columna
      const k = Math.ceil((side === 'right' ? mid - sx : sx - mid) / cell);
      const a = k <= 0 ? 1 : Math.max(0, 1 - k / (SPLIT_BG_EXT + 1));
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      for (let j = -1; j < rows; j++) {
        ctx.beginPath();
        ctx.arc(sx - x0, oy + (j + 0.5) * cell, r + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    dotsMaskCache[key] = `url(${cv.toDataURL()})`;
  }
  return { x0, W, url: dotsMaskCache[key] };
}

function splitDotsMask() {
  const m = halfDotsMask('right');
  splitEl.style.setProperty('--bg-left', m.x0 + 'px');
  splitEl.style.setProperty('--bg-w', m.W + 'px');
  splitEl.style.setProperty('--bg-dots', m.url);
}

function sizeSplitBg() {
  if (SPLIT_BG_DOT_EDGE) splitBgMask(); else splitDotsMask();
  const W = SPLIT_BG_DOT_EDGE ? innerWidth / 2 : innerWidth / 2 + SPLIT_BG_EXT * maskGeometry().cell, H = innerHeight;
  const vw = Math.max(W, H * 16 / 9), vh = vw * 9 / 16;
  splitEl.querySelectorAll('.split-bgvideo iframe').forEach(f => Object.assign(f.style, {
    width: vw + 'px', height: vh + 'px', left: (W - vw) / 2 + 'px', top: (H - vh) / 2 + 'px'
  }));
}

// Solo se reproduce el video de la película a la vista (y solo en el paso)
function playSplitBg() {
  clearInterval(split.watch);
  split.players.forEach((p, i) => {
    if (!p || !split.ready[i]) return;
    const want = split.on && split.idx === i;
    if (want) { p.mute(); p.playVideo(); } else p.pauseVideo();
  });
  if (!split.on) return;
  // Loop del tramo y reintento si el navegador frenó la reproducción
  split.watch = setInterval(() => {
    const i = split.idx, p = split.players[i], f = split.films && split.films[i];
    if (!p || !split.ready[i] || !f || !f.bgVideo) return;
    if (p.getCurrentTime() >= f.bgVideo.end - LOOP_LEAD || p.getCurrentTime() < f.bgVideo.start - 2) p.seekTo(f.bgVideo.start, true);
    const st = p.getPlayerState();
    if (st === YT.PlayerState.UNSTARTED || st === YT.PlayerState.CUED || st === YT.PlayerState.PAUSED) { p.mute(); p.playVideo(); }
  }, 1000);
}

/* VIDEO A MEDIA PANTALLA (step.bigCircle = cfg de una película; p. ej. el sobre
   equivocado de Moonlight): el mismo tratamiento que los videos de Wings y One
   Battle After Another, pero del lado izquierdo. El video ocupa la mitad
   izquierda, visto a través de la grilla de puntos de la portada, y se pasa un
   poco del centro con los puntos perdiendo opacidad (halfDotsMask). A la
   derecha, el texto (etiqueta, título y descripción). Con sonido. */
const bigEl = document.getElementById('big-circle');
const big = { on: false, cfg: null, player: null, ready: false, watch: null, timer: null };

// Tamaño y máscara: el video cubre su área sin deformarse (16:9 recortado)
function sizeBig() {
  const box = bigEl.querySelector('.bc-video');
  if (!box) return;
  const m = halfDotsMask(big.cfg && big.cfg.side === 'right' ? 'right' : 'left');   // side: de qué lado va el video
  Object.assign(box.style, { left: m.x0 + 'px', width: m.W + 'px' });
  box.style.setProperty('--bc-dots', m.url);
  const f = box.querySelector('iframe');
  if (f) {
    const W = m.W, H = innerHeight, vw = Math.max(W, H * 16 / 9), vh = vw * 9 / 16;
    Object.assign(f.style, { width: vw + 'px', height: vh + 'px', left: (W - vw) / 2 + 'px', top: (H - vh) / 2 + 'px' });
  }
}

function buildBig(cfg) {
  const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  bigEl.innerHTML = `<div class="bc-video"><div id="bc-player"></div></div>` +
    `<div class="bc-text"><p class="split-label"${cfg.labelColor ? ` style="color:${cfg.labelColor}"` : ''}>${esc(cfg.label)}</p><h3>${esc(cfg.title)}</h3>` +
    `<p class="split-desc">${esc(glueLast(cfg.caption || ''))}</p></div>`;
  big.cfg = cfg; big.player = null; big.ready = false;
  bigEl.dataset.side = cfg.side === 'right' ? 'right' : 'left';   // CSS: el texto del otro lado
  bigEl.classList.remove("playing");   // el video nuevo se muestra recién cuando reproduce
  sizeBig();
  const init = () => {
    if (!window.YT || !YT.Player) return setTimeout(init, 300);
    big.player = new YT.Player('bc-player', {
      videoId: cfg.video,
      playerVars: { start: cfg.start, mute: 1, controls: 0, disablekb: 1, playsinline: 1,
                    rel: 0, iv_load_policy: 3, modestbranding: 1, fs: 0 },
      events: {
        onReady: e => { big.ready = true; e.target.mute(); sizeBig(); if (big.on) playBig(); },
        onStateChange: e => {
          if (e.data === YT.PlayerState.PLAYING) setTimeout(() => bigEl.classList.add('playing'), WARMUP_MS);
          if (e.data === YT.PlayerState.ENDED && big.on) { e.target.seekTo(cfg.start, true); e.target.playVideo(); }
        },
        onError: e => console.warn(`Video a media pantalla: ${cfg.video} no se puede reproducir (error ${e.data})`)
      }
    });
  };
  init();
}

// Con sonido si el navegador lo permite (la persona ya hizo clic o tocó una tecla)
// cfg.clips (segundos): en vez de un tramo fijo, saltos a pedazos al azar del video
// (entre start y end), de cfg.clips segundos cada uno
const randomClipStart = cfg => cfg.start + Math.random() * Math.max(0, cfg.end - cfg.start - cfg.clips);
function playBig() {
  if (!big.ready) return;
  const p = big.player, cfg = big.cfg;
  big.segEnd = null;
  if (cfg.clips) { const s = randomClipStart(cfg); p.seekTo(s, true); big.segEnd = s + cfg.clips; }
  else p.seekTo(cfg.start, true);
  const canSound = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
  if (canSound) { p.unMute(); p.setVolume(100); } else p.mute();
  p.playVideo();
  clearInterval(big.watch);
  big.watch = setInterval(() => {
    if (!big.on || !big.ready) return;
    if (cfg.clips) {
      if (p.getCurrentTime() >= big.segEnd) { const s = randomClipStart(cfg); p.seekTo(s, true); big.segEnd = s + cfg.clips; }
    } else if (p.getCurrentTime() >= cfg.end - LOOP_LEAD) p.seekTo(cfg.start, true);
    const st = p.getPlayerState();
    if (st === YT.PlayerState.UNSTARTED || st === YT.PlayerState.CUED || st === YT.PlayerState.PAUSED) p.playVideo();
  }, 1000);
}

// delay: espera extra antes de aparecer (p. ej. mientras la tira de pósters vuelve)
function showBigCircle(cfg, animate, delay = 0) {
  if (!bigEl) return;
  if (big.cfg !== cfg) buildBig(cfg);
  sizeBig();
  if (big.on) return;
  big.on = true;
  clearTimeout(big.timer);
  big.timer = setTimeout(() => {
    bigEl.classList.add('on');
    big.timer = setTimeout(() => bigEl.classList.add('text-on'), animate ? 600 : 0);
  }, animate ? 500 + delay : 0);
  playBig();
}

function hideBigCircle() {
  if (!bigEl || !big.on) return;
  big.on = false;
  clearTimeout(big.timer);
  clearInterval(big.watch);
  bigEl.classList.remove('on', 'text-on');
  if (big.ready) { big.player.mute(); big.player.pauseVideo(); }
}
addEventListener('resize', () => { if (big.on) sizeBig(); });

/* TIRA DE PÓSTERS (step.posterStrip = lista de imágenes): debajo del bloque, los
   pósters pasan solos en horizontal, en loop continuo (la lista va dos veces y
   la animación CSS corre media tira). Los bordes de la pantalla se difuminan. */
const POSTER_STRIP_SPEED = 45;   // px por segundo
const stripEl = document.getElementById('poster-strip');
const strip = { on: false, list: null, timer: null };

// focus (índice): la tira deja de pasar sola y vuelve hasta ese póster, que queda
// en el centro (los demás se apagan); después de STRIP_FOCUS_MS la tira se esfuma
const STRIP_FOCUS_MS = 1500;
function showPosterStrip(list, cy, D, animate, focus = null) {
  if (!stripEl) return;
  const h = Math.max(140, Math.min(D * 1.15, innerHeight * 0.36));   // alto de los pósters
  strip.h = h; strip.cy = cy;   // (los usa el texto que va arriba de la tira)
  stripEl.style.setProperty('--ph', h + 'px');
  stripEl.style.top = cy + 'px';
  if (strip.list !== list) {
    strip.list = list;
    const imgs = list.map(src => `<img src="${src}" alt="" loading="eager">`).join('');
    stripEl.innerHTML = `<div class="ps-track">${imgs}${imgs}</div>`;
  }
  // Duración según el largo real de la tira (misma velocidad en cualquier pantalla)
  const track = stripEl.querySelector('.ps-track');
  const setDur = () => track.style.setProperty('--ps-dur', Math.max(10, track.scrollWidth / 2 / POSTER_STRIP_SPEED) + 's');
  setDur();
  track.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', setDur, { once: true }); });
  clearTimeout(strip.timer);
  if (focus != null) { focusPosterStrip(track, focus, animate); return; }
  // Sin foco: vuelve a pasar sola (si venía de un foco, desde el principio)
  if (track.classList.contains('focused')) {
    track.classList.remove('focused');
    track.style.transition = ''; track.style.transform = '';
    track.querySelectorAll('img').forEach(img => img.classList.remove('target'));
  }
  if (strip.on && stripEl.classList.contains('on')) return;
  strip.on = true;
  strip.timer = setTimeout(() => stripEl.classList.add('on'), animate ? 700 : 0);
}

// Detiene la tira donde está y la lleva hasta el póster `idx` (la copia más cercana)
function focusPosterStrip(track, idx, animate) {
  const n = strip.list.length, imgs = [...track.querySelectorAll('img')];
  const m = getComputedStyle(track).transform;
  const cur = m && m !== 'none' ? new DOMMatrixReadOnly(m).m41 : 0;   // dónde iba la tira
  const center = el => innerWidth / 2 - (el.offsetLeft + el.offsetWidth / 2);
  const target = [imgs[idx], imgs[idx + n]].filter(Boolean)
    .reduce((a, b) => Math.abs(center(b) - cur) < Math.abs(center(a) - cur) ? b : a);
  imgs.forEach(img => img.classList.toggle('target', img === target));
  track.classList.add('focused');   // sin animación CSS: queda donde iba
  track.style.transition = 'none';
  track.style.transform = `translateX(${cur}px)`;
  track.getBoundingClientRect();
  track.style.transition = animate ? 'transform 1.1s cubic-bezier(.65, 0, .35, 1)' : 'none';
  track.style.transform = `translateX(${center(target)}px)`;
  strip.on = true;
  stripEl.classList.add('on');
  // Después de llegar, la tira se esfuma (deja lugar a la instancia de la película)
  strip.timer = setTimeout(() => stripEl.classList.remove('on'), animate ? STRIP_FOCUS_MS : 0);
}

function hidePosterStrip() {
  if (!stripEl || !strip.on) return;
  strip.on = false;
  clearTimeout(strip.timer);
  stripEl.classList.remove('on');
}

/* CIERRE ----------------------------------------------------------------
   La fórmula (step.formulaNote): a la izquierda, las líneas de la tarjeta
   (género, duración, estudio) en amarillo y grandes, centradas en la altura
   de la estatuilla (que va a la derecha). */
const formulaEl = document.getElementById('formula-note');
let formulaTimer = null;
function showFormulaNote(src, cy, delay) {
  if (!formulaEl || !src) return;
  clearTimeout(formulaTimer);
  if (formulaEl.dataset.html !== src.innerHTML) { formulaEl.innerHTML = src.innerHTML; formulaEl.dataset.html = src.innerHTML; }
  formulaEl.style.top = cy + 'px';
  formulaTimer = setTimeout(() => formulaEl.classList.add('on'), delay);
}
function hideFormulaNote() {
  if (!formulaEl) return;
  clearTimeout(formulaTimer);
  formulaEl.classList.remove('on');
}

/* Cuenta regresiva a la próxima ceremonia (step.countdown): días, horas,
   minutos y segundos, en amarillo, se actualiza cada segundo. */
// 99.ª ceremonia: domingo 14 de marzo de 2027, 16 h en Los Ángeles
const OSCARS_NEXT = { date: '2027-03-14T16:00:00-07:00', name: 'la 99.ª ceremonia de los Óscar', when: '14 de marzo de 2027' };
const countEl = document.getElementById('countdown');
const countdown = { on: false, tick: null, timer: null };
function renderCountdown() {
  const ms = Math.max(0, new Date(OSCARS_NEXT.date) - Date.now());
  const s = Math.floor(ms / 1000), pad = n => String(n).padStart(2, '0');
  const parts = [[Math.floor(s / 86400), 'días'], [pad(Math.floor(s / 3600) % 24), 'horas'],
                 [pad(Math.floor(s / 60) % 60), 'min'], [pad(s % 60), 'seg']];
  countEl.querySelector('.cd-clock').innerHTML = parts.map(([v, u]) =>
    `<span class="cd-part"><span class="cd-num">${v}</span><span class="cd-unit">${u}</span></span>`).join('<span class="cd-sep">:</span>');
}
function showCountdown(animate) {
  if (!countEl) return;
  if (!countEl.innerHTML.trim())
    countEl.innerHTML = `<p class="cd-label">Faltan para ${OSCARS_NEXT.name}</p><div class="cd-clock"></div><p class="cd-when">${OSCARS_NEXT.when}</p>`;
  renderCountdown();
  if (countdown.on) return;
  countdown.on = true;
  clearInterval(countdown.tick);
  countdown.tick = setInterval(renderCountdown, 1000);
  clearTimeout(countdown.timer);
  countdown.timer = setTimeout(() => countEl.classList.add('on'), animate ? 700 : 0);
}
function hideCountdown() {
  if (!countEl || !countdown.on) return;
  countdown.on = false;
  clearInterval(countdown.tick);
  clearTimeout(countdown.timer);
  countEl.classList.remove('on');
}

/* Video final (step.outro): el video que estaba detrás de OSCARS en la portada
   (INTRO_VIDEO), a pantalla completa y en blanco y negro, visto a través de la
   grilla de puntos (la misma del video de la portada). dim: más oscuro, para
   leer las fuentes y los créditos encima. */
const outroEl = document.getElementById('outro-video');
const outro = { on: false, player: null, ready: false, watch: null, timer: null };
function sizeOutro() {
  const { cell, oy, r } = maskGeometry();
  outroEl.style.setProperty('--cell', cell + 'px');
  outroEl.style.setProperty('--oy', oy + 'px');
  outroEl.style.setProperty('--mr', (r + 0.5) + 'px');
  const f = outroEl.querySelector('iframe');
  if (f) {
    const vw = Math.max(innerWidth, innerHeight * 16 / 9), vh = vw * 9 / 16;
    Object.assign(f.style, { width: vw + 'px', height: vh + 'px', left: (innerWidth - vw) / 2 + 'px', top: (innerHeight - vh) / 2 + 'px' });
  }
}
function initOutro() {
  if (outro.player || !outroEl) return;
  if (!window.YT || !YT.Player) { setTimeout(initOutro, 300); return; }
  outroEl.innerHTML = '<div id="outro-player"></div>';
  outro.player = new YT.Player('outro-player', {
    videoId: INTRO_VIDEO.video,
    playerVars: { start: INTRO_VIDEO.start, mute: 1, controls: 0, disablekb: 1, playsinline: 1,
                  rel: 0, iv_load_policy: 3, modestbranding: 1, fs: 0 },
    events: {
      onReady: e => { outro.ready = true; e.target.mute(); sizeOutro(); if (outro.on) e.target.playVideo(); },
      onStateChange: e => {
        if (e.data === YT.PlayerState.PLAYING) setTimeout(() => outroEl.classList.add('playing'), WARMUP_MS);
        if (e.data === YT.PlayerState.ENDED && outro.on) { e.target.seekTo(INTRO_VIDEO.start, true); e.target.playVideo(); }
      },
      onError: e => console.warn(`Video del cierre: no se puede reproducir (error ${e.data})`)
    }
  });
}
function showOutro(animate, dim) {
  if (!outroEl) return;
  initOutro();
  sizeOutro();
  outroEl.classList.toggle('dim', dim);
  if (outro.on) return;
  outro.on = true;
  if (outro.ready) { outro.player.mute(); outro.player.playVideo(); }
  clearInterval(outro.watch);
  outro.watch = setInterval(() => {
    if (!outro.on || !outro.ready) return;
    const t = outro.player.getCurrentTime();
    if (t >= INTRO_VIDEO.end - LOOP_LEAD || t < INTRO_VIDEO.start - 2) outro.player.seekTo(INTRO_VIDEO.start, true);
    const st = outro.player.getPlayerState();
    if (st === YT.PlayerState.UNSTARTED || st === YT.PlayerState.CUED || st === YT.PlayerState.PAUSED) outro.player.playVideo();
  }, 1000);
  clearTimeout(outro.timer);
  outro.timer = setTimeout(() => outroEl.classList.add('on'), animate ? 600 : 0);
}
function hideOutro() {
  if (!outroEl || !outro.on) return;
  outro.on = false;
  clearInterval(outro.watch);
  clearTimeout(outro.timer);
  outroEl.classList.remove('on');
  if (outro.ready) outro.player.pauseVideo();
}
addEventListener('resize', () => { if (outro.on) sizeOutro(); });

/* CORAZÓN DE PUNTOS QUE SE PARTE (step.heart): debajo de la fila del romance.
   Los puntos llenan la silueta de un corazón; una grieta en zigzag lo divide en
   dos mitades que, al aparecer, se separan girando hacia afuera (CSS: #heart.broken). */
const HEART_STEP = 2.6;         // distancia entre puntos del corazón, en radios (los puntos miden DOT_R, como en todo el sitio)
const HEART_BREAK_MS = 900;     // espera antes de partirse (después de aparecer)
const heartEl = document.getElementById('heart');
const heart = { on: false, size: 0, timer: null };

// size: tamaño en px. Los puntos tienen siempre radio DOT_R y la misma separación,
// así que un corazón más chico tiene menos puntos (no puntos más chicos)
function buildHeart(size) {
  // Coordenadas normalizadas: el corazón (x²+y²−1)³ − x²y³ ≤ 0 ocupa x ∈ [−1.14, 1.14], y ∈ [−1, 1.25]
  const inside = (x, y) => (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0;
  // Grieta: zigzag de arriba (hendidura) hacia la punta de abajo
  const crack = [[0, 1.0], [-0.16, 0.62], [0.12, 0.3], [-0.14, -0.05], [0.1, -0.4], [-0.06, -0.72], [0, -1.05]];
  const crackX = y => {
    for (let i = 1; i < crack.length; i++) {
      const [x0, y0] = crack[i - 1], [x1, y1] = crack[i];
      if (y <= y0 && y >= y1) return x0 + (x1 - x0) * (y - y0) / (y1 - y0);
    }
    return 0;
  };
  const K = size / 250;   // px por unidad del SVG (viewBox de 250)
  const sp = DOT_R * HEART_STEP / (K * 100), R = DOT_R / (K * 100), GAP = sp * 0.55;   // en unidades normalizadas
  const U = 100, X = x => (x + 1.25) * U, Y = y => (1.35 - y) * U;   // a coordenadas del SVG (0..250)
  const left = [], right = [];
  for (let y = 1.3; y >= -1.05; y -= sp) {
    for (let x = -1.2; x <= 1.2; x += sp) {
      if (!inside(x, y)) continue;
      const c = crackX(y);
      if (Math.abs(x - c) < GAP) continue;   // el hueco de la grieta
      (x < c ? left : right).push(`<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="${(R * U).toFixed(2)}"/>`);
    }
  }
  heartEl.innerHTML = `<svg viewBox="0 0 250 250" aria-hidden="true">` +
    `<g class="heart-half left">${left.join('')}</g><g class="heart-half right">${right.join('')}</g></svg>`;
  heart.size = size;
}

// Entre el eje de la fila del romance y el texto (HEART_Y, HEART_SIZE)
const heartSize = () => Math.round(Math.max(70, Math.min(HEART_SIZE, innerHeight * 0.27)));
function placeHeart() {
  const size = heartSize();
  if (heart.size !== size) buildHeart(size);   // se rearma si cambia el tamaño (mismo tamaño de punto)
  Object.assign(heartEl.style, { width: size + 'px', height: size + 'px', top: innerHeight * HEART_Y + 'px' });
}

function showHeart(animate) {
  if (!heartEl) return;
  placeHeart();
  if (heart.on) return;
  heart.on = true;
  clearTimeout(heart.timer);
  heartEl.classList.remove('broken');
  heart.timer = setTimeout(() => {
    heartEl.classList.add('on');
    heart.timer = setTimeout(() => heartEl.classList.add('broken'), animate ? HEART_BREAK_MS : 0);
  }, animate ? 700 : 0);
}

function hideHeart() {
  if (!heartEl || !heart.on) return;
  heart.on = false;
  clearTimeout(heart.timer);
  heartEl.classList.remove('on', 'broken');
}
addEventListener('resize', () => { if (heart.on) placeHeart(); });

/* MÁSCARA DE TEATRO DE PUNTOS (step.maskIcon): como el corazón del romance,
   misma altura y tamaño (HEART_Y, HEART_SIZE) y puntos del tamaño de siempre
   (DOT_R, separación HEART_STEP). Se toman los puntos de una grilla que caen
   dentro de la silueta (los ojos y la boca quedan vacíos). Aparece y después
   flota despacio, sin detenerse (CSS: #mask-icon.on). */
// Íconos de puntos por género (step.icon): dibujo (path SVG), su tamaño y color
const STAR_PATH = (() => {   // estrella de 5 puntas en un cuadro de 100 × 100
  const p = d3.range(10).map(i => {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 21 : 50;
    return `${(50 + r * Math.cos(a)).toFixed(2)} ${(53 + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${p.join('L')}Z`;
})();
const DOT_ICONS = {
  mask: { view: [480, 519], color: '#4e79a7', path: 'M27.3758 90.3954C39.1158 54.6854 52.7057 26.5954 62.6958 7.94536C63.6958 4.31536 66.1558 1.80536 68.9958 0.785355C72.0358 -0.304645 76.4958 -0.524645 79.0558 1.86536L95.9458 17.6554C184.656 110.645 318.676 147.365 442.396 111.945L466.366 106.195C470.186 105.275 474.066 106.915 476.356 109.475C478.966 112.385 479.806 116.065 478.596 120.545L426.996 311.655C420.866 334.375 409.686 354.705 396.556 374.175C363.326 423.435 318.236 463.505 266.236 492.015C250.106 500.855 234.026 507.315 216.636 512.465C184.996 521.835 151.536 522.425 122.956 503.865C87.3558 481.425 62.2558 443.635 43.3158 405.815C24.2058 371.195 14.6558 340.685 9.52575 319.425C-14.3242 220.675 12.3158 136.175 27.3758 90.3954ZM184.396 178.245C171.676 182.615 161.256 186.395 149.256 186.995C117.706 189.895 95.0857 172.875 76.5957 148.815C74.6157 157.185 75.5957 164.205 78.0957 171.545C89.9658 206.345 130.786 222.105 162.926 204.185C173.086 198.525 181.286 189.605 184.396 178.245ZM395.946 234.935C383.146 239.265 372.326 243.245 359.976 243.745C328.696 246.225 306.866 229.535 288.136 205.665C285.766 215.755 287.706 224.385 291.486 233.035C305.316 264.685 344.166 277.735 374.376 260.875C384.546 255.195 392.656 246.495 395.946 234.935ZM274.466 459.075C278.216 445.875 276.576 432.365 272.236 419.265C258.926 379.095 224.006 350.635 182.246 343.975C155.586 339.725 129.136 344.125 106.246 358.175C89.4658 369.035 75.4258 383.605 69.6458 404.175C150.336 372.515 220.906 391.445 274.466 459.065V459.075Z' },
  star: { view: [100, 100], color: '#f28e2b', path: STAR_PATH }
};
const maskIconEl = document.getElementById('mask-icon');
const maskIcon = { on: false, key: '', kind: null, timer: null };

function buildMaskIcon(kind, size) {
  const icon = DOT_ICONS[kind];
  const [VW, VH] = icon.view;
  const K = size / Math.max(VW, VH);              // px por unidad del dibujo
  const sp = DOT_R * HEART_STEP / K, R = DOT_R / K;   // separación y radio, en unidades del dibujo
  const path = new Path2D(icon.path);
  const ctx = document.createElement('canvas').getContext('2d');
  // Un punto entra si su centro está dentro y no está pegado a un borde (ojos, boca)
  const fits = (x, y) => ctx.isPointInPath(path, x, y, 'evenodd') &&
    [[R * .8, 0], [-R * .8, 0], [0, R * .8], [0, -R * .8]].every(([dx, dy]) => ctx.isPointInPath(path, x + dx, y + dy, 'evenodd'));
  const dots = [];
  for (let y = sp / 2; y < VH; y += sp)
    for (let x = sp / 2; x < VW; x += sp)
      if (fits(x, y)) dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${R.toFixed(2)}"/>`);
  maskIconEl.innerHTML = `<svg viewBox="0 0 ${VW} ${VH}" aria-hidden="true"><g style="fill:${icon.color}">${dots.join('')}</g></svg>`;
  maskIconEl.dataset.kind = kind;   // animación según el ícono (style.css)
  maskIcon.key = kind + size;
}

const maskIconSize = () => Math.round(Math.max(70, Math.min(HEART_SIZE, innerHeight * 0.17)));
function placeMaskIcon() {
  const size = maskIconSize();
  if (maskIcon.key !== maskIcon.kind + size) buildMaskIcon(maskIcon.kind, size);
  Object.assign(maskIconEl.style, { width: size + 'px', height: size + 'px', top: innerHeight * HEART_Y + 'px' });
}

function showMaskIcon(animate, kind = 'mask') {
  if (!maskIconEl) return;
  if (maskIcon.on && maskIcon.kind === kind) { placeMaskIcon(); return; }
  const swap = maskIcon.on;   // otro ícono a la vista: se esfuma y aparece el nuevo
  maskIcon.on = true;
  maskIcon.kind = kind;
  clearTimeout(maskIcon.timer);
  if (swap) {
    maskIconEl.classList.remove('on');
    maskIcon.timer = setTimeout(() => { placeMaskIcon(); maskIconEl.classList.add('on'); }, animate ? 600 : 0);
  } else {
    placeMaskIcon();
    maskIcon.timer = setTimeout(() => maskIconEl.classList.add('on'), animate ? 700 : 0);
  }
}

function hideMaskIcon() {
  if (!maskIconEl || !maskIcon.on) return;
  maskIcon.on = false;
  clearTimeout(maskIcon.timer);
  maskIconEl.classList.remove('on');
}
addEventListener('resize', () => { if (maskIcon.on) placeMaskIcon(); });


/* Cifras calculadas de los datos en los textos: <span data-stat="nombre"></span>
   romance-30s: % de nominadas que eran romance en los años 30
   romance-last: % en la última década (los 10 años más recientes) */
let statsDone = false;
function fillStats() {
  if (statsDone || !films.length) return;
  statsDone = true;
  const pct = (items, f) => items.length ? Math.round(items.filter(f).length / items.length * 100) + '%' : '–';
  const maxYear = d3.max(films, d => d.year);
  const STATS = {
    'winners': String(films.filter(d => d.winner).length),
    'mgm-n': String(films.filter(d => d.studio === 'MGM').length),
    'big5-pct': Math.round(films.filter(d => STUDIOS.includes(d.studio)).length / films.length * 100) + '%',   // los cinco grandes estudios
    'romance-30s': pct(films.filter(d => d.year >= 1930 && d.year < 1940), d => d.main === 'Romance'),
    'romance-last': pct(films.filter(d => d.year > maxYear - 10), d => d.main === 'Romance'),
    'biopic-30s': pct(films.filter(d => d.year >= 1930 && d.year < 1940), d => d.main === 'Biopic'),
    'biopic-last': pct(films.filter(d => d.year > maxYear - 10), d => d.main === 'Biopic'),
    'biopic-last-n': String(films.filter(d => d.year > maxYear - 10 && d.main === 'Biopic').length),
    'drama-30s': pct(films.filter(d => d.year >= 1930 && d.year < 1940), d => d.main === 'Drama'),
    'drama-last': pct(films.filter(d => d.year > maxYear - 10), d => d.main === 'Drama')
  };
  document.querySelectorAll('[data-stat]').forEach(el => { el.textContent = STATS[el.dataset.stat] ?? ''; });
}


function hideMaskVideo() {
  if (!maskV.on) return;
  maskV.on = false;
  clearTimeout(maskV.timer);
  clearTimeout(maskV.dotsTimer);
  maskEl.classList.remove('on');
  dotGridEl.classList.remove('on');
  maskVideoEl.muted = true;   // sin sonido fuera de este paso
  updateSoundBtn();
}

/* Sonido del video "And the Oscar goes to": los navegadores no dejan
   reproducir con sonido hasta que la persona hace clic, toca la pantalla o
   aprieta una tecla (el scroll no cuenta). Apenas lo hace, si el video está a
   la vista, se activa el sonido. Mientras tanto, un botón "Activar sonido". */
const soundBtn = document.getElementById('sound-btn');
function updateSoundBtn() {
  if (soundBtn) soundBtn.classList.toggle('on', maskV.on && maskVideoEl.muted);
}
function enableMaskSound() {
  if (!maskV.on || !maskVideoEl.muted) return;
  maskVideoEl.muted = false;
  maskVideoEl.volume = 1;
  playMask();
  setTimeout(updateSoundBtn, 300);
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  addEventListener(ev, enableMaskSound, { passive: true }));
maskVideoEl.addEventListener('volumechange', updateSoundBtn);

function trendOpacity(step, key) {
  return !step.trendFocus || step.trendFocus === key ? 1 : TREND_DIM;
}

function render(stepIdx, animate = true) {
  currentStep = stepIdx;
  const step = STEPS[stepIdx];
  const { w, h } = getSize();
  svg.attr('width', w).attr('height', h);

  // Fondo teñido muy sutilmente con el color del género del que se habla (step.bg)
  // bgColor: un color propio en vez del de un género (p. ej. el rojo del sobre equivocado)
  document.body.style.backgroundColor = step.bg || step.bgColor
    ? d3.interpolateRgb(BASE_BG, step.bgColor || GENRE_COLORS[step.bg])(BG_TINT)
    : BASE_BG;

  // El layout se calcula dentro del área útil y luego se desplaza a su posición
  const box = getBox(w, h);
  const L = LAYOUTS[step.layout](films, box.w, box.h);
  L.pos.forEach(p => { p.x += box.x; p.y += box.y; });
  L.labels.forEach(l => { l.x += box.x; l.y += box.y; });
  L.lines.forEach(l => {
    l.x1 += box.x; l.x2 += box.x;
    // Horizontales: y; verticales: y1 / y2
    if (l.y1 == null) l.y1 = l.y2 = l.y;
    l.y1 += box.y; l.y2 += box.y;
  });
  (L.rects || []).forEach(r => { r.x += box.x; r.y += box.y; });
  (L.trends || []).forEach(t => { t.x1 += box.x; t.x2 += box.x; t.y1 += box.y; t.y2 += box.y; });
  (L.trends || []).forEach(t => { if (t.points) t.points = t.points.map(([x, y]) => [x + box.x, y + box.y]); });
  if (L.orbit) L.orbit.forEach(o => { o.cx += box.x; o.cy += box.y; });
  if (L.spot) { L.spot.x += box.x; L.spot.y += box.y; }
  (L.extra || []).forEach(p => { p.x += box.x; p.y += box.y; });
  (L.trioGeo || []).forEach(g => { g.x += box.x; g.y += box.y; });
  if (L.info) { L.info.x += box.x; L.info.y += box.y; }
  const colorFn = COLOR_FNS[step.color];

  // samePos: los puntos no cambian de lugar (solo de opacidad/color) -> fade uniforme.
  // Si sí se mueven, se escalonan por orden cronológico.
  const base = step.base || step.layout;
  const samePos = prevBase === base;

  stopOrbit();   // si veníamos de la órbita, se detiene antes de mover los puntos
  dots.interrupt();
  // fadeSwap: los puntos que se ocultan se esfuman donde están y los que aparecen
  // lo hacen directamente en su lugar (sin volar ni caer); p. ej. al pasar de la
  // línea de tiempo de un género a la de otro
  if (step.fadeSwap && animate) {
    const hid = d => (step.hide && step.hide(d)) || (L.hidden && L.hidden.has(d.id));
    dots.each(function (d) {
      const el = d3.select(this), wasHidden = +el.attr('opacity') === 0;
      if (hid(d)) L.pos.set(d.id, { x: +el.attr('cx'), y: +el.attr('cy') });
      else if (wasHidden) { const p = L.pos.get(d.id); el.attr('cx', p.x).attr('cy', p.y); }
    });
  }
  const sel = animate
    ? dots.transition().duration(samePos ? DOT_FADE_MS : DOT_MOVE_MS).ease(DOT_EASE)
          .delay((d, i) => samePos ? 0 : Math.min(i * DOT_STAGGER, DOT_STAGGER_MAX))
    : dots;
  const isFocus = d => step.focus && step.focus(d);
  const isHidden = d => (step.hide && step.hide(d)) || (L.hidden && L.hidden.has(d.id));
  dots.style('pointer-events', d => isHidden(d) ? 'none' : null);   // ocultas: sin tooltip
  sel.attr('cx', d => L.pos.get(d.id).x)
     .attr('cy', d => L.pos.get(d.id).y)
     .attr('r', d => step.focusScale && isFocus(d) ? L.r * step.focusScale : L.r)   // focusScale: agranda las resaltadas
     .attr('fill', colorFn)
     .attr('opacity', d => isHidden(d) ? 0 : L.opacity ? L.opacity.get(d.id) : step.focus ? (isFocus(d) ? (step.focusOpacity ?? 1) : (step.dimOpacity ?? FOCUS_OPACITY)) : 1);
  dots.filter(isFocus).raise();   // las resaltadas quedan por encima

  // Puntos de relleno (p. ej. los que completan la silueta de la estatuilla):
  // aparecen cuando las películas ya llegaron y se esfuman al salir del paso
  gExtra.selectAll('circle').data(step.noExtra ? [] : (L.extra || []), (_, i) => i).join(   // noExtra: sin los puntos de relleno
    enter => enter.append('circle')
      .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', L.r)
      .attr('fill', L.extraColor || WIN_COLOR).attr('opacity', 0)
      .call(e => e.transition().delay(animate ? 900 : 0).duration(animate ? 600 : 0)
                  .attr('opacity', STATUE_EXTRA_OPACITY)),
    // Los que ya estaban (p. ej. de la estatuilla a la grilla) viajan a su nuevo lugar
    update => update.interrupt()
      .call(u => u.transition().duration(animate ? 1000 : 0).ease(d3.easeCubicInOut)
                  .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', L.r)
                  .attr('fill', L.extraColor || WIN_COLOR).attr('opacity', STATUE_EXTRA_OPACITY)),
    exit => exit.transition().duration(animate ? 300 : 0).attr('opacity', 0).remove()
  );

  // Brillo: un halo que late detrás de los puntos de las películas de step.glow
  const glowFilms = (step.glow || []).map(findFilm).filter(Boolean);
  const halos = gGlow.selectAll('circle.halo').data(glowFilms, d => d.id).join(
    enter => enter.append('circle').attr('class', 'halo')
      .attr('cx', d => L.pos.get(d.id).x).attr('cy', d => L.pos.get(d.id).y)
      .attr('opacity', 0)
      .call(e => e.transition().delay(animate ? 300 : 0).duration(animate ? 500 : 0).attr('opacity', 1)),
    update => update,
    exit => exit.transition().duration(animate ? 300 : 0).attr('opacity', 0).remove()
  );
  halos.attr('r', L.r * GLOW_R);
  (animate ? halos.transition().duration(samePos ? DOT_FADE_MS : DOT_MOVE_MS).ease(DOT_EASE) : halos)
    .attr('cx', d => L.pos.get(d.id).x).attr('cy', d => L.pos.get(d.id).y);
  dots.filter(d => glowFilms.includes(d)).raise();

  // Órbita: cuando los puntos llegan a su anillo, empiezan a girar
  if (L.orbit) startOrbit(L.orbit, animate ? ORBIT_WAIT_MS : 0);

  // Movie-Zoom-In: abre la máscara desde el punto de la película indicada
  if (step.zoom) {
    const f = findFilm(step.zoom);
    const p = f && L.pos.get(f.id);
    if (p) {
      const vr = vis.getBoundingClientRect();
      openZoom(step.zoom, vr.left + p.x, vr.top + p.y, L.r, animate);
    }
  } else if (zoom.open) {
    closeZoom(animate);
  }

  // Portada: video dentro de los puntos de OSCARS
  if (step.introVideo) showIntroVideo(L, animate);
  else hideIntroVideo();

  // Grilla de video: se precarga (en silencio, oculta) unos pasos antes
  const maskNear = STEPS.some((st, j) => st.maskVideo && j >= stepIdx - 1 && j <= stepIdx + MASK_PRELOAD);
  if (step.split) showSplit(step.split, animate); else hideSplit();
  if (step.bigCircle) showBigCircle(step.bigCircle, animate, step.bigDelay || 0); else hideBigCircle();
  if (step.heart) showHeart(animate); else hideHeart();
  if (step.formulaNote && L.statueBox) {
    const vr = vis.getBoundingClientRect();
    showFormulaNote(document.querySelector(`.step[data-step="${stepIdx}"] .card[data-float]`),
                    vr.top + box.y + (L.statueBox.y0 + L.statueBox.y1) / 2, animate ? 900 : 0);
  } else hideFormulaNote();
  if (step.countdown) showCountdown(animate); else hideCountdown();
  if (step.outro) showOutro(animate, step.outro === 'dim'); else hideOutro();
  if (step.posterStrip && L.trioGeo) {
    const vr = vis.getBoundingClientRect();
    showPosterStrip(step.posterStrip, vr.top + L.trioGeo[0].y, L.trioGeo[0].D, animate, step.posterFocus);
  } else hidePosterStrip();
  if (step.icon) showMaskIcon(animate, step.icon); else hideMaskIcon();
  fillStats();
  if (step.maskVideo) showMaskVideo(animate, step.maskVideo === 'word');
  else { hideMaskVideo(); if (maskNear) warmMask(); else coolMask(); }

  // Trío: tres círculos con video que crecen desde sus puntos
  // Calentamiento: los tríos que aparecen en los próximos PRELOAD_STEPS pasos
  // (o en el anterior, por si se vuelve) reproducen sus videos de antemano
  TRIO_SETS.forEach(s => {
    s.near = STEPS.some((st, j) => st.trio && st.trio.films === s.films &&
                                   j >= stepIdx - 1 && j <= stepIdx + PRELOAD_STEPS);
    if (s.near) warmSet(s);
    else if (!s.open) coolSet(s);   // si está abierto, closeTrio lo detiene al cerrar
  });

  const trioSet = step.trio ? TRIO_SETS.find(s => s.films === step.trio.films) : null;
  let zoomT = null;   // tiempos de la secuencia del zoom in (si este paso la usa)
  TRIO_SETS.forEach(s => { if (s !== trioSet && s.open) closeTrio(s, animate); });
  if (trioSet) {
    const vr = vis.getBoundingClientRect();
    const origins = step.trio.films.map(cfg => {
      const f = findFilm(cfg);
      const p = f && L.pos.get(f.id);
      return p ? { x: vr.left + p.x, y: vr.top + p.y, r: L.r }
               : { x: innerWidth / 2, y: innerHeight / 2, r: 0 };
    });
    if (step.trio.spot && L.spot) {
      // Espera a que el rectángulo termine de deslizarse (o a que el círculo
      // anterior empiece a volver a su punto) antes de abrir el nuevo
      const delay = prevLayout === step.layout ? 350 : samePos ? 800 : 1400;
      openSpot(trioSet, step.trio.active, origins,
               { x: vr.left + L.spot.x, y: vr.top + L.spot.y, D: L.spot.D }, animate, delay);
    } else {
      // Posiciones de los círculos dadas por el layout (p. ej. debajo del drama)
      const geo = L.trioGeo ? L.trioGeo.map(g => ({ x: vr.left + g.x, y: vr.top + g.y, D: g.D })) : null;
      if (step.zoomLinks) {
        // Zoom in: si recién se abre (o, de a una, cambia la película), va en
        // secuencia (ver ZOOM_SEQ)
        const single = !!step.trio.single;
        const changed = single && trioSet.open && trioSet.activeIdx !== step.trio.active;
        // Otra instancia de la misma película (p. ej. Moonlight y su ceremonia):
        // el punto, la línea y el contorno ya están; solo cambia el video del círculo
        const prevCfg = changed ? trioSet.films[trioSet.activeIdx] : null;
        const sameFilm = !!prevCfg && prevCfg.film === step.trio.films[step.trio.active].film;
        zoomT = zoomTimes(animate && (!trioSet.open || changed) && !sameFilm, !trioSet.open);
        if (single || step.trio.together) zoomT.stagger = 0;   // together: todas a la par
        openTrio(trioSet, step.trio.active, origins, animate, geo, zoomT.content, single);
        trioSet.activeIdx = step.trio.active;
      } else openTrio(trioSet, step.trio.active, origins, animate, geo);
    }
  }

  // Sonido: solo el video con cfg.sound de la película activa de este paso
  TRIO_SETS.forEach(s => s.items.forEach((it, i) => setItemSound(it,
    !!(it.cfg.sound && s === trioSet && step.trio.active === i))));

  // Zoom in: 1) los puntos de las películas se encienden (crecen y vuelven)
  if (zoomT && zoomT.glow) {
    // De a una (single): solo el punto de la película activa
    const lit = (step.trio.single ? [step.trio.films[step.trio.active]] : step.trio.films).map(findFilm);
    dots.filter(d => lit.includes(d)).raise()
      .transition('glow').delay(d => zoomT.glow + lit.indexOf(d) * zoomT.stagger)
        .duration(ZOOM_SEQ.glow * 0.45).ease(d3.easeSinOut)
        .attr('r', L.r * ZOOM_GLOW_R)
      .transition().duration(ZOOM_SEQ.glow * 0.55).ease(d3.easeSinInOut)
        .attr('r', L.r);
  }
  // 2) la línea baja del punto al círculo y 3) se dibuja el contorno del círculo
  const links = step.zoomLinks && step.trio && L.trioGeo
    ? step.trio.films.map((cfg, i) => {
        if (step.trio.single && i !== step.trio.active) return null;   // de a una: solo la activa
        const f = findFilm(cfg), p = f && L.pos.get(f.id), g = L.trioGeo[i];
        const R = g.D / 2 + ZOOM_RING_OUT;
        return p ? { key: cfg.film, i, line: zoomLinkPath(p, L.r, g, R, cfg.joint), ring: zoomRingPath(p, g, R, cfg.joint) } : null;
      }).filter(Boolean)
    : [];
  // delay/dur: funciones de la película (d.i); ease: curva del trazo.
  // Para "dibujarlo" de principio a fin se usa una máscara: una copia del mismo
  // path que se va dibujando y deja ver el trazo a medida que avanza (sirve
  // también si el trazo fuera punteado). Al terminar, la máscara se quita.
  const drawPath = (cls, attr, delay, dur, ease) =>
    gZoom.selectAll(`path.${cls}`).data(links, d => d.key).join(
      enter => enter.append('path').attr('class', cls).attr('d', d => d[attr])
        .attr('opacity', ZOOM_LINK_OPACITY)
        .each(function (d) {
          if (!zoomT || !zoomT.content) return;   // sin animación: completo
          const id = `zoom-mask-${++zoomMaskSeq}`;
          const mask = svgDefs.append('mask').attr('id', id).attr('maskUnits', 'userSpaceOnUse')
            .attr('x', -innerWidth).attr('y', -innerHeight).attr('width', innerWidth * 3).attr('height', innerHeight * 3);
          const mp = mask.append('path').attr('d', d[attr]).attr('fill', 'none')
            .attr('stroke', '#fff').attr('stroke-width', 12).attr('stroke-linecap', 'butt');
          const len = mp.node().getTotalLength();
          this.setAttribute('mask', `url(#${id})`);
          this.__zoomMask = mask;
          const path = this;
          mp.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
            .transition('draw').delay(delay(d)).duration(dur(d)).ease(ease)
            .attr('stroke-dashoffset', 0)
            .on('end interrupt', () => { path.removeAttribute('mask'); mask.remove(); path.__zoomMask = null; });
        }),
      update => update.attr('d', d => d[attr]).attr('opacity', ZOOM_LINK_OPACITY),
      exit => exit.each(function () { if (this.__zoomMask) { this.__zoomMask.selectAll('path').interrupt('draw'); } })
        .transition().duration(animate ? 250 : 0).attr('opacity', 0).remove()
    );
  const off = d => zoomT ? d.i * zoomT.stagger : 0;
  // La línea acelera al bajar (sin frenar) y el contorno sale con esa velocidad
  drawPath('zoomlink', 'line', d => (zoomT ? zoomT.line : 0) + off(d), () => ZOOM_SEQ.line, d3.easeSinIn);
  drawPath('zoomring', 'ring', d => (zoomT ? zoomT.ring : 0) + off(d), d => zoomRingDur(d.i), d3.easeSinOut);

  // De a una: título, año y descripción a la derecha del círculo
  if (step.trio && step.trio.single && L.info) {
    const vr = vis.getBoundingClientRect();
    showZoomInfo(step.trio.films[step.trio.active], vr.left + L.info.x, vr.top + L.info.y, L.info.w,
                 zoomT && zoomT.content ? zoomT.content + 250 : 0, animate, !!step.trio.era);
    // Color del texto de arriba del título (era o, en los épicos, la duración)
    if (step.eraColor) zoomInfoEl.style.setProperty('--zi-era-color', step.eraColor);
    else if (step.bg) zoomInfoEl.style.setProperty('--zi-era-color', GENRE_COLORS[step.bg]);
  } else hideZoomInfo(animate);

  // Texto flotante (paso con .card[data-float] en index.html): centrado en el
  // espacio vacío donde después aparecen los círculos
  if (step.floatNote === 'aboveStrip' && strip.cy != null) {
    // Arriba de la tira de pósters (en el lugar del bloque): termina a 48 px de los pósters
    const src = document.querySelector(`.step[data-step="${stepIdx}"] .card[data-float]`);
    showFloatNote(src ? src.innerHTML : '', innerWidth / 2, 0, animate ? 700 : 0,
      () => { floatNoteEl.style.top = strip.cy - strip.h / 2 - 48 - floatNoteEl.offsetHeight / 2 + 'px'; });
  } else   if (step.floatNote === 'center' || typeof step.floatNote === 'number') {
    // 'center': el texto solo, centrado en la pantalla (FLOAT_CENTER_Y). Número: a esa
    // altura (fracción del alto de la pantalla), p. ej. debajo del corazón del romance
    const fy = typeof step.floatNote === 'number' ? step.floatNote : FLOAT_CENTER_Y;
    const src = document.querySelector(`.step[data-step="${stepIdx}"] .card[data-float]`);
    showFloatNote(src ? src.innerHTML : '', innerWidth / 2, innerHeight * fy, animate ? 900 : 0);
  } else if (step.floatNote && L.trioGeo) {
    const vr = vis.getBoundingClientRect();
    const src = document.querySelector(`.step[data-step="${stepIdx}"] .card[data-float]`);
    showFloatNote(src ? src.innerHTML : '', vr.left + box.x + box.w / 2, vr.top + L.trioGeo[0].y,
                  animate && prevLayout !== step.layout ? 900 : 0);   // si el gráfico se mueve, espera a que llegue
  } else hideFloatNote();

  // Textos a los costados de la estatuilla (step.sideNote): apoyados en su base
  if (step.sideNote && L.statueBox) {
    const vr = vis.getBoundingClientRect(), b = L.statueBox;
    const src = document.querySelector(`.step[data-step="${stepIdx}"] .card[data-float]`);
    showSideNote(src, vr.left + box.x + b.x0, vr.left + box.x + b.x1, vr.top + box.y + b.y1, animate ? 900 : 0);
  } else hideSideNote();

  // Texto arriba de la grilla (step.headNote): apoyado sobre la primera fila de
  // puntos, alineado con el primer punto de la izquierda
  if (step.headNote && (L.headAnchor || L.x0 != null)) {
    const vr = vis.getBoundingClientRect();
    const src = document.querySelector(`.step[data-step="${stepIdx}"] .card[data-float]`);
    // L.headAnchor: punto propio del layout (borde izquierdo, borde de arriba); si no, la grilla
    const a = L.headAnchor
      ? { x: L.headAnchor.x, y: L.headAnchor.y - HEAD_NOTE_GAP * 0.5 }
      : { x: L.x0 + L.size / 2 - L.r, y: L.y0 + L.size / 2 - L.r - HEAD_NOTE_GAP };
    showHeadNote(src ? src.innerHTML : "", vr.left + box.x + a.x, vr.top + box.y + a.y, animate ? 500 : 0);
  } else hideHeadNote();

  // Texto debajo de los bloques (step.footNote): cifra grande + texto al lado, el
  // conjunto centrado en el ancho de la pantalla, a FOOT_NOTE_GAP de la última fila
  if (step.footNote) {
    const vr = vis.getBoundingClientRect();
    const isHid = d => (step.hide && step.hide(d)) || (L.hidden && L.hidden.has(d.id));
    const maxY = d3.max(films.filter(d => !isHid(d)), d => L.pos.get(d.id).y);
    const src = document.querySelector(`.step[data-step="${stepIdx}"] .card[data-float]`);
    // footNote: 'overlap': la cifra se superpone a las últimas filas de puntos (alineada
    // a la izquierda de los bloques) y debajo sigue el resto
    const over = step.footNote === 'overlap';
    footNoteEl.classList.toggle('overlap', over);
    if (over) {
      const minX = d3.min(films.filter(d => !isHid(d)), d => L.pos.get(d.id).x);
      showFootNote(src ? src.innerHTML : '', vr.left + minX - L.r - innerWidth * FOOT_OVERLAP_X, 0, animate ? 600 : 0);
      const num = footNoteEl.querySelector('.big-num');
      footNoteEl.style.top = vr.top + maxY + L.r - (num ? num.offsetHeight : 0) + 'px';   // la cifra termina en la última fila
    } else
    showFootNote(src ? src.innerHTML : '', innerWidth / 2, vr.top + maxY + L.r + FOOT_NOTE_GAP, animate ? 600 : 0);
  } else hideFootNote();

  // Género solo (romance, biopic, drama): título a la izquierda del ícono y la
  // descripción a la derecha, los dos centrados en la altura del ícono
  if (step.soloNote) showSoloNote(document.querySelector(`.step[data-step="${stepIdx}"] .card[data-float]`), animate ? 900 : 0);
  else hideSoloNote();

  const labelOp = step.labelOp ?? (step.focus ? LABEL_OPACITY : 1);
  // labelFocus: solo los textos de ese grupo (p. ej. un género) quedan plenos
  const labelOpFor = key => step.labelFocus && key && key !== step.labelFocus ? LABEL_OPACITY : labelOp;

  // Etiquetas y líneas:
  //  - mismo layout que el paso anterior: solo cambia su opacidad (foco)
  //  - mismas posiciones pero otro texto: crossfade
  //  - otra configuración: se redibujan con fade-in
  let labelDelay = 500;
  if (animate && prevLayout === step.layout) {
    gLabels.selectAll('text').transition().duration(800)
      .attr('opacity', function () { return labelOpFor(this.getAttribute('data-key')); });
    gLines.selectAll('line, rect').transition().duration(800).attr('opacity', labelOp);   // líneas guía y franjas también
  } else {
    if (animate && samePos) {
      gLabels.selectAll('*').transition().duration(300).attr('opacity', 0).remove();
      labelDelay = 300;
    } else {
      gLabels.selectAll('*').remove();
    }
    gLines.selectAll('*').remove();

    gLines.selectAll('line').data(L.lines).join('line')
      .attr('class', d => d.cls || 'gridline')
      .attr('opacity', labelOp)   // con labelOp: 0 también se ocultan las líneas guía
      .attr('x1', d => d.x1).attr('x2', d => d.x2)
      .attr('y1', d => d.y1).attr('y2', d => d.y2);

    // Paneles de fondo (p. ej. el recuadro oscuro del paso de drama)
    gLines.selectAll('rect').data(L.rects || []).join('rect')
      .attr('class', d => d.cls || 'panel')
      .attr('x', d => d.x).attr('y', d => d.y)
      .attr('width', d => d.w).attr('height', d => d.h)
      .attr('opacity', animate ? 0 : 1)
      .transition().delay(animate ? 400 : 0).duration(animate ? 600 : 0).attr('opacity', labelOp);

    const addText = (cls, x, y, text, color, key = null) => {
      const op = labelOpFor(key);
      const t = gLabels.append('text')
        .attr('class', cls).attr('x', x).attr('y', y)
        .attr('data-key', key)
        .attr('text-anchor', cls === 'tick' ? null : 'middle')
        .attr('opacity', animate ? 0 : op)
        .text(text);
      if (color) t.style('fill', color);
      if (animate) t.transition().delay(labelDelay).duration(500).attr('opacity', op);
      return t;
    };

    L.labels.forEach(l => {
      const t = addText(l.cls, l.x, l.y, l.text, l.color, l.key);
      if (l.anchor) t.attr('text-anchor', l.anchor);
      // spans: varios textos seguidos en la misma línea, cada uno con su estilo
      (l.spans || []).forEach((sp, i) =>
        t.append('tspan').attr('class', sp.cls).attr('dx', i ? 8 : null).text(sp.text));
      (l.subs || []).forEach((sb, i) => {
        const s = addText(sb.cls, l.x, l.y + 17 * (i + 1) + (sb.cls === 'label-rate' ? 3 : 0), sb.text);
        if (l.anchor) s.attr('text-anchor', l.anchor);   // mismo alineado que su nombre
      });
    });

    // Líneas de tendencia: se dibujan de izquierda a derecha
    (L.trends || []).forEach(t => {
      // Polilínea (t.points): p. ej. el promedio por década
      if (t.points) {
        const path = gLabels.append('path')
          .attr('class', 'trendline').attr('fill', 'none')
          .attr('data-key', t.key || null)
          .attr('d', d3.line()(t.points))
          .attr('opacity', trendOpacity(step, t.key) * labelOp);
        if (t.color) path.style('stroke', t.color);
        if (animate) {
          const len = path.node().getTotalLength();
          path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
            .transition().delay(labelDelay).duration(1400).ease(d3.easeCubicInOut)
            .attr('stroke-dashoffset', 0)
            .on('end', () => path.attr('stroke-dasharray', null));
        }
        return;
      }
      const len = Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
      const line = gLabels.append('line')
        .attr('class', 'trendline')
        .attr('data-key', t.key || null)
        .attr('x1', t.x1).attr('y1', t.y1).attr('x2', t.x2).attr('y2', t.y2)
        .attr('opacity', trendOpacity(step, t.key) * labelOp);
      if (t.color) line.style('stroke', t.color);
      if (animate) {
        line.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
          .transition().delay(labelDelay).duration(1400).ease(d3.easeCubicInOut)
          .attr('stroke-dashoffset', 0)
          .on('end', () => line.attr('stroke-dasharray', null));
      }
    });
  }
  // Mismo layout: solo cambia qué línea de tendencia se destaca
  if (animate && prevLayout === step.layout) {
    gLabels.selectAll('.trendline').transition().duration(800)
      .attr('opacity', function () { return trendOpacity(step, this.getAttribute('data-key')) * labelOp; });
  }
  prevLayout = step.layout;
  prevBase = base;

  // Primer y último año del bloque destacado (step.years = género)
  drawYearMarks(step, L, animate, samePos);

  // Leyenda
  const items = LEGENDS[step.color];
  // Con círculos de película, sin leyenda (salvo el círculo al costado: spot).
  // noLegend: sin leyenda aunque no haya círculos (p. ej. el drama aislado)
  // En la sección de género, la leyenda va en columna, arriba a la izquierda
  const secEl = document.querySelector(`.step[data-step="${stepIdx}"]`);
  legend.classed('side', !!secEl && secEl.dataset.section === 'genero');
  legend.style('opacity', !step.noLegend && items.length && (!step.trio || step.trio.spot || step.keepLegend) ? 1 : 0)
    .html(items.map(i => `<span${i.dim ? ' class="dim"' : ''}><i style="background:${i.color}"></i>${i.text}</span>`).join(''));
}

/* =========================================================
   CARGA DE DATOS
   ========================================================= */
// Se espera también a que cargue Outfit: la palabra de puntos se dibuja con ella
/* Sin palabras huérfanas en los textos: la última palabra de cada párrafo
   queda unida a la anterior con un espacio que no corta (\u00A0), así nunca
   queda sola en la última línea. */
function noOrphans(root = document) {
  root.querySelectorAll('.card p, .card h1, .card h2, .card h3').forEach(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    // El último espacio del texto (sin contar los del final), aunque esté en otro
    // nodo que la última palabra (p. ej. "apenas el <strong>9%</strong>.")
    let tail = true;
    for (let i = nodes.length - 1; i >= 0; i--) {
      let t = nodes[i].nodeValue;
      if (tail) { const s = t.replace(/\s+$/, ''); if (!s) continue; t = s; tail = false; }
      const k = t.lastIndexOf(' ');
      if (k >= 0) { const v = nodes[i].nodeValue; nodes[i].nodeValue = v.slice(0, k) + '\u00A0' + v.slice(k + 1); break; }
    }
  });
}
noOrphans();

Promise.all([
  d3.csv('data/oscars.csv'),
  document.fonts.load(WORD_FONT, 'Género Duración Productora La fórmula').catch(() => null),
  document.fonts.load(OSCARS_WORD.font, 'OSCARS').catch(() => null),
  document.fonts.load(`${OSCARS_GRID.weight} 100px Outfit`, OSCARS_GRID.text).catch(() => null),   // OSCARS de la portada
  document.fonts.load(ORBIT_FONT, GENRES.map(g => GENRE_LABELS[g]).join(' ')).catch(() => null),
  loadStatue()   // silueta de la estatuilla (paso de las ganadoras)
]).then(([rows]) => {
  films = rows.map((d, i) => {
    const genres = d.genero.split(',').map(s => s.trim());
    // 58 películas no tienen year_film: se usa el año de ceremonia - 1
    const year = +d.year_film || (+d.year_ceremony - 1);
    return {
      id: i,
      film: d.film,
      year,
      decade: Math.floor(year / 10) * 10 + 's',
      genres,
      genreText: d.genero,
      main: classify(genres),
      dur: +d.duracion || 120,           // 1 película sin duración: se usa 120
      winner: String(d.winner).toUpperCase() === 'TRUE',
      studio: (d.estudio || '').trim()   // estudio productor (columna "estudio": MGM, Paramount…)
    };
  }).sort((a, b) => a.year - b.year || a.id - b.id);

  const { w, h } = getSize();
  dots = gDots.selectAll('circle').data(films, d => d.id).join('circle')
    .attr('cx', w / 2).attr('cy', h / 2).attr('r', 0)
    .on('mouseenter', (e, d) => {
      tooltip.style('opacity', 1).html(
        `<b>${d.film}</b>${d.year} · ${d.dur} min<br>${d.genreText}` +
        (d.winner ? '<br>🏆 Ganadora' : ''));
    })
    .on('mousemove', e => tooltip.style('left', (e.clientX + 14) + 'px').style('top', (e.clientY + 14) + 'px'))
    .on('mouseleave', () => tooltip.style('opacity', 0));

  render(0, true);

// Línea de disparo: un poco por debajo de donde queda encajado cada paso
// (calculada con las medidas de style.css)
function triggerMargin() {
  const L = Math.round(cssLen('--step-offset') + 0.38 * cssLen('--step-h'));
  return `-${L}px 0px -${innerHeight - L - 2}px 0px`;
}

  // Scrollytelling: cambia el paso cuando su texto entra en la zona de texto.
  // El gráfico cambia justo cuando el texto nuevo asoma por abajo y el
  // anterior ya se fue (ver triggerMargin).
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const idx = +e.target.dataset.step;
        if (idx !== currentStep) render(idx, true);
      }
    });
  }, { rootMargin: triggerMargin() });
  document.querySelectorAll('.step').forEach(s => io.observe(s));

  // Recalcular al cambiar el tamaño de la ventana
  let timer;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => render(currentStep, false), 150);
  });
}).catch(err => console.error('No se pudo cargar data/oscars.csv', err));

/* =========================================================
   NAVEGACIÓN: barra de progreso por secciones + menú hamburguesa
   Cada .step de index.html indica su sección con data-section="id".
   Una sección sin pasos todavía aparece en la barra (vacía) y en el
   menú como "Próximamente"; se activa sola al agregarle pasos.
   ========================================================= */
const SECTIONS = [
  { id: 'intro',      label: 'Introducción' },
  { id: 'genero',     label: 'Género' },
  { id: 'duracion',   label: 'Duración' },
  { id: 'productora', label: 'Productora' },
  { id: 'cierre',     label: 'La Fórmula Ganadora' }
];

(function initNav() {
  const progress = document.getElementById('progress');
  const btn = document.getElementById('menu-btn');
  const menu = document.getElementById('menu');

  // Pasos de cada sección (en orden del documento)
  SECTIONS.forEach(s => {
    // Sin los pasos ocultos (hidden): no miden nada y desarmarían el cálculo del avance
    s.steps = [...document.querySelectorAll(`.step[data-section="${s.id}"]`)].filter(el => !el.hidden);
  });

  // Barra: un segmento por sección
  progress.innerHTML = SECTIONS.map(s =>
    `<div class="seg"><div class="track"><div class="fill"></div></div><span class="name">${s.label}</span></div>`
  ).join('');
  const segs = [...progress.querySelectorAll('.seg')];
  const fills = [...progress.querySelectorAll('.fill')];

  // Menú: un botón por sección
  menu.querySelector('ol').innerHTML = SECTIONS.map((s, i) => `
    <li><button type="button" data-i="${i}" ${s.steps.length ? '' : 'disabled'}>
      <span class="num">${String(i + 1).padStart(2, '0')}</span>${s.label}
      ${s.steps.length ? '' : '<span class="soon">Próximamente</span>'}
    </button></li>`).join('');
  const items = [...menu.querySelectorAll('button')];

  // Posición vertical de un elemento respecto del documento
  const pageTop = el => el.getBoundingClientRect().top + scrollY;

  // Avance (0 a 1) dentro de cada sección, medido con el centro de la pantalla
  function update() {
    const mid = scrollY + innerHeight / 2;
    let current = -1;
    SECTIONS.forEach((s, i) => {
      let p = 0;
      if (s.steps.length) {
        const top = pageTop(s.steps[0]);
        const last = s.steps[s.steps.length - 1];
        const bottom = pageTop(last) + last.offsetHeight;
        p = Math.min(1, Math.max(0, (mid - top) / (bottom - top)));
        if (mid >= top && mid < bottom) current = i;
      }
      fills[i].style.transform = `scaleX(${p})`;
    });
    segs.forEach((el, i) => el.classList.toggle('current', i === current));
    items.forEach((el, i) => el.setAttribute('aria-current', i === current ? 'true' : 'false'));
  }
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();

  // Abrir / cerrar menú
  function setOpen(open) {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open);
    btn.setAttribute('aria-label', open ? 'Cerrar menú de secciones' : 'Abrir menú de secciones');
    if (open) (items.find(b => !b.disabled) || btn).focus();
  }
  btn.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); }
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });

  // Saltar a una sección: salto directo (sin scroll suave) para que no se
  // disparen todas las animaciones intermedias; el paso de destino se anima.
  items.forEach(b => b.addEventListener('click', () => {
    const s = SECTIONS[+b.dataset.i];
    if (!s.steps.length) return;
    setOpen(false);
    // Destino: el título hecho de puntos de la sección (Género, Duración,
    // Productora: pasos con layout 'word…'); si no tiene, su primer paso visible
    const visible = s.steps.filter(el => !el.hidden);
    const target = visible.find(el => /^word/.test((STEPS[+el.dataset.step] || {}).layout || '')) || visible[0] || s.steps[0];
    // El paso se activa cuando cruza la línea de disparo (triggerMargin):
    // se ubica esa línea en el medio del paso
    const line = Math.round(cssLen('--step-offset') + 0.38 * cssLen('--step-h'));
    scrollTo({ top: pageTop(target) + target.offsetHeight / 2 - line, behavior: 'instant' });
  }));
})();

/* =========================================================
   OPACIDAD Y RECORTE DE LOS TEXTOS SEGÚN SU POSICIÓN
   Los textos viven en la zona de texto (debajo del gráfico). Cada uno es
   transparente al entrar por abajo, llega al 100% en el centro de la zona y
   se esfuma al subir. Además se recorta exactamente en el borde superior de
   la zona (--text-top), así nunca tapa el gráfico.
   ========================================================= */
(function initCardFade() {
  const cards = [...document.querySelectorAll('.steps .card')];
  function update() {
    const B = textTop();                       // borde superior de la zona de texto
    const mid = (B + innerHeight) / 2;         // centro de la zona
    const half = (innerHeight - B) / 2;
    cards.forEach(c => {
      const r = c.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid) / half;   // 0 en el centro, 1 en el borde
      c.style.opacity = Math.min(1, Math.max(0, (1 - d) * 1.8)).toFixed(3);
      const cut = B - r.top;                    // parte que ya subió por encima del borde
      c.style.clipPath = cut > 0 ? `inset(${cut.toFixed(1)}px 0 0 0)` : '';
    });
  }
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();
})();
