const { addToOutbox, getOutbox, getAllCache, updateCacheStatus, sincronizar } = self.TelesaludDB;

const DEVICE_ID = (() => {
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = 'dispositivo-' + crypto.randomUUID().slice(0, 8);
    localStorage.setItem('device_id', id);
  }
  return id;
})();

let PROTOCOLOS = null;
let DIVIPOLA = null;
let DIRECTORIO_REMISION = null;
let sintomaSeleccionado = null;
let protocoloSeleccionado = null;
let triageCalculado = null; // { nivel, detalle }
let proToken = sessionStorage.getItem('pro_token');
let proNombre = sessionStorage.getItem('pro_nombre');

// ---------- Navegación ----------
// Una sola vista "activa" a la vez (panel-home, panel-nueva, panel-cola, panel-profesional,
// panel-ussd, panel-sms). El "modo comunidad" (nueva/cola) y el "modo profesional" son las dos
// audiencias reales del sistema; USSD/SMS son demostraciones de canal, solo alcanzables desde
// el inicio, para no competir visualmente con las funciones reales.
function mostrarPanel(id) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('activo'));
  document.getElementById('panel-' + id).classList.add('activo');
  window.scrollTo(0, 0);

  const esComunidad = id === 'nueva' || id === 'cola';
  document.getElementById('nav-comunidad').classList.toggle('oculto', !esComunidad);
  if (esComunidad) {
    document.querySelectorAll('#nav-comunidad button').forEach((b) => b.classList.toggle('activo', b.dataset.panel === id));
  }

  document.querySelectorAll('#nav-modo button').forEach((b) => {
    b.classList.toggle('activo', (b.dataset.vista === 'nueva' && esComunidad) || (b.dataset.vista === 'profesional' && id === 'profesional'));
  });

  if (id === 'cola') renderCola();
  if (id === 'profesional') renderPanelProfesional();
  if (id === 'sms') renderSmsOutbox();
}

document.querySelectorAll('[data-vista]').forEach((btn) => btn.addEventListener('click', () => mostrarPanel(btn.dataset.vista)));
document.querySelectorAll('#nav-comunidad [data-panel]').forEach((btn) => btn.addEventListener('click', () => mostrarPanel(btn.dataset.panel)));
document.getElementById('btn-ir-inicio').addEventListener('click', () => mostrarPanel('home'));
document.getElementById('btn-ir-politica-datos').addEventListener('click', () => mostrarPanel('politica-datos'));

// ---------- Estado de conexión ----------
function actualizarBadgeConexion() {
  const badge = document.getElementById('badge-conexion');
  if (navigator.onLine) {
    badge.textContent = 'En línea';
    badge.className = 'badge online';
  } else {
    badge.textContent = 'Sin conexión';
    badge.className = 'badge offline';
  }
}
window.addEventListener('online', () => { actualizarBadgeConexion(); trySync(); });
window.addEventListener('offline', actualizarBadgeConexion);
actualizarBadgeConexion();

async function actualizarBadgePendientes() {
  const outbox = await getOutbox();
  const rojosPendientes = outbox.filter((it) => it.triage_nivel === 'rojo').length;
  const badge = document.getElementById('badge-pendientes');
  if (outbox.length > 0) {
    badge.textContent = rojosPendientes > 0 ? `${outbox.length} por sincronizar (${rojosPendientes} urgente)` : `${outbox.length} por sincronizar`;
    badge.classList.remove('oculto');
  } else {
    badge.classList.add('oculto');
  }
  actualizarBannerRojo(rojosPendientes);
  return rojosPendientes;
}

// El badge de arriba es informativo y fácil de ignorar. Este banner es deliberadamente más
// difícil de pasar por alto: mientras haya al menos un caso rojo sin enviar, queda fijo en
// pantalla en cualquier panel, con la acción concreta que debe tomar el promotor ahora mismo
// — no solo el conteo genérico "N por sincronizar".
function actualizarBannerRojo(rojosPendientes) {
  const banner = document.getElementById('banner-rojo-pendiente');
  if (rojosPendientes > 0) {
    banner.textContent = rojosPendientes === 1
      ? '⚠ 1 caso urgente sin enviar — no espere el envío para actuar. Vea "Mi cola" para el protocolo.'
      : `⚠ ${rojosPendientes} casos urgentes sin enviar — no espere el envío para actuar. Vea "Mi cola" para el protocolo.`;
    banner.classList.remove('oculto');
  } else {
    banner.classList.add('oculto');
  }
}

// ---------- Datos base (municipios reales, protocolos de triage) ----------
async function cargarProtocolos() {
  try {
    const res = await fetch('/protocolos.json');
    PROTOCOLOS = await res.json();
  } catch {
    PROTOCOLOS = { protocolos: [], signos_generales_peligro: [], grupos_edad: [] };
  }

  const contSintomas = document.getElementById('chips-sintomas');
  contSintomas.innerHTML = '';
  PROTOCOLOS.protocolos.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = p.sintoma;
    chip.addEventListener('click', () => seleccionarSintoma(p, chip));
    contSintomas.appendChild(chip);
  });

  const selEdad = document.getElementById('f-edad');
  selEdad.innerHTML = (PROTOCOLOS.grupos_edad || []).map((g) => `<option value="${g.valor}">${g.texto}</option>`).join('');
}

