# Telesalud Offline-First para Zonas Rurales

Repositorio: [github.com/fjfc1984-bit/telesalud-offline](https://github.com/fjfc1984-bit/telesalud-offline)

## ¿Qué es y para quién?

Un sistema de **teleorientación en salud** (regulada por la Resolución 1644/2026 — ver la nota
normativa en `docs/CUMPLIMIENTO_SUH.md`, la norma cambió en agosto de 2026): un promotor de salud o el
propio paciente reporta un caso — síntomas, urgencia, datos básicos — y un profesional de
salud lo revisa y responde a distancia. La función que resuelve, y que ninguna app de
telesalud convencional resuelve bien, es esta: **en la mayoría del territorio rural
colombiano no se puede asumir que hay internet en el momento en que alguien necesita
reportar un caso.**

Por eso el diseño completo gira alrededor de una sola idea: **el reporte nunca depende de
tener conexión en ese instante.** Se guarda donde sea que se esté (una app, un teléfono
básico por USSD, un SMS) y llega al profesional en cuanto haya señal — sin perderse, sin
duplicarse, y ya priorizado por qué tan urgente es.

### Flujo end-to-end

1. **Alguien reporta un caso** — con o sin señal — desde la app, un menú USSD (*123#), o un SMS.
2. **El sistema calcula la urgencia automáticamente**, con preguntas de signos de alarma
   (no le pregunta al usuario "¿qué tan grave es?", se lo pregunta a los síntomas).
3. **El reporte se guarda localmente** si no hay red, y se sincroniza solo cuando la haya.
4. **Un profesional de salud** (autenticado) ve los casos ordenados por urgencia, responde,
   y puede ver el historial si ese paciente ya había reportado antes.

## Sobre la cifra de conectividad rural

El dato citado originalmente ("37,4% de municipios rurales con menos del 1% de cobertura")
**no pudo verificarse** contra fuentes oficiales actuales y probablemente corresponde a un
reporte anterior a 2022. Los datos verificados más recientes (DANE, Encuesta de Calidad de
Vida 2025; MinTIC) muestran:

- Conectividad de hogares **rurales**: pasó de 32,2% (2022) a **56,9% (2025)**.
- Conectividad **nacional** (hogares): **73,9%** en 2025.
- La brecha ya no es "casi ningún municipio rural conectado", sino una **fuerte
  concentración de la exclusión** en departamentos específicos: Vichada, Vaupés y Chocó
  reportan los niveles de acceso más bajos del país, muy por debajo del promedio nacional.

**Conclusión para el modelo de negocio:** el problema sigue siendo real y vigente, pero el
argumento correcto en 2026 no es "casi toda la ruralidad está desconectada", sino "persiste
una brecha severa y focalizada en ~10-15 departamentos/regiones PDET, donde el diseño
offline-first y los canales USSD/SMS siguen siendo indispensables". Usa esta versión del dato
en cualquier pitch o documento formal — la cifra original debe corregirse o sustentarse con
una fuente primaria específica antes de presentarse a un tercero.

Fuentes: [MinTIC — Más de la mitad de los hogares rurales ya tienen internet](https://www.mintic.gov.co/portal/inicio/Sala-de-prensa/Noticias/438459:Mas-de-la-mitad-de-los-hogares-rurales-en-Colombia-ya-tienen-internet-56-9-estan-conectados) ·
[La República — brecha departamental de uso de internet](https://www.larepublica.co/internet-economy/en-colombia-72-8-de-la-poblacion-usa-internet-pero-en-vichada-solo-la-usa-12-7-3623833)

## Estructura del proyecto

```
telesalud-offline/
├── backend/        API de sincronización + canales USSD/SMS (Express + node:sqlite)
├── frontend/       PWA offline-first (HTML/CSS/JS sin build step, IndexedDB, Service Worker)
└── docs/
    ├── ARQUITECTURA.md                    Diseño técnico del offline-first, triage y servicio clínico
    ├── CUMPLIMIENTO_SUH.md                Mapeo normativo (⚠️ actualizado ago-2026: 2654/2019 y 3100/2019 fueron derogadas)
    ├── ACREDITACION_Y_HISTORIA_CLINICA.md ¿Tiene HC? ¿Aplica alguna acreditación internacional? (respuesta corta: no todavía)
    ├── PROTECCION_DATOS_SIC.md            Ley 1581/2012, Decreto 1377/2013, Circular SIC 002/2024 — qué falta para no tener problemas con la SIC
    ├── ANEXO_ENCARGO_TRATAMIENTO_DATOS.md Borrador de cláusula de encargo del tratamiento para el convenio con la IPS (Art. 25 Decreto 1377/2013)
    └── GUIA_REGISTRO_RNBD.md              ¿Quién debe registrarse en el RNBD? (spoiler: probablemente la IPS, no Telesalud)
```

También en la raíz del proyecto: `SECURITY.md` (proceso de reporte de vulnerabilidades y
respuesta a incidentes) y una página de Política de Tratamiento de Datos dentro de la app
(enlace en el pie de página).

## Cómo ejecutarlo

```bash
cd telesalud-offline/backend
npm install
npm start
```

Luego abre `http://localhost:5175`. El servidor sirve tanto la API como la PWA.

Profesionales de demostración para el panel (documento + PIN):
- `1020304050` / PIN `1234` (médico)
- `1122334455` / PIN `5678` (enfermero)

### Ejecutar las pruebas automatizadas

```bash
cd telesalud-offline/backend
npm test
```

33 pruebas end-to-end sobre una base de datos en memoria: login y PIN, cifrado en reposo,
idempotencia de sincronización, versionado de respuestas, historial de pacientes, filtros,
estadísticas, checklist de cierre normativo, seguimiento de casos, consentimientos separados
(Res. 1644/2026 + Ley 1581/2012), derechos ARCO completos (acceso, rectificación, supresión y
revocación), asentimiento de adolescentes, backups, consulta pública de resultados
(Res. 1644/2026 Art. 10 §1), y los flujos completos de USSD y SMS.

## Qué es real y qué es simulado en este prototipo

| Componente | Estado |
|---|---|
| Formulario offline con guardado en IndexedDB | Real y funcional |
| Motor de sincronización idempotente | Real y funcional |
| Motor de triage por banderas rojas (inspirado en AIEPI) | Real: preguntas de signos de alarma generales + por síntoma calculan el nivel de urgencia automáticamente, ajustado por edad y embarazo. Es una simplificación de demostración, no un protocolo clínicamente validado |
| Respuesta profesional estructurada | Real: orientación, recomendaciones y signos de alarma por separado, con sugerencia pre-llenada desde el protocolo del síntoma |
| Seguimiento de casos | Real: programar fecha de control, cola de "seguimientos pendientes", marcar completado |
| Checklist de cierre normativo | Real y exigido por el backend: no se puede cerrar un caso sin confirmar consentimiento y orientación entregada (y remisión gestionada si aplica) |
| Consulta pública de resultados por código (Res. 1644/2026, Art. 10 §1) | Real: cada caso recibe un código de 8 caracteres; el paciente puede consultar la orientación recibida por el mismo canal (app, USSD con "Consultar mi caso", SMS con `ESTADO <código>`), sin necesitar cuenta |
| Historia Clínica Electrónica / interoperabilidad (Res. 1888/2025, HL7 FHIR) | **No implementada** — ver `docs/ACREDITACION_Y_HISTORIA_CLINICA.md` para el detalle de la brecha |
| Acreditación internacional (ISO 13131, ATA/TAP, URAC) | No aplica al software en sí — son acreditaciones de la organización prestadora, no del código. Ver el mismo documento |
| Municipios y departamentos | Datos reales de Colombia (selección curada, no el DIVIPOLA oficial completo) |
| Historial de pacientes recurrentes | Real: búsqueda por documento mediante índice ciego (HMAC), sin exponer el documento en texto plano en la base de datos |
| Panel profesional (login, triage, respuesta, filtros, historial, estadísticas, seguimiento) | Real y funcional |
| Red de remisión sugerida al marcar un caso como remitido | Directorio de **ejemplo** (nombres genéricos) — debe reemplazarse por la red real de la IPS piloto |
| Datos de demostración | 20 casos realistas en 12 municipios reales, con 2 pacientes recurrentes, para poblar historial y estadísticas |
| Orientación clínica cacheada sin conexión | Real (contenido de ejemplo, no clínicamente validado) |
| Canal USSD | Simulado con la interfaz estándar de un agregador; falta contrato con operador de telecomunicaciones |
| Canal SMS | Simulado igual que USSD; falta contrato con agregador SMS |
| Service Worker (caché de app shell + Background Sync) | **Verificado con un navegador real (Playwright/Chromium):** la app carga completa sin red, el formulario se guarda offline y sincroniza automáticamente al reconectar |
| Autenticación de profesionales | PIN + JWT firmado con expiración de 8h, límite de intentos de ingreso (anti fuerza bruta) |
| Cifrado en reposo | Nombre, documento y teléfono del paciente cifrados con AES-256-GCM antes de guardarse en SQLite |
| Validación de entradas | Todos los endpoints validan su cuerpo con esquemas (zod); rechazan payloads malformados |
| Cabeceras de seguridad HTTP | `helmet` habilitado en todas las respuestas |
| Consentimiento clínico y autorización de datos personales | Real y separados: dos checkboxes en la app, mensaje combinado y explícito en USSD/SMS; ambos campos independientes en la base de datos y ambos exigidos por el backend |
| Derechos ARCO completos (Ley 1581/2012 Art. 8) | Real: Acceso, Rectificación (datos de identificación, no el contenido clínico), Supresión (anonimiza, conserva el registro por la Res. 1995/1999) y Revocación — los cuatro con botón en "Mi cola" y endpoint público por código |
| Asentimiento diferenciado para adolescentes (Res. 1644/2026 Art. 7) | Real: casilla adicional que aparece solo cuando el grupo de edad es "adolescente"; el backend la exige |
| Backups automatizados | Real: copia al iniciar y cada 24h, con checkpoint de WAL, reteniendo 30 copias; endpoint para listar/forzar una manual |
| Íconos PWA | Real: PNG 192×192 y 512×512 (`any` y `maskable`), generados y verificados — antes eran un SVG de marcador de posición |
| Pruebas automatizadas | 33 pruebas (`npm test`) cubren auth, cifrado, idempotencia, versionado, historial, filtros, estadísticas, consentimientos, ARCO completo, backups, consulta pública, USSD y SMS |

## Siguientes pasos recomendados

1. Definir con jurídica el texto de consentimiento informado y la política de datos
   personales (Ley 1581/2012).
2. Buscar un convenio piloto con una IPS/ESE ya habilitada en un municipio con brecha
   confirmada (ver `docs/CUMPLIMIENTO_SUH.md`, sección 4).
3. Cotizar integración con un agregador de SMS/USSD colombiano para reemplazar los
   simuladores por tráfico real.
4. Reemplazar la llave de cifrado y el secreto JWT generados localmente (`backend/data/.encryption_key`,
   `backend/data/.jwt_secret`) por secretos gestionados (KMS/Vault) antes de cualquier despliegue real.
5. Integrar verificación real contra RETHUS para la habilitación profesional (hoy solo modelada).
6. Reemplazar `frontend/directorio_remision.json` por la red de referencia y contrarreferencia
   real de la IPS piloto (nombres, teléfonos y protocolos de remisión verdaderos).
7. Validar el motor de triage con un profesional de salud o una guía clínica formal antes de
   usarlo más allá de una demostración — hoy es una simplificación educativa, no un dispositivo
   de decisión clínica certificado.
