const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Overridable so the automated test suite runs against an isolated database instead of the
// developer's own data/telesalud.db (which may also be locked by a running `npm start`).
const DB_PATH = process.env.TELESALUD_DB_PATH || path.join(DATA_DIR, 'telesalud.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS professionals (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    documento_profesional TEXT UNIQUE NOT NULL,
    rol TEXT NOT NULL,
    rethus_verificado INTEGER NOT NULL DEFAULT 0,
    pin_hash TEXT NOT NULL,
    creado_en TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_profesional TEXT NOT NULL,
    exitoso INTEGER NOT NULL,
    ip TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS encounters (
    id TEXT PRIMARY KEY,
    client_id TEXT UNIQUE NOT NULL,
    codigo_corto TEXT UNIQUE,
    device_id TEXT,
    channel TEXT NOT NULL CHECK (channel IN ('app','sms','ussd')),
    modalidad TEXT NOT NULL DEFAULT 'teleorientacion' CHECK (modalidad IN ('teleorientacion','teleapoyo')),
    categoria_2654 TEXT,
    departamento TEXT,
    municipio TEXT,
    vereda TEXT,
    paciente_nombre TEXT,
    paciente_documento TEXT,
    paciente_documento_hash TEXT,
    paciente_telefono TEXT,
    edad_grupo TEXT,
    gestante INTEGER NOT NULL DEFAULT 0,
    motivo_consulta TEXT,
    sintomas TEXT,
    triage_detalle TEXT,
    triage_nivel TEXT CHECK (triage_nivel IN ('rojo','amarillo','verde') OR triage_nivel IS NULL),
    triage_nivel_confirmado TEXT CHECK (triage_nivel_confirmado IN ('rojo','amarillo','verde') OR triage_nivel_confirmado IS NULL),
    consentimiento_informado INTEGER NOT NULL DEFAULT 0,
    consentimiento_medio TEXT,
    consentimiento_timestamp TEXT,
    autorizacion_datos_personales INTEGER NOT NULL DEFAULT 0,
    autorizacion_datos_timestamp TEXT,
    autorizacion_datos_revocada INTEGER NOT NULL DEFAULT 0,
    autorizacion_datos_revocada_en TEXT,
    datos_personales_suprimidos INTEGER NOT NULL DEFAULT 0,
    datos_personales_suprimidos_en TEXT,
    asentimiento_menor INTEGER NOT NULL DEFAULT 0,
    asentimiento_menor_timestamp TEXT,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','en_triage','orientado','remitido_urgencias','remitido_presencial','cerrado')),
    profesional_id TEXT,
    respuesta_profesional TEXT,
    recomendaciones TEXT,
    signos_alarma_seguimiento TEXT,
    requiere_seguimiento INTEGER NOT NULL DEFAULT 0,
    seguimiento_fecha TEXT,
    seguimiento_estado TEXT CHECK (seguimiento_estado IN ('pendiente','completado') OR seguimiento_estado IS NULL),
    checklist_cierre TEXT,
    creado_en_cliente TEXT NOT NULL,
    recibido_en_servidor TEXT NOT NULL,
    actualizado_en TEXT NOT NULL,
    sync_version INTEGER NOT NULL DEFAULT 1,
    hash_integridad TEXT NOT NULL,
    FOREIGN KEY (profesional_id) REFERENCES professionals(id)
  );

  CREATE TABLE IF NOT EXISTS encounter_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    campo_cambiado TEXT NOT NULL,
    valor_anterior TEXT,
    valor_nuevo TEXT,
    cambiado_por TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (encounter_id) REFERENCES encounters(id)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT NOT NULL,
    actor_rol TEXT NOT NULL,
    accion TEXT NOT NULL,
    entidad TEXT NOT NULL,
    entidad_id TEXT,
    timestamp TEXT NOT NULL,
    ip TEXT,
    detalle TEXT
  );

  CREATE TABLE IF NOT EXISTS ussd_sessions (
    session_id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    state TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sms_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_phone TEXT NOT NULL,
    body TEXT NOT NULL,
    related_encounter_id TEXT,
    creado_en TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_encounters_status ON encounters(status);
  CREATE INDEX IF NOT EXISTS idx_encounters_channel ON encounters(channel);
  CREATE INDEX IF NOT EXISTS idx_encounters_documento_hash ON encounters(paciente_documento_hash);
  CREATE INDEX IF NOT EXISTS idx_encounters_municipio ON encounters(municipio);
  CREATE INDEX IF NOT EXISTS idx_encounters_seguimiento ON encounters(seguimiento_estado, seguimiento_fecha);
  CREATE INDEX IF NOT EXISTS idx_encounters_codigo_corto ON encounters(codigo_corto);
`);

module.exports = db;
