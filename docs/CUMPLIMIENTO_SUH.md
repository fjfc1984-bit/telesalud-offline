# Mapeo de cumplimiento — Telesalud/Telemedicina y Sistema Único de Habilitación

> **Aviso legal:** este documento es una guía técnica de apoyo, no un concepto jurídico. La
> habilitación real de un servicio de salud en Colombia la define la Secretaría de Salud
> departamental/distrital a través del Sistema Único de Habilitación (SUH). A diferencia de la
> versión anterior de este documento, **esta sí está verificada contra el texto oficial** de las
> resoluciones (extraído de la base jurídica de la Secretaría Jurídica Distrital de Bogotá,
> `alcaldiabogota.gov.co/sisjur`, el 2 de septiembre de 2026), citando artículo por artículo. Aun
> así, antes de operar, debe ser validado por el equipo jurídico y de calidad de la IPS/ESE.

## Marco normativo vigente (verificado contra texto oficial)

| Norma | Deroga a | Expedición / vigencia | Objeto |
|---|---|---|---|
| **Resolución 1644 de 2026** | Resolución 2654 de 2019 (Art. 44) | 31-jul-2026, rige desde su expedición | Requisitos y condiciones para telesalud y telemedicina en el SGSSS |
| **Resolución 1732 de 2026** | Resolución 3100 de 2019 y sus 8 modificatorias (Art. 35) | 5-ago-2026, rige desde su expedición/publicación en Diario Oficial | Procedimiento de inscripción de prestadores y condiciones de habilitación (Manual de Inscripción de Prestadores y Habilitación de Servicios de Salud) |

La conclusión central de este proyecto **se confirma con el texto oficial**: la teleorientación
sigue sin requerir habilitación, y la distinción teleorientación/telemedicina no cambió en su
naturaleza — solo se reescribió y se precisó.

## 1. Teleorientación en salud — Artículos 9 y 10 de la Resolución 1644/2026 (texto oficial)

**Artículo 9 — Actividades de telesalud:** *"Las siguientes actividades se consideran parte de
la telesalud y no requieren habilitación teniendo en cuenta que su alcance no implica la
prestación de un servicio de salud en modalidad de telemedicina: 1. Teleorientación en salud.
2. Teleapoyo. 3. Teleeducación en salud."*

- **Parágrafo 1:** debe garantizarse protección, confidencialidad e integridad de los datos
  personales; comunicar claramente el alcance e implicaciones; el alcance debe estar
  **documentado** y la información generada conservarse **bajo custodia del emisor**.
- **Parágrafo 2:** estas actividades tienen alcance de educación/orientación/consejería, **en
  ningún caso constituyen acto médico**, y se recomienda no implementarlas como acciones
  aisladas sino integradas a estrategias de Atención Primaria en Salud (APS) y planes
  territoriales.

**Artículo 10 — Teleorientación en salud:** *"actividad de consejería y orientación en los
componentes de promoción de la salud, prevención de la enfermedad y el fomento del
autocuidado. Su finalidad es informar, identificar alertas, orientar y, cuando corresponda,
recomendar la derivación del usuario hacia los servicios de salud pertinentes."*

- **Parágrafo 1:** el teleorientador debe tener **entrenamiento previo**, operar desde un
  entorno que garantice privacidad/confidencialidad, y **debe informar al usuario el alcance y
  limitaciones de la orientación brindada, y entregar copia o resumen de la comunicación
  cuando el usuario o su responsable lo solicite.**
- **Parágrafo 2:** *"La teleorientación en salud no contempla la formulación de medicamentos,
  órdenes, incapacidades, certificados clínicos ni solicitudes diagnósticas."*

### Estado de este prototipo frente al texto oficial

| Requisito (artículo) | Estado en el software | Qué falta institucionalmente |
|---|---|---|
| No formular medicamentos, órdenes, incapacidades ni certificados (Art. 10 §2) | ✅ El modelo de datos no tiene ningún campo de prescripción; los estados de cierre son `orientado`/`remitido_*`/`cerrado`, nunca una fórmula | Control de proceso: el campo de texto libre no impide que un profesional escriba una dosis — es responsabilidad operativa, no del software |
| Alcance documentado, información bajo custodia del emisor (Art. 9 §1) | ✅ `encounter_versions` + `audit_log`, cifrado en reposo | Política formal de custodia/retención |
| **Entregar copia o resumen al usuario que lo solicite (Art. 10 §1)** | ✅ **Implementado.** Cada caso recibe un código corto; el paciente puede consultarlo desde el mismo canal (app: botón "Consultar respuesta"; USSD: opción "Consultar mi caso"; SMS: `ESTADO <código>`) sin necesitar cuenta de profesional | — |
| Entrenamiento previo del teleorientador (Art. 10 §1) | ❌ No aplica al software | Capacitación institucional del equipo clínico |
| No constituye acto médico / se integra a APS, no aislada (Art. 9 §2) | ⚠️ Depende de cómo se opere, no del código | Diseño del programa de atención de la IPS piloto |