async function cargarDivipola() {
  try {
    const res = await fetch('/divipola.json');
    DIVIPOLA = await res.json();
  } catch {
    DIVIPOLA = { departamentos: {} };
  }
  const selDepto = document.getElementById('f-departamento');
  const nombres = Object.keys(DIVIPOLA.departamentos).sort();
  selDepto.innerHTML = `<option value="">Seleccione...</option>${nombres.map((d) => `<option value="${d}">${d}</option>`).join('')}`;
  selDepto.addEventListener('change', () => actualizarMunicipios(selDepto.value));
}

function actualizarMunicipios(departamento) {
  const selMunicipio = document.getElementById('f-municipio');
  const municipios = (DIVIPOLA.departamentos[departamento] || []);
  selMunicipio.innerHTML = municipios.length
    ? municipios.map((m) => `<option value="${m}">${m}</option>`).join('')
    : '<option value="">Seleccione un departamento primero</option>';
}

function seleccionarSintoma(protocolo, chipEl) {
  sintomaSeleccionado = protocolo.sintoma;
  protocoloSeleccionado = protocolo;
  document.querySelectorAll('#chips-sintomas .chip').forEach((c) => c.classList.remove('selected'));
  chipEl.classList.add('selected');

  const box = document.getElementById('orientacion-offline');
  box.classList.remove('oculto');
  box.innerHTML = `<strong>Orientación general:</strong> ${protocolo.orientacion}<br/><br/>
    <strong>Busque atención inmediata si:</strong><ul>${protocolo.signos_alarma.map((s) => `<li>${s}</li>`).join('')}</ul>
    ${(protocolo.que_evitar && protocolo.que_evitar.length) ? `<strong>Qué evitar:</strong><ul>${protocolo.que_evitar.map((s) => `<li>${s}</li>`).join('')}</ul>` : ''}`;

  renderPreguntasTriage(protocolo);
}

// ---------- Motor de triage (banderas rojas, inspirado en el enfoque de AIEPI) ----------
function renderPreguntasTriage(protocolo) {
  const cont = document.getElementById('triage-preguntas');
  cont.classList.remove('oculto');

  const contGeneral = document.getElementById('triage-signos-generales');
  contGeneral.innerHTML = '<p class="meta">Signos generales de peligro:</p>' + (PROTOCOLOS.signos_generales_peligro || []).map((p) => preguntaHtml(p)).join('');

  const contSintoma = document.getElementById('triage-signos-sintoma');
  contSintoma.innerHTML = `<p class="meta">Sobre ${protocolo.sintoma.toLowerCase()}:</p>` + (protocolo.preguntas_triage || []).map((p) => preguntaHtml(p)).join('');

  cont.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.addEventListener('change', calcularTriage));
  calcularTriage();
}

function preguntaHtml(p) {
  return `
    <label class="pregunta-triage ${p.bandera_roja ? 'bandera-roja' : ''}">
      <input type="checkbox" data-id="${p.id}" data-bandera="${!!p.bandera_roja}" data-peso="${p.peso || 0}" />
      <span class="texto-pregunta">${p.texto}</span>
    </label>
  `;
}

function calcularTriage() {
  const cont = document.getElementById('triage-preguntas');
  const marcadas = [...cont.querySelectorAll('input[type="checkbox"]')].filter((cb) => cb.checked);
  const detalle = {};
  cont.querySelectorAll('input[type="checkbox"]').forEach((cb) => { detalle[cb.dataset.id] = cb.checked; });

  const hayBanderaRoja = marcadas.some((cb) => cb.dataset.bandera === 'true');
  const puntaje = marcadas.reduce((acc, cb) => acc + Number(cb.dataset.peso || 0), 0);
  const edad = document.getElementById('f-edad').value;
  const gestante = document.getElementById('f-gestante').checked;

  let nivel = hayBanderaRoja ? 'rojo' : puntaje >= 2 ? 'amarillo' : 'verde';

  // Menores de 2 meses y gestantes se manejan con umbral más bajo: cualquier síntoma
  // reportado eleva al menos a "amarillo", siguiendo el enfoque de AIEPI para population
  // de mayor riesgo, incluso si ninguna pregunta puntual marcó bandera roja.
  if (nivel === 'verde' && edad === 'recien_nacido') nivel = 'amarillo';
  if (nivel === 'verde' && gestante) nivel = 'amarillo';

  triageCalculado = { nivel, detalle };

  const razones = [];
  if (hayBanderaRoja) razones.push('al menos un signo de alarma marcado');
  if (edad === 'recien_nacido') razones.push('menor de 2 meses (grupo de mayor riesgo)');
  if (gestante) razones.push('paciente en embarazo (grupo de mayor riesgo)');
  if (!hayBanderaRoja && puntaje >= 2) razones.push(`puntaje de síntomas ${puntaje}`);

  const resultado = document.getElementById('triage-resultado');
  resultado.className = `alerta ${nivel}`;
  const etiqueta = { rojo: 'Urgente — requiere atención pronta', amarillo: 'Moderado — vigilar de cerca', verde: 'Leve — orientación general' }[nivel];
  resultado.innerHTML = `<strong>Nivel calculado: ${etiqueta}</strong>${razones.length ? `<br/>Motivo: ${razones.join(', ')}.` : '<br/>Sin signos de alarma marcados.'}`;

  // El registro se guarda igual sea cual sea la urgencia, pero un caso rojo no debería
  // depender de que el envío llegue a tiempo: esta caja aparece de inmediato, antes incluso
  // de guardar, con lo que el promotor debe hacer ahora mismo — no solo cuando el caso queda
  // atascado en la cola.
  const cajaRojo = document.getElementById('protocolo-rojo-ahora');
  const protocoloOffline = (PROTOCOLOS && PROTOCOLOS.protocolo_rojo_offline) || null;
  if (nivel === 'rojo' && protocoloOffline) {
    cajaRojo.innerHTML = `<strong>${protocoloOffline.titulo}</strong><ul>${protocoloOffline.pasos.map((p) => `<li>${p}</li>`).join('')}</ul>`;
    cajaRojo.classList.remove('oculto');
  } else {
    cajaRojo.classList.add('oculto');
  }
}

