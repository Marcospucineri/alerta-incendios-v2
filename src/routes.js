import { Router } from 'express';
import { getStore } from './store.js';

export const router = Router();

/**
 * Validación de un reporte de triangulación. El cálculo del foco se hace en el
 * cliente (geo.js); el servidor solo persiste lo que se le manda, así que acá
 * verificamos que los datos tengan sentido antes de guardarlos.
 */
function validateReport(body) {
  const errors = [];
  const { pointA, pointB, azimuthA, azimuthB, estimated } = body || {};

  const validPoint = (p, name) => {
    if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') {
      errors.push(`${name}: coordenadas faltantes o no numéricas`);
      return;
    }
    if (p.lat < -90 || p.lat > 90) errors.push(`${name}: latitud fuera de rango`);
    if (p.lng < -180 || p.lng > 180) errors.push(`${name}: longitud fuera de rango`);
  };

  const validAz = (a, name) => {
    if (typeof a !== 'number' || Number.isNaN(a)) {
      errors.push(`${name}: azimut no numérico`);
    } else if (a < 0 || a >= 360) {
      errors.push(`${name}: azimut fuera de [0, 360)`);
    }
  };

  validPoint(pointA, 'Punto 1');
  validPoint(pointB, 'Punto 2');
  validAz(azimuthA, 'Azimut 1');
  validAz(azimuthB, 'Azimut 2');
  if (estimated) validPoint(estimated, 'Foco estimado');

  return errors;
}

router.get('/reports', async (req, res, next) => {
  try {
    const store = await getStore();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    res.json(await store.listReports(limit));
  } catch (err) {
    next(err);
  }
});

router.post('/reports', async (req, res, next) => {
  try {
    const errors = validateReport(req.body);
    if (errors.length) {
      return res.status(400).json({ error: 'Datos inválidos', detalles: errors });
    }
    const store = await getStore();
    const saved = await store.saveReport({
      ...req.body,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

/**
 * Puntos de observación precargados (torres, puestos conocidos). El documento de
 * alcance los pedía; por ahora el store en memoria devuelve una lista vacía y la
 * UI cae al ingreso manual.
 */
router.get('/observation-points', async (_req, res, next) => {
  try {
    const store = await getStore();
    res.json(await store.listObservationPoints());
  } catch (err) {
    next(err);
  }
});