## 2. Consentimiento informado — Artículo 7 de la Resolución 1644/2026 (texto oficial)

El consentimiento debe informar sobre: *"el funcionamiento de la atención mediante TIC, su
alcance, beneficios y riesgos, las responsabilidades de las partes, el manejo de la privacidad,
confidencialidad y datos personales, los protocolos de contacto, las condiciones para la
prescripción de tecnologías en salud [no aplica a teleorientación], los procedimientos ante
emergencias o fallas tecnológicas, y los riesgos de violación a la confidencialidad."*

Puntos verificados textualmente que **no estaban** en el análisis anterior de este documento:

- El consentimiento **es independiente** de la autorización de tratamiento de datos personales
  (Ley 1581 de 2012) — son dos consentimientos distintos, no uno solo.
- Se admite firma manuscrita, digital, electrónica o digitalizada.
- **"El usuario podrá revocarlo en cualquier momento."** — mecanismo de revocación explícito.
- Para niños, niñas y adolescentes: además del consentimiento de los padres/acudientes, se
  requiere el **asentimiento informado** del menor cuando su edad y madurez se lo permitan
  (remite a la Resolución 309, sobre atención diferencial a menores).

### Estado de este prototipo

| Requisito | Estado | Qué falta |
|---|---|---|
| Consentimiento obligatorio antes de sincronizar | ✅ El backend rechaza sin él | Redactar el texto legal exacto con jurídica, cubriendo los puntos del Art. 7 (hoy el texto de la app es una versión simplificada, ver `ussd.js`/`index.html`) |
| Mención de que el triage se calcula de forma automatizada | ✅ Agregado al texto de consentimiento de la app y del menú USSD | — |
| **Mecanismo de revocación del consentimiento** | ❌ No implementado | **Brecha real.** El sistema no tiene ningún flujo para que un paciente revoque su consentimiento después de haberlo dado |
| **Asentimiento diferenciado para niños/adolescentes** | ❌ No implementado — el formulario usa el mismo checkbox de consentimiento sin distinguir por `edad_grupo` | **Brecha real.** Cuando `edad_grupo` es `nino` o `adolescente`, el consentimiento debería reflejar que lo da el acudiente, con espacio para el asentimiento del menor |
| Independencia entre consentimiento clínico y autorización de datos personales | ❌ El prototipo solo tiene un checkbox combinado | Separar ambos consentimientos si se avanza más allá del prototipo |

## 3. Inteligencia artificial y automatización — Artículo 23 de la Resolución 1644/2026 (texto oficial)

