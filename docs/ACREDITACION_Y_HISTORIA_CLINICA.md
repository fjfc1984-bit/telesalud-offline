# Acreditación internacional e Historia Clínica

## Respuesta directa: ¿esto tiene Historia Clínica?

**No.** Lo que existe hoy es un **registro de encuentros de teleorientación** (cada reporte,
con su triage, respuesta y versionado). Eso es útil y necesario, pero **no es** una Historia
Clínica Electrónica (HCE) en el sentido legal colombiano, y tampoco cumple la interoperabilidad
nacional que ya es obligatoria. La diferencia concreta:

| | Este prototipo | Historia Clínica Electrónica (legal) |
|---|---|---|
| Qué guarda | Encuentros de teleorientación aislados, agrupados por paciente vía un índice ciego del documento | Historia longitudinal completa: antecedentes, anamnesis, evolución, todas las atenciones del paciente en cualquier prestador |
| Retención | Sin política de retención definida | Mínimo 15 años (Res. 1995/1999) |
| Formato de intercambio | Ninguno (datos propios del sistema) | HL7 FHIR R4, obligatorio desde la Resolución 1888/2025 |
| Interoperabilidad con otros prestadores | No | Obligatoria: todo prestador debe generar y poder consultar el Resumen Digital de Atención en Salud (RDA) en la plataforma nacional de MinSalud |

## Marco legal colombiano de Historia Clínica (vigente en 2026)

1. **Resolución 1995 de 1999** — la norma base: define la historia clínica como documento
   privado, obligatorio, sometido a reserva; exige diligenciamiento sin tachones ni espacios en
   blanco, y **conservación mínima de 15 años**. Define también los contenidos mínimos que debe
   tener cualquier historia clínica, digital o en papel.
2. **Resolución 866 de 2021** — reglamenta la Ley 2015 y fija los requisitos técnicos de
   interoperabilidad de la HCE: los principios de confidencialidad, disponibilidad, integridad,
   intercambio, oportunidad, seguridad, uniformidad y veracidad.
3. **Resolución 1888 de 2025** (la más reciente y la que más cambia el panorama) — adopta de
   forma **obligatoria** el **Resumen Digital de Atención en Salud (RDA)**: cada prestador debe
   generar un resumen estructurado de cada atención, transmitirlo cifrado (TLS 1.3 + AES-256) a
   la plataforma nacional de MinSalud usando el estándar internacional **HL7 FHIR R4**, donde
   recibe un número único de atención ("VIDA"). Aplica a IPS, EPS, clínicas corporativas y
   cualquier prestador — sin excepción para el tamaño o la ruralidad del prestador.

**Implicación concreta para este proyecto:** si esto se pilotea bajo el convenio con una IPS/ESE
que ya recomendaba `docs/CUMPLIMIENTO_SUH.md` (sección 4), **es esa IPS quien ya debe estar
cumpliendo la Resolución 1888/2025** con su propio sistema de historia clínica. Este prototipo
no necesita implementar HL7 FHIR ni el RDA por sí mismo — necesita **entregarle a esa IPS los
datos del encuentro de teleorientación** para que ella los incorpore a su HCE y los reporte,
como una fuente más de información, no como la historia clínica en sí. Construir la
interoperabilidad HL7 FHIR/RDA completa dentro de este prototipo sería sobre-construir para la
fase de piloto — y de todas formas no eximiría a la IPS de su propia obligación.

**Precisión verificada contra el texto oficial (2-sep-2026):** el Artículo 39 de la Resolución
1644/2026, que exige interoperabilidad con la Historia Clínica Electrónica bajo el estándar de
la Resolución 866/2021, aplica textualmente a *"prestadores de servicios de salud que oferten
servicios en modalidad de telemedicina"* — no a telesalud/teleorientación. Como este prototipo
está acotado a teleorientación, esa obligación específica no se activa por el 1644/2026. La
obligación más amplia de la Resolución 1888/2025 (RDA) sí parece aplicar a todo prestador sin
distinción de modalidad, pero eso **no se verificó contra su texto oficial** (solo fuentes
secundarias) — pendiente de confirmar igual que se hizo con la 1644 y la 1732.

## Estándares internacionales de acreditación en telesalud

**Corrección (2-sep-2026):** el proyecto hermano NormaLis (`normalis-crosswalk.js`) ya construyó
un cross-walk verificado entre la Res. 1732/2026 y **ISO 7101:2023** (*Healthcare organization
management systems — Requirements*) y **Joint Commission International (JCI, 8ª edición)** — dos
referencias más actuales y específicas de salud que ISO 13131 para el estándar de gestión de
calidad general. Se mantienen ambas listas porque ISO 13131 sigue siendo la referencia específica
de *telehealth*, mientras que ISO 7101/JCI son la referencia de calidad hospitalaria/IPS general
bajo la que se evaluaría la organización completa.

Los programas relevantes — **ISO 13131:2021**, **ISO 7101:2023**, **JCI (8ª ed.)**,
**ATA/ClearHealth Quality Institute (Telemedicine Accreditation Program)**, **URAC Telehealth
Accreditation** y **Joint Commission Telehealth Accreditation** — certifican **la operación de
un prestador de salud**, no una pieza
de software. Ninguno se "instala" en el código. Pero comparten dominios de evaluación comunes,
y sobre esos sí se puede medir, hoy, qué tan lista está la base técnica de este prototipo para
sostener esa acreditación cuando la tramite la IPS/ESE que opere el servicio:

| Dominio evaluado (ISO 13131 / ATA-TAP / URAC) | Evidencia que piden ver en auditoría | Estado en este prototipo | Qué falta |
|---|---|---|---|
| Seguridad y confidencialidad de la información | Cifrado de datos sensibles, control de acceso, bitácora de auditoría | ✅ Implementado — AES-256-GCM en reposo, JWT+PIN, `audit_log` por acción | Gestión de secretos con KMS/Vault real (hoy es un archivo local de desarrollo) |
| Flujos clínicos documentados y trazables | Protocolo de triage, respuesta estructurada, registro de qué se le dijo al paciente | ✅ Implementado — triage por banderas rojas, respuesta con orientación/recomendaciones/signos de alarma separados | Validación clínica formal del protocolo por un profesional o guía oficial (hoy es una simplificación de demostración) |
| Gestión de riesgo y seguridad del paciente | Escalamiento por urgencia, seguimiento de casos, remisión a mayor complejidad | ✅ Implementado — triage automático, cola de seguimiento, sugerencia de red de referencia | Red de referencia real (hoy es un directorio de ejemplo) y protocolo formal de remisión con la IPS de referencia |
| Cierre y documentación de cada atención | Constancia de consentimiento y de que la orientación fue entregada | ✅ Implementado — checklist de cierre exigido por el backend, no solo por la interfaz | Ninguna acción de software adicional — esto ya es exigible tal como está |
| Supervisión y competencia profesional | Verificación de que quien atiende está habilitado | ⚠️ Parcial — campo `rethus_verificado` modelado, sin integración real | Conectar al webservice oficial de verificación de RETHUS |
| Trazabilidad histórica del paciente | Vista longitudinal de atenciones previas, no solo el encuentro actual | ⚠️ Parcial — ver "Ficha del paciente" más abajo; no es una HCE | Integración real con la HCE del prestador (Resolución 1888/2025) |
| Talento humano, infraestructura, continuidad del servicio | Personal vinculado y habilitado, plan de contingencia, copias de seguridad | ❌ No aplica al software — esto lo define y documenta la IPS que opere el servicio | Fuera de alcance de este repositorio por definición |
| Gestión financiera del servicio | Sostenibilidad económica del servicio de telesalud | ❌ No aplica al software | Fuera de alcance de este repositorio por definición |

**Cómo leer esta tabla:** las filas en ✅ son evidencia que ya existe y que un auditor de ISO
13131 o ATA/TAP podría revisar hoy mismo en el código. Las filas en ⚠️ tienen una base
construida pero les falta la pieza externa (un webservice, una red real) para estar completas.
Las filas en ❌ no son carencias del software — son responsabilidades que la acreditación exige
de la organización prestadora, y ningún prototipo puede resolverlas por adelantado.

## Qué sí es razonable construir en este prototipo

En vez de perseguir una acreditación o una HCE completa (ambas fuera de alcance de un
prototipo), esto es lo que aporta valor real y ya está construido:

- Una **respuesta profesional estructurada** (orientación, recomendaciones, signos de alarma,
  seguimiento) en vez de un cuadro de texto libre — ver `ARQUITECTURA.md`, sección 10.
- Un **checklist de cierre** que impide marcar un caso como "cerrado" sin confirmar que se
  cumplieron los requisitos mínimos de teleorientación (hoy Resolución 1644/2026, Art. 10).
- Un **registro de seguimiento** de casos que lo requieran, con fecha y estado.
- Una **"ficha del paciente"** (`GET /api/sync/patients/:documento/resumen`): total de
  encuentros, primera y última consulta, motivos más frecuentes, cuántas veces ha estado en
  triage rojo, cuántos encuentros terminaron en remisión. No es una Historia Clínica
  Electrónica — no tiene antecedentes, anamnesis ni examen físico — pero es el paso honesto
  que sí cabe aquí: convertir encuentros aislados en una vista longitudinal del paciente, que
  es exactamente lo que le falta a un simple registro de "tickets" de teleorientación.

Esto no reemplaza una HCE ni una acreditación — pero es exactamente la evidencia operativa que
ambas exigen, y es lo que un prototipo puede entregar honestamente.

## Dos brechas nuevas, encontradas al verificar el texto oficial (no estaban documentadas antes)

Ver `CUMPLIMIENTO_SUH.md` secciones 1 y 2 para el detalle completo, con la cita exacta del
artículo:

1. **Entrega de copia/resumen al usuario que lo solicite** (Res. 1644/2026, Art. 10 §1) — el
   sistema no tiene hoy ninguna forma de que un paciente reciba un resumen de su propio caso.
2. **Revocación de consentimiento** (Res. 1644/2026, Art. 7) — el texto oficial es explícito en
   que el usuario puede revocar su consentimiento en cualquier momento; no existe ningún flujo
   para eso hoy.

Ambas son más concretas y accionables que la pregunta de INVIMA, que además **se despejó
parcialmente**: el Artículo 23 (IA/dispositivos médicos de software) aplica textualmente a la
modalidad de telemedicina, no a telesalud/teleorientación — ver `CUMPLIMIENTO_SUH.md` sección 3.
