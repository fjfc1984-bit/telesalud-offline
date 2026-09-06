# Arquitectura — Telesalud Offline-First

## 1. Problema técnico que resuelve

Un prestador de teleorientación en zonas rurales no puede asumir que el dispositivo del
paciente o del promotor de salud tendrá internet en el momento del reporte. La solución
debe funcionar en tres escenarios de conectividad, degradando capacidades pero nunca
bloqueando el registro clínico:

| Escenario | Canal | Qué funciona |
|---|---|---|
| Smartphone sin señal | App web (PWA) | Formulario completo + orientación general cacheada localmente; el envío queda en cola |
| Teléfono básico con señal 2G únicamente | USSD (`*123#`) | Menú de texto por sesión, sin necesidad de datos móviles |
| Teléfono básico, solo SMS | SMS (`SALUD <texto>`) | Reporte mínimo por mensaje de texto |

## 2. Componentes

```
┌─────────────────────┐     ┌──────────────────────┐
│   PWA (frontend/)    │     │   Teléfono básico     │
│  - Service Worker    │     │  (USSD / SMS)         │
│  - IndexedDB (outbox)│     └──────────┬────────────┘
│  - Motor de sync     │                │ webhook (aggregator)
└──────────┬───────────┘                │
           │ POST /api/sync/encounters  │
           ▼                            ▼
   ┌────────────────────────────────────────┐
   │            Backend (Express)            │
   │  routes/sync.js   routes/ussd.js        │
   │  routes/sms.js    routes/auth.js        │
   │  - Upsert idempotente por client_id     │
   │  - Versionado append-only               │
   │  - audit_log (trazabilidad SUH)         │
   └──────────────────┬───────────────────────┘
                       ▼
                 SQLite (node:sqlite)
```

## 3. Offline-first en la PWA

**Principio de diseño:** el guardado local nunca depende de la red. El flujo es:

1. El usuario completa el formulario. Al enviar, el registro se escribe primero en
   `IndexedDB` (`frontend/idb.js`, store `outbox`), con un `client_id` (UUID) generado en
   el dispositivo.
2. Solo *después* de guardar localmente, la app intenta sincronizar si `navigator.onLine`
   es verdadero.
3. Si falla o no hay conexión, el registro queda en la cola. Tres mecanismos garantizan que
   eventualmente se envíe:
   - Evento `online` del navegador dispara sync inmediato.
   - Reintento en primer plano cada 20s mientras la pestaña esté abierta.
   - `Background Sync API` (`sw.js`, evento `sync`) reintenta aunque la pestaña esté cerrada,
     en navegadores que la soportan (Chrome/Edge en Android; Safari/Firefox no la soportan —
     ahí aplica el reintento en primer plano).
4. El *Service Worker* además cachea el *app shell* (HTML/CSS/JS/manifest/protocolos.json) para
   que la aplicación cargue por completo sin red, no solo el formulario.

**Idempotencia:** cada item de la cola lleva un `client_id` único. El servidor
(`backend/src/routes/sync.js`) usa ese id como llave de upsert: reenviar el mismo lote tras un
corte de red a mitad de sincronización nunca duplica el registro clínico.

**Sincronización priorizada por urgencia (`TelesaludDB.sincronizar`, en `idb.js`, compartida por
`app.js` y `sw.js`):** en las zonas con la brecha más severa la señal no suele ser "cero total"
sino una ventana corta e intermitente. Enviar toda la cola en un solo lote arriesga que un caso
ROJO se pierda junto con el resto si la ventana no alcanza para completar la petición. Por eso
la cola nunca se envía como un solo lote: primero se manda, sola, la sub-cola de casos con
`triage_nivel: 'rojo'`; solo si esa petición tiene éxito se intenta el resto. El sondeo en
primer plano (`app.js`) además reduce su intervalo de 20s a 5s mientras haya al menos un rojo
sin enviar, y un banner fijo (`banner-rojo-pendiente`) lo señala en cualquier pantalla — no solo
el contador genérico de pendientes. Un caso ROJO calculado localmente también muestra de
inmediato, sin depender del envío, el protocolo de "qué hacer ahora" (`protocolos.json`,
`protocolo_rojo_offline`): trasladar, buscar radio/teléfono satelital, o cualquier vía distinta
al propio sistema, porque el envío puede tardar más de lo que el caso puede esperar.

**Contenido offline útil:** `protocolos.json` se cachea localmente y contiene orientación
general y signos de alarma por síntoma. Así, incluso sin conexión ni profesional disponible,
la app entrega algo de valor inmediato (concepto de *teleorientación*, hoy regulado por la
Res. 1644/2026 — ver `CUMPLIMIENTO_SUH.md`), mientras el caso espera revisión humana.

