const crypto = require('node:crypto');
const db = require('./db');

function nowIso() {
  return new Date().toISOString();
}

function shortId(id) {
  return id.slice(0, 8).toUpperCase();
}

// Tamper-evident fingerprint over the clinical core of an encounter.
// Any silent edit to these fields changes the hash, which the audit trail can detect.
function hashEncounter(fields) {
  const core = [
    fields.client_id,
    fields.motivo_consulta || '',
    fields.sintomas || '',
    fields.triage_nivel || '',
    fields.consentimiento_informado ? '1' : '0',
    fields.creado_en_cliente,
  ].join('|');
  return crypto.createHash('sha256').update(core).digest('hex');
}

function audit({ actorId, actorRol, accion, entidad, entidadId, ip, detalle }) {
  db.prepare(
    `INSERT INTO audit_log (actor_id, actor_rol, accion, entidad, entidad_id, timestamp, ip, detalle)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(actorId, actorRol, accion, entidad, entidadId || null, nowIso(), ip || null, detalle ? JSON.stringify(detalle) : null);
}

module.exports = { nowIso, shortId, hashEncounter, audit };
