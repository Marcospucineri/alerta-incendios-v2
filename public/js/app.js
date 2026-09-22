/**
 * Detección temprana de columnas de humo — v2
 *
 * Orquestación de la UI: estado de las dos observaciones, capas del mapa y
 * captura del azimut. Toda la matemática vive en geo.js y la brújula en
 * compass.js; este archivo no calcula nada por su cuenta.
 */

import {
  intersect,
  destination,
  distance,
  uncertaintyArea,
  crossQuality,
  normalizeAzimuth,
  utmToLatLng,
  dmsToDecimal,
  magneticToTrue,
  magneticDeclination,
  MAX_SIGHT_DISTANCE,
} from './geo.js';
import { Compass, diagnose, assessReading } from './compass.js';

const CENTER = [-32.0278273, -64.462219]; // Valle de Calamuchita
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  A: { point: null, azimuth: null },
  B: { point: null, azimuth: null },
  picking: null,      // slot que espera un clic en el mapa
  errorDeg: 3,
  result: null,
};

const layers = {
  markers: {},        // marcadores de observación por slot
  rays: {},           // visuales
  fire: null,
  area: null,
};

let map;
let compass = null;
let compassTarget = null;   // slot para el que se está midiendo
let compassReading = null;

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView(CENTER, 12);

  // Esri World Imagery: satelital con términos de uso públicos, a diferencia
  // del endpoint no oficial de Google que usaba la v1.
  const sat = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Imágenes &copy; Esri' }
  );
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  });

  sat.addTo(map);
  L.control.layers({ Satelital: sat, Mapa: osm }, null, { position: 'topleft' }).addTo(map);

  map.on('click', onMapClick);
}

function onMapClick(e) {
  if (!state.picking) return;
  const slot = state.picking;
  setPoint(slot, { lat: e.latlng.lat, lng: e.latlng.lng });
  stopPicking();
  toast(`Punto ${slot === 'A' ? 1 : 2} ubicado. Ahora cargá el azimut.`);
}

function startPicking(slot) {
  state.picking = slot;
  $('#map').classList.add('is-picking');
  $('#panel').classList.add('is-collapsed');
  toast('Tocá el mapa donde estás parado');
}

function stopPicking() {
  state.picking = null;
  $('#map').classList.remove('is-picking');
  $('#panel').classList.remove('is-collapsed');
}

// ---------------------------------------------------------------------------
// Estado de las observaciones
// ---------------------------------------------------------------------------

function setPoint(slot, point) {
  state[slot].point = point;
  render();
  drawSlot(slot);
  map.setView([point.lat, point.lng], Math.max(map.getZoom(), 13));
}

function setAzimuth(slot, azimuth) {
  state[slot].azimuth = normalizeAzimuth(azimuth);
  render();
  drawSlot(slot);
  recompute();
}

function clearSlot(slot) {
  state[slot] = { point: null, azimuth: null };
  removeLayer(layers.markers, slot);
  removeLayer(layers.rays, slot);
  clearResult();
  render();
}

function removeLayer(bag, key) {
  if (bag[key]) {
    map.removeLayer(bag[key]);
    delete bag[key];
  }
}

function resetAll() {
  clearSlot('A');
  clearSlot('B');
  stopPicking();
  map.setView(CENTER, 12);
}

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------

function drawSlot(slot) {
  const { point, azimuth } = state[slot];
  removeLayer(layers.markers, slot);
  removeLayer(layers.rays, slot);
  if (!point) return;

  const label = slot === 'A' ? '1' : '2';
  layers.markers[slot] = L.marker([point.lat, point.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="obs-marker obs-marker--${slot.toLowerCase()}" style="width:26px;height:26px">${label}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
    title: `Observación ${label}`,
  }).addTo(map);

  if (azimuth === null) return;

  // La visual se dibuja como un rayo largo: comunica la dirección aunque el
  // foco todavía no se pueda calcular.
  const far = destination(point, azimuth, 60000);
  layers.rays[slot] = L.polyline(
    [[point.lat, point.lng], [far.lat, far.lng]],
    {
      color: slot === 'A' ? '#2b8cff' : '#9b5de5',
      weight: 2,
      opacity: 0.75,
      dashArray: '7 6',
    }
  ).addTo(map);
}

