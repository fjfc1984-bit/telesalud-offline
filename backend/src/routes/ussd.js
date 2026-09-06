const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../db');
const { nowIso, shortId, hashEncounter, audit } = require('../util');
const { encryptField } = require('../crypto');

const router = express.Router();

const ussdLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const ussdSchema = z.object({
  sessionId: z.string().trim().min(1).max(120),
  phoneNumber: z.string().trim().min(4).max(30),
  text: z.string().trim().max(200).optional().default(''),
});

// Menu tree for a feature-phone USSD flow. The wire format (sessionId/phoneNumber/text -> "CON "/"END ")
// matches the convention used by African/LatAm USSD aggregators (e.g. Africa's Talking), so swapping
// this simulator for a real telco aggregator is a webhook URL change, not a rewrite.
const SINTOMAS = ['Fiebre', 'Dolor / malestar', 'Dificultad para respirar', 'Diarrea o vómito', 'Otro'];
const GRAVEDAD = ['Leve, puedo esperar', 'Moderado, molesta bastante', 'Urgente, muy fuerte'];

function getSession(sessionId, phone) {
  let s = db.prepare('SELECT * FROM ussd_sessions WHERE session_id = ?').get(sessionId);
  if (!s) {
    db.prepare('INSERT INTO ussd_sessions (session_id, phone, state, data_json, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(sessionId, phone, 'inicio', '{}', nowIso());
    s = db.prepare('SELECT * FROM ussd_sessions WHERE session_id = ?').get(sessionId);
  }
  return s;
}

function saveSession(sessionId, state, data) {
  db.prepare('UPDATE ussd_sessions SET state = ?, data_json = ?, updated_at = ? WHERE session_id = ?')
    .run(state, JSON.stringify(data), nowIso(), sessionId);
}

function crearEncuentroUssd(phone, data) {
  const id = crypto.randomUUID();
  const codigo = shortId(id);
  const now = nowIso();
  const clientId = `ussd-${crypto.randomUUID()}`;
  const item = {
    client_id: clientId,
    creado_en_cliente: now,
    motivo_consulta: `Reporte USSD: ${SINTOMAS[data.sintomaIdx]}`,
    sintomas: [SINTOMAS[data.sintomaIdx]],
    triage_nivel: data.gravedadIdx === 2 ? 'rojo' : data.gravedadIdx === 1 ? 'amarillo' : 'verde',
    consentimiento_informado: true,
  };
  const hash = hashEncounter(item);
  db.prepare(`
    INSERT INTO encounters (
      id, codigo_corto, client_id, device_id, channel, modalidad, paciente_telefono, motivo_consulta, sintomas,
      triage_nivel, consentimiento_informado, consentimiento_medio, consentimiento_timestamp,
      autorizacion_datos_personales, autorizacion_datos_timestamp,
      status, creado_en_cliente, recibido_en_servidor, actualizado_en, sync_version, hash_integridad
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    // El menú inicial (paso 0) presenta ambas autorizaciones en un solo texto — el consentimiento
    // clínico y la autorización de datos personales (Ley 1581/2012) — porque un teléfono básico
    // no permite dos pasos de aceptación separados sin degradar demasiado la experiencia. Quedan
    // registradas como dos campos independientes con el mismo timestamp, no fusionadas en uno solo.
    id, codigo, clientId, `ussd:${phone}`, 'ussd', 'teleorientacion', encryptField(phone), item.motivo_consulta,
    JSON.stringify(item.sintomas), item.triage_nivel, 1, 'menu_ussd_paso_1', now, 1, now,
    'pendiente', now, now, now, 1, hash
  );
  audit({ actorId: `ussd:${phone}`, actorRol: 'canal_ussd', accion: 'crear_encuentro', entidad: 'encounter', entidadId: id, detalle: { sintoma: SINTOMAS[data.sintomaIdx] } });
  return { id, codigo };
}

// Consultar mi caso: implementa la entrega de "copia o resumen" al usuario que la solicite
// (Res. 1644/2026, Art. 10 §1), disponible desde el mismo canal por el que se reportó.
function consultarCaso(codigo) {
  const row = db.prepare('SELECT * FROM encounters WHERE codigo_corto = ?').get((codigo || '').trim().toUpperCase());
  if (!row) return 'END No se encontró ningún caso con ese código. Verifique e intente de nuevo.';

  const estado = { pendiente: 'En espera de revisión', en_triage: 'En revisión', orientado: 'Orientado', remitido_urgencias: 'Remitido a urgencias', remitido_presencial: 'Remitido a atención presencial', cerrado: 'Cerrado' }[row.status] || row.status;
  if (!row.respuesta_profesional) {
    return `END Caso ${row.codigo_corto}: ${estado}. Todavia no tiene respuesta de un profesional. Intente consultar mas tarde.`;
  }
  const resumen = `Caso ${row.codigo_corto}: ${estado}.\nOrientacion: ${row.respuesta_profesional}`.slice(0, 180);
  return `END ${resumen}`;
}

router.post('/', ussdLimiter, (req, res) => {
  const parsed = ussdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).send('END Solicitud inválida');
  const { sessionId, phoneNumber, text } = parsed.data;

  const session = getSession(sessionId, phoneNumber);
  const data = JSON.parse(session.data_json);
  const parts = (text || '').split('*').filter(Boolean);
  const step = parts.length;
  let response;

  if (step === 0) {
    response = 'CON TELESALUD RURAL\nAl continuar: (1) acepta la orientacion en salud, con calculo automatizado de urgencia revisado por un profesional, y (2) autoriza el tratamiento de sus datos personales (Ley 1581/2012). Puede revocarlo despues con su codigo.\n1. Reportar sintoma\n2. Consultar mi caso\n3. Salir';
  } else if (step === 1 && parts[0] === '1') {
    response = `CON Elija el sintoma principal:\n${SINTOMAS.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
  } else if (step === 1 && parts[0] === '2') {
    response = 'CON Escriba el codigo de su caso (8 caracteres):';
  } else if (step === 1 && parts[0] === '3') {
    response = 'END Gracias por comunicarse con Telesalud Rural.';
  } else if (step === 2 && parts[0] === '2') {
    response = consultarCaso(parts[1]);
  } else if (step === 2 && parts[0] === '1') {
    const idx = parseInt(parts[1], 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= SINTOMAS.length) {
      response = 'END Opción inválida. Vuelva a marcar.';
    } else {
      data.sintomaIdx = idx;
      saveSession(sessionId, 'sintoma_elegido', data);
      response = `CON ¿Qué tan fuerte es la molestia?\n${GRAVEDAD.map((g, i) => `${i + 1}. ${g}`).join('\n')}`;
    }
  } else if (step === 3 && parts[0] === '1') {
    const idx = parseInt(parts[2], 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= GRAVEDAD.length) {
      response = 'END Opción inválida. Vuelva a marcar.';
    } else {
      data.gravedadIdx = idx;
      const { codigo } = crearEncuentroUssd(phoneNumber, data);
      const urgente = idx === 2;
      response = urgente
        ? `END Caso ${codigo} registrado como URGENTE. Si tiene dificultad para respirar o dolor de pecho intenso, acuda AHORA al centro de salud mas cercano. Un profesional lo llamara pronto. Guarde este codigo para consultar la respuesta.`
        : `END Caso ${codigo} registrado. Un profesional de salud se comunicara con usted en las proximas horas. Guarde este codigo para consultar la respuesta.`;
    }
  } else {
    response = 'END Sesión no reconocida. Vuelva a marcar.';
  }

  res.type('text/plain').send(response);
});

module.exports = router;