document.getElementById('f-edad').addEventListener('change', () => {
  if (protocoloSeleccionado) calcularTriage();
  const esAdolescente = document.getElementById('f-edad').value === 'adolescente';
  document.getElementById('label-asentimiento-menor').classList.toggle('oculto', !esAdolescente);
  if (!esAdolescente) document.getElementById('f-asentimiento-menor').checked = false;
});
document.getElementById('f-gestante').addEventListener('change', () => { if (protocoloSeleccionado) calcularTriage(); });

document.getElementById('btn-guardar').addEventListener('click', async () => {
  const msg = document.getElementById('msg-guardado');
  const consentido = document.getElementById('f-consentimiento').checked;
  const autorizaDatos = document.getElementById('f-autorizacion-datos').checked;
  const esAdolescente = document.getElementById('f-edad').value === 'adolescente';
  const asentimientoMenor = document.getElementById('f-asentimiento-menor').checked;
  const motivo = document.getElementById('f-motivo').value.trim();

  if (!consentido || !autorizaDatos) {
    msg.className = 'alerta roja';
    msg.textContent = 'Debe aceptar ambos consentimientos para continuar: la orientación en salud y el tratamiento de datos personales.';
    msg.classList.remove('oculto');
    return;
  }
  if (esAdolescente && !asentimientoMenor) {
    msg.className = 'alerta roja';
    msg.textContent = 'Para adolescentes, además del consentimiento del acudiente se requiere el asentimiento del menor.';
    msg.classList.remove('oculto');
    return;
  }
  if (!sintomaSeleccionado || !triageCalculado) {
    msg.className = 'alerta roja';
    msg.textContent = 'Seleccione el síntoma principal y responda las preguntas de urgencia.';
    msg.classList.remove('oculto');
    return;
  }

  const item = {
    client_id: crypto.randomUUID(),
    device_id: DEVICE_ID,
    channel: 'app',
    modalidad: 'teleorientacion',
    departamento: document.getElementById('f-departamento').value || null,
    municipio: document.getElementById('f-municipio').value || null,
    vereda: document.getElementById('f-vereda').value.trim() || null,
    paciente_nombre: document.getElementById('f-nombre').value.trim(),
    paciente_documento: document.getElementById('f-documento').value.trim() || null,
    paciente_telefono: document.getElementById('f-telefono').value.trim(),
    edad_grupo: document.getElementById('f-edad').value || null,
    gestante: document.getElementById('f-gestante').checked,
    motivo_consulta: motivo || sintomaSeleccionado,
    sintomas: [sintomaSeleccionado],
    triage_nivel: triageCalculado.nivel,
    triage_detalle: triageCalculado.detalle,
    consentimiento_informado: true,
    consentimiento_medio: 'formulario_app',
    consentimiento_timestamp: new Date().toISOString(),
    autorizacion_datos_personales: true,
    autorizacion_datos_timestamp: new Date().toISOString(),
    asentimiento_menor: esAdolescente ? asentimientoMenor : undefined,
    asentimiento_menor_timestamp: esAdolescente ? new Date().toISOString() : undefined,
    creado_en_cliente: new Date().toISOString(),
    sync_status: 'pending',
  };

  await addToOutbox(item);
  await actualizarBadgePendientes();

  const esRojo = triageCalculado.nivel === 'rojo';
  msg.className = esRojo ? 'alerta roja' : 'alerta';
  if (esRojo) {
    msg.textContent = navigator.onLine
      ? 'Reporte guardado y enviándose ahora — es un caso urgente, se envía antes que el resto de la cola. Aun así, no espere esa confirmación: siga el protocolo de arriba.'
      : 'Reporte guardado en este dispositivo. Es un caso urgente: no espere a que haya señal para actuar — siga el protocolo de arriba ahora mismo.';
  } else {
    msg.textContent = navigator.onLine
      ? 'Reporte guardado. Intentando enviarlo ahora...'
      : 'Reporte guardado en este dispositivo. Se enviará automáticamente cuando haya conexión.';
  }
  msg.classList.remove('oculto');

  document.getElementById('f-motivo').value = '';
  document.getElementById('f-nombre').value = '';
  document.getElementById('f-documento').value = '';
  document.getElementById('f-vereda').value = '';
  document.getElementById('f-gestante').checked = false;
  document.getElementById('f-consentimiento').checked = false;
  document.getElementById('f-autorizacion-datos').checked = false;
  document.getElementById('f-asentimiento-menor').checked = false;
  document.getElementById('label-asentimiento-menor').classList.add('oculto');
  document.getElementById('triage-preguntas').classList.add('oculto');
  document.getElementById('orientacion-offline').classList.add('oculto');
  document.querySelectorAll('.chip.selected').forEach((c) => c.classList.remove('selected'));
  sintomaSeleccionado = null;
  protocoloSeleccionado = null;
  triageCalculado = null;

  trySync();
});

