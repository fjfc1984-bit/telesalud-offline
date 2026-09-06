// Suite de pruebas automatizadas del backend. Corre contra una base de datos SQLite en
// memoria y llaves de cifrado/JWT efímeras (variables de entorno), aisladas del
// data/telesalud.db que usa `npm start` en desarrollo — así ambos pueden correr a la vez
// sin bloquearse mutuamente ni mezclar datos.
process.env.TELESALUD_DB_PATH = ':memory:';
process.env.TELESALUD_ENCRYPTION_KEY = require('node:crypto').randomBytes(32).toString('hex');
process.env.TELESALUD_JWT_SECRET = require('node:crypto').randomBytes(48).toString('hex');

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const db = require('../src/db');
const { decryptField } = require('../src/crypto');

const app = createApp();
const server = app.listen(0);
const BASE_URL = `http://localhost:${server.address().port}`;

test.after(() => server.close());

async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// Se cachea el token entre pruebas: el límite de intentos de login (anti fuerza bruta) es
// deliberadamente estricto, y un cliente real tampoco vuelve a autenticarse en cada llamada.
let medicoTokenCache = null;
async function loginMedico() {
  if (medicoTokenCache) return medicoTokenCache;
  const { body } = await api('/api/auth/login', { method: 'POST', body: { documento_profesional: '1020304050', pin: '1234' } });
  medicoTokenCache = body.token;
  return medicoTokenCache;
}

test('salud del servidor responde ok', async () => {
  const { status, body } = await api('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
});

test('login: credenciales válidas devuelven un token', async () => {
  const { status, body } = await api('/api/auth/login', { method: 'POST', body: { documento_profesional: '1020304050', pin: '1234' } });
  assert.equal(status, 200);
  assert.ok(body.token);
  assert.equal(body.profesional.rol, 'medico');
});

test('login: PIN incorrecto es rechazado', async () => {
  const { status, body } = await api('/api/auth/login', { method: 'POST', body: { documento_profesional: '1020304050', pin: '0000' } });
  assert.equal(status, 401);
  assert.ok(body.error);
});

test('login: documento inexistente es rechazado con el mismo mensaje (sin enumeración de usuarios)', async () => {
  const conocido = await api('/api/auth/login', { method: 'POST', body: { documento_profesional: '1020304050', pin: '0000' } });
  const desconocido = await api('/api/auth/login', { method: 'POST', body: { documento_profesional: '0000000000', pin: '0000' } });
  assert.equal(conocido.status, 401);
  assert.equal(desconocido.status, 401);
  assert.equal(conocido.body.error, desconocido.body.error);
});

test('sync: rechaza un encuentro sin consentimiento informado', async () => {
  const { status, body } = await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'sin-consentimiento', creado_en_cliente: new Date().toISOString(), motivo_consulta: 'Fiebre', consentimiento_informado: false }] },
  });
  assert.equal(status, 200);
  assert.equal(body.resultados[0].status, 'rechazado');
});

test('sync: rechaza un encuentro sin autorización de datos personales, aunque haya consentimiento clínico (Ley 1581/2012)', async () => {
  const { status, body } = await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'sin-autorizacion-datos', creado_en_cliente: new Date().toISOString(), motivo_consulta: 'Fiebre', consentimiento_informado: true, autorizacion_datos_personales: false }] },
  });
  assert.equal(status, 200);
  assert.equal(body.resultados[0].status, 'rechazado');
  assert.match(body.resultados[0].error, /1581/);
});

test('sync: valida el cuerpo de la solicitud (campos requeridos)', async () => {
  const { status } = await api('/api/sync/encounters', { method: 'POST', body: { device_id: 'dev-test', encounters: [{ motivo_consulta: 'Fiebre' }] } });
  assert.equal(status, 400);
});

