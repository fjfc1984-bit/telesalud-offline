const crypto = require('node:crypto');
const db = require('./db');
const { nowIso, hashEncounter, shortId } = require('./util');
const { hashPin, encryptField, hashLookup } = require('./crypto');

const DEMO_PROFESSIONALS = [
  { nombre: 'Dra. Ana Restrepo', documento_profesional: '1020304050', rol: 'medico', pin: '1234' },
  { nombre: 'Enf. Luis Pardo', documento_profesional: '1122334455', rol: 'enfermero', pin: '5678' },
];

// Casos de demostración: variados en municipio, canal, urgencia y estado, incluyendo dos
// pacientes recurrentes (mismo documento en más de un encuentro) para poder probar el
// historial clínico por paciente. Nombres y datos ficticios.
const HORA = 3_600_000;
const DIA = 24 * HORA;

function haceMs(ms) {
  return new Date(Date.now() - ms).toISOString();
}

const CASOS_DEMO = [
  { dias: 13, horas: 2, municipio: 'San José del Guaviare', departamento: 'Guaviare', nombre: 'Luz Marina Torres', documento: '40123456', telefono: '3101112222', edad: 'adulto', motivo: 'Fiebre alta hace 3 días con dolor de cabeza intenso', sintomas: ['Fiebre'], triage: 'rojo', canal: 'app', status: 'remitido_urgencias', respuesta: 'Signos de alarma presentes (rigidez de cuello). Se remite a urgencias del hospital de referencia.' },
  { dias: 13, horas: 5, municipio: 'Puerto Carreño', departamento: 'Vichada', nombre: 'Carlos Andrés Pérez', documento: '80234567', telefono: '3112223333', edad: 'adulto', motivo: 'Dolor de espalda leve tras cargar bultos', sintomas: ['Dolor / malestar'], triage: 'verde', canal: 'ussd', status: 'orientado', respuesta: 'Reposo relativo, calor local y acetaminofén según tolerancia. Reconsultar si el dolor empeora.' },
  { dias: 12, horas: 8, municipio: 'Mitú', departamento: 'Vaupés', nombre: 'Yolanda Ríos', documento: '52345678', telefono: '3123334444', edad: 'lactante', motivo: 'Bebé de 8 meses con diarrea hace 1 día', sintomas: ['Diarrea o vómito'], triage: 'amarillo', canal: 'app', status: 'orientado', respuesta: 'Suero oral cada vez que tenga deposición. Vigilar signos de deshidratación y consultar si no mejora en 24h.' },
  { dias: 12, horas: 1, municipio: 'Quibdó', departamento: 'Chocó', nombre: 'Miguel Ángel Mosquera', documento: '11456789', telefono: '3134445555', edad: 'adulto_mayor', motivo: 'Dificultad para respirar y tos hace 2 días', sintomas: ['Dificultad para respirar'], triage: 'rojo', canal: 'app', status: 'remitido_urgencias', respuesta: 'Labios con cianosis referida. Remisión inmediata al hospital de referencia de Quibdó.' },
  { dias: 11, horas: 4, municipio: 'Tumaco', departamento: 'Nariño', nombre: 'Diana Carolina Quiñones', documento: '27567890', telefono: '3145556666', edad: 'adulto', gestante: true, motivo: 'Gestante de 32 semanas con dolor de cabeza y visión borrosa', sintomas: ['Gestante con molestias'], triage: 'rojo', canal: 'sms', status: 'remitido_urgencias', respuesta: 'Posibles signos de preeclampsia. Remisión urgente a control prenatal de alto riesgo.' },
  { dias: 11, horas: 9, municipio: 'Riohacha', departamento: 'La Guajira', nombre: 'José Gregorio Epieyu', documento: '84678901', telefono: '3156667777', edad: 'nino', motivo: 'Niño de 6 años con fiebre leve desde ayer', sintomas: ['Fiebre'], triage: 'verde', canal: 'app', status: 'orientado', respuesta: 'Manejo con antipirético y abundantes líquidos. Reconsultar si la fiebre persiste más de 3 días.' },
  { dias: 10, horas: 3, municipio: 'Popayán', departamento: 'Cauca', nombre: 'Sandra Milena López', documento: '34789012', telefono: '3167778888', edad: 'adulto', motivo: 'Dolor abdominal moderado después de comer', sintomas: ['Dolor / malestar'], triage: 'amarillo', canal: 'app', status: 'orientado', respuesta: 'Dieta blanda, evitar irritantes. Consultar si el dolor se localiza o empeora.' },
  { dias: 10, horas: 7, municipio: 'Mocoa', departamento: 'Putumayo', nombre: 'Fernando Jansasoy', documento: '18890123', telefono: '3178889999', edad: 'adulto', motivo: 'Tos y congestión leve hace 2 días', sintomas: ['Otro'], triage: 'verde', canal: 'ussd', status: 'orientado', respuesta: 'Cuadro compatible con resfriado común. Hidratación y reposo, consultar si aparece fiebre alta.' },
  { dias: 9, horas: 2, municipio: 'Leticia', departamento: 'Amazonas', nombre: 'Rosa Elena Cahuache', documento: '45901234', telefono: '3189990000', edad: 'lactante', motivo: 'Bebé de 3 meses con fiebre y decaimiento', sintomas: ['Fiebre'], triage: 'rojo', canal: 'app', status: 'remitido_urgencias', respuesta: 'Lactante menor con fiebre: remisión inmediata por alto riesgo en este grupo de edad.' },
  { dias: 9, horas: 11, municipio: 'Inírida', departamento: 'Guainía', nombre: 'Pedro Antonio Gaitán', documento: '19012345', telefono: '3191001111', edad: 'adulto_mayor', motivo: 'Dolor articular crónico, sin cambios recientes', sintomas: ['Dolor / malestar'], triage: 'verde', canal: 'app', status: 'cerrado', respuesta: 'Sin signos de alarma. Continuar manejo habitual, revalorar en control de crónicos.' },
  { dias: 8, horas: 5, municipio: 'Arauca', departamento: 'Arauca', nombre: 'Luz Marina Torres', documento: '40123456', telefono: '3101112222', edad: 'adulto', motivo: 'Control tras episodio de fiebre de hace una semana, ya sin síntomas', sintomas: ['Otro'], triage: 'verde', canal: 'app', status: 'cerrado', respuesta: 'Evolución favorable, sin signos de alarma. Se cierra el caso.' },
  { dias: 8, horas: 1, municipio: 'Florencia', departamento: 'Caquetá', nombre: 'Camila Andrea Perdomo', documento: '56123456', telefono: '3202223333', edad: 'adolescente', motivo: 'Dolor de cabeza leve tras exposición al sol', sintomas: ['Dolor / malestar'], triage: 'verde', canal: 'sms', status: 'orientado', respuesta: 'Hidratación y reposo en la sombra. Consultar si el dolor no mejora o aparece fiebre.' },
  { dias: 7, horas: 6, municipio: 'San José del Guaviare', departamento: 'Guaviare', nombre: 'Wilson Hernán Cabrera', documento: '72234567', telefono: '3213334444', edad: 'adulto', motivo: 'Diarrea con algo de sangre hace 1 día', sintomas: ['Diarrea o vómito'], triage: 'rojo', canal: 'app', status: 'remitido_presencial', respuesta: 'Sangre en materia fecal: requiere valoración presencial para descartar causas que necesiten manejo hospitalario.' },
  { dias: 6, horas: 3, municipio: 'Puerto Carreño', departamento: 'Vichada', nombre: 'Carlos Andrés Pérez', documento: '80234567', telefono: '3112223333', edad: 'adulto', motivo: 'El dolor de espalda volvió tras otro día de trabajo pesado', sintomas: ['Dolor / malestar'], triage: 'amarillo', canal: 'ussd', status: 'pendiente' },
  { dias: 5, horas: 4, municipio: 'Quibdó', departamento: 'Chocó', nombre: 'Estefanía Palacios', documento: '31345678', telefono: '3224445555', edad: 'nino', motivo: 'Niña con dificultad respiratoria leve y silbido al respirar', sintomas: ['Dificultad para respirar'], triage: 'amarillo', canal: 'app', status: 'pendiente' },
  { dias: 4, horas: 9, municipio: 'Tumaco', departamento: 'Nariño', nombre: 'Jhonatan Steven Angulo', documento: '98456789', telefono: '3235556666', edad: 'adulto', motivo: 'Fiebre y malestar general hace 1 día', sintomas: ['Fiebre'], triage: 'verde', canal: 'app', status: 'pendiente' },
  { dias: 2, horas: 2, municipio: 'Mitú', departamento: 'Vaupés', nombre: 'Yolanda Ríos', documento: '52345678', telefono: '3123334444', edad: 'lactante', motivo: 'El bebé sigue con algo de diarrea, ya menos frecuente', sintomas: ['Diarrea o vómito'], triage: 'verde', canal: 'app', status: 'pendiente' },
  { dias: 1, horas: 3, municipio: 'Riohacha', departamento: 'La Guajira', nombre: 'Marta Cecilia Iguarán', documento: '65567890', telefono: '3246667777', edad: 'adulto', motivo: 'Dolor de pecho leve al respirar profundo desde hoy', sintomas: ['Dolor / malestar'], triage: 'rojo', canal: 'sms', status: 'pendiente' },
  { dias: 0, horas: 6, municipio: 'Popayán', departamento: 'Cauca', nombre: 'Andrés Felipe Muñoz', documento: '76678901', telefono: '3257778888', edad: 'adulto', motivo: 'Congestión nasal leve, sin fiebre', sintomas: ['Otro'], triage: 'verde', canal: 'app', status: 'pendiente' },
  { dias: 0, horas: 1, municipio: 'Mocoa', departamento: 'Putumayo', nombre: 'Diana Carolina Quiñones', documento: '27567890', telefono: '3145556666', edad: 'adulto', gestante: true, motivo: 'Control post-remisión, ya valorada en el hospital, sin nuevas molestias', sintomas: ['Gestante con molestias'], triage: 'verde', canal: 'app', status: 'pendiente' },
];

