const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../db');
const { nowIso, hashEncounter, audit, shortId } = require('../util');
const { requireAuth } = require('./auth');
const { encryptField, decryptField, hashLookup } = require('../crypto');

const router = express.Router();

const CAMPOS_PUBLICOS = [
  'id', 'codigo_corto', 'client_id', 'device_id', 'channel', 'modalidad', 'categoria_2654',
  'departamento', 'municipio', 'vereda', 'paciente_nombre', 'paciente_documento',
  'paciente_telefono', 'edad_grupo', 'gestante',
  'motivo_consulta', 'sintomas', 'triage_detalle', 'triage_nivel', 'triage_nivel_confirmado',
  'consentimiento_informado', 'consentimiento_medio', 'consentimiento_timestamp',
  'autorizacion_datos_personales', 'autorizacion_datos_timestamp', 'autorizacion_datos_revocada', 'autorizacion_datos_revocada_en',
  'datos_personales_suprimidos', 'datos_personales_suprimidos_en', 'asentimiento_menor', 'asentimiento_menor_timestamp',
  'status', 'profesional_id', 'respuesta_profesional', 'recomendaciones', 'signos_alarma_seguimiento',
  'requiere_seguimiento', 'seguimiento_fecha', 'seguimiento_estado', 'checklist_cierre',
  'creado_en_cliente', 'recibido_en_servidor', 'actualizado_en', 'sync_version',
];

function toPublic(row) {
  const out = {};
  for (const k of CAMPOS_PUBLICOS) out[k] = row[k];
  out.sintomas = row.sintomas ? JSON.parse(row.sintomas) : [];
  out.triage_detalle = row.triage_detalle ? JSON.parse(row.triage_detalle) : null;
  out.checklist_cierre = row.checklist_cierre ? JSON.parse(row.checklist_cierre) : null;
  out.consentimiento_informado = !!row.consentimiento_informado;
  out.autorizacion_datos_personales = !!row.autorizacion_datos_personales;
  out.autorizacion_datos_revocada = !!row.autorizacion_datos_revocada;
  out.datos_personales_suprimidos = !!row.datos_personales_suprimidos;
  out.asentimiento_menor = !!row.asentimiento_menor;
  out.gestante = !!row.gestante;
  out.requiere_seguimiento = !!row.requiere_seguimiento;
  out.paciente_nombre = decryptField(row.paciente_nombre);
  out.paciente_documento = decryptField(row.paciente_documento);
  out.paciente_telefono = decryptField(row.paciente_telefono);
  return out;
}

const syncSchema = z.object({
  device_id: z.string().trim().max(120).optional(),
  encounters: z.array(z.object({
    client_id: z.string().trim().min(1).max(120),
    creado_en_cliente: z.string().trim().min(1),
    device_id: z.string().trim().max(120).optional(),
    channel: z.enum(['app', 'sms', 'ussd']).optional(),
    modalidad: z.enum(['teleorientacion', 'teleapoyo']).optional(),
    categoria_2654: z.string().trim().max(60).optional().nullable(),
    departamento: z.string().trim().max(120).optional().nullable(),
    municipio: z.string().trim().max(120).optional().nullable(),
    vereda: z.string().trim().max(120).optional().nullable(),
    paciente_nombre: z.string().trim().max(200).optional().nullable(),
    paciente_documento: z.string().trim().max(60).optional().nullable(),
    paciente_telefono: z.string().trim().max(30).optional().nullable(),
    edad_grupo: z.enum(['recien_nacido', 'lactante', 'nino', 'adolescente', 'adulto', 'adulto_mayor']).optional().nullable(),
    gestante: z.boolean().optional(),
    motivo_consulta: z.string().trim().max(2000).optional().nullable(),
    sintomas: z.array(z.string().trim().max(120)).max(20).optional(),
    triage_detalle: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])).optional().nullable(),
    triage_nivel: z.enum(['rojo', 'amarillo', 'verde']).optional().nullable(),
    consentimiento_informado: z.boolean().optional(),
    consentimiento_medio: z.string().trim().max(60).optional().nullable(),
    consentimiento_timestamp: z.string().trim().optional().nullable(),
    autorizacion_datos_personales: z.boolean().optional(),
    autorizacion_datos_timestamp: z.string().trim().optional().nullable(),
    asentimiento_menor: z.boolean().optional(),
    asentimiento_menor_timestamp: z.string().trim().optional().nullable(),
  })).min(1).max(200),
});

const syncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de sincronización desde este origen. Intente de nuevo en unos minutos.' },
});

// Batch, idempotent upload of an offline device's outbox. Each item carries a client-generated
// client_id (UUID) so retried/duplicated submissions never create duplicate encounters — the
// device can safely retry a batch that partially failed (e.g. connection dropped mid-sync).
router.post('/encounters', syncLimiter, (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Cuerpo de la solicitud inválido', detalle: parsed.error.issues });
  }
  const { device_id, encounters } = parsed.data;

  const results = [];
  const findByClientId = db.prepare('SELECT * FROM encounters WHERE client_id = ?');
  const insert = db.prepare(`
    INSERT INTO encounters (
      id, codigo_corto, client_id, device_id, channel, modalidad, categoria_2654,
      departamento, municipio, vereda, paciente_nombre, paciente_documento, paciente_documento_hash,
      paciente_telefono, edad_grupo, gestante,
      motivo_consulta, sintomas, triage_detalle, triage_nivel, consentimiento_informado, consentimiento_medio,
      consentimiento_timestamp, autorizacion_datos_personales, autorizacion_datos_timestamp,
      asentimiento_menor, asentimiento_menor_timestamp,
      status, creado_en_cliente, recibido_en_servidor, actualizado_en,
      sync_version, hash_integridad
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  for (const item of encounters) {
    const existing = findByClientId.get(item.client_id);
    if (existing) {
      // Already synced in a previous attempt — acknowledge without creating a duplicate.
      results.push({ client_id: item.client_id, server_id: existing.id, status: 'ya_sincronizado', codigo_corto: existing.codigo_corto });
      continue;
    }

    if (!item.consentimiento_informado) {
      results.push({ client_id: item.client_id, status: 'rechazado', error: 'La normativa de teleorientación exige consentimiento informado registrado antes de sincronizar' });
      continue;
    }

    // Independientes por diseño (Res. 1644/2026, Art. 7: "El consentimiento informado para la
    // atención en salud es independiente de la autorización para el tratamiento de datos
    // personales, la cual se regirá por lo dispuesto en la Ley 1581 de 2012"). Se exigen los dos.
    if (!item.autorizacion_datos_personales) {
      results.push({ client_id: item.client_id, status: 'rechazado', error: 'La Ley 1581 de 2012 exige autorización de tratamiento de datos personales, independiente del consentimiento clínico' });
      continue;
    }

    // La Res. 1644/2026 Art. 7 exige, para adolescentes, el asentimiento informado del menor
    // además del consentimiento del acudiente (remite a la Resolución 309 sobre atención
    // diferencial). No se pide para recién nacidos/lactantes/niños porque, por su edad, no
    // aplica el criterio de "madurez suficiente para comprender" que exige la norma.
    if (item.edad_grupo === 'adolescente' && !item.asentimiento_menor) {
      results.push({ client_id: item.client_id, status: 'rechazado', error: 'Para adolescentes, la Res. 1644/2026 exige además el asentimiento informado del menor' });
      continue;
    }

    const id = crypto.randomUUID();
    const codigo = shortId(id);
    const now = nowIso();
    const hash = hashEncounter(item);

    insert.run(
      id, codigo, item.client_id, device_id || item.device_id || null, item.channel || 'app', item.modalidad || 'teleorientacion',
      item.categoria_2654 || null, item.departamento || null, item.municipio || null, item.vereda || null,
      encryptField(item.paciente_nombre), encryptField(item.paciente_documento), hashLookup(item.paciente_documento),
      encryptField(item.paciente_telefono), item.edad_grupo || null, item.gestante ? 1 : 0,
      item.motivo_consulta || null, JSON.stringify(item.sintomas || []),
      item.triage_detalle ? JSON.stringify(item.triage_detalle) : null, item.triage_nivel || null,
      item.consentimiento_informado ? 1 : 0, item.consentimiento_medio || null, item.consentimiento_timestamp || null,
      item.autorizacion_datos_personales ? 1 : 0, item.autorizacion_datos_timestamp || null,
      item.asentimiento_menor ? 1 : 0, item.asentimiento_menor_timestamp || null,
      'pendiente', item.creado_en_cliente, now, now, 1, hash
    );

    audit({ actorId: device_id || 'desconocido', actorRol: 'dispositivo_offline', accion: 'crear_encuentro', entidad: 'encounter', entidadId: id, ip: req.ip, detalle: { channel: item.channel } });
    results.push({ client_id: item.client_id, server_id: id, status: 'creado', codigo_corto: codigo });
  }

  res.json({ recibido_en_servidor: nowIso(), resultados: results });
});

const consultaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas desde este origen. Intente de nuevo en unos minutos.' },
});

// Sin autenticación a propósito: es el mecanismo para que el propio paciente/promotor obtenga
// "copia o resumen de la comunicación" de su caso (Res. 1644/2026, Art. 10 §1), desde cualquier
// canal (app, USSD, SMS), sin necesitar una cuenta de profesional. El código corto (8 caracteres)
// actúa como token de acceso de un solo propósito: quien lo tiene es, en la práctica, quien lo
// recibió al reportar el caso. No expone documento/teléfono/nombre del paciente.
router.get('/consulta/:codigo', consultaLimiter, (req, res) => {
  const codigo = (req.params.codigo || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM encounters WHERE codigo_corto = ?').get(codigo);
  if (!row) return res.status(404).json({ error: 'No se encontró ningún caso con ese código' });

  audit({ actorId: `consulta:${codigo}`, actorRol: 'consulta_publica', accion: 'consultar_resumen', entidad: 'encounter', entidadId: row.id, ip: req.ip });

  res.json({
    codigo_corto: row.codigo_corto,
    motivo_consulta: row.motivo_consulta,
    sintomas: row.sintomas ? JSON.parse(row.sintomas) : [],
    triage_nivel: row.triage_nivel,
    status: row.status,
    respuesta_profesional: row.respuesta_profesional,
    recomendaciones: row.recomendaciones,
    signos_alarma_seguimiento: row.signos_alarma_seguimiento,
    creado_en_cliente: row.creado_en_cliente,
    actualizado_en: row.actualizado_en,
    autorizacion_datos_revocada: !!row.autorizacion_datos_revocada,
    datos_personales_suprimidos: !!row.datos_personales_suprimidos,
  });
});

// Derecho de revocación (Ley 1581/2012, Art. 8 — "el usuario podrá revocarlo en cualquier
// momento", Res. 1644/2026 Art. 7). Revoca la autorización de tratamiento de datos personales de
// este caso puntual; no borra el registro (la Res. 1995/1999 exige conservar la historia
// clínica/encuentro), pero deja constancia de que el titular retiró su autorización desde esta
// fecha en adelante — es la IPS/profesional quien debe decidir, con criterio legal, qué implica
// eso para el uso futuro del dato (ver docs/PROTECCION_DATOS_SIC.md).
router.post('/consulta/:codigo/revocar', consultaLimiter, (req, res) => {
  const codigo = (req.params.codigo || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM encounters WHERE codigo_corto = ?').get(codigo);
  if (!row) return res.status(404).json({ error: 'No se encontró ningún caso con ese código' });
  if (row.autorizacion_datos_revocada) return res.json({ status: 'ya_revocada' });

  const now = nowIso();
  db.prepare('UPDATE encounters SET autorizacion_datos_revocada = 1, autorizacion_datos_revocada_en = ? WHERE id = ?').run(now, row.id);
  db.prepare(`
    INSERT INTO encounter_versions (encounter_id, version, campo_cambiado, valor_anterior, valor_nuevo, cambiado_por, timestamp)
    VALUES (?, ?, 'autorizacion_datos_revocada', '0', '1', ?, ?)
  `).run(row.id, row.sync_version + 1, `titular:${codigo}`, now);
  db.prepare('UPDATE encounters SET sync_version = sync_version + 1 WHERE id = ?').run(row.id);

  audit({ actorId: `titular:${codigo}`, actorRol: 'titular_datos', accion: 'revocar_autorizacion_datos', entidad: 'encounter', entidadId: row.id, ip: req.ip });
  res.json({ status: 'revocada', revocada_en: now });
});

const rectificarSchema = z.object({
  paciente_nombre: z.string().trim().max(200).optional(),
  paciente_telefono: z.string().trim().max(30).optional(),
  departamento: z.string().trim().max(120).optional(),
  municipio: z.string().trim().max(120).optional(),
  vereda: z.string().trim().max(120).optional(),
  edad_grupo: z.enum(['recien_nacido', 'lactante', 'nino', 'adolescente', 'adulto', 'adulto_mayor']).optional(),
  gestante: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'Debe indicar al menos un dato a corregir' });

// Derecho de rectificación (Ley 1581/2012, Art. 8): permite al titular corregir datos de
// identificación inexactos o incompletos que él mismo aportó. Deliberadamente NO permite
// corregir el motivo de consulta, los síntomas ni la respuesta del profesional — eso es el
// registro clínico del encuentro tal como ocurrió, no un dato de identificación del titular.
router.post('/consulta/:codigo/rectificar', consultaLimiter, (req, res) => {
  const codigo = (req.params.codigo || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM encounters WHERE codigo_corto = ?').get(codigo);
  if (!row) return res.status(404).json({ error: 'No se encontró ningún caso con ese código' });
  if (row.datos_personales_suprimidos) return res.status(400).json({ error: 'Los datos de este caso ya fueron suprimidos y no pueden rectificarse' });

  const parsed = rectificarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Cuerpo de la solicitud inválido', detalle: parsed.error.issues });
  const cambios = parsed.data;

  const now = nowIso();
  const nextVersion = row.sync_version + 1;
  const insertVersion = db.prepare(`
    INSERT INTO encounter_versions (encounter_id, version, campo_cambiado, valor_anterior, valor_nuevo, cambiado_por, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  if (cambios.paciente_nombre !== undefined) insertVersion.run(row.id, nextVersion, 'paciente_nombre', '(cifrado)', '(cifrado, rectificado)', `titular:${codigo}`, now);
  if (cambios.paciente_telefono !== undefined) insertVersion.run(row.id, nextVersion, 'paciente_telefono', '(cifrado)', '(cifrado, rectificado)', `titular:${codigo}`, now);
  for (const campo of ['departamento', 'municipio', 'vereda', 'edad_grupo']) {
    if (cambios[campo] !== undefined) insertVersion.run(row.id, nextVersion, campo, row[campo], cambios[campo], `titular:${codigo}`, now);
  }
  if (cambios.gestante !== undefined) insertVersion.run(row.id, nextVersion, 'gestante', String(!!row.gestante), String(cambios.gestante), `titular:${codigo}`, now);

  db.prepare(`
    UPDATE encounters SET
      paciente_nombre = COALESCE(?, paciente_nombre),
      paciente_telefono = COALESCE(?, paciente_telefono),
      departamento = COALESCE(?, departamento),
      municipio = COALESCE(?, municipio),
      vereda = COALESCE(?, vereda),
      edad_grupo = COALESCE(?, edad_grupo),
      gestante = COALESCE(?, gestante),
      actualizado_en = ?, sync_version = ?
    WHERE id = ?
  `).run(
    cambios.paciente_nombre !== undefined ? encryptField(cambios.paciente_nombre) : null,
    cambios.paciente_telefono !== undefined ? encryptField(cambios.paciente_telefono) : null,
    cambios.departamento ?? null, cambios.municipio ?? null, cambios.vereda ?? null, cambios.edad_grupo ?? null,
    cambios.gestante !== undefined ? (cambios.gestante ? 1 : 0) : null,
    now, nextVersion, row.id
  );

  audit({ actorId: `titular:${codigo}`, actorRol: 'titular_datos', accion: 'rectificar_datos', entidad: 'encounter', entidadId: row.id, ip: req.ip, detalle: { campos: Object.keys(cambios) } });
  res.json({ status: 'rectificado' });
});

// Derecho de supresión (Ley 1581/2012, Art. 8). No se puede borrar el encuentro clínico completo
// — la Resolución 1995/1999 exige conservar la historia clínica un mínimo de 15 años, que es
// precisamente la excepción que la misma Ley 1581/2012 prevé para el derecho de supresión cuando
// existe un deber legal de conservación. Lo que sí se hace es anonimizar los datos que
// identifican al titular (nombre, documento, teléfono), conservando el contenido clínico.
router.post('/consulta/:codigo/eliminar', consultaLimiter, (req, res) => {
  const codigo = (req.params.codigo || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM encounters WHERE codigo_corto = ?').get(codigo);
  if (!row) return res.status(404).json({ error: 'No se encontró ningún caso con ese código' });
  if (row.datos_personales_suprimidos) return res.json({ status: 'ya_suprimidos' });

  const now = nowIso();
  const nextVersion = row.sync_version + 1;
  db.prepare(`
    INSERT INTO encounter_versions (encounter_id, version, campo_cambiado, valor_anterior, valor_nuevo, cambiado_por, timestamp)
    VALUES (?, ?, 'datos_personales_suprimidos', '0', '1', ?, ?)
  `).run(row.id, nextVersion, `titular:${codigo}`, now);

  db.prepare(`
    UPDATE encounters SET
      paciente_nombre = NULL, paciente_documento = NULL, paciente_documento_hash = NULL, paciente_telefono = NULL,
      datos_personales_suprimidos = 1, datos_personales_suprimidos_en = ?,
      actualizado_en = ?, sync_version = ?
    WHERE id = ?
  `).run(now, now, nextVersion, row.id);

  audit({ actorId: `titular:${codigo}`, actorRol: 'titular_datos', accion: 'suprimir_datos_personales', entidad: 'encounter', entidadId: row.id, ip: req.ip });
  res.json({ status: 'suprimido', nota: 'Se eliminó su información de identificación. El registro clínico se conserva anonimizado por obligación legal (Res. 1995/1999).' });
});

router.get('/encounters', requireAuth, (req, res) => {
  const { status, channel, municipio, documento, desde, hasta } = req.query;
  let sql = 'SELECT * FROM encounters WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (channel) { sql += ' AND channel = ?'; params.push(channel); }
  if (municipio) { sql += ' AND municipio = ?'; params.push(municipio); }
  if (documento) { sql += ' AND paciente_documento_hash = ?'; params.push(hashLookup(documento)); }
  if (desde) { sql += ' AND creado_en_cliente >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND creado_en_cliente <= ?'; params.push(hasta); }
  sql += ' ORDER BY CASE triage_nivel WHEN \'rojo\' THEN 0 WHEN \'amarillo\' THEN 1 ELSE 2 END, creado_en_cliente ASC';

  const rows = db.prepare(sql).all(...params);
  audit({ actorId: req.professional.id, actorRol: req.professional.rol, accion: 'listar_encuentros', entidad: 'encounter', ip: req.ip, detalle: { status, channel, municipio } });
  res.json(rows.map(toPublic));
});

// Historia del paciente a través de varios encuentros, aunque hayan llegado por canales
// distintos (app, USSD, SMS) — se busca por el índice ciego del documento, nunca por texto plano.
router.get('/patients/:documento/historial', requireAuth, (req, res) => {
  const hash = hashLookup(req.params.documento);
  if (!hash) return res.status(400).json({ error: 'Documento inválido' });

  const rows = db.prepare('SELECT * FROM encounters WHERE paciente_documento_hash = ? ORDER BY creado_en_cliente DESC').all(hash);
  audit({ actorId: req.professional.id, actorRol: req.professional.rol, accion: 'ver_historial_paciente', entidad: 'patient', ip: req.ip });
  res.json(rows.map(toPublic));
});

// "Ficha del paciente": un resumen agregado a través de todos sus encuentros — no es una
// Historia Clínica Electrónica (ver docs/ACREDITACION_Y_HISTORIA_CLINICA.md), pero es el paso
// concreto y honesto que sí cabe en este prototipo: darle al profesional una vista longitudinal
// en vez de encuentros aislados que hay que reconstruir mentalmente uno por uno.
router.get('/patients/:documento/resumen', requireAuth, (req, res) => {
  const hash = hashLookup(req.params.documento);
  if (!hash) return res.status(400).json({ error: 'Documento inválido' });

  const rows = db.prepare('SELECT * FROM encounters WHERE paciente_documento_hash = ? ORDER BY creado_en_cliente ASC').all(hash);
  if (rows.length === 0) return res.json(null);

  const conteoSintomas = {};
  const conteoTriage = { rojo: 0, amarillo: 0, verde: 0 };
  let encuentrosConRemision = 0;
  for (const row of rows) {
    for (const s of JSON.parse(row.sintomas || '[]')) conteoSintomas[s] = (conteoSintomas[s] || 0) + 1;
    if (row.triage_nivel) conteoTriage[row.triage_nivel] = (conteoTriage[row.triage_nivel] || 0) + 1;
    if (row.status === 'remitido_urgencias' || row.status === 'remitido_presencial') encuentrosConRemision += 1;
  }
  const sintomasFrecuentes = Object.entries(conteoSintomas)
    .sort((a, b) => b[1] - a[1])
    .map(([sintoma, veces]) => ({ sintoma, veces }));

  const ultimo = rows[rows.length - 1];
  const resumen = {
    paciente_nombre: decryptField(ultimo.paciente_nombre),
    paciente_documento: decryptField(ultimo.paciente_documento),
    total_encuentros: rows.length,
    primera_consulta: rows[0].creado_en_cliente,
    ultima_consulta: ultimo.creado_en_cliente,
    edad_grupo_mas_reciente: ultimo.edad_grupo,
    gestante_mas_reciente: !!ultimo.gestante,
    sintomas_frecuentes: sintomasFrecuentes,
    niveles_triage_historial: conteoTriage,
    encuentros_con_remision: encuentrosConRemision,
  };

  audit({ actorId: req.professional.id, actorRol: req.professional.rol, accion: 'ver_resumen_paciente', entidad: 'patient', ip: req.ip });
  res.json(resumen);
});

router.get('/stats', requireAuth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM encounters').get().n;
  const porEstado = db.prepare('SELECT status, COUNT(*) AS n FROM encounters GROUP BY status').all();
  const porTriage = db.prepare('SELECT triage_nivel, COUNT(*) AS n FROM encounters WHERE triage_nivel IS NOT NULL GROUP BY triage_nivel').all();
  const porCanal = db.prepare('SELECT channel, COUNT(*) AS n FROM encounters GROUP BY channel').all();

  // Tiempo de respuesta: desde que el caso llega al servidor hasta que un profesional lo
  // saca de "pendiente" (queda registrado como la primera versión de campo "status").
  const tiempos = db.prepare(`
    SELECT e.recibido_en_servidor AS recibido, MIN(v.timestamp) AS primera_respuesta
    FROM encounters e JOIN encounter_versions v ON v.encounter_id = e.id AND v.campo_cambiado = 'status'
    GROUP BY e.id
  `).all();
  const horasRespuesta = tiempos
    .map((t) => (new Date(t.primera_respuesta) - new Date(t.recibido)) / 3_600_000)
    .filter((h) => h >= 0);
  const promedioHorasRespuesta = horasRespuesta.length
    ? Math.round((horasRespuesta.reduce((a, b) => a + b, 0) / horasRespuesta.length) * 10) / 10
    : null;

  audit({ actorId: req.professional.id, actorRol: req.professional.rol, accion: 'ver_estadisticas', entidad: 'encounter', ip: req.ip });
  res.json({ total, por_estado: porEstado, por_triage: porTriage, por_canal: porCanal, promedio_horas_respuesta: promedioHorasRespuesta, casos_medidos_tiempo_respuesta: horasRespuesta.length });
});

router.get('/encounters/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM encounters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });

  const versions = db.prepare('SELECT * FROM encounter_versions WHERE encounter_id = ? ORDER BY version ASC').all(req.params.id);
  audit({ actorId: req.professional.id, actorRol: req.professional.rol, accion: 'ver_encuentro', entidad: 'encounter', entidadId: row.id, ip: req.ip });
  res.json({ ...toPublic(row), historial: versions });
});