test('sync: crea un encuentro válido y cifra los datos del paciente en disco', async () => {
  const { status, body } = await api('/api/sync/encounters', {
    method: 'POST',
    body: {
      device_id: 'dev-test',
      encounters: [{
        client_id: 'caso-1', creado_en_cliente: new Date().toISOString(),
        paciente_nombre: 'Ana Ejemplo', paciente_telefono: '3009998877',
        motivo_consulta: 'Fiebre y tos', sintomas: ['Fiebre'], triage_nivel: 'amarillo',
        consentimiento_informado: true, autorizacion_datos_personales: true,
      }],
    },
  });
  assert.equal(status, 200);
  assert.equal(body.resultados[0].status, 'creado');

  const raw = db.prepare('SELECT paciente_nombre, paciente_telefono FROM encounters WHERE client_id = ?').get('caso-1');
  assert.notEqual(raw.paciente_nombre, 'Ana Ejemplo');
  assert.notEqual(raw.paciente_telefono, '3009998877');
  assert.equal(decryptField(raw.paciente_nombre), 'Ana Ejemplo');
  assert.equal(decryptField(raw.paciente_telefono), '3009998877');
});

test('sync: reenviar el mismo client_id es idempotente (no duplica)', async () => {
  const payload = {
    device_id: 'dev-test',
    encounters: [{ client_id: 'caso-idempotente', creado_en_cliente: new Date().toISOString(), motivo_consulta: 'Dolor', consentimiento_informado: true, autorizacion_datos_personales: true }],
  };
  const primero = await api('/api/sync/encounters', { method: 'POST', body: payload });
  const segundo = await api('/api/sync/encounters', { method: 'POST', body: payload });
  assert.equal(primero.body.resultados[0].status, 'creado');
  assert.equal(segundo.body.resultados[0].status, 'ya_sincronizado');
  assert.equal(primero.body.resultados[0].server_id, segundo.body.resultados[0].server_id);

  const count = db.prepare('SELECT COUNT(*) AS n FROM encounters WHERE client_id = ?').get('caso-idempotente');
  assert.equal(count.n, 1);
});

test('panel profesional: requiere autenticación', async () => {
  const { status } = await api('/api/sync/encounters');
  assert.equal(status, 401);
});

test('panel profesional: lista, responde y versiona un encuentro', async () => {
  const token = await loginMedico();
  await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'caso-respuesta', creado_en_cliente: new Date().toISOString(), motivo_consulta: 'Dolor de cabeza', consentimiento_informado: true, autorizacion_datos_personales: true }] },
  });

  const lista = await api('/api/sync/encounters?status=pendiente', { headers: { Authorization: `Bearer ${token}` } });
  const caso = lista.body.find((e) => e.client_id === 'caso-respuesta');
  assert.ok(caso, 'el caso recién creado debe aparecer en pendientes');

  const respuesta = await api(`/api/sync/encounters/${caso.id}/respuesta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { respuesta_profesional: 'Maneje hidratación y reposo', status: 'orientado' },
  });
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.body.status, 'orientado');

  const detalle = await api(`/api/sync/encounters/${caso.id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(detalle.body.historial.length, 2); // respuesta_profesional + status
});

test('USSD: flujo completo crea un encuentro urgente con el triage correcto', async () => {
  const sessionId = 'sesion-test-2';
  const phoneNumber = '3007654321';
  const enviar = (text) => fetch(`${BASE_URL}/api/ussd`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, phoneNumber, text }),
  }).then((r) => r.text());

  assert.match(await enviar(''), /TELESALUD RURAL/);
  assert.match(await enviar('1'), /Elija el sintoma/);
  assert.match(await enviar('1*3'), /Que tan fuerte|Qué tan fuerte/);
  const final = await enviar('1*3*3');
  assert.match(final, /^END /);
  assert.match(final, /URGENTE/);

  const token = await loginMedico();
  const lista = await api('/api/sync/encounters?channel=ussd', { headers: { Authorization: `Bearer ${token}` } });
  const caso = lista.body.find((e) => e.paciente_telefono === phoneNumber);
  assert.ok(caso, 'el caso creado por USSD debe listarse con el teléfono descifrado');
  assert.equal(caso.triage_nivel, 'rojo');
});