function insertarCasoDemo(caso, profesionalPorDocumento) {
  const id = crypto.randomUUID();
  const clientId = `demo-${crypto.randomUUID()}`;
  const creado = haceMs(caso.dias * DIA + caso.horas * HORA);
  const recibido = creado;

  const item = {
    client_id: clientId,
    creado_en_cliente: creado,
    motivo_consulta: caso.motivo,
    sintomas: caso.sintomas,
    triage_nivel: caso.triage,
    consentimiento_informado: true,
  };
  const hash = hashEncounter(item);

  const codigo = shortId(id);
  db.prepare(`
    INSERT INTO encounters (
      id, codigo_corto, client_id, device_id, channel, modalidad, categoria_2654,
      departamento, municipio, vereda, paciente_nombre, paciente_documento, paciente_documento_hash,
      paciente_telefono, edad_grupo, gestante,
      motivo_consulta, sintomas, triage_detalle, triage_nivel, consentimiento_informado, consentimiento_medio,
      consentimiento_timestamp, autorizacion_datos_personales, autorizacion_datos_timestamp,
      status, profesional_id, respuesta_profesional,
      creado_en_cliente, recibido_en_servidor, actualizado_en, sync_version, hash_integridad
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, codigo, clientId, `demo-device-${caso.municipio}`, caso.canal, 'teleorientacion', null,
    caso.departamento, caso.municipio, null,
    encryptField(caso.nombre), encryptField(caso.documento), hashLookup(caso.documento),
    encryptField(caso.telefono), caso.edad, caso.gestante ? 1 : 0,
    caso.motivo, JSON.stringify(caso.sintomas), null, caso.triage,
    1, 'formulario_app', creado, 1, creado,
    caso.status, caso.respuesta ? profesionalPorDocumento : null, caso.respuesta || null,
    creado, recibido, caso.respuesta ? haceMs(caso.dias * DIA) : recibido, caso.respuesta ? 2 : 1, hash
  );

  if (caso.respuesta) {
    db.prepare(`
      INSERT INTO encounter_versions (encounter_id, version, campo_cambiado, valor_anterior, valor_nuevo, cambiado_por, timestamp)
      VALUES (?, 2, 'status', 'pendiente', ?, ?, ?)
    `).run(id, caso.status, profesionalPorDocumento, haceMs(caso.dias * DIA));
  }
}

function seed() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM professionals').get();
  if (existing.n > 0) return;

  const insertPro = db.prepare(`
    INSERT INTO professionals (id, nombre, documento_profesional, rol, rethus_verificado, pin_hash, creado_en)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);
  let medicoId = null;
  for (const p of DEMO_PROFESSIONALS) {
    const id = crypto.randomUUID();
    if (p.rol === 'medico') medicoId = id;
    insertPro.run(id, p.nombre, p.documento_profesional, p.rol, hashPin(p.pin), nowIso());
  }
  console.log(`[seed] ${DEMO_PROFESSIONALS.length} profesionales de demostración creados. PIN demo: 1234 / 5678.`);

  for (const caso of CASOS_DEMO) insertarCasoDemo(caso, medicoId);
  console.log(`[seed] ${CASOS_DEMO.length} casos de demostración creados (municipios reales, 2 pacientes recurrentes).`);
}

module.exports = { seed };
