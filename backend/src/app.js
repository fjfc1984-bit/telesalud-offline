const express = require('express');
const helmet = require('helmet');
const path = require('node:path');
const { seed } = require('./seed');
const { router: authRouter, requireAuth } = require('./routes/auth');
const syncRouter = require('./routes/sync');
const ussdRouter = require('./routes/ussd');
const smsRouter = require('./routes/sms');
const { crearBackup, listarBackups } = require('./backup');

function createApp() {
  seed();

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({
    // Content-Security-Policy por defecto de helmet bloquearía el propio Service Worker / manifest
    // si no se ajusta; se relaja aquí solo lo necesario para servir el frontend estático.
    contentSecurityPolicy: false,
  }));
  app.use(express.json({ limit: '256kb' }));

  app.use('/api/auth', authRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/ussd', ussdRouter);
  app.use('/api/sms', smsRouter);

  app.get('/api/health', (req, res) => res.json({ status: 'ok', hora_servidor: new Date().toISOString() }));

  // Backups: automáticos cada 24h desde server.js (deshabilitados aquí, y también durante las
  // pruebas — ver TELESALUD_DB_PATH — para no dejar temporizadores vivos que impidan cerrar el
  // proceso). Este par de rutas permite ver el historial y forzar una copia manual, ej. antes de
  // una migración o un despliegue.
  app.get('/api/backups', requireAuth, (req, res) => res.json(listarBackups()));
  app.post('/api/backups', requireAuth, (req, res) => {
    const archivo = crearBackup();
    if (!archivo) return res.status(400).json({ error: 'No hay base de datos para respaldar todavía' });
    res.json({ status: 'creado', archivo });
  });

  const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');
  app.use(express.static(FRONTEND_DIR));
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No encontrado' });
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });

  return app;
}

module.exports = { createApp };