test('SMS: sin descripción responde con instrucciones y no crea encuentro', async () => {
  const { status, body } = await api('/api/sms/inbound', { method: 'POST', body: { from: '3011112222', text: 'SALUD' } });
  assert.equal(status, 200);
  assert.equal(body.status, 'instrucciones_enviadas');
});

test('SMS: con descripción crea un encuentro y encola una confirmación', async () => {
  const { status, body } = await api('/api/sms/inbound', { method: 'POST', body: { from: '3022223333', text: 'SALUD fiebre hace 2 dias' } });
  assert.equal(status, 200);
  assert.equal(body.status, 'creado');
  assert.ok(body.codigo_corto);
});

test('SMS: valida el cuerpo de la solicitud', async () => {
  const { status } = await api('/api/sms/inbound', { method: 'POST', body: { from: '' } });
  assert.equal(status, 400);
});

test('historial de paciente: encuentra los encuentros previos de un paciente recurrente de los datos de demostración', async () => {
  const token = await loginMedico();
  const { status, body } = await api('/api/sync/patients/40123456/historial', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(status, 200);
  assert.ok(body.length >= 2, 'Luz Marina Torres tiene al menos 2 encuentros en los datos de demostración');
  assert.ok(body.every((e) => e.paciente_nombre === 'Luz Marina Torres'));
});

test('historial de paciente: dos documentos distintos no cruzan resultados (el índice ciego no genera colisiones triviales)', async () => {
  const token = await loginMedico();
  const uno = await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'hist-1', creado_en_cliente: new Date().toISOString(), paciente_documento: '11111111', motivo_consulta: 'Caso A', consentimiento_informado: true, autorizacion_datos_personales: true }] },
  });
  const dos = await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'hist-2', creado_en_cliente: new Date().toISOString(), paciente_documento: '22222222', motivo_consulta: 'Caso B', consentimiento_informado: true, autorizacion_datos_personales: true }] },
  });
  assert.equal(uno.status, 200);
  assert.equal(dos.status, 200);

  const historialUno = await api('/api/sync/patients/11111111/historial', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(historialUno.body.length, 1);
  assert.equal(historialUno.body[0].motivo_consulta, 'Caso A');
});

test('ficha del paciente: resumen agregado coherente con los datos de demostración', async () => {
  const token = await loginMedico();
  const { status, body } = await api('/api/sync/patients/40123456/resumen', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(status, 200);
  assert.equal(body.paciente_nombre, 'Luz Marina Torres');
  assert.equal(body.total_encuentros, 2);
  assert.ok(body.niveles_triage_historial.rojo >= 1);
  assert.ok(body.encuentros_con_remision >= 1);
  assert.ok(body.sintomas_frecuentes.length > 0);
  assert.ok(new Date(body.primera_consulta) <= new Date(body.ultima_consulta));
});

test('ficha del paciente: documento sin encuentros devuelve null, no error', async () => {
  const token = await loginMedico();
  const { status, body } = await api('/api/sync/patients/00000000000/resumen', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(status, 200);
  assert.equal(body, null);
});

test('filtros: por municipio y por documento', async () => {
  const token = await loginMedico();
  const porMunicipio = await api('/api/sync/encounters?municipio=Quibdó', { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(porMunicipio.body.length >= 1);
  assert.ok(porMunicipio.body.every((e) => e.municipio === 'Quibdó'));

  const porDocumento = await api('/api/sync/encounters?documento=40123456', { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(porDocumento.body.length >= 2);
});

test('estadísticas: totales y promedio de tiempo de respuesta coherentes con los datos de demostración', async () => {
  const token = await loginMedico();
  const { status, body } = await api('/api/sync/stats', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(status, 200);
  assert.ok(body.total >= 20);
  assert.ok(Array.isArray(body.por_estado) && body.por_estado.length > 0);
  assert.ok(Array.isArray(body.por_triage) && body.por_triage.length > 0);
  assert.ok(typeof body.promedio_horas_respuesta === 'number' && body.promedio_horas_respuesta >= 0);
});

test('cierre de caso: no permite marcar "cerrado" sin confirmar el checklist normativo', async () => {
  const token = await loginMedico();
  const crear = await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'caso-cierre-1', creado_en_cliente: new Date().toISOString(), motivo_consulta: 'Dolor leve', consentimiento_informado: true, autorizacion_datos_personales: true }] },
  });
  const id = crear.body.resultados[0].server_id;

  const sinChecklist = await api(`/api/sync/encounters/${id}/respuesta`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: { status: 'cerrado', respuesta_profesional: 'Manejo ambulatorio' },
  });
  assert.equal(sinChecklist.status, 400);
  assert.match(sinChecklist.body.error, /consentimiento/);

  const conChecklist = await api(`/api/sync/encounters/${id}/respuesta`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: { status: 'cerrado', respuesta_profesional: 'Manejo ambulatorio', checklist_cierre: { consentimiento_confirmado: true, orientacion_entregada: true } },
  });
  assert.equal(conChecklist.status, 200);
  assert.equal(conChecklist.body.status, 'cerrado');
});