const respuestaSchema = z.object({
  respuesta_profesional: z.string().trim().max(4000).optional(),
  recomendaciones: z.string().trim().max(2000).optional(),
  signos_alarma_seguimiento: z.string().trim().max(2000).optional(),
  status: z.enum(['en_triage', 'orientado', 'remitido_urgencias', 'remitido_presencial', 'cerrado']).optional(),
  triage_nivel_confirmado: z.enum(['rojo', 'amarillo', 'verde']).optional(),
  requiere_seguimiento: z.boolean().optional(),
  seguimiento_fecha: z.string().trim().optional().nullable(),
  checklist_cierre: z.object({
    consentimiento_confirmado: z.boolean().optional(),
    orientacion_entregada: z.boolean().optional(),
    remision_gestionada: z.boolean().optional(),
  }).optional(),
});

// Clinical responses are appended, never overwritten in place, so the original patient-submitted
// record and every professional action remain reconstructable for audit (SUH trazabilidad).
router.post('/encounters/:id/respuesta', requireAuth, (req, res) => {
  const parsed = respuestaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Cuerpo de la solicitud inválido', detalle: parsed.error.issues });
  }
  const {
    respuesta_profesional, recomendaciones, signos_alarma_seguimiento, status, triage_nivel_confirmado,
    requiere_seguimiento, seguimiento_fecha, checklist_cierre,
  } = parsed.data;

  const row = db.prepare('SELECT * FROM encounters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });

  // La normativa de teleorientación (Res. 1644/2026, que reemplazó a la 2654/2019) exige que la
  // orientación quede documentada y el consentimiento conste antes de dar por cerrado un caso;
  // si además el caso fue remitido, se exige dejar constancia de que la remisión se gestionó.
  // Se valida aquí, no solo en la interfaz, para
  // que no exista una vía de la API que cierre un caso sin ese registro.
  if (status === 'cerrado') {
    const checklist = { ...JSON.parse(row.checklist_cierre || '{}'), ...(checklist_cierre || {}) };
    const faltantes = [];
    if (!checklist.consentimiento_confirmado) faltantes.push('confirmar el consentimiento informado');
    if (!checklist.orientacion_entregada) faltantes.push('confirmar que la orientación fue entregada al paciente');
    if ((row.status === 'remitido_urgencias' || row.status === 'remitido_presencial') && !checklist.remision_gestionada) {
      faltantes.push('confirmar que la remisión fue gestionada');
    }
    if (faltantes.length > 0) {
      return res.status(400).json({ error: `No se puede cerrar el caso: falta ${faltantes.join(', ')}.` });
    }
  }

  const now = nowIso();
  const nextVersion = row.sync_version + 1;
  const insertVersion = db.prepare(`
    INSERT INTO encounter_versions (encounter_id, version, campo_cambiado, valor_anterior, valor_nuevo, cambiado_por, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const registrarCambio = (campo, anterior, nuevo) => {
    if (nuevo !== undefined && nuevo !== null && String(nuevo) !== String(anterior || '')) {
      insertVersion.run(row.id, nextVersion, campo, anterior, String(nuevo), req.professional.id, now);
    }
  };

  registrarCambio('respuesta_profesional', row.respuesta_profesional, respuesta_profesional);
  registrarCambio('recomendaciones', row.recomendaciones, recomendaciones);
  registrarCambio('signos_alarma_seguimiento', row.signos_alarma_seguimiento, signos_alarma_seguimiento);
  registrarCambio('status', row.status, status);
  registrarCambio('triage_nivel_confirmado', row.triage_nivel_confirmado, triage_nivel_confirmado);
  registrarCambio('seguimiento_fecha', row.seguimiento_fecha, seguimiento_fecha);

  const checklistFinal = checklist_cierre ? JSON.stringify({ ...JSON.parse(row.checklist_cierre || '{}'), ...checklist_cierre }) : row.checklist_cierre;
  const seguimientoEstado = requiere_seguimiento === true ? 'pendiente' : requiere_seguimiento === false ? null : row.seguimiento_estado;

  db.prepare(`
    UPDATE encounters SET
      respuesta_profesional = COALESCE(?, respuesta_profesional),
      recomendaciones = COALESCE(?, recomendaciones),
      signos_alarma_seguimiento = COALESCE(?, signos_alarma_seguimiento),
      status = COALESCE(?, status),
      triage_nivel_confirmado = COALESCE(?, triage_nivel_confirmado),
      requiere_seguimiento = ?,
      seguimiento_fecha = COALESCE(?, seguimiento_fecha),
      seguimiento_estado = ?,
      checklist_cierre = ?,
      profesional_id = ?,
      actualizado_en = ?,
      sync_version = ?
    WHERE id = ?
  `).run(
    respuesta_profesional || null, recomendaciones || null, signos_alarma_seguimiento || null,
    status || null, triage_nivel_confirmado || null,
    requiere_seguimiento === undefined ? row.requiere_seguimiento : (requiere_seguimiento ? 1 : 0),
    seguimiento_fecha || null, seguimientoEstado, checklistFinal,
    req.professional.id, now, nextVersion, row.id
  );

  const telefonoPaciente = decryptField(row.paciente_telefono);
  if (telefonoPaciente) {
    db.prepare('INSERT INTO sms_outbox (to_phone, body, related_encounter_id, creado_en) VALUES (?, ?, ?, ?)').run(
      telefonoPaciente,
      `Telesalud: su caso fue atendido por ${req.professional.nombre}. ${respuesta_profesional ? respuesta_profesional.slice(0, 100) : 'Revise la app cuando tenga conexión.'}`,
      row.id, now
    );
  }

  audit({ actorId: req.professional.id, actorRol: req.professional.rol, accion: 'responder_encuentro', entidad: 'encounter', entidadId: row.id, ip: req.ip, detalle: { status } });
  res.json(toPublic(db.prepare('SELECT * FROM encounters WHERE id = ?').get(row.id)));
});

// Cola de seguimiento: casos marcados por el profesional como que requieren un control
// posterior (ej. "llamar en 48h"), ordenados por la fecha programada más próxima primero.
router.get('/seguimientos', requireAuth, (req, res) => {
  const estado = req.query.estado || 'pendiente';
  const rows = db.prepare(`
    SELECT * FROM encounters WHERE requiere_seguimiento = 1 AND seguimiento_estado = ?
    ORDER BY seguimiento_fecha IS NULL, seguimiento_fecha ASC
  `).all(estado);
  audit({ actorId: req.professional.id, actorRol: req.professional.rol, accion: 'listar_seguimientos', entidad: 'encounter', ip: req.ip, detalle: { estado } });
  res.json(rows.map(toPublic));
});

router.post('/encounters/:id/seguimiento-completado', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM encounters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!row.requiere_seguimiento) return res.status(400).json({ error: 'Este caso no tiene un seguimiento programado' });

  const now = nowIso();
  const nextVersion = row.sync_version + 1;
  db.prepare(`
    INSERT INTO encounter_versions (encounter_id, version, campo_cambiado, valor_anterior, valor_nuevo, cambiado_por, timestamp)
    VALUES (?, ?, 'seguimiento_estado', ?, 'completado', ?, ?)
  `).run(row.id, nextVersion, row.seguimiento_estado, req.professional.id, now);

  db.prepare('UPDATE encounters SET seguimiento_estado = ?, actualizado_en = ?, sync_version = ? WHERE id = ?')
    .run('completado', now, nextVersion, row.id);

  audit({ actorId: req.professional.id, actorRol: req.professional.rol, accion: 'completar_seguimiento', entidad: 'encounter', entidadId: row.id, ip: req.ip });
  res.json(toPublic(db.prepare('SELECT * FROM encounters WHERE id = ?').get(row.id)));
});

module.exports = router;
