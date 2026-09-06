const { createApp } = require('./app');
const { iniciarBackupsAutomaticos } = require('./backup');

const app = createApp();
const PORT = process.env.PORT || 5175;
app.listen(PORT, () => {
  console.log(`Telesalud Offline-First escuchando en http://localhost:${PORT}`);
  console.log('Profesionales demo -> documento: 1020304050 (medico) / 1122334455 (enfermero)');
});

// Una copia al iniciar y luego cada 24 horas. Ver backend/src/backup.js y SECURITY.md.
const VEINTICUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
iniciarBackupsAutomaticos(VEINTICUATRO_HORAS_MS);