**Hallazgo que corrige la versión anterior de este documento:** el Artículo 23 ("Uso de
plataformas basadas en inteligencia artificial") está **explícitamente scoped a la modalidad de
telemedicina**, no a telesalud/teleorientación: *"El uso de plataformas tecnológicas basadas en
inteligencia artificial (IA) se permite como herramienta de apoyo tecnológico en la prestación
de servicios de salud en **modalidad de telemedicina**..."* Igual ocurre con el Artículo 39
(interoperabilidad con Historia Clínica Electrónica): aplica a *"prestadores de servicios de
salud que oferten servicios en **modalidad de telemedicina**"*.

**Esto reduce el riesgo regulatorio del motor de triage de este prototipo**, frente a lo que se
documentó la primera vez: como el sistema está acotado a teleorientación (no telemedicina), el
requisito de registro ante INVIMA como dispositivo médico de software (Art. 23, numeral 3, que sí
aplicaría si se clasificara como tal) **no se activa directamente** bajo la lectura literal del
artículo. Dicho esto, dos consideraciones quedan abiertas:

1. El "considerando" de la resolución cita el **Documento CONPES 4144 de 2025** (Política
   Nacional de Inteligencia Artificial), que fija principios éticos — transparencia,
   responsabilidad jurídica del talento humano, protección de datos, mitigación de sesgos —
   para *"cualquier sistema automatizado de soporte relacionado con la decisión clínica"*, sin
   acotarlo a telemedicina. Es una política nacional, no una obligación de habilitación, pero es
   buena práctica seguirla igual — es lo que ya se hizo al ampliar el consentimiento (sección 2).
2. Esta lectura (Art. 23 no aplica a teleorientación) es la interpretación literal del texto,
   **no un concepto jurídico**. Si el alcance del sistema creciera hacia telemedicina en el
   futuro, el Art. 23 completo — incluyendo el posible registro INVIMA — sí se activaría.

| Requisito | Estado |
|---|---|
| El profesional revisa/anula la sugerencia del sistema | ✅ `triage_nivel_confirmado` |
| Trazabilidad de cómo se calculó la sugerencia | ✅ `triage_detalle` |
| El sistema no decide autónomamente el tratamiento | ✅ Solo calcula un nivel de urgencia editable |
| Registro INVIMA como dispositivo médico de software | ⚪ No aplica bajo la lectura literal del Art. 23 (scoped a telemedicina) mientras el alcance sea teleorientación — revalidar si el alcance cambia |

## 4. Sistema Único de Habilitación — Resolución 1732 de 2026 (texto oficial)

**Artículo 35 — Vigencia y derogatoria:** deroga la Resolución 3100 de 2019 *"y sus
modificatorias"* (Resoluciones 2215/2020, 1317/2021, 1138/2022 y otras posteriores).

### Municipios con condiciones especiales — Capítulo 6, Artículos 27 a 32 (texto oficial completo)

Aplica a municipios del **Plan Nacional de Salud Rural** (*"Plan Nacional de Salud Rural, salud,
cuidado y paz en el campo colombiano"*, adoptado por el **Decreto 351 de 2025**) y a estos 8
tipos de municipio (texto verbatim, Art. 27):

1. Población igual o inferior a veinte mil (20.000) habitantes.
2. Municipios incluidos en Programas de Desarrollo con Enfoque Territorial (PDET).
3. Municipios con Planes Especiales de Intervención Integral (PEII) en Zonas Estratégicas de
   Intervención Integral (ZEII), (LGM-MAM-CA).
4. Municipios vinculados al Programa Nacional Integral de Sustitución Voluntaria de Cultivos de
   Uso Ilícito (PNIS).
5. Municipios clasificados como Zonas Más Afectadas por el Conflicto Armado (ZOMAC).
6. Municipios priorizados en el marco del Plan Nacional de Salud Rural (PNSR).
7. Zonas especiales de dispersión geográfica.
8. Municipios con presencia significativa de comunidades étnicas.

**Artículo 28 — Plan de Adecuación Progresiva de Condiciones de Habilitación** (el nombre
correcto, no "Adaptación" como se citó en la versión anterior de este documento): documento
técnico donde el prestador programa acciones/inversiones para avanzar gradualmente hacia el
cumplimiento pleno. **Artículo 31 — Cláusula de no regresividad:** son medidas transitorias,
revisadas a un plazo máximo de **4 años**. El detalle de los criterios diferenciales por
categoría vive en el **Tomo I del Manual de Inscripción de Prestadores y Habilitación de
Servicios de Salud** (anexo técnico, no incluido en el cuerpo de la resolución consultado).

**Coincidencia confirmada con este proyecto:** Chocó, Vichada, Vaupés, Guaviare, Putumayo,
Cauca y La Guajira (municipios usados en los datos de demostración) caen en varias de estas 8
categorías simultáneamente (PDET + ZOMAC + dispersión geográfica + PNSR, típicamente). Esto ya
no es una inferencia — es una coincidencia verificable artículo por artículo.

### Confirmación oficial de la conectividad intermitente (Resolución 1644/2026, no solo 1732/2026)

Buscando "dispersión" en el texto de la 1644/2026 se encontró, en el artículo de criterios
diferenciales para telemedicina en municipios con condiciones especiales: *"Estos criterios
podrán contemplar adaptaciones relacionadas con infraestructura física, dotación mínima de
equipos y disponibilidad de conectividad, **reconociendo condiciones de conectividad
intermitente, satelital o de difícil acceso**."* Esto confirma, con texto oficial, algo que en
la primera versión de este análisis quedó como un hallazgo de una sola fuente secundaria sin
corroborar: **la conectividad intermitente ya está reconocida explícitamente en la norma**, no
solo como argumento de mercado sino como criterio regulatorio.

## 5. Acciones concretas recomendadas (actualizado con el texto oficial)

1. ~~Implementar la entrega de copia/resumen al usuario (Art. 10 §1)~~ — **hecho**: endpoint
   público `GET /api/sync/consulta/:codigo` (sin autenticación, protegido solo por el código de
   8 caracteres que recibe el usuario al reportar su caso) más la integración en los tres
   canales. Probado de extremo a extremo con Playwright y con 3 pruebas automatizadas nuevas.
2. **Agregar un mecanismo de revocación de consentimiento** (Art. 7) — al menos un procedimiento
   documentado, idealmente una función en el panel profesional para marcar un consentimiento
   como revocado.
3. **Diferenciar el consentimiento cuando `edad_grupo` es `nino`/`adolescente`** para reflejar
   consentimiento del acudiente + espacio de asentimiento del menor (Art. 7, remite a la
   Resolución 309).
4. **Separar el consentimiento clínico de la autorización de datos personales** (Art. 7 lo exige
   como dos actos independientes; hoy el prototipo los mezcla en un solo checkbox).
5. Verificar contra el **Tomo I del Manual de Inscripción de Prestadores** (anexo técnico de la
   Res. 1732/2026, no consultado directamente) los criterios diferenciales exactos para cada una
   de las 8 categorías de municipio, antes de usarlos en una negociación con una Secretaría de
   Salud.
6. Talento humano, protocolo de remisión, y protección de datos personales (Ley 1581/2012):
   sin cambios frente a la versión anterior de este documento.
