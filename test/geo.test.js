import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  intersect,
  destination,
  distance,
  bearing,
  utmToLatLng,
  dmsToDecimal,
  normalizeAzimuth,
  crossQuality,
  uncertaintyArea,
} from '../public/js/geo.js';

describe('conversión de coordenadas', () => {
  test('UTM 20S reproduce el Punto 1 del caso INTA Manfredi', () => {
    const p = utmToLatLng(429944.13, 6473934.89, 20, true);
    assert.ok(Math.abs(p.lat - -31.868193) < 1e-5, `lat fue ${p.lat}`);
    assert.ok(Math.abs(p.lng - -63.740616) < 1e-5, `lng fue ${p.lng}`);
  });

  test('GMS a decimal respeta el hemisferio sur y oeste', () => {
    assert.ok(Math.abs(dmsToDecimal(31, 58, 41, 'S') - -31.978056) < 1e-6);
    assert.ok(Math.abs(dmsToDecimal(64, 33, 30, 'O') - -64.558333) < 1e-6);
  });

  test('normalizeAzimuth acota valores fuera de rango', () => {
    assert.equal(normalizeAzimuth(370), 10);
    assert.equal(normalizeAzimuth(-10), 350);
    assert.equal(normalizeAzimuth(360), 0);
  });
});

describe('primitivas geodésicas', () => {
  test('destination y bearing son inversas entre sí', () => {
    const origin = { lat: -31.97, lng: -64.55 };
    const target = destination(origin, 106, 5000);
    assert.ok(Math.abs(bearing(origin, target) - 106) < 0.01);
    assert.ok(Math.abs(distance(origin, target) - 5000) < 0.5);
  });
});

describe('intersección de visuales', () => {
  /**
   * Prueba de ida y vuelta: se fija un foco conocido, se calculan los rumbos
   * reales desde dos observadores y se verifica que la intersección devuelva
   * ese mismo foco. Es la garantía de que el cálculo es correcto, independiente
   * de cualquier dato de campo.
   */
  test('recupera un foco conocido a partir de los rumbos exactos', () => {
    const foco = { lat: -31.9876, lng: -64.5215 };
    const obsA = { lat: -31.978056, lng: -64.558333 };
    const obsB = { lat: -31.979167, lng: -64.548611 };

    const r = intersect(obsA, bearing(obsA, foco), obsB, bearing(obsB, foco));
    assert.ok(r, 'debería encontrar intersección');
    assert.ok(
      distance(r.point, foco) < 1,
      `error de ${distance(r.point, foco).toFixed(2)} m`
    );
  });

  test('caso 1 - INTA Manfredi', () => {
    const p1 = utmToLatLng(429944.13, 6473934.89, 20, true);
    const p2 = utmToLatLng(430390.92, 6475005.07, 20, true);
    const r = intersect(p1, 119, p2, 131);

    assert.ok(r, 'debería encontrar intersección');
    // El foco queda al sudeste de ambos observadores, a pocos km.
    assert.ok(r.point.lat < p1.lat, 'el foco debe quedar al sur');
    assert.ok(r.point.lng > p1.lng, 'el foco debe quedar al este');
    assert.ok(r.distA > 1000 && r.distA < 20000, `distancia ${r.distA}`);

    // Los rumbos desde cada observador hacia el resultado deben coincidir con
    // los azimuts ingresados: esto es lo que la v1 no cumplía.
    assert.ok(Math.abs(bearing(p1, r.point) - 119) < 0.01);
    assert.ok(Math.abs(bearing(p2, r.point) - 131) < 0.01);
  });

  test('caso 2 - Villa General Belgrano hacia el Cerro de la Virgen', () => {
    const p1 = { lat: dmsToDecimal(31, 58, 41, 'S'), lng: dmsToDecimal(64, 33, 30, 'O') };
    const p2 = { lat: dmsToDecimal(31, 58, 45, 'S'), lng: dmsToDecimal(64, 32, 55, 'O') };
    const r = intersect(p1, 106, p2, 125);

    assert.ok(r, 'debería encontrar intersección');
    assert.ok(Math.abs(bearing(p1, r.point) - 106) < 0.01);
    assert.ok(Math.abs(bearing(p2, r.point) - 125) < 0.01);
  });

  test('visuales paralelas no producen resultado', () => {
    const a = { lat: -32, lng: -64.5 };
    const b = { lat: -32.01, lng: -64.5 };
    assert.equal(intersect(a, 90, b, 90), null);
  });

  test('un cruce a espaldas de los observadores se rechaza', () => {
    const a = { lat: -32, lng: -64.5 };
    const b = { lat: -32, lng: -64.4 };
    // ambos miran hacia afuera: el cruce matemático queda detrás
    assert.equal(intersect(a, 270, b, 90), null);
  });

  /**
   * Caso que conviene tener fijado porque no es evidente: el rumbo de A hacia B
   * es 103°. Si A mira a 100°, su visual pasa por delante de B y las dos líneas
   * divergen en lugar de cruzarse. No hay foco posible, y la función debe
   * decirlo en vez de devolver un punto inventado del otro lado del mundo.
   */
  test('visuales divergentes no producen foco', () => {
    const a = { lat: -31.97, lng: -64.55 };
    const b = { lat: -31.98, lng: -64.5 };
    assert.ok(Math.abs(bearing(a, b) - 103.28) < 0.1, 'premisa del caso');
    assert.equal(intersect(a, 100, b, 140), null);
  });

  test('nunca devuelve una intersección antipodal', () => {
    // barrido de combinaciones: ningún resultado debe superar el límite de visión
    for (let azA = 0; azA < 360; azA += 15) {
      for (let azB = 0; azB < 360; azB += 15) {
        const r = intersect({ lat: -32, lng: -64.5 }, azA, { lat: -32.02, lng: -64.45 }, azB);
        if (r) {
          assert.ok(
            r.distA <= 200000,
            `azA=${azA} azB=${azB} dio ${Math.round(r.distA / 1000)} km`
          );
        }
      }
    }
  });

  test('observadores en el mismo punto no permiten triangular', () => {
    const a = { lat: -32, lng: -64.5 };
    assert.equal(intersect(a, 100, { ...a }, 120), null);
  });
});

