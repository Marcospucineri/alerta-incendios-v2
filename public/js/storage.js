/**
 * Persistencia local de la sesión de triangulación.
 *
 * El caso de uso que justifica esto: entre cargar la observación 1 y llegar al
 * segundo punto de observación puede pasar bastante tiempo. En ese rato el
 * teléfono se bloquea, el navegador descarta la pestaña en segundo plano para
 * liberar memoria (iOS lo hace con bastante agresividad) o el usuario la cierra
 * sin querer. Sin persistencia, todo ese trabajo se pierde y hay que volver al
 * primer punto.
 *
 * Se guarda la sesión completa, no solo el punto 1: si la pestaña se pierde
 * después de cargar ambos puntos, el problema es exactamente el mismo.
 *
 * localStorage puede fallar o venir vacío (modo privado, almacenamiento
 * bloqueado, cuota llena), así que todos los accesos van envueltos y la app
 * tiene que funcionar igual si esto no anda.
 */

const KEY = 'columnas-humo:sesion';
const VERSION = 1;

/**
 * Las observaciones viejas dejan de ser útiles: un foco de hace dos días no
 * sirve, y restaurar datos rancios confundiría más de lo que ayuda.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 horas

function isValidPoint(p) {
  return (
    p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

function isValidAzimuth(a) {
  return a === null || (typeof a === 'number' && Number.isFinite(a) && a >= 0 && a < 360);
}

/** Normaliza un slot leído del disco, descartando lo que no tenga sentido. */
function sanitizeSlot(raw) {
  if (!raw || typeof raw !== 'object') return { point: null, azimuth: null };
  const point = isValidPoint(raw.point) ? { lat: raw.point.lat, lng: raw.point.lng } : null;
  // Un azimut sin punto no sirve para nada.
  const azimuth = point && isValidAzimuth(raw.azimuth) ? raw.azimuth : null;
  return { point, azimuth };
}

export function save(state) {
  try {
    const payload = {
      v: VERSION,
      savedAt: Date.now(),
      A: { point: state.A.point, azimuth: state.A.azimuth },
      B: { point: state.B.point, azimuth: state.B.azimuth },
      errorDeg: state.errorDeg,
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Sin almacenamiento la app sigue funcionando, solo que sin memoria.
  }
}

/**
 * Devuelve la sesión guardada, o `null` si no hay nada aprovechable.
 * El `savedAt` se devuelve para poder decirle al usuario de cuándo es.
 */
export function load() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    clear(); // guardado corrupto: no sirve de nada conservarlo
    return null;
  }

  if (!data || data.v !== VERSION) {
    clear();
    return null;
  }

  if (typeof data.savedAt !== 'number' || Date.now() - data.savedAt > MAX_AGE_MS) {
    clear();
    return null;
  }

  const A = sanitizeSlot(data.A);
  const B = sanitizeSlot(data.B);

  // Sin al menos un punto no hay nada que restaurar.
  if (!A.point && !B.point) {
    clear();
    return null;
  }

  const errorDeg =
    typeof data.errorDeg === 'number' && data.errorDeg >= 1 && data.errorDeg <= 10
      ? data.errorDeg
      : 3;

  return { A, B, errorDeg, savedAt: data.savedAt };
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nada que hacer
  }
}

/** Texto legible de cuánto hace que se guardó, para el aviso de restauración. */
export function describeAge(savedAt) {
  const mins = Math.floor((Date.now() - savedAt) / 60000);
  if (mins < 1) return 'recién';
  if (mins === 1) return 'hace 1 minuto';
  if (mins < 60) return `hace ${mins} minutos`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? 'hace 1 hora' : `hace ${hrs} horas`;
}