## 4. Canales de bajo ancho de banda (USSD / SMS)

No existe integración real con un operador de telecomunicaciones en este prototipo —
requiere un contrato comercial con un agregador (ej. un partner tipo Africa's Talking,
Twilio o un agregador local colombiano). Lo que sí está construido es el **contrato de
integración**: los endpoints `/api/ussd` y `/api/sms/inbound` implementan el formato de
webhook estándar de la industria (`sessionId` / `phoneNumber` / `text` → `CON`/`END` para
USSD; `from`/`text` para SMS entrante), de modo que conectar un operador real es un cambio
de URL de webhook, no una reescritura.

El simulador incluido en la UI (`Simulador USSD`, `Simulador SMS`) llama a estos mismos
endpoints, por lo que el flujo de negocio (triage → creación de encuentro → notificación de
respuesta) es idéntico al que correría en producción.

## 5. Integridad y trazabilidad de datos clínicos

- **Append-only:** las respuestas profesionales y cambios de estado no sobrescriben el
  registro original; se guardan como nuevas versiones en `encounter_versions`, preservando
  el reporte tal como lo envió el paciente/promotor.
- **Huella de integridad:** cada encuentro guarda un hash SHA-256 (`hash_integridad`) sobre
  sus campos clínicos núcleo, para detectar alteraciones no auditadas.
- **Bitácora de auditoría:** toda lectura o escritura relevante (login, listar, ver, crear,
  responder) queda en `audit_log` con actor, rol, acción y marca de tiempo.
- **Consentimiento informado:** es un campo obligatorio antes de que el backend acepte
  sincronizar un encuentro (`routes/sync.js`), reflejando el requisito normativo de
  teleorientación (ver `CUMPLIMIENTO_SUH.md` para la cita vigente — la norma cambió en agosto
  de 2026, después de escrita la primera versión de este documento).

## 6. Verificación del offline-first con navegador real

El navegador de vista previa en sandbox usado durante el desarrollo inicial bloqueaba el
registro de Service Worker (restricción del entorno, no del código). Se verificó después con
un motor de navegador real (Chromium vía Playwright), simulando desconexión real de red
(`context.setOffline(true)`, no solo `navigator.onLine`):

1. Con la red completamente cortada, se recargó la página: el *app shell* completo (HTML,
   CSS, JS, `protocolos.json`) se sirvió 100% desde el Service Worker, sin ningún request de
   red exitoso.
2. Se completó y guardó el formulario de teleorientación estando offline: el registro quedó
   en `IndexedDB` (verificado leyendo la cola directamente, no solo el mensaje de la interfaz).
3. Al restaurar la red, el motor de sincronización lo envió automáticamente y el backend lo
   confirmó con un `server_id`, sin intervención manual.

## 7. Seguridad implementada

- **Autenticación de profesionales:** PIN (hash con `scrypt`) + token JWT firmado con
  expiración de 8 horas, en vez del token estático de la primera versión del prototipo.
- **Límite de intentos de ingreso:** `express-rate-limit` en `/api/auth/login` (8 intentos /
  15 min por IP) para dificultar fuerza bruta; el hash se calcula también cuando el
  documento no existe, para no filtrar por tiempo de respuesta qué documentos están
  registrados.
- **Cifrado en reposo:** nombre, documento y teléfono del paciente se cifran con
  AES-256-GCM antes de escribirse en SQLite; el resto de campos clínicos queda legible para
  el flujo de triage. La llave vive en `backend/data/.encryption_key` solo como conveniencia
  de desarrollo — **debe reemplazarse por un secreto gestionado (KMS/Vault) antes de
  cualquier despliegue real**, ver `TELESALUD_ENCRYPTION_KEY` en `crypto.js`.
- **Validación de entradas:** todos los endpoints (`sync`, `ussd`, `sms`, `auth`) validan su
  cuerpo con esquemas `zod` y rechazan payloads malformados con `400`.
- **Cabeceras HTTP:** `helmet` habilitado globalmente.
- **Límite de tamaño de payload:** `express.json({ limit: '256kb' })` para mitigar abuso.

## 8. Motor de triage y datos operativos realistas