// ---------- Motor de sincronización ----------
// Los rojos van primero, en su propio lote (ver TelesaludDB.sincronizar en idb.js).
async function trySync() {
  if (!navigator.onLine) return;
  try {
    await sincronizar(DEVICE_ID);
  } catch {
    // Sin conexión real o el servidor no respondió; se reintentará en el próximo ciclo.
  }
  await actualizarBadgePendientes();
  if (document.getElementById('panel-cola').classList.contains('activo')) renderCola();
}

document.getElementById('btn-sync-ahora').addEventListener('click', trySync);

// Sondeo adaptativo: cada 20s en el caso normal, pero cada 5s mientras haya al menos un caso
// rojo sin enviar — un caso urgente no debería esperar el mismo ciclo que uno rutinario para
// aprovechar una ventana de señal corta.
let cicloSyncActual = null;
async function programarSiguienteSync() {
  const rojosPendientes = await actualizarBadgePendientes();
  const espera = rojosPendientes > 0 ? 5000 : 20000;
  clearTimeout(cicloSyncActual);
  cicloSyncActual = setTimeout(async () => {
    await trySync();
    programarSiguienteSync();
  }, espera);
}
programarSiguienteSync();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    if ('sync' in reg) {
      // Best-effort: browsers without Background Sync simply ignore this and rely on the
      // foreground polling above once a tab is open.
    }
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'sync-completed') {
      actualizarBadgePendientes();
      if (document.getElementById('panel-cola').classList.contains('activo')) renderCola();
    }
  });
}

