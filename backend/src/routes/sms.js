const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../db');
const { nowIso, shortId, hashEncounter, audit } = require('../util');
const { encryptField } = require('../crypto');

const router = express.Router();

const smsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const smsSchema = z.object({
  from: z.string().trim().min(4).max(30),
  text: z.string().trim().min(1).max(500),
});

// Consultar mi caso por SMS: "ESTADO <codigo>". Es la misma entrega de "copia o resumen" que
// exige la Res. 1644/2026 Art. 10 §1, adaptada al canal SMS.
function responderEstado(from, codigo) {
  const row = db.prepare('SELECT * FROM encounters WHERE codigo_corto = ?').get((codigo || '').trim().toUpperCase());
  const cuerpo = !row
    ? 'No se encontró ningún caso con ese código.'
    : !row.respuesta_profesional
      ? `Caso ${row.codigo_corto}: aún sin respuesta de un profesional. Intente más tarde.`
      : `Caso ${row.codigo_corto}: ${row.respuesta_profesional}`.slice(0, 300);
  db.prepare('INSERT INTO sms_outbox (to_phone, body, related_encounter_id, creado_en) VALUES (?, ?, ?, ?)')
    .run(from, cuerpo, row ? row.id : null, nowIso());
}

// Keyword-based SMS intake: "SALUD <descripcion>". Designed for a two-way SMS aggregator
// webhook (Twilio-style {From, Body}) so a patient with only basic SMS, no data plan, can
// still open a teleorientación case; a professional's reply is queued in sms_outbox for the
// aggregator to deliver (see routes/sync.js respuesta endpoint).
router.post('/inbound', smsLimiter, (req, res) => {
  const parsed = smsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'from y text son requeridos' });
  const { from, text } = parsed.data;

  if (/^estado\b/i.test(text)) {
    const codigo = text.replace(/^estado\b/i, '').trim();
    responderEstado(from, codigo);
    return res.json({ status: 'estado_enviado' });
  }

  const esComando = /^salud\b/i.test(text);
  const descripcion = esComando ? text.replace(/^salud\b/i, '').trim() : text;

  if (!descripcion) {
    db.prepare('INSERT INTO sms_outbox (to_phone, body, related_encounter_id, creado_en) VALUES (?, ?, NULL, ?)')
      .run(from, 'Para reportar un síntoma envíe: SALUD seguido de una breve descripción (acepta la orientación en salud y autoriza el tratamiento de sus datos, Ley 1581/2012). Para consultar un caso: ESTADO seguido del código. Ej: SALUD fiebre y tos hace 2 dias', nowIso());
    return res.json({ status: 'instrucciones_enviadas' });
  }

  const id = crypto.randomUUID();
  const codigo = shortId(id);
  const now = nowIso();
  const clientId = `sms-${crypto.randomUUID()}`;
  const item = {
    client_id: clientId,
    creado_en_cliente: now,
    motivo_consulta: descripcion,
    sintomas: [descripcion],
    consentimiento_informado: true,
  };
  const hash = hashEncounter(item);

  db.prepare(`
    INSERT INTO encounters (
      id, codigo_corto, client_id, device_id, channel, modalidad, paciente_telefono, motivo_consulta, sintomas,
      consentimiento_informado, consentimiento_medio, consentimiento_timestamp,
      autorizacion_datos_personales, autorizacion_datos_timestamp,
      status, creado_en_cliente, recibido_en_servidor, actualizado_en, sync_version, hash_integridad
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    // El envío del SMS con la palabra clave "SALUD" se trata como aceptación combinada del
    // consentimiento clínico y la autorización de datos personales (Ley 1581/2012) — el canal SMS
    // no permite dos pasos de aceptación separados. Se registran como dos campos independientes.
    id, codigo, clientId, `sms:${from}`, 'sms', 'teleorientacion', encryptField(from), descripcion,
    JSON.stringify(item.sintomas), 1, 'sms_envio_palabra_clave', now, 1, now,
    'pendiente', now, now, now, 1, hash
  );

  db.prepare('INSERT INTO sms_outbox (to_phone, body, related_encounter_id, creado_en) VALUES (?, ?, ?, ?)').run(
    from, `Caso ${codigo} recibido. Un profesional de salud lo revisara y le respondera por este mismo medio. Para consultar la respuesta despues envie: ESTADO ${codigo}`, id, now
  );

  audit({ actorId: `sms:${from}`, actorRol: 'canal_sms', accion: 'crear_encuentro', entidad: 'encounter', entidadId: id });
  res.json({ status: 'creado', server_id: id, codigo_corto: codigo });
});

router.get('/outbox', (req, res) => {
  const rows = db.prepare('SELECT * FROM sms_outbox ORDER BY id DESC LIMIT 50').all();
  res.json(rows);
});

module.exports = router;
