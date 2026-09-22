import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * storage.js habla con localStorage, que no existe en Node. Se lo simula antes
 * de importar el módulo, incluyendo los modos de falla reales: almacenamiento
 * bloqueado (modo privado) y contenido corrupto.
 */
class FakeStorage {
  constructor() { this.data = new Map(); }
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v) { this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}

globalThis.localStorage = new FakeStorage();

const storage = await import('../public/js/storage.js');

const KEY = 'columnas-humo:sesion';
const punto = (lat, lng) => ({ lat, lng });

function stateWith(A, B, errorDeg = 3) {
  return { A, B, errorDeg };
}

beforeEach(() => {
  globalThis.localStorage = new FakeStorage();
});

describe('guardado y restauración', () => {
  test('una sesión guardada se recupera igual', () => {
    const st = stateWith(
      { point: punto(-31.97, -64.55), azimuth: 106 },
      { point: punto(-31.98, -64.5), azimuth: 125 },
      5
    );
    storage.save(st);

    const out = storage.load();
    assert.ok(out);
    assert.deepEqual(out.A, st.A);
    assert.deepEqual(out.B, st.B);
    assert.equal(out.errorDeg, 5);
    assert.ok(typeof out.savedAt === 'number');
  });

  /** El caso de uso central: se guarda el punto 1 y se vuelve más tarde. */
  test('recupera el punto 1 aunque el 2 esté vacío', () => {
    storage.save(
      stateWith({ point: punto(-31.97, -64.55), azimuth: 106 }, { point: null, azimuth: null })
    );
    const out = storage.load();
    assert.ok(out);
    assert.deepEqual(out.A.point, punto(-31.97, -64.55));
    assert.equal(out.A.azimuth, 106);
    assert.equal(out.B.point, null);
  });

  test('guarda un punto sin azimut todavía', () => {
    storage.save(
      stateWith({ point: punto(-31.97, -64.55), azimuth: null }, { point: null, azimuth: null })
    );
    const out = storage.load();
    assert.ok(out);
    assert.equal(out.A.azimuth, null);
  });

  test('sin nada guardado devuelve null', () => {
    assert.equal(storage.load(), null);
  });

  test('clear borra la sesión', () => {
    storage.save(stateWith({ point: punto(-31.97, -64.55), azimuth: 106 }, { point: null, azimuth: null }));
    storage.clear();
    assert.equal(storage.load(), null);
  });

  test('una sesión sin ningún punto no se restaura', () => {
    storage.save(stateWith({ point: null, azimuth: null }, { point: null, azimuth: null }));
    assert.equal(storage.load(), null);
  });
});

describe('robustez ante datos inválidos', () => {
  test('descarta un JSON corrupto sin explotar', () => {
    localStorage.setItem(KEY, '{esto no es json');
    assert.equal(storage.load(), null);
    assert.equal(localStorage.getItem(KEY), null, 'debe limpiar lo corrupto');
  });

  test('descarta una versión de formato distinta', () => {
    localStorage.setItem(KEY, JSON.stringify({
      v: 99, savedAt: Date.now(),
      A: { point: punto(-31.97, -64.55), azimuth: 106 }, B: { point: null, azimuth: null },
    }));
    assert.equal(storage.load(), null);
  });

  test('descarta una sesión vieja', () => {
    const hace13horas = Date.now() - 13 * 60 * 60 * 1000;
    localStorage.setItem(KEY, JSON.stringify({
      v: 1, savedAt: hace13horas,
      A: { point: punto(-31.97, -64.55), azimuth: 106 }, B: { point: null, azimuth: null },
      errorDeg: 3,
    }));
    assert.equal(storage.load(), null);
  });

  test('conserva una sesión reciente', () => {
    const haceUnaHora = Date.now() - 60 * 60 * 1000;
    localStorage.setItem(KEY, JSON.stringify({
      v: 1, savedAt: haceUnaHora,
      A: { point: punto(-31.97, -64.55), azimuth: 106 }, B: { point: null, azimuth: null },
      errorDeg: 3,
    }));
    assert.ok(storage.load());
  });

  test('descarta coordenadas fuera de rango', () => {
    localStorage.setItem(KEY, JSON.stringify({
      v: 1, savedAt: Date.now(),
      A: { point: { lat: 999, lng: -64.55 }, azimuth: 106 }, B: { point: null, azimuth: null },
    }));
    assert.equal(storage.load(), null, 'sin puntos válidos no hay nada que restaurar');
  });

  test('descarta un azimut fuera de rango pero conserva el punto', () => {
    localStorage.setItem(KEY, JSON.stringify({
      v: 1, savedAt: Date.now(),
      A: { point: punto(-31.97, -64.55), azimuth: 400 }, B: { point: null, azimuth: null },
      errorDeg: 3,
    }));
    const out = storage.load();
    assert.ok(out);
    assert.deepEqual(out.A.point, punto(-31.97, -64.55));
    assert.equal(out.A.azimuth, null, 'el azimut inválido se descarta');
  });

  /** Un azimut sin punto no se puede usar para nada. */
  test('ignora un azimut huérfano', () => {
    localStorage.setItem(KEY, JSON.stringify({
      v: 1, savedAt: Date.now(),
      A: { point: null, azimuth: 106 }, B: { point: punto(-31.98, -64.5), azimuth: 125 },
      errorDeg: 3,
    }));
    const out = storage.load();
    assert.ok(out);
    assert.equal(out.A.azimuth, null);
  });

  test('un errorDeg inválido cae al valor por defecto', () => {
    localStorage.setItem(KEY, JSON.stringify({
      v: 1, savedAt: Date.now(),
      A: { point: punto(-31.97, -64.55), azimuth: 106 }, B: { point: null, azimuth: null },
      errorDeg: 999,
    }));
    assert.equal(storage.load().errorDeg, 3);
  });

  test('NaN en las coordenadas se descarta', () => {
    localStorage.setItem(KEY, JSON.stringify({
      v: 1, savedAt: Date.now(),
      A: { point: { lat: null, lng: null }, azimuth: 106 }, B: { point: null, azimuth: null },
    }));
    assert.equal(storage.load(), null);
  });
});

describe('almacenamiento no disponible', () => {
  /**
   * En modo privado o con el almacenamiento bloqueado, localStorage lanza al
   * escribir. La app tiene que seguir andando, solo que sin memoria.
   */
  test('no propaga el error si el almacenamiento falla', () => {
    globalThis.localStorage = {
      getItem() { throw new Error('bloqueado'); },
      setItem() { throw new Error('bloqueado'); },
      removeItem() { throw new Error('bloqueado'); },
    };
    assert.doesNotThrow(() => storage.save(stateWith({ point: punto(-31.9, -64.5), azimuth: 10 }, { point: null, azimuth: null })));
    assert.doesNotThrow(() => storage.clear());
    assert.equal(storage.load(), null);
  });
});

describe('describeAge', () => {
  test('describe el tiempo transcurrido en lenguaje natural', () => {
    assert.equal(storage.describeAge(Date.now()), 'recién');
    assert.equal(storage.describeAge(Date.now() - 60 * 1000), 'hace 1 minuto');
    assert.equal(storage.describeAge(Date.now() - 25 * 60 * 1000), 'hace 25 minutos');
    assert.equal(storage.describeAge(Date.now() - 60 * 60 * 1000), 'hace 1 hora');
    assert.equal(storage.describeAge(Date.now() - 3 * 60 * 60 * 1000), 'hace 3 horas');
  });
});
