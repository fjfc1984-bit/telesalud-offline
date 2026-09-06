const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
// Misma variable que db.js — así una base en memoria (usada por las pruebas automatizadas) no
// intenta respaldar ni contamina el directorio real de datos.
const DB_FILE = process.env.TELESALUD_DB_PATH || path.join(DATA_DIR, 'telesalud.db');

// Cuántas copias conservar. A este ritmo (una copia diaria por defecto, ver server.js), 30
// copias cubren un mes de historial sin dejar crecer el directorio indefinidamente.
const MAX_BACKUPS = 30;

// SQLite en modo WAL mantiene las escrituras recientes en el archivo -wal, no en el .db
// principal, hasta que ocurre un checkpoint. Sin este paso, copiar solo telesalud.db podría
// omitir encuentros creados justo antes del backup.
function checkpoint() {
  db.exec('PRAGMA wal_checkpoint(FULL)');
}

function crearBackup() {
  // Una base ':memory:' no tiene archivo que copiar — es el caso de las pruebas automatizadas,
  // donde respaldar no aplica.
  if (DB_FILE === ':memory:' || !fs.existsSync(DB_FILE)) return null;
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  checkpoint();

  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(BACKUP_DIR, `telesalud-${marca}.db`);
  fs.copyFileSync(DB_FILE, destino);

  podarBackupsAntiguos();
  return destino;
}

function podarBackupsAntiguos() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const archivos = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('telesalud-') && f.endsWith('.db'))
    .map((f) => ({ nombre: f, ruta: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const viejo of archivos.slice(MAX_BACKUPS)) {
    fs.unlinkSync(viejo.ruta);
  }
}

function listarBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('telesalud-') && f.endsWith('.db'))
    .map((f) => {
      const ruta = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(ruta);
      return { archivo: f, tamano_bytes: stat.size, creado_en: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en));
}

// Se ejecuta una vez al iniciar el servidor y luego cada `intervaloMs` (24h por defecto desde
// server.js). Este mecanismo cubre el caso de uso de un piloto pequeño corriendo en un solo
// proceso; en un despliegue real conviene además una copia fuera de esta misma máquina (ver
// SECURITY.md, "Estado de madurez").
function iniciarBackupsAutomaticos(intervaloMs) {
  crearBackup();
  return setInterval(crearBackup, intervaloMs);
}

module.exports = { crearBackup, listarBackups, iniciarBackupsAutomaticos, BACKUP_DIR };
