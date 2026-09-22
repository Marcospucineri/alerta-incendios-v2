/**
 * Capa de persistencia.
 *
 * Hoy corre en memoria: la app funciona sin base de datos. Si se define
 * MONGODB_URI en el entorno, se usa Mongo Atlas en su lugar, sin que las rutas
 * cambien una línea.
 *
 * Para activar Mongo:
 *   1. npm install mongodb
 *   2. definir MONGODB_URI en las variables de Railway
 *   3. descomentar createMongoStore y su rama en getStore
 */

function createMemoryStore() {
  const reports = [];

  return {
    kind: 'memory',

    async saveReport(report) {
      const saved = { _id: String(reports.length + 1), ...report };
      reports.unshift(saved);
      // El store en memoria se pierde al reiniciar; lo acotamos para no crecer sin fin.
      if (reports.length > 500) reports.pop();
      return saved;
    },

    async listReports(limit) {
      return reports.slice(0, limit);
    },

    async listObservationPoints() {
      // Sin base de datos no hay puntos precargados; la UI usa ingreso manual.
      return [];
    },

    async close() {},
  };
}

// ---------------------------------------------------------------------------
// Mongo Atlas — listo para activar
// ---------------------------------------------------------------------------
//
// import { MongoClient } from 'mongodb';
//
// async function createMongoStore(uri) {
//   const client = new MongoClient(uri, { retryWrites: true, w: 'majority' });
//   await client.connect();
//   const db = client.db(process.env.MONGODB_DB || 'incendios');
//   const reports = db.collection('reports');
//   const points = db.collection('observationPoints');
//
//   // Índice geoespacial para consultar focos por cercanía, y uno temporal
//   // para el listado cronológico.
//   await reports.createIndex({ 'estimated.geo': '2dsphere' });
//   await reports.createIndex({ createdAt: -1 });
//
//   return {
//     kind: 'mongo',
//     async saveReport(report) {
//       const doc = {
//         ...report,
//         // GeoJSON usa [lng, lat], en ese orden
//         estimated: report.estimated
//           ? { ...report.estimated, geo: { type: 'Point', coordinates: [report.estimated.lng, report.estimated.lat] } }
//           : null,
//       };
//       const res = await reports.insertOne(doc);
//       return { ...doc, _id: res.insertedId };
//     },
//     async listReports(limit) {
//       return reports.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
//     },
//     async listObservationPoints() {
//       return points.find({}).sort({ name: 1 }).toArray();
//     },
//     async close() { await client.close(); },
//   };
// }

let storePromise = null;

export function getStore() {
  if (!storePromise) {
    // if (process.env.MONGODB_URI) {
    //   storePromise = createMongoStore(process.env.MONGODB_URI);
    // } else {
    storePromise = Promise.resolve(createMemoryStore());
    // }
  }
  return storePromise;
}