function drawResult(res, unc) {
  if (layers.fire) map.removeLayer(layers.fire);
  if (layers.area) map.removeLayer(layers.area);

  if (unc.polygon && unc.polygon.length >= 3) {
    layers.area = L.polygon(
      unc.polygon.map((p) => [p.lat, p.lng]),
      {
        color: unc.unbounded ? '#e5484d' : '#ff7a1a',
        weight: 1.5,
        fillOpacity: unc.unbounded ? 0.1 : 0.18,
        dashArray: '4 4',
      }
    ).addTo(map);
  }

  layers.fire = L.marker([res.point.lat, res.point.lng], {
    icon: L.divIcon({
      className: '',
      html: '<div class="fire-marker">🔥</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
    zIndexOffset: 1000,
  }).addTo(map);

  const group = L.featureGroup(
    [layers.fire, layers.area, ...Object.values(layers.markers)].filter(Boolean)
  );

  // El panel tapa un costado (o la mitad inferior en mobile): se descuenta ese
  // espacio para que el foco no quede escondido debajo.
  const mobile = window.matchMedia('(max-width: 640px)').matches;
  map.fitBounds(group.getBounds(), {
    paddingTopLeft: [20, 20],
    paddingBottomRight: mobile ? [20, Math.round(window.innerHeight * 0.62)] : [370, 20],
    maxZoom: 16,
  });
}

function clearResult() {
  state.result = null;
  if (layers.fire) { map.removeLayer(layers.fire); layers.fire = null; }
  if (layers.area) { map.removeLayer(layers.area); layers.area = null; }
  $('#result').hidden = true;
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

function recompute() {
  const { A, B } = state;
  if (!A.point || !B.point || A.azimuth === null || B.azimuth === null) {
    clearResult();
    return;
  }

  const res = intersect(A.point, A.azimuth, B.point, B.azimuth);

  if (!res) {
    clearResult();
    toast('Las dos visuales no se cruzan hacia adelante. Revisá los azimuts.');
    return;
  }

  const unc = uncertaintyArea(A.point, A.azimuth, B.point, B.azimuth, state.errorDeg);
  const quality = crossQuality(A.azimuth, B.azimuth);

  state.result = { ...res, unc, quality };
  drawResult(res, unc);
  renderResult();
}

// ---------------------------------------------------------------------------
// Render del panel
// ---------------------------------------------------------------------------

function render() {
  for (const slot of ['A', 'B']) {
    const el = $(`#obs-${slot.toLowerCase()}`);
    const { point, azimuth } = state[slot];
    const filled = Boolean(point);

    el.querySelector('[data-empty]').hidden = filled;
    el.querySelector('[data-filled]').hidden = !filled;
    el.querySelector('.obs__clear').hidden = !filled;

    if (filled) {
      el.querySelector('[data-field="coords"]').textContent =
        `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
      el.querySelector('[data-field="azimuth"]').textContent =
        azimuth === null ? 'sin cargar' : `${azimuth.toFixed(1)}°`;
    }
  }

  // La observación 2 aparece recién cuando la 1 está completa: evita que el
  // usuario cargue datos sueltos sin entender la secuencia.
  const aReady = state.A.point && state.A.azimuth !== null;
  $('#obs-b').hidden = !aReady;
  $('#intro').hidden = Boolean(state.A.point);
}

function renderResult() {
  const r = state.result;
  if (!r) return;

  $('#result').hidden = false;
  $('#res-coords').textContent = `${r.point.lat.toFixed(6)}, ${r.point.lng.toFixed(6)}`;
  $('#res-dist').textContent =
    `${fmtDist(r.distA)} desde 1 · ${fmtDist(r.distB)} desde 2`;

  // Si algún borde del margen de error ya no produce cruce, la zona posible no
  // está acotada: dar un radio ahí sería mentirle al usuario.
  if (r.unc.unbounded) {
    $('#res-unc').textContent =
      `sin acotar con ±${state.errorDeg}° — las visuales se vuelven paralelas`;
  } else {
    $('#res-unc').textContent = r.unc.radius
      ? `± ${fmtDist(r.unc.radius)} (con ±${state.errorDeg}° de error)`
      : '—';
  }

  const chip = $('#quality-chip');
  chip.textContent = `${r.quality.angle.toFixed(0)}° · ${r.quality.label}`;
  chip.className = `chip chip--${r.quality.level}`;
}

function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

// ---------------------------------------------------------------------------
// Geolocalización
// ---------------------------------------------------------------------------

function useGPS(slot) {
  if (!navigator.geolocation) {
    return toast('Este dispositivo no expone geolocalización.');
  }
  toast('Obteniendo ubicación…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setPoint(slot, { lat: pos.coords.latitude, lng: pos.coords.longitude });
      const acc = Math.round(pos.coords.accuracy);
      toast(`Ubicación obtenida (±${acc} m). Ahora cargá el azimut.`);
    },
    (err) => {
      const msgs = {
        1: 'Permiso de ubicación denegado.',
        2: 'No se pudo determinar la posición.',
        3: 'La ubicación tardó demasiado.',
      };
      toast(msgs[err.code] || 'Error al obtener la ubicación.');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
  );
}

// ---------------------------------------------------------------------------
// Brújula
// ---------------------------------------------------------------------------

async function openCompass(slot) {
  const point = state[slot].point;
  if (!point) return toast('Primero cargá la ubicación del punto.');

  const diag = diagnose();
  if (!diag.ok) {
    return toast(diag.reason);
  }

  compassTarget = slot;
  compassReading = null;
  $('#rose-deg').textContent = '—';
  $('#compass-warn').hidden = true;
  $('#compass-accept').disabled = true;
  $('#compass-overlay').hidden = false;

  compass = new Compass();
  compass.onUpdate(onCompassUpdate);

  try {
    // start() se invoca dentro del gesto de click que abrió este overlay,
    // que es lo que iOS exige para conceder el permiso.
    await compass.start();
    $('#compass-accept').disabled = false;
  } catch (err) {
    closeCompass();
    toast(err.message);
  }
}

function onCompassUpdate(reading) {
  const point = state[compassTarget]?.point;
  if (!point) return;

  // El sensor entrega rumbo magnético; el mapa trabaja en rumbo geográfico.
  const trueAz = magneticToTrue(reading.heading, point.lat, point.lng);
  compassReading = trueAz;

  $('#rose-deg').textContent = `${Math.round(trueAz)}°`;
  // La rosa gira en sentido contrario para que la aguja quede fija apuntando
  // hacia donde mira el teléfono.
  $('#rose-dial').style.transform = `rotate(${-trueAz}deg)`;

  const warnings = assessReading(reading);
  const warnEl = $('#compass-warn');
  if (warnings.length) {
    warnEl.textContent = warnings[0];
    warnEl.hidden = false;
  } else {
    warnEl.hidden = true;
  }
}

function closeCompass() {
  if (compass) { compass.stop(); compass = null; }
  $('#compass-overlay').hidden = true;
  compassTarget = null;
}

function acceptCompass() {
  if (compassReading === null || !compassTarget) return closeCompass();
  const slot = compassTarget;
  const az = compassReading;
  const point = state[slot].point;
  const decl = magneticDeclination(point.lat, point.lng);
  closeCompass();
  setAzimuth(slot, az);
  toast(`Azimut ${az.toFixed(1)}° fijado (corregido ${decl.toFixed(1)}° por declinación).`);
}

// ---------------------------------------------------------------------------
// Carga manual
// ---------------------------------------------------------------------------

let manualTarget = null;

function openManual(slot) {
  manualTarget = slot;
  $('#manual-title').textContent = `Observación ${slot === 'A' ? 1 : 2}`;
  $('#manual-error').hidden = true;
  $('#manual-form').reset();
  $('#utm-z').value = 20;
  $('#manual-overlay').hidden = false;
}

function closeManual() {
  $('#manual-overlay').hidden = true;
  manualTarget = null;
}

function activeTab() {
  return $('.tab.is-active').dataset.tab;
}

function readManualPoint() {
  const num = (sel) => {
    const v = parseFloat($(sel).value);
    return Number.isFinite(v) ? v : null;
  };

  if (activeTab() === 'dec') {
    const lat = num('#dec-lat');
    const lng = num('#dec-lng');
    if (lat === null || lng === null) throw new Error('Completá latitud y longitud.');
    if (lat < -90 || lat > 90) throw new Error('La latitud debe estar entre -90 y 90.');
    if (lng < -180 || lng > 180) throw new Error('La longitud debe estar entre -180 y 180.');
    return { lat, lng };
  }

  if (activeTab() === 'dms') {
    const parts = ['#dms-lat-d', '#dms-lat-m', '#dms-lat-s', '#dms-lng-d', '#dms-lng-m', '#dms-lng-s'].map(num);
    if (parts.some((p) => p === null)) throw new Error('Completá los seis campos de GMS.');
    const [ld, lm, ls, gd, gm, gs] = parts;
    // La región de trabajo es hemisferio sur y oeste.
    return {
      lat: dmsToDecimal(ld, lm, ls, 'S'),
      lng: dmsToDecimal(gd, gm, gs, 'O'),
    };
  }

  const e = num('#utm-e');
  const n = num('#utm-n');
  const z = num('#utm-z');
  if (e === null || n === null || z === null) throw new Error('Completá easting, northing y zona.');
  if (z < 1 || z > 60) throw new Error('La zona UTM debe estar entre 1 y 60.');
  return utmToLatLng(e, n, z, true);
}

function submitManual(ev) {
  ev.preventDefault();
  const slot = manualTarget;
  try {
    const point = readManualPoint();
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      throw new Error('Las coordenadas ingresadas no son válidas.');
    }

    const azRaw = $('#man-az').value.trim();
    closeManual();
    setPoint(slot, point);

    if (azRaw !== '') {
      const az = parseFloat(azRaw);
      if (!Number.isFinite(az)) return toast('El azimut no es un número válido.');
      setAzimuth(slot, az);
    } else {
      toast('Punto cargado. Falta el azimut.');
    }
  } catch (err) {
    const el = $('#manual-error');
    el.textContent = err.message;
    el.hidden = false;
  }
}

/** Azimut escrito a mano, sin brújula. */
function promptAzimuth(slot) {
  const current = state[slot].azimuth;
  const raw = window.prompt(
    'Azimut en grados (0 = Norte, 90 = Este):',
    current === null ? '' : String(Math.round(current))
  );
  if (raw === null) return;
  const az = parseFloat(raw);
  if (!Number.isFinite(az)) return toast('El azimut debe ser un número.');
  setAzimuth(slot, az);
}

// ---------------------------------------------------------------------------
// Compartir
// ---------------------------------------------------------------------------

function shareWhatsApp() {
  const r = state.result;
  if (!r) return;
  const { lat, lng } = r.point;
  const text =
    `🔥 Posible foco de incendio\n` +
    `Ubicación estimada: ${lat.toFixed(6)}, ${lng.toFixed(6)}\n` +
    (r.unc.unbounded
      ? `Precisión: baja, estimación poco confiable\n`
      : r.unc.radius
        ? `Precisión: ± ${fmtDist(r.unc.radius)}\n`
        : '') +
    `Ángulo de corte: ${r.quality.angle.toFixed(0)}° (${r.quality.label})\n` +
    `Mapa: https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

async function copyCoords() {
  const r = state.result;
  if (!r) return;
  const txt = `${r.point.lat.toFixed(6)}, ${r.point.lng.toFixed(6)}`;
  try {
    await navigator.clipboard.writeText(txt);
    toast('Coordenadas copiadas.');
  } catch {
    window.prompt('Copiá las coordenadas:', txt);
  }
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function bind() {
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (btn) {
      const { action, slot } = btn.dataset;
      if (action === 'gps') useGPS(slot);
      else if (action === 'map') startPicking(slot);
      else if (action === 'manual') openManual(slot);
      else if (action === 'compass') openCompass(slot);
      else if (action === 'azimuth') promptAzimuth(slot);
      return;
    }
    const clear = ev.target.closest('[data-clear]');
    if (clear) clearSlot(clear.dataset.clear);
  });

  $('#toggle-panel').addEventListener('click', (ev) => {
    const panel = $('#panel');
    panel.classList.toggle('is-collapsed');
    ev.currentTarget.setAttribute(
      'aria-expanded',
      String(!panel.classList.contains('is-collapsed'))
    );
  });

  $('#reset').addEventListener('click', resetAll);
  $('#share-wa').addEventListener('click', shareWhatsApp);
  $('#copy-coords').addEventListener('click', copyCoords);

  $('#compass-cancel').addEventListener('click', closeCompass);
  $('#compass-accept').addEventListener('click', acceptCompass);

  $('#manual-cancel').addEventListener('click', closeManual);
  $('#manual-form').addEventListener('submit', submitManual);

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.tabpane').forEach((p) =>
        p.classList.toggle('is-active', p.dataset.pane === tab.dataset.tab)
      );
    });
  });

  const range = $('#err-range');
  range.addEventListener('input', () => {
    state.errorDeg = parseInt(range.value, 10);
    $('#err-out').textContent = `±${state.errorDeg}°`;
    if (state.result) recompute();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!$('#compass-overlay').hidden) closeCompass();
    else if (!$('#manual-overlay').hidden) closeManual();
    else if (state.picking) stopPicking();
  });
}

initMap();
bind();
render();
