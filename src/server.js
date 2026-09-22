import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { router as apiRouter } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Railway termina TLS en su proxy

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://unpkg.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://unpkg.com', 'https://*.tile.openstreetmap.org', 'https://server.arcgisonline.com', 'https://*.basemaps.cartocdn.com'],
        connectSrc: ["'self'"],
      },
    },
    // Necesario para que DeviceOrientationEvent funcione sin bloqueos extra
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());
app.use(express.json({ limit: '64kb' }));

/**
 * Railway entrega HTTPS en el proxy, pero permite entrar por HTTP. La brújula
 * solo funciona en contexto seguro, así que forzamos el redirect en producción.
 */
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === 'production' &&
    req.headers['x-forwarded-proto'] === 'http'
  ) {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

app.use('/api', apiRouter);

app.use(
  express.static(PUBLIC_DIR, {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    etag: true,
  })
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Detección de columnas de humo v2 escuchando en :${PORT}`);
});