test('cierre de caso: un caso remitido exige confirmar que la remisión fue gestionada', async () => {
  const token = await loginMedico();
  const crear = await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'caso-cierre-2', creado_en_cliente: new Date().toISOString(), motivo_consulta: 'Dolor de pecho', triage_nivel: 'rojo', consentimiento_informado: true, autorizacion_datos_personales: true }] },
  });
  const id = crear.body.resultados[0].server_id;

  await api(`/api/sync/encounters/${id}/respuesta`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: { status: 'remitido_urgencias', respuesta_profesional: 'Remitido por dolor torácico' },
  });

  const sinRemision = await api(`/api/sync/encounters/${id}/respuesta`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: { status: 'cerrado', checklist_cierre: { consentimiento_confirmado: true, orientacion_entregada: true } },
  });
  assert.equal(sinRemision.status, 400);
  assert.match(sinRemision.body.error, /remisión/);

  const conRemision = await api(`/api/sync/encounters/${id}/respuesta`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: { status: 'cerrado', checklist_cierre: { consentimiento_confirmado: true, orientacion_entregada: true, remision_gestionada: true } },
  });
  assert.equal(conRemision.status, 200);
});

test('seguimiento: programar, listar y completar', async () => {
  const token = await loginMedico();
  const crear = await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'caso-seguimiento-1', creado_en_cliente: new Date().toISOString(), motivo_consulta: 'Diarrea en niño', consentimiento_informado: true, autorizacion_datos_personales: true }] },
  });
  const id = crear.body.resultados[0].server_id;

  const fechaSeguimiento = new Date(Date.now() + 2 * 86400000).toISOString();
  const programar = await api(`/api/sync/encounters/${id}/respuesta`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: { status: 'orientado', respuesta_profesional: 'Hidratación oral', requiere_seguimiento: true, seguimiento_fecha: fechaSeguimiento },
  });
  assert.equal(programar.body.requiere_seguimiento, true);
  assert.equal(programar.body.seguimiento_estado, 'pendiente');

  const pendientes = await api('/api/sync/seguimientos?estado=pendiente', { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(pendientes.body.some((e) => e.id === id));

  const completar = await api(`/api/sync/encounters/${id}/seguimiento-completado`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(completar.body.seguimiento_estado, 'completado');

  const pendientesDespues = await api('/api/sync/seguimientos?estado=pendiente', { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(!pendientesDespues.body.some((e) => e.id === id));
});

test('triage con banderas rojas: sync acepta y conserva triage_detalle para revisión del profesional', async () => {
  const token = await loginMedico();
  const detalle = { fiebre_rigidez_cuello: true, fiebre_mas_3_dias: false };
  const { status } = await api('/api/sync/encounters', {
    method: 'POST',
    body: {
      device_id: 'dev-test',
      encounters: [{
        client_id: 'caso-triage-detalle', creado_en_cliente: new Date().toISOString(),
        motivo_consulta: 'Fiebre con rigidez de cuello', sintomas: ['Fiebre'], triage_nivel: 'rojo',
        triage_detalle: detalle, edad_grupo: 'adulto', consentimiento_informado: true, autorizacion_datos_personales: true,
      }],
    },
  });
  assert.equal(status, 200);

  const lista = await api('/api/sync/encounters?status=pendiente', { headers: { Authorization: `Bearer ${token}` } });
  const caso = lista.body.find((e) => e.client_id === 'caso-triage-detalle');
  assert.ok(caso);
  assert.deepEqual(caso.triage_detalle, detalle);
  assert.equal(caso.edad_grupo, 'adulto');
});

test('consulta pública: entrega copia/resumen al usuario con su código (Res. 1644/2026 Art. 10 §1)', async () => {
  const token = await loginMedico();
  const crear = await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'caso-consulta-1', creado_en_cliente: new Date().toISOString(), motivo_consulta: 'Tos leve', consentimiento_informado: true, autorizacion_datos_personales: true }] },
  });
  const { server_id, codigo_corto } = crear.body.resultados[0];
  assert.ok(codigo_corto && codigo_corto.length === 8);

  const antesDeResponder = await api(`/api/sync/consulta/${codigo_corto}`);
  assert.equal(antesDeResponder.status, 200);
  assert.equal(antesDeResponder.body.respuesta_profesional, null);
  assert.equal(antesDeResponder.body.paciente_nombre, undefined); // no expone PII del paciente

  await api(`/api/sync/encounters/${server_id}/respuesta`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: { respuesta_profesional: 'Hidratación y reposo', status: 'orientado' },
  });

  const despuesDeResponder = await api(`/api/sync/consulta/${codigo_corto}`);
  assert.equal(despuesDeResponder.body.respuesta_profesional, 'Hidratación y reposo');
  assert.equal(despuesDeResponder.body.status, 'orientado');

  const inexistente = await api('/api/sync/consulta/ZZZZZZZZ');
  assert.equal(inexistente.status, 404);
});