// ---------- Mi cola ----------
async function renderCola() {
  const items = await getAllCache();
  const cont = document.getElementById('lista-cola');
  if (items.length === 0) {
    cont.innerHTML = 'Sin reportes todavía.';
    return;
  }
  cont.innerHTML = items.map((it, idx) => `
    <div class="encuentro" data-idx="${idx}" data-codigo="${it.codigo_corto || ''}">
      <div class="fila-top">
        <strong>${it.sintomas?.[0] || it.motivo_consulta}</strong>
        <span class="pill ${it.triage_nivel || 'gris'}">${it.triage_nivel || 's/n'}</span>
        <span class="pill ${it.sync_status === 'sincronizado' ? 'sincronizado' : 'pending'}">${it.sync_status === 'sincronizado' ? 'Sincronizado' : 'Pendiente'}</span>
      </div>
      <div class="meta">${new Date(it.creado_en_cliente).toLocaleString()} · ${it.municipio || 'sin ubicación'}</div>
      ${(it.triage_nivel === 'rojo' && it.sync_status !== 'sincronizado' && PROTOCOLOS?.protocolo_rojo_offline) ? `
        <div class="alerta-urgente">
          <strong>${PROTOCOLOS.protocolo_rojo_offline.titulo}</strong>
          <ul>${PROTOCOLOS.protocolo_rojo_offline.pasos.map((p) => `<li>${p}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${it.codigo_corto ? `
        <div class="meta">Código de su caso: <strong>${it.codigo_corto}</strong></div>
        <div class="chips" style="margin-top:6px;">
          <button class="btn secundario btn-chico btn-consultar-respuesta">Consultar respuesta</button>
          <button class="btn secundario btn-chico btn-abrir-rectificar">Corregir mis datos</button>
          <button class="btn secundario btn-chico btn-revocar-datos">Revocar autorización de datos</button>
          <button class="btn secundario btn-chico btn-eliminar-datos">Eliminar mis datos personales</button>
        </div>
        <div class="form-rectificar oculto">
          <label>Teléfono correcto</label>
          <input class="rect-telefono" placeholder="Dejar en blanco si no cambia" />
          <label>Municipio correcto</label>
          <input class="rect-municipio" placeholder="Dejar en blanco si no cambia" />
          <button class="btn btn-chico btn-enviar-rectificar" style="margin-top:8px;">Guardar corrección</button>
        </div>
        <div class="respuesta-recibida oculto alerta"></div>
      ` : ''}
    </div>
  `).join('');

  cont.querySelectorAll('.btn-consultar-respuesta').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.encuentro');
      const caja = card.querySelector('.respuesta-recibida');
      caja.classList.remove('oculto');
      caja.textContent = 'Consultando...';
      try {
        const res = await fetch(`/api/sync/consulta/${card.dataset.codigo}`);
        if (!res.ok) { caja.textContent = 'Aún no hay respuesta disponible.'; return; }
        const data = await res.json();
        const revocado = data.autorizacion_datos_revocada ? '<br/><em>Su autorización de tratamiento de datos fue revocada.</em>' : '';
        caja.innerHTML = (data.respuesta_profesional
          ? `<strong>Orientación recibida:</strong> ${data.respuesta_profesional}${data.recomendaciones ? `<br/><strong>Recomendaciones:</strong> ${data.recomendaciones}` : ''}${data.signos_alarma_seguimiento ? `<br/><strong>Signos de alarma a vigilar:</strong> ${data.signos_alarma_seguimiento}` : ''}`
          : `Estado: ${data.status}. Todavía no hay respuesta de un profesional.`) + revocado;
      } catch {
        caja.textContent = 'No se pudo consultar en este momento. Intente cuando tenga conexión.';
      }
    });
  });
  cont.querySelectorAll('.btn-revocar-datos').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.encuentro');
      const caja = card.querySelector('.respuesta-recibida');
      caja.classList.remove('oculto');
      if (!confirm('¿Confirma que desea revocar su autorización de tratamiento de datos personales para este caso? Esto no elimina el registro clínico, que debe conservarse por ley.')) return;
      try {
        const res = await fetch(`/api/sync/consulta/${card.dataset.codigo}/revocar`, { method: 'POST' });
        const data = await res.json();
        caja.textContent = data.status === 'ya_revocada' ? 'Ya había revocado su autorización.' : 'Autorización de datos revocada correctamente.';
      } catch {
        caja.textContent = 'No se pudo procesar la revocación en este momento. Intente cuando tenga conexión.';
      }
    });
  });
  cont.querySelectorAll('.btn-eliminar-datos').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.encuentro');
      const caja = card.querySelector('.respuesta-recibida');
      caja.classList.remove('oculto');
      if (!confirm('¿Confirma que desea eliminar su información de identificación (nombre, documento, teléfono) de este caso? El registro clínico se conserva de forma anónima porque la ley exige guardar la historia clínica. Esta acción no se puede deshacer.')) return;
      try {
        const res = await fetch(`/api/sync/consulta/${card.dataset.codigo}/eliminar`, { method: 'POST' });
        const data = await res.json();
        caja.textContent = data.nota || (data.status === 'ya_suprimidos' ? 'Sus datos ya habían sido eliminados.' : 'Datos eliminados correctamente.');
      } catch {
        caja.textContent = 'No se pudo procesar la eliminación en este momento. Intente cuando tenga conexión.';
      }
    });
  });
  cont.querySelectorAll('.btn-abrir-rectificar').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.encuentro').querySelector('.form-rectificar').classList.toggle('oculto');
    });
  });
  cont.querySelectorAll('.btn-enviar-rectificar').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.encuentro');
      const caja = card.querySelector('.respuesta-recibida');
      const cambios = {};
      const telefono = card.querySelector('.rect-telefono').value.trim();
      const municipio = card.querySelector('.rect-municipio').value.trim();
      if (telefono) cambios.paciente_telefono = telefono;
      if (municipio) cambios.municipio = municipio;
      caja.classList.remove('oculto');
      if (Object.keys(cambios).length === 0) { caja.textContent = 'Indique al menos un dato a corregir.'; return; }
      try {
        const res = await fetch(`/api/sync/consulta/${card.dataset.codigo}/rectificar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cambios),
        });
        const data = await res.json();
        caja.textContent = res.ok ? 'Datos corregidos correctamente.' : (data.error || 'No se pudo corregir.');
      } catch {
        caja.textContent = 'No se pudo procesar la corrección en este momento. Intente cuando tenga conexión.';
      }
    });
  });
}

// ---------- Panel profesional ----------
document.getElementById('btn-pro-login').addEventListener('click', async () => {
  const documento = document.getElementById('pro-documento').value.trim();
  const pin = document.getElementById('pro-pin').value.trim();
  const errorBox = document.getElementById('pro-login-error');
  errorBox.classList.add('oculto');

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documento_profesional: documento, pin }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    errorBox.textContent = data.error || 'No fue posible ingresar. Verifique documento y PIN.';
    errorBox.classList.remove('oculto');
    return;
  }
  const data = await res.json();
  proToken = data.token;
  proNombre = `${data.profesional.nombre} (${data.profesional.rol})`;
  sessionStorage.setItem('pro_token', proToken);
  sessionStorage.setItem('pro_nombre', proNombre);
  document.getElementById('pro-pin').value = '';
  renderPanelProfesional();
});

document.getElementById('btn-pro-salir').addEventListener('click', () => {
  proToken = null;
  sessionStorage.removeItem('pro_token');
  sessionStorage.removeItem('pro_nombre');
  renderPanelProfesional();
});

document.querySelectorAll('[data-filtro]').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('[data-filtro]').forEach((c) => c.classList.remove('selected'));
    chip.classList.add('selected');
    cargarListaProfesional(chip.dataset.filtro);
  });
});

document.getElementById('pro-filtro-municipio').addEventListener('change', () => {
  const status = document.querySelector('[data-filtro].selected')?.dataset.filtro || '';
  cargarListaProfesional(status);
});

document.getElementById('btn-pro-buscar-historial').addEventListener('click', async () => {
  const documento = document.getElementById('pro-filtro-documento').value.trim();
  const cont = document.getElementById('pro-historial');
  if (!documento) { cont.classList.add('oculto'); return; }

  const [resumenRes, historialRes] = await Promise.all([
    fetch(`/api/sync/patients/${encodeURIComponent(documento)}/resumen`, { headers: { Authorization: `Bearer ${proToken}` } }),
    fetch(`/api/sync/patients/${encodeURIComponent(documento)}/historial`, { headers: { Authorization: `Bearer ${proToken}` } }),
  ]);
  const resumen = await resumenRes.json();
  const historial = await historialRes.json();
  cont.classList.remove('oculto');

  if (!resumen || !Array.isArray(historial) || historial.length === 0) {
    cont.innerHTML = '<p class="meta">Sin encuentros previos para este documento.</p>';
    return;
  }

  const fichaHtml = `
    <div class="ficha-paciente">
      <p class="meta" style="margin-top:0;"><strong>Ficha de ${resumen.paciente_nombre || documento}</strong> — no reemplaza una Historia Clínica Electrónica, es un resumen de los encuentros de teleorientación registrados aquí.</p>
      <div class="stats-grid">
        <div class="stat-tile"><div class="valor">${resumen.total_encuentros}</div><div class="etiqueta">Encuentros</div></div>
        <div class="stat-tile rojo"><div class="valor">${resumen.niveles_triage_historial.rojo || 0}</div><div class="etiqueta">Veces en rojo</div></div>
        <div class="stat-tile"><div class="valor">${resumen.encuentros_con_remision}</div><div class="etiqueta">Con remisión</div></div>
      </div>
      <p class="meta">Primera consulta: ${new Date(resumen.primera_consulta).toLocaleDateString()} · Última: ${new Date(resumen.ultima_consulta).toLocaleDateString()}${resumen.gestante_mas_reciente ? ' · Gestante' : ''}</p>
      ${resumen.sintomas_frecuentes.length ? `<p class="meta"><strong>Motivos más frecuentes:</strong> ${resumen.sintomas_frecuentes.map((s) => `${s.sintoma} (${s.veces})`).join(', ')}</p>` : ''}
    </div>
  `;

  const timelineHtml = historial.map((e) => `
      <div class="historial-item">
        <strong>${new Date(e.creado_en_cliente).toLocaleDateString()}</strong> — ${e.motivo_consulta || (e.sintomas && e.sintomas[0]) || 'Sin motivo'}
        <span class="pill ${e.triage_nivel || 'gris'}">${e.triage_nivel || 's/n'}</span>
        <span class="pill gris">${e.status}</span>
        ${e.respuesta_profesional ? `<div class="meta">Respuesta: ${e.respuesta_profesional}</div>` : ''}
      </div>
    `).join('');

  cont.innerHTML = fichaHtml + timelineHtml;
});

async function cargarEstadisticas() {
  const res = await fetch('/api/sync/stats', { headers: { Authorization: `Bearer ${proToken}` } });
  if (!res.ok) return;
  const stats = await res.json();
  const rojos = (stats.por_triage.find((t) => t.triage_nivel === 'rojo') || {}).n || 0;
  const pendientes = (stats.por_estado.find((e) => e.status === 'pendiente') || {}).n || 0;
  document.getElementById('pro-stats').innerHTML = `
    <div class="stat-tile"><div class="valor">${stats.total}</div><div class="etiqueta">Total casos</div></div>
    <div class="stat-tile"><div class="valor">${pendientes}</div><div class="etiqueta">Pendientes</div></div>
    <div class="stat-tile rojo"><div class="valor">${rojos}</div><div class="etiqueta">Urgentes (rojo)</div></div>
    <div class="stat-tile"><div class="valor">${stats.promedio_horas_respuesta ?? '—'}</div><div class="etiqueta">Horas promedio 1ra respuesta</div></div>
  `;
}

function poblarFiltroMunicipios(encuentros) {
  const sel = document.getElementById('pro-filtro-municipio');
  const actual = sel.value;
  const municipios = [...new Set(encuentros.map((e) => e.municipio).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Todos los municipios</option>' + municipios.map((m) => `<option value="${m}">${m}</option>`).join('');
  sel.value = municipios.includes(actual) ? actual : '';
}

async function cargarDirectorioRemision() {
  if (DIRECTORIO_REMISION) return DIRECTORIO_REMISION;
  try {
    const res = await fetch('/directorio_remision.json');
    DIRECTORIO_REMISION = await res.json();
  } catch {
    DIRECTORIO_REMISION = { por_departamento: { _default: [] } };
  }
  return DIRECTORIO_REMISION;
}

function renderPanelProfesional() {
  const login = document.getElementById('pro-login');
  const panel = document.getElementById('pro-panel');
  if (!proToken) {
    login.classList.remove('oculto');
    panel.classList.add('oculto');
    return;
  }
  login.classList.add('oculto');
  panel.classList.remove('oculto');
  document.getElementById('pro-nombre').textContent = proNombre;
  cargarEstadisticas();
  cargarListaProfesional('pendiente');

  fetch('/api/sync/encounters', { headers: { Authorization: `Bearer ${proToken}` } })
    .then((r) => r.json())
    .then((todos) => Array.isArray(todos) && poblarFiltroMunicipios(todos))
    .catch(() => {});
}

async function cargarListaProfesional(status) {
  if (status === 'seguimientos') return cargarListaSeguimientos();

  const municipio = document.getElementById('pro-filtro-municipio').value;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (municipio) params.set('municipio', municipio);

  const res = await fetch(`/api/sync/encounters${params.toString() ? `?${params}` : ''}`, {
    headers: { Authorization: `Bearer ${proToken}` },
  });
  if (res.status === 401) {
    proToken = null;
    sessionStorage.removeItem('pro_token');
    renderPanelProfesional();
    return;
  }
  const encuentros = await res.json();
  renderListaCasos(encuentros, { conSeguimiento: false });
}

async function cargarListaSeguimientos() {
  const res = await fetch('/api/sync/seguimientos?estado=pendiente', { headers: { Authorization: `Bearer ${proToken}` } });
  const encuentros = await res.json();
  renderListaCasos(encuentros, { conSeguimiento: true });
}

function protocoloDe(sintoma) {
  return (PROTOCOLOS?.protocolos || []).find((p) => p.sintoma === sintoma);
}

function renderListaCasos(encuentros, { conSeguimiento }) {
  const cont = document.getElementById('lista-profesional');
  if (!Array.isArray(encuentros) || encuentros.length === 0) {
    cont.innerHTML = '<p class="meta">No hay casos en esta vista.</p>';
    return;
  }
  cont.innerHTML = encuentros.map((e) => `
    <div class="encuentro" data-id="${e.id}" data-departamento="${e.departamento || ''}" data-documento="${e.paciente_documento || ''}" data-sintoma="${(e.sintomas && e.sintomas[0]) || ''}" data-status-actual="${e.status}">
      <div class="fila-top">
        <strong>${(e.sintomas && e.sintomas[0]) || e.motivo_consulta || 'Sin motivo registrado'}</strong>
        <span class="pill ${e.triage_nivel || 'gris'}">${e.triage_nivel || 's/n'}</span>
        <span class="pill gris">${e.channel.toUpperCase()}</span>
        ${e.requiere_seguimiento ? `<span class="pill amarillo">Seguimiento ${e.seguimiento_fecha ? new Date(e.seguimiento_fecha).toLocaleDateString() : ''}</span>` : ''}
      </div>
      <div class="meta">${e.municipio || ''} ${e.paciente_telefono ? '· ' + e.paciente_telefono : ''} · ${new Date(e.creado_en_cliente).toLocaleString()}</div>
      <div class="meta">${e.motivo_consulta || ''}${e.edad_grupo ? ' · ' + e.edad_grupo.replace('_', ' ') : ''}${e.gestante ? ' · gestante' : ''}</div>
      ${conSeguimiento ? `
        <div class="meta"><strong>Orientación previa:</strong> ${e.respuesta_profesional || '—'}</div>
        <button class="btn btn-completar-seguimiento" style="margin-top:8px;">Marcar seguimiento completado</button>
      ` : `
      <div class="respuesta-area oculto">
        ${e.paciente_documento ? '<button class="btn secundario btn-ver-historial-caso" style="margin-top:0;">Ver historial de este paciente</button>' : ''}
        <label>Orientación entregada</label>
        <button class="btn secundario btn-usar-sugerencia" style="margin-top:4px;">Usar sugerencia del protocolo</button>
        <textarea class="txt-respuesta" placeholder="Qué orientación se le dio al paciente"></textarea>
        <label>Recomendaciones</label>
        <textarea class="txt-recomendaciones" placeholder="Indicaciones concretas para el paciente/cuidador"></textarea>
        <label>Signos de alarma que debe vigilar</label>
        <textarea class="txt-signos-alarma" placeholder="Qué debe hacer que el paciente vuelva a consultar"></textarea>

        <label style="display:flex; align-items:center; gap:8px; font-weight:400;">
          <input type="checkbox" class="chk-requiere-seguimiento" style="width:auto;" />
          <span>Requiere seguimiento posterior</span>
        </label>
        <input type="date" class="fecha-seguimiento oculto" />

        <label>Estado</label>
        <select class="sel-status">
          <option value="orientado">Orientado</option>
          <option value="remitido_presencial">Remitido a atención presencial</option>
          <option value="remitido_urgencias">Remitido a urgencias</option>
          <option value="cerrado">Cerrado</option>
        </select>
        <div class="remision-sugerida oculto"></div>

        <div class="checklist-cierre oculto">
          <p class="meta"><strong>Antes de cerrar:</strong></p>
          <label style="display:flex; align-items:center; gap:8px; font-weight:400;"><input type="checkbox" class="chk-consentimiento" style="width:auto;" /><span>Consentimiento informado confirmado</span></label>
          <label style="display:flex; align-items:center; gap:8px; font-weight:400;"><input type="checkbox" class="chk-orientacion" style="width:auto;" /><span>Orientación entregada al paciente</span></label>
          <label style="display:flex; align-items:center; gap:8px; font-weight:400;"><input type="checkbox" class="chk-remision oculto" style="width:auto;" /><span>Remisión gestionada</span></label>
        </div>

        <div class="msg-cierre alerta roja oculto"></div>
        <button class="btn btn-enviar-respuesta" style="margin-top:8px;">Guardar respuesta</button>
      </div>
      <button class="btn secundario btn-toggle-respuesta">Responder</button>
      `}
    </div>
  `).join('');

  if (conSeguimiento) {
    cont.querySelectorAll('.btn-completar-seguimiento').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('.encuentro').dataset.id;
        await fetch(`/api/sync/encounters/${id}/seguimiento-completado`, { method: 'POST', headers: { Authorization: `Bearer ${proToken}` } });
        cargarListaSeguimientos();
      });
    });
    return;
  }

  cont.querySelectorAll('.btn-toggle-respuesta').forEach((btn) => {
    btn.addEventListener('click', () => btn.previousElementSibling.classList.toggle('oculto'));
  });
  cont.querySelectorAll('.btn-usar-sugerencia').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.encuentro');
      const protocolo = protocoloDe(card.dataset.sintoma);
      if (!protocolo) return;
      card.querySelector('.txt-respuesta').value = protocolo.orientacion;
      const recomendaciones = (protocolo.recomendaciones_sugeridas || []).map((r) => `- ${r}`);
      const queEvitar = (protocolo.que_evitar || []).map((r) => `- Evitar: ${r}`);
      card.querySelector('.txt-recomendaciones').value = [...recomendaciones, ...queEvitar].join('\n');
      card.querySelector('.txt-signos-alarma').value = (protocolo.signos_alarma || []).map((s) => `- ${s}`).join('\n');
    });
  });
  cont.querySelectorAll('.btn-ver-historial-caso').forEach((btn) => {
    btn.addEventListener('click', () => {
      const documento = btn.closest('.encuentro').dataset.documento;
      document.getElementById('pro-filtro-documento').value = documento;
      document.getElementById('btn-pro-buscar-historial').click();
      document.getElementById('pro-historial').scrollIntoView({ behavior: 'smooth' });
    });
  });
  cont.querySelectorAll('.chk-requiere-seguimiento').forEach((chk) => {
    chk.addEventListener('change', () => {
      chk.closest('.encuentro').querySelector('.fecha-seguimiento').classList.toggle('oculto', !chk.checked);
    });
  });
  cont.querySelectorAll('.sel-status').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const card = sel.closest('.encuentro');
      const cajaRemision = card.querySelector('.remision-sugerida');
      const esRemision = sel.value === 'remitido_urgencias' || sel.value === 'remitido_presencial';
      if (esRemision) {
        const directorio = await cargarDirectorioRemision();
        const opciones = directorio.por_departamento[card.dataset.departamento] || directorio.por_departamento._default || [];
        cajaRemision.classList.remove('oculto');
        cajaRemision.innerHTML = '<strong>Red de referencia sugerida:</strong><br/>' +
          opciones.map((o) => `${o.nombre} (${o.tipo}) — ${o.telefono}`).join('<br/>');
      } else {
        cajaRemision.classList.add('oculto');
      }

      const checklist = card.querySelector('.checklist-cierre');
      const yaFueRemitido = card.dataset.statusActual === 'remitido_urgencias' || card.dataset.statusActual === 'remitido_presencial';
      checklist.classList.toggle('oculto', sel.value !== 'cerrado');
      checklist.querySelector('.chk-remision').classList.toggle('oculto', !(yaFueRemitido || esRemision));
    });
  });
  cont.querySelectorAll('.btn-enviar-respuesta').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.encuentro');
      const id = card.dataset.id;
      const status = card.querySelector('.sel-status').value;
      const requiereSeguimiento = card.querySelector('.chk-requiere-seguimiento').checked;
      const msgCierre = card.querySelector('.msg-cierre');
      msgCierre.classList.add('oculto');

      const payload = {
        respuesta_profesional: card.querySelector('.txt-respuesta').value.trim(),
        recomendaciones: card.querySelector('.txt-recomendaciones').value.trim(),
        signos_alarma_seguimiento: card.querySelector('.txt-signos-alarma').value.trim(),
        status,
        requiere_seguimiento: requiereSeguimiento,
        seguimiento_fecha: requiereSeguimiento ? (card.querySelector('.fecha-seguimiento').value || null) : null,
      };
      if (status === 'cerrado') {
        payload.checklist_cierre = {
          consentimiento_confirmado: card.querySelector('.chk-consentimiento').checked,
          orientacion_entregada: card.querySelector('.chk-orientacion').checked,
          remision_gestionada: card.querySelector('.chk-remision').checked,
        };
      }

      const res = await fetch(`/api/sync/encounters/${id}/respuesta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${proToken}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        msgCierre.textContent = data.error || 'No fue posible guardar la respuesta.';
        msgCierre.classList.remove('oculto');
        return;
      }
      cargarListaProfesional(document.querySelector('[data-filtro].selected')?.dataset.filtro || '');
      cargarEstadisticas();
    });
  });
}

