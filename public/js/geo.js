/**
 * Núcleo geodésico: triangulación de dos visuales sobre el elipsoide.
 *
 * Todo el cálculo se hace con rumbos verdaderos sobre una esfera de radio medio
 * terrestre. A las distancias de esta aplicación (decenas de km) la diferencia
 * contra un cálculo elipsoidal completo es de centímetros, muy por debajo del
 * error de medición de una brújula.
 *
 * Convenio de azimut en todo el módulo: grados sexagesimales, 0 = norte
 * geográfico, sentido horario, rango [0, 360).
 */

export const R = 6371008.8; // radio medio terrestre IUGG, en metros

/**
 * Distancia máxima plausible entre un observador y una columna de humo. Muy por
 * encima de cualquier avistamiento real (el horizonte visual desde una loma
 * ronda los 50-80 km), pero suficientemente baja como para descartar las
 * intersecciones antipodales que genera la geometría esférica.
 */
export const MAX_SIGHT_DISTANCE = 200000; // 200 km

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function normalizeAzimuth(az) {
  return ((az % 360) + 360) % 360;
}

/**
 * Punto destino a partir de un origen, un rumbo y una distancia (fórmula directa).
 * @param {{lat:number, lng:number}} origin
 * @param {number} azimuth grados
 * @param {number} distance metros
 */
export function destination(origin, azimuth, distance) {
  const d = distance / R;
  const brg = rad(normalizeAzimuth(azimuth));
  const lat1 = rad(origin.lat);
  const lng1 = rad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: deg(lat2), lng: ((deg(lng2) + 540) % 360) - 180 };
}

/** Distancia en metros entre dos puntos (haversine). */
export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rumbo inicial en grados desde `a` hacia `b`. */
export function bearing(a, b) {
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeAzimuth(deg(Math.atan2(y, x)));
}

/**
 * Intersección de dos círculos máximos definidos cada uno por un punto y un rumbo.
 *
 * Este es el reemplazo correcto del cálculo de la v1, que resolvía el sistema en
 * grados lat/lng tratados como plano cartesiano. Implementa el método de
 * Vincenty/Bowring tal como lo formula Chris Veness.
 *
 * Devuelve `{point, distA, distB}` o `null` si las visuales no se cruzan hacia
 * adelante (paralelas, divergentes, o el cruce queda a espaldas de un observador).
 */
export function intersect(pA, azA, pB, azB) {
  const φ1 = rad(pA.lat);
  const λ1 = rad(pA.lng);
  const φ2 = rad(pB.lat);
  const λ2 = rad(pB.lng);
  const θ13 = rad(normalizeAzimuth(azA));
  const θ23 = rad(normalizeAzimuth(azB));
  const Δφ = φ2 - φ1;
  const Δλ = λ2 - λ1;

  // distancia angular entre los dos observadores
  const δ12 =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin(Δφ / 2) ** 2 +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
      )
    );

  if (Math.abs(δ12) < Number.EPSILON) {
    return null; // los dos puntos coinciden: no hay base para triangular
  }

  // rumbos iniciales entre los observadores
  let cosθa =
    (Math.sin(φ2) - Math.sin(φ1) * Math.cos(δ12)) /
    (Math.sin(δ12) * Math.cos(φ1));
  let cosθb =
    (Math.sin(φ1) - Math.sin(φ2) * Math.cos(δ12)) /
    (Math.sin(δ12) * Math.cos(φ2));
  // acotar por error de redondeo antes de pasar a acos
  const θa = Math.acos(Math.min(Math.max(cosθa, -1), 1));
  const θb = Math.acos(Math.min(Math.max(cosθb, -1), 1));

  const θ12 = Math.sin(λ2 - λ1) > 0 ? θa : 2 * Math.PI - θa;
  const θ21 = Math.sin(λ2 - λ1) > 0 ? 2 * Math.PI - θb : θb;

  const α1 = θ13 - θ12; // ángulo en el observador A
  const α2 = θ21 - θ23; // ángulo en el observador B

  if (Math.sin(α1) === 0 && Math.sin(α2) === 0) return null; // infinitas soluciones
  if (Math.sin(α1) * Math.sin(α2) < 0) return null; // el cruce cae "detrás"

  const cosα3 =
    -Math.cos(α1) * Math.cos(α2) + Math.sin(α1) * Math.sin(α2) * Math.cos(δ12);
  const δ13 = Math.atan2(
    Math.sin(δ12) * Math.sin(α1) * Math.sin(α2),
    Math.cos(α2) + Math.cos(α1) * cosα3
  );

  const φ3 = Math.asin(
    Math.min(
      Math.max(
        Math.sin(φ1) * Math.cos(δ13) +
          Math.cos(φ1) * Math.sin(δ13) * Math.cos(θ13),
        -1
      ),
      1
    )
  );
  const Δλ13 = Math.atan2(
    Math.sin(θ13) * Math.sin(δ13) * Math.cos(φ1),
    Math.cos(δ13) - Math.sin(φ1) * Math.sin(φ3)
  );
  const λ3 = λ1 + Δλ13;

  const point = { lat: deg(φ3), lng: ((deg(λ3) + 540) % 360) - 180 };
  const distA = δ13 * R;

  // Sobre una esfera dos círculos máximos SIEMPRE se cruzan: visuales paralelas
  // o divergentes producen una intersección antipodal, a media circunferencia de
  // distancia. Matemáticamente válida, operativamente absurda. La descartamos.
  if (!Number.isFinite(distA) || distA > MAX_SIGHT_DISTANCE) return null;

  return {
    point,
    distA,
    distB: distance(pB, point),
  };
}