test('revocación: el titular puede revocar la autorización de datos con su código (Ley 1581/2012, Art. 8)', async () => {
  const crear = await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'caso-revocar-1', creado_en_cliente: new Date().toISOString(), motivo_consulta: 'Dolor muscular', consentimiento_informado: true, autorizacion_datos_personales: true }] },
  });
  const { codigo_corto } = crear.body.resultados[0];

  const antes = await api(`/api/sync/consulta/${codigo_corto}`);
  assert.equal(antes.body.autorizacion_datos_revocada, false);

  const revocar = await api(`/api/sync/consulta/${codigo_corto}/revocar`, { method: 'POST' });
  assert.equal(revocar.status, 200);
  assert.equal(revocar.body.status, 'revocada');

  const despues = await api(`/api/sync/consulta/${codigo_corto}`);
  assert.equal(despues.body.autorizacion_datos_revocada, true);

  const segundaVez = await api(`/api/sync/consulta/${codigo_corto}/revocar`, { method: 'POST' });
  assert.equal(segundaVez.body.status, 'ya_revocada');

  const inexistente = await api('/api/sync/consulta/ZZZZZZZZ/revocar', { method: 'POST' });
  assert.equal(inexistente.status, 404);
});

test('USSD: opción "consultar mi caso" entrega la respuesta del profesional por el mismo canal', async () => {
  const token = await loginMedico();
  const sessionId = 'sesion-consulta-ussd';
  const phoneNumber = '3009998877';
  const enviar = (text) => fetch(`${BASE_URL}/api/ussd`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, phoneNumber, text }),
  }).then((r) => r.text());

  await enviar('');
  await enviar('1');
  await enviar('1*1');
  const final = await enviar('1*1*1');
  const codigo = final.match(/Caso ([A-Z0-9]{8})/)[1];

  const lista = await api('/api/sync/encounters?channel=ussd', { headers: { Authorization: `Bearer ${token}` } });
  const caso = lista.body.find((e) => e.codigo_corto === codigo);
  assert.ok(caso, 'el caso debe existir con el código extraído del mensaje USSD');

  const sesionConsulta = 'sesion-consulta-ussd-2';
  const enviarConsulta = (text) => fetch(`${BASE_URL}/api/ussd`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sesionConsulta, phoneNumber, text }),
  }).then((r) => r.text());

  const sinRespuesta = await enviarConsulta('2*' + codigo);
  assert.match(sinRespuesta, /Todavia no tiene respuesta/);

  await api(`/api/sync/encounters/${caso.id}/respuesta`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: { respuesta_profesional: 'Manejo ambulatorio, control en 48h', status: 'orientado' },
  });

  const conRespuesta = await enviarConsulta('2*' + codigo);
  assert.match(conRespuesta, /Manejo ambulatorio/);
});