describe('calidad y área de incertidumbre', () => {
  test('detecta visuales casi paralelas como mala geometría', () => {
    assert.equal(crossQuality(100, 105).level, 'mala');
    assert.equal(crossQuality(100, 140).level, 'buena');
  });

  /**
   * Con un ángulo de corte chico, abrir el margen de error hace que alguno de
   * los bordes del sector deje de cruzarse: la zona posible se vuelve abierta.
   * El cálculo debe declararlo en vez de devolver un radio que parecería
   * preciso justamente cuando menos hay que confiar en él.
   */
  test('marca como no acotada la zona cuando el corte es malo', () => {
    const A = utmToLatLng(429944.13, 6473934.89, 20, true);
    const B = utmToLatLng(430390.92, 6475005.07, 20, true);
    assert.ok(crossQuality(119, 131).angle < 15, 'premisa: corte malo');

    const chico = uncertaintyArea(A, 119, B, 131, 1);
    assert.equal(chico.unbounded, false, 'con ±1° todavía cierra');

    const grande = uncertaintyArea(A, 119, B, 131, 8);
    assert.equal(grande.unbounded, true, 'con ±8° ya no cierra');
  });

  test('devuelve un polígono para visuales que convergen', () => {
    const obsA = { lat: -31.97, lng: -64.55 };
    const obsB = { lat: -31.98, lng: -64.50 };
    const unc = uncertaintyArea(obsA, 120, obsB, 150, 3);
    assert.ok(unc.polygon && unc.polygon.length >= 3, 'debería devolver un polígono');
    assert.equal(unc.unbounded, false, 'con buen ángulo de corte debe estar acotada');
    assert.ok(unc.radius > 0, 'debería informar un radio');
  });

  test('un mayor error angular produce un área mayor', () => {
    const obsA = { lat: -31.97, lng: -64.55 };
    const obsB = { lat: -31.98, lng: -64.50 };
    const bbox = (poly) => {
      const lats = poly.map((p) => p.lat);
      const lngs = poly.map((p) => p.lng);
      return (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lngs) - Math.min(...lngs));
    };
    const chica = uncertaintyArea(obsA, 120, obsB, 150, 1);
    const grande = uncertaintyArea(obsA, 120, obsB, 150, 5);
    assert.ok(bbox(grande.polygon) > bbox(chica.polygon), 'el área debe crecer con el error angular');
    assert.ok(grande.radius > chica.radius, 'el radio debe crecer con el error angular');
  });

  test('el foco calculado cae dentro de su área de incertidumbre', () => {
    const obsA = { lat: -31.97, lng: -64.55 };
    const obsB = { lat: -31.98, lng: -64.50 };
    const r = intersect(obsA, 120, obsB, 150);
    const area = uncertaintyArea(obsA, 120, obsB, 150, 3).polygon;

    // test de punto en polígono (ray casting)
    let inside = false;
    for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
      const xi = area[i].lng, yi = area[i].lat;
      const xj = area[j].lng, yj = area[j].lat;
      if (
        yi > r.point.lat !== yj > r.point.lat &&
        r.point.lng < ((xj - xi) * (r.point.lat - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    assert.ok(inside, 'el foco estimado debe estar dentro del área');
  });
});