/**
 * Área de incertidumbre del foco.
 *
 * Cada visual se abre ±`errorDeg` (error de brújula, declinación residual, pulso
 * del observador). Las cuatro combinaciones de los bordes de ambos sectores
 * producen cuatro intersecciones; su envolvente convexa es la zona donde
 * razonablemente está el foco.
 *
 * Esto responde al punto 3 del roadmap del equipo: un área es más honesta que un
 * punto con seis decimales, porque el error angular se amplifica con la distancia.
 */
export function uncertaintyArea(pA, azA, pB, azB, errorDeg = 3) {
  const corners = [];
  let unbounded = false;

  for (const dA of [-errorDeg, errorDeg]) {
    for (const dB of [-errorDeg, errorDeg]) {
      const r = intersect(pA, azA + dA, pB, azB + dB);
      if (r) {
        corners.push(r.point);
      } else {
        // Ese borde del sector no llega a cruzarse: dentro del margen de error
        // las visuales se vuelven paralelas o divergentes, y la zona posible
        // deja de estar acotada.
        unbounded = true;
      }
    }
  }

  if (corners.length < 3) {
    return { polygon: null, unbounded: true, radius: null };
  }

  const polygon = convexHull(corners);
  const base = intersect(pA, azA, pB, azB);
  const radius = base
    ? Math.max(...polygon.map((c) => distance(base.point, c)))
    : null;

  return { polygon, unbounded, radius };
}

/** Envolvente convexa (monotone chain) sobre lng/lat. */
function convexHull(pts) {
  const p = [...pts].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const cross = (o, a, b) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);

  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0)
      upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Calidad geométrica del cruce.
 *
 * Dos visuales casi paralelas dan una intersección matemáticamente válida pero
 * pésima: un error de 1° desplaza el foco kilómetros. El ángulo de corte es el
 * mejor indicador simple de confiabilidad.
 */
export function crossQuality(azA, azB) {
  let diff = Math.abs(normalizeAzimuth(azA) - normalizeAzimuth(azB)) % 180;
  if (diff > 90) diff = 180 - diff;
  if (diff < 15) return { angle: diff, level: 'mala', label: 'Visuales casi paralelas' };
  if (diff < 30) return { angle: diff, level: 'regular', label: 'Ángulo de corte bajo' };
  return { angle: diff, level: 'buena', label: 'Buen ángulo de corte' };
}

// ---------------------------------------------------------------------------
// Conversión de coordenadas
// ---------------------------------------------------------------------------

/** Grados/minutos/segundos a grados decimales. `hemi` es 'N'|'S'|'E'|'O'|'W'. */
export function dmsToDecimal(d, m, s, hemi) {
  const sign = /[SOW]/i.test(hemi) ? -1 : 1;
  return sign * (Math.abs(d) + m / 60 + s / 3600);
}

/**
 * UTM a lat/lng sobre WGS84, inversa de Karney/Snyder.
 *
 * A diferencia de la v1 (que dependía de proj4js por CDN y tenía la zona fija en
 * 20), acá la zona es un parámetro y no hay dependencia externa.
 */
export function utmToLatLng(easting, northing, zone, southern = true) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);

  const x = easting - 500000.0;
  const y = southern ? northing - 10000000.0 : northing;

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));

  const p1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);

  const C1 = ep2 * Math.cos(p1) ** 2;
  const T1 = Math.tan(p1) ** 2;
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2);
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5;
  const D = x / (N1 * k0);

  const lat =
    p1 -
    ((N1 * Math.tan(p1)) / R1) *
      ((D ** 2) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) *
          D ** 6) /
          720);

  const lng =
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) /
        120) /
    Math.cos(p1);

  return {
    lat: deg(lat),
    lng: zone * 6 - 183 + deg(lng),
  };
}

/** Zona UTM que corresponde a una longitud dada. */
export function utmZoneFor(lng) {
  return Math.floor((lng + 180) / 6) + 1;
}

/**
 * Declinación magnética aproximada para el centro de Argentina.
 *
 * El sensor del teléfono entrega rumbo MAGNÉTICO; el mapa está en rumbo
 * GEOGRÁFICO. En Córdoba la diferencia ronda los -5°, que sobre una visual de
 * 10 km son casi 900 m de desvío: no es despreciable.
 *
 * Esto es una aproximación lineal suficiente para la región de operación. Si la
 * app se extiende a otras zonas, conviene reemplazarla por el modelo WMM.
 */
export function magneticDeclination(lat, lng) {
  // Ajuste lineal sobre valores del WMM para el centro-oeste argentino (época 2025).
  return -4.5 + (lng + 64) * 0.55 + (lat + 32) * 0.12;
}

/** Rumbo magnético -> rumbo geográfico. */
export function magneticToTrue(magneticAz, lat, lng) {
  return normalizeAzimuth(magneticAz + magneticDeclination(lat, lng));
}