test('SMS: comando ESTADO entrega la respuesta del profesional por el mismo canal', async () => {
  const token = await loginMedico();
  const crear = await api('/api/sms/inbound', { method: 'POST', body: { from: '3033334444', text: 'SALUD dolor de cabeza leve' } });
  const { codigo_corto } = crear.body;

  await api('/api/sms/inbound', { method: 'POST', body: { from: '3033334444', text: `ESTADO ${codigo_corto}` } });
  const outboxAntes = await api('/api/sms/outbox');
  assert.ok(outboxAntes.body.some((m) => m.to_phone === '3033334444' && /aún sin respuesta/.test(m.body)));

  const lista = await api('/api/sync/encounters?channel=sms', { headers: { Authorization: `Bearer ${token}` } });
  const caso = lista.body.find((e) => e.codigo_corto === codigo_corto);
  await api(`/api/sync/encounters/${caso.id}/respuesta`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: { respuesta_profesional: 'Acetaminofen y control si persiste', status: 'orientado' },
  });

  await api('/api/sms/inbound', { method: 'POST', body: { from: '3033334444', text: `ESTADO ${codigo_corto}` } });
  const outboxDespues = await api('/api/sms/outbox');
  assert.ok(outboxDespues.body.some((m) => m.to_phone === '3033334444' && m.body.includes('Acetaminofen')));
});

test('rectificación: el titular puede corregir datos de identificación con su código (Ley 1581/2012, Art. 8)', async () => {
  const crear = await api('/api/sync/encounters', {
    method: 'POST',
    body: { device_id: 'dev-test', encounters: [{ client_id: 'caso-rectificar-1', creado_en_cliente: new Date().toISOString(), motivo_consulta: 'Dolor de garganta', municipio: 'Pasto', consentimiento_informado: true, autorizacion_datos_personales: true }] },
  });
  const { codigo_corto } = crear.body.resultados[0];

  const sinCampos = await api(`/api/sync/consulta/${codigo_corto}/rectificar`, { method: 'POST', body: {} });
  assert.equal(sinCampos.status, 400);

  const rectificar = await api(`/api/sync/consulta/${codigo_corto}/rectificar`, {
    method: 'POST',
    body: { municipio: 'Ipiales', paciente_telefono: '3111111111' },
  });
  assert.equal(rectificar.status, 200);
  assert.equal(rectificar.body.status, 'rectificado');

  const token = await loginMedico();
  const lista = await api('/api/sync/encounters?municipio=Ipiales', { headers: { Authorization: `Bearer ${token}` } });
  const caso = lista.body.find((e) => e.codigo_corto === codigo_corto);
  assert.ok(caso, 'el municipio corregido debe reflejarse en el panel profesional');
  assert.equal(caso.paciente_telefono, '3111111111');

  const inexistente = await api('/api/sync/consulta/ZZZZZZZZ/rectificar', { method: 'POST', body: { municipio: 'X' } });
  assert.equal(inexistente.status, 404);
});