// ---------- Simulador USSD ----------
let ussdSessionId = null;
let ussdPath = [];

function ussdIniciar() {
  ussdSessionId = crypto.randomUUID();
  ussdPath = [];
  ussdEnviar('');
}

async function ussdEnviar(nuevoValor) {
  if (nuevoValor !== '') ussdPath.push(nuevoValor);
  const text = ussdPath.join('*');
  const telefono = '300' + (localStorage.getItem('ussd_demo_tel') || (() => {
    const t = String(Math.floor(1000000 + Math.random() * 8999999));
    localStorage.setItem('ussd_demo_tel', t);
    return t;
  })());

  const res = await fetch('/api/ussd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: ussdSessionId, phoneNumber: telefono, text }),
  });
  const body = await res.text();
  const pantalla = document.getElementById('ussd-pantalla');
  pantalla.textContent = body.replace(/^(CON|END) /, '');
  const entrada = document.getElementById('ussd-entrada');
  if (body.startsWith('END')) {
    entrada.disabled = true;
    document.getElementById('ussd-enviar').disabled = true;
  } else {
    entrada.disabled = false;
    document.getElementById('ussd-enviar').disabled = false;
    entrada.value = '';
    entrada.focus();
  }
}

document.getElementById('ussd-reiniciar').addEventListener('click', ussdIniciar);
document.getElementById('ussd-enviar').addEventListener('click', () => {
  const val = document.getElementById('ussd-entrada').value.trim();
  if (val) ussdEnviar(val);
});
document.getElementById('ussd-entrada').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('ussd-enviar').click();
});

// ---------- Simulador SMS ----------
document.getElementById('sms-enviar').addEventListener('click', async () => {
  const from = document.getElementById('sms-from').value.trim();
  const text = document.getElementById('sms-texto').value.trim();
  if (!from || !text) return;
  await fetch('/api/sms/inbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, text }),
  });
  document.getElementById('sms-texto').value = '';
  renderSmsOutbox();
});

async function renderSmsOutbox() {
  const res = await fetch('/api/sms/outbox');
  const items = await res.json();
  const cont = document.getElementById('sms-outbox');
  cont.innerHTML = items.length === 0 ? 'Sin mensajes.' : items.map((m) => `
    <div class="encuentro"><strong>Para ${m.to_phone}:</strong> ${m.body}<div class="meta">${new Date(m.creado_en).toLocaleString()}</div></div>
  `).join('');
}

// ---------- Inicio ----------
cargarProtocolos();
cargarDivipola();
actualizarBadgePendientes();
renderPanelProfesional();