- **Triage por banderas rojas:** en vez de que el usuario autoreporte "leve/moderado/urgente",
  el formulario pregunta signos generales de peligro (inspirados en el enfoque de AIEPI —
  Atención Integrada a las Enfermedades Prevalentes de la Infancia, OPS/Minsalud) y preguntas
  específicas por síntoma (`frontend/protocolos.json`, campo `preguntas_triage`). El nivel se
  calcula 100% en el cliente (funciona sin conexión): cualquier bandera roja marcada da
  `rojo`; si no, se suman pesos hacia `amarillo`; y menores de 2 meses o gestantes tienen un
  umbral más bajo (mínimo `amarillo`) por ser poblaciones de mayor riesgo. El detalle de
  respuestas (`triage_detalle`) viaja con el encuentro para que el profesional vea *por qué*
  se calculó ese nivel, no solo el color.
- **Historial de pacientes recurrentes sin exponer el documento en texto plano:** el
  documento del paciente se cifra igual que nombre/teléfono (AES-256-GCM, IV aleatorio), lo
  que por diseño impide una búsqueda por igualdad directa en la base de datos. Para permitir
  "ver los encuentros previos de este paciente" sin sacrificar la confidencialidad, se guarda
  además un **índice ciego**: `HMAC-SHA256(documento, llave)` — determinístico (mismo
  documento produce siempre el mismo hash, así se puede buscar) pero no reversible (no revela
  el documento). Ver `hashLookup` en `crypto.js` y la columna `paciente_documento_hash`.
- **Municipios y departamentos reales:** `frontend/divipola.json` reemplaza el campo de
  ubicación de texto libre por selects reales de Colombia (curados, no el DIVIPOLA oficial
  completo), priorizando los departamentos con mayor brecha de conectividad citados en el
  pitch (Chocó, Vichada, Vaupés, Guainía, Guaviare, entre otros).
- **Panel profesional con estadísticas:** `GET /api/sync/stats` agrega totales por estado,
  por triage y por canal, y calcula el tiempo promedio hasta la primera respuesta usando el
  historial de versiones (`encounter_versions`) — no un campo separado, para no duplicar la
  fuente de verdad del estado del caso.
- **Red de remisión sugerida:** al marcar un caso como remitido, el panel busca en
  `frontend/directorio_remision.json` por el departamento del caso. Es un directorio de
  **ejemplo** (nombres genéricos, sin teléfonos reales) — antes de un piloto debe
  reemplazarse por la red de referencia real de la IPS convenida.

## 10. Servicio clínico: respuesta estructurada, seguimiento y cierre normativo

- **Respuesta profesional estructurada:** en vez de un solo cuadro de texto libre, la
  respuesta ahora separa `respuesta_profesional` (orientación entregada),
  `recomendaciones` y `signos_alarma_seguimiento` (qué debe hacer que el paciente vuelva a
  consultar). El profesional puede partir de una sugerencia (`protocolos.json`, campo
  `recomendaciones_sugeridas`) y editarla, en vez de escribir desde cero cada vez.
- **Seguimiento de casos:** un encuentro puede marcarse con `requiere_seguimiento` +
  `seguimiento_fecha`. `GET /api/sync/seguimientos?estado=pendiente` es la cola de control
  pendiente, ordenada por fecha más próxima; `POST /encounters/:id/seguimiento-completado`
  lo cierra. Antes de esto, un caso remitido o con control pendiente no tenía ningún
  mecanismo — dependía de que el profesional recordara revisarlo.
- **Checklist de cierre exigido por la normativa de teleorientación** (ver `CUMPLIMIENTO_SUH.md`
  para la resolución vigente): el backend, no solo la
  interfaz, rechaza con `400` cualquier intento de marcar un caso `cerrado` sin
  `checklist_cierre.consentimiento_confirmado` y `orientacion_entregada` en `true`; si el
  caso venía de un estado `remitido_urgencias`/`remitido_presencial`, exige además
  `remision_gestionada`. Esto convierte un requisito normativo en una regla que el sistema
  hace cumplir, no solo en un recordatorio en pantalla.

## 11. Qué falta para producción (fuera del alcance de este prototipo)

- Gestión de secretos con KMS/Vault en lugar de los archivos locales de llave/JWT.
- Integración real con RETHUS para verificar la habilitación del profesional (hoy solo
  modelada como campo `rethus_verificado`).
- Contrato con un agregador de SMS/USSD y con un operador de telecomunicaciones.
- Interoperabilidad con la Historia Clínica Electrónica del prestador y con RIPS/PISIS.
- Inscripción del servicio de telemedicina (si aplica, más allá de teleorientación) en el
  REPS y habilitación ante la Secretaría de Salud territorial.
- Pruebas de carga, plan de continuidad y copias de seguridad.
- Instalabilidad completa como PWA (iconos PNG *maskable* — hoy son SVG de marcador de
  posición) y pruebas en dispositivos Android reales de gama baja.