test('supresión: anonimiza los datos de identificación pero conserva el registro clínico (Ley 1581/2012, Art. 8 vs. Res. 1995/1999)', async () => {
  const crear = await api('/api/sync/encounters', {
    method: 'POST',
    body: {
      device_id: 'dev-test',
      encounters: [{
        client_id: 'caso-suprimir-1', creado_en_cliente: new Date().toISOString(),
        paciente_nombre: 'Carlos Suprimir', paciente_documento: '99887766', paciente_telefono: '3122223333',
        motivo_consulta: 'Fiebre alta', consentimiento_informado: true, autorizacion_datos_personales: true,
      }],
    },
  });
  const { server_id, codigo_corto } = crear.body.resultados[0];

  const eliminar = await api(`/api/sync/consulta/${codigo_corto}/eliminar`, { method: 'POST' });
  assert.equal(eliminar.status, 200);
  assert.equal(eliminar.body.status, 'suprimido');

  const token = await loginMedico();
  const detalle = await api(`/api/sync/encounters/${server_id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(detalle.body.paciente_nombre, null);
  assert.equal(detalle.body.paciente_documento, null);
  assert.equal(detalle.body.paciente_telefono, null);
  assert.equal(detalle.body.datos_personales_suprimidos, true);
  assert.equal(detalle.body.motivo_consulta, 'Fiebre alta', 'el contenido clínico se conserva por la Res. 1995/1999');

  const segundaVez = await api(`/api/sync/consulta/${codigo_corto}/eliminar`, { method: 'POST' });
  assert.equal(segundaVez.body.status, 'ya_suprimidos');

  // Un dato ya suprimido no debería poder "rectificarse" — no hay identificación que corregir.
  const rectificarTrasSuprimir = await api(`/api/sync/consulta/${codigo_corto}/rectificar`, { method: 'POST', body: { municipio: 'X' } });
  assert.equal(rectificarTrasSuprimir.status, 400);
});

test('asentimiento del adolescente: la Res. 1644/2026 exige el asentimiento del menor, no solo del acudiente', async () => {
  const sinAsentimiento = await api('/api/sync/encounters', {
    method: 'POST',
    body: {
      device_id: 'dev-test',
      encounters: [{
        client_id: 'caso-adolescente-1', creado_en_cliente: new Date().toISOString(),
        motivo_consulta: 'Dolor abdominal', edad_grupo: 'adolescente',
        consentimiento_informado: true, autorizacion_datos_personales: true, asentimiento_menor: false,
      }],
    },
  });
  assert.equal(sinAsentimiento.body.resultados[0].status, 'rechazado');
  assert.match(sinAsentimiento.body.resultados[0].error, /asentimiento/);

  const conAsentimiento = await api('/api/sync/encounters', {
    method: 'POST',
    body: {
      device_id: 'dev-test',
      encounters: [{
        client_id: 'caso-adolescente-2', creado_en_cliente: new Date().toISOString(),
        motivo_consulta: 'Dolor abdominal', edad_grupo: 'adolescente',
        consentimiento_informado: true, autorizacion_datos_personales: true, asentimiento_menor: true,
      }],
    },
  });
  assert.equal(conAsentimiento.body.resultados[0].status, 'creado');

  // Para un niño (no adolescente), el asentimiento del menor no aplica y no debe exigirse.
  const nino = await api('/api/sync/encounters', {
    method: 'POST',
    body: {
      device_id: 'dev-test',
      encounters: [{
        client_id: 'caso-nino-1', creado_en_cliente: new Date().toISOString(),
        motivo_consulta: 'Fiebre', edad_grupo: 'nino',
        consentimiento_informado: true, autorizacion_datos_personales: true,
      }],
    },
  });
  assert.equal(nino.body.resultados[0].status, 'creado');
});

test('backups: requiere autenticación y responde correctamente cuando no hay base de datos en disco (modo de pruebas)', async () => {
  const sinAuthGet = await api('/api/backups');
  assert.equal(sinAuthGet.status, 401);
  const sinAuthPost = await api('/api/backups', { method: 'POST' });
  assert.equal(sinAuthPost.status, 401);

  const token = await loginMedico();
  const lista = await api('/api/backups', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(lista.status, 200);
  assert.ok(Array.isArray(lista.body));

  // En modo de pruebas la base es ':memory:' — no hay archivo que respaldar, y el endpoint debe
  // decirlo con claridad en vez de fallar de forma confusa.
  const crear = await api('/api/backups', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(crear.status, 400);
});
