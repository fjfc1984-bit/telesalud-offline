# Protección de Datos Personales y Superintendencia de Industria y Comercio (SIC)

> **Origen de este documento:** además de la normativa de salud (`CUMPLIMIENTO_SUH.md`,
> `ACREDITACION_Y_HISTORIA_CLINICA.md`), este análisis se apoya en el trabajo jurídico ya hecho
> para **NormaLis** (`C:\Users\fjfc1\OneDrive\Documentos\GitHub\normalis`), la plataforma de
> cumplimiento normativo del mismo autor — específicamente su Política de Tratamiento de Datos
> Personales (v1.1, agosto 2026) y su página de Confianza y Seguridad, que ya identificaron y
> aplicaron el marco de la SIC con detalle. Aquí se traslada ese marco al contexto específico de
> Telesalud Offline-First, que maneja un tipo de dato más sensible (salud) que NormaLis (datos
> institucionales de IPS).

## 1. El marco legal completo (no solo salud)

| Norma | Qué regula | Autoridad |
|---|---|---|
| **Ley 1581 de 2012** | Ley estatutaria de Habeas Data — protección general de datos personales | SIC |
| **Decreto 1377 de 2013** | Reglamenta la Ley 1581/2012: autorización, política de tratamiento, aviso de privacidad, transferencia internacional | SIC |
| **Circular Externa 002 de 2024 (SIC)** | Lineamientos de tratamiento de datos personales en **sistemas de inteligencia artificial** — idoneidad, necesidad, razonabilidad, proporcionalidad; privacidad desde el diseño | SIC |
| **Ley 1266 de 2008** | Habeas Data **financiero/crediticio** — no aplica directamente a Telesalud, pero la Circular 002/2024 la referencia como marco hermano | SIC |
| **Ley 23 de 1981, Art. 15 + Resolución 13437 de 1991** | Consentimiento informado clínico general (distinto del consentimiento específico de teleorientación de la Res. 1644/2026, Art. 7) | Ministerio de Salud |
| **Ley 527 de 1999, Art. 7 vs. Art. 28 + Decreto 2364 de 2012** | Validez de firmas electrónicas (Art. 7, lo que ya usa este prototipo) vs. firma digital certificada por PKI (Art. 28, requiere Entidad de Certificación Digital acreditada) | — |

**Por qué importa la distinción Ley 1581/2012 vs. Res. 1644/2026:** son dos consentimientos
legalmente independientes, tal como confirma el texto oficial de la Res. 1644/2026 Art. 7: *"El
consentimiento informado para la atención en salud es independiente de la autorización para el
tratamiento de datos personales, la cual se regirá por lo dispuesto en la Ley 1581 de 2012."*
Este prototipo hoy **mezcla ambos en un solo checkbox** — ver sección 4.

## 2. Responsable vs. Encargado del Tratamiento — la pieza que falta definir

La Ley 1581/2012 (Art. 3, literales d y e) distingue:

- **Responsable del Tratamiento:** decide para qué se usan los datos. Normalmente, en un
  convenio de piloto, **es la IPS/ESE**, no el software.
- **Encargado del Tratamiento:** procesa los datos por instrucción del Responsable, sin decidir
  su finalidad. **Este sería el rol de Telesalud Offline-First** si opera bajo convenio con una
  IPS (el mismo modelo que usa NormaLis para su módulo de Consentimientos Informados frente a
  las IPS que lo usan).

**Esto no está definido hoy en ningún documento del proyecto.** Es una decisión contractual, no
de código, pero tiene consecuencias reales:

| Si Telesalud es... | Implica que... |
|---|---|
| **Encargado** (recomendado, igual que el modelo de NormaLis) | La IPS define las finalidades y responde ante el paciente y la SIC; Telesalud procesa "por instrucción" y debe firmar un contrato de encargo (Art. 25 Decreto 1377/2013) con la IPS |
| **Responsable** (si opera de forma independiente, sin convenio) | Telesalud mismo debe registrar sus bases de datos, definir su propia política, y responde directamente ante la SIC y los pacientes |

**Recomendación:** formalizar a Telesalud como **Encargado del Tratamiento** en el convenio con
la IPS piloto (ver `CUMPLIMIENTO_SUH.md`, sección de recomendaciones) — es más simple, y es el
modelo que ya usa NormaLis exitosamente con las IPS que lo contratan.

## 3. Registro Nacional de Bases de Datos (RNBD)

**Corrección verificada (2-sep-2026):** no existe una excepción por sensibilidad del dato — que
sean datos de salud no activa por sí solo la obligación de registro. El criterio real es: (a)
ser una entidad de naturaleza **pública** (sin importar el tamaño), o (b) superar **100.000 UVT**
en activos totales (≈ $5.237.400.000 COP en 2026) si es privada. Además, **el Encargado del
Tratamiento no se registra por separado** — solo el Responsable. El detalle completo, con el
calendario 2026 y los pasos del trámite, está en `docs/GUIA_REGISTRO_RNBD.md`.

Si Telesalud opera como Encargado bajo el convenio de la IPS (sección 2), **no necesita registro
propio**; es la IPS quien probablemente ya deba tener uno (muchas IPS/ESE rurales son entidades
públicas, obligadas sin importar sus activos) — pero esto **debe confirmarse explícitamente en
el convenio**, no asumirse.

## 4. Estado de este prototipo frente a la Ley 1581/2012 y la Circular 002/2024

| Requisito | Estado | Acción |
|---|---|---|
| Autorización de tratamiento de datos personales, **separada** del consentimiento clínico (Art. 7 Res. 1644/2026 lo exige explícitamente) | ✅ **Implementado.** Dos checkboxes independientes en la app (canal con más capacidad de UI); en USSD/SMS se combinan en un solo mensaje que nombra ambas autorizaciones explícitamente (limitación real del canal), pero se registran como dos campos independientes en la base de datos | — |
| Aviso de privacidad / Política de Tratamiento de Datos publicada | ✅ **Implementado.** Página de 13 secciones dentro de la app (enlace "Política de tratamiento de datos" en el pie de página), adaptada de la estructura de NormaLis a datos de salud como dato principal, no excepción — marcada explícitamente como borrador de un prototipo | — |
| Derechos ARCO completos (Art. 8 Ley 1581/2012) | ✅ **Implementados los cuatro**, con el código de 8 caracteres como llave de acceso: Acceso (`GET /consulta/:codigo`), Rectificación (`POST /consulta/:codigo/rectificar` — solo datos de identificación, no el contenido clínico), Supresión (`POST /consulta/:codigo/eliminar` — anonimiza identificación, conserva el registro clínico por la Res. 1995/1999), Revocación (`POST /consulta/:codigo/revocar`). Los cuatro con botón correspondiente en "Mi cola" | Un canal de soporte humano (correo) para los casos que no encajen en el flujo automatizado (ej. el usuario perdió su código) |
| Asentimiento diferenciado para adolescentes (Art. 7 Res. 1644/2026) | ✅ **Implementado**: casilla adicional que aparece cuando el grupo de edad es "adolescente"; el backend rechaza el caso si falta | — |
| Backups de la base de datos | ✅ **Implementado**: copia automática al iniciar y cada 24h, con checkpoint de WAL, reteniendo 30 copias (`backend/src/backup.js`, ver `SECURITY.md`) | Copia fuera de sitio (otra máquina/nube), no solo en el mismo disco |
| Transparencia sobre uso de IA/automatización (Circular 002/2024: idoneidad, necesidad, razonabilidad, proporcionalidad) | ⚠️ Parcial — se avisa que el triage es automatizado (consentimiento ampliado en la ronda anterior), pero no se documentó explícitamente el análisis de idoneidad/necesidad/proporcionalidad que pide la circular | Redactar ese análisis una vez (no es una función de software, es un documento de sustentación) |
| Definición de Responsable vs. Encargado | ❌ No definida | Resolver en el convenio con la IPS piloto (sección 2) |
| Registro en el RNBD | ✅ **Aclarado** — Telesalud (Encargado) no se registra; la IPS (Responsable) probablemente ya deba estarlo si es pública. Ver `GUIA_REGISTRO_RNBD.md` | Confirmar en el convenio si la IPS ya tiene registro vigente y actualizarlo para incluir a Telesalud |
| Contrato de encargo del tratamiento con la IPS (Art. 25 Decreto 1377/2013) | ❌ No existe (no hay convenio firmado aún) | Redactar como parte del convenio de piloto |
| Notificación de incidentes de seguridad a la SIC (Art. 17(n) Ley 1581/2012) | ❌ No hay proceso documentado | Ver plantilla de NormaLis (`SECURITY.md`) — es reutilizable casi directamente |
| Cifrado, control de acceso, bitácora inmutable | ✅ Ya implementado (ver `ARQUITECTURA.md`) — de hecho más fuerte que lo mínimo exigido | — |

## 5. Qué copiar directamente del trabajo ya hecho en NormaLis

NormaLis ya resolvió, para un producto SaaS colombiano de salud, varias piezas que Telesalud
puede adaptar en vez de rehacer desde cero:

1. **Estructura de la Política de Tratamiento de Datos** (`normalis/web/app/politica-privacidad/page.tsx`):
   13 secciones — responsable, datos recopilados, finalidad, base legal, datos sensibles,
   transferencia, retención, derechos ARCO, seguridad, IA, cookies, modificaciones, contacto.
   Telesalud necesita su propia versión (los datos son de pacientes, no de instituciones — el
   nivel de sensibilidad y las excepciones son distintas), pero la estructura es directamente
   reutilizable.
2. **`SECURITY.md`** — proceso de reporte de vulnerabilidades y respuesta a incidentes,
   incluyendo la notificación a la SIC bajo el Art. 17(n). Telesalud no tiene ningún documento
   equivalente hoy.
3. **Página de "Confianza y Seguridad"** — honesta sobre qué controles existen y cuáles faltan,
   sin fingir una certificación que no se tiene. Encaja perfectamente con el tono de
   `ACREDITACION_Y_HISTORIA_CLINICA.md`, que ya sigue el mismo principio.
4. **Retención por categoría de dato** (cuenta activa / tras cancelación 15 días hábiles /
   bitácora 12 meses / logs técnicos 90 días) — Telesalud no tiene ninguna política de
   retención definida; esta es una plantilla de partida razonable, ajustando los plazos a los
   15 años mínimos que exige la Resolución 1995/1999 para la información clínica específicamente.
5. **El manejo de la firma electrónica** (Ley 527/1999 Art. 7, con aclaración explícita de que
   no equivale a firma digital certificada PKI) — directamente aplicable si Telesalud algún día
   pide una firma en vez de solo un checkbox de consentimiento.

## 6. Resumen de acciones concretas, en orden de prioridad

1. ~~Separar el consentimiento clínico del consentimiento de datos personales~~ — **hecho**:
   dos checkboxes en la app, un mensaje combinado pero explícito en USSD/SMS, y dos campos
   (`consentimiento_informado` / `autorizacion_datos_personales`) independientes en la base de
   datos. El backend rechaza sincronizar si falta cualquiera de los dos.
2. ~~Implementar la revocación de consentimiento~~ — **hecho**: `POST
   /api/sync/consulta/:codigo/revocar`, con botón "Revocar autorización de datos" en "Mi cola".
   No borra el registro clínico (lo exige la Res. 1995/1999) — deja constancia de que el
   titular retiró su autorización, con versión y bitácora de auditoría. Probado de extremo a
   extremo con Playwright, y con pruebas automatizadas (`npm test`, 33 pruebas en verde).
3. ~~Definir Responsable vs. Encargado del Tratamiento~~ — **borrador hecho**:
   `docs/ANEXO_ENCARGO_TRATAMIENTO_DATOS.md` es una plantilla de cláusula de encargo (basada en
   el Art. 25 del Decreto 1377/2013) lista para que jurídica la revise y adapte al convenio real
   con la IPS piloto — no es un contrato firmable tal cual.
4. ~~Redactar una Política de Tratamiento de Datos~~ — **hecho**, ver sección anterior.
5. ~~Crear un `SECURITY.md`~~ — **hecho**: `telesalud-offline/SECURITY.md`, adaptado del de
   NormaLis con el estado de madurez honesto de este prototipo (sin revocación individual de
   sesión, llaves en archivo local — no en KMS; backups sí resueltos, ver punto 8).
6. ~~Confirmar si aplica el registro en el RNBD~~ — **investigado y documentado**:
   `docs/GUIA_REGISTRO_RNBD.md`. Hallazgo clave: si Telesalud opera como Encargado (el modelo
   recomendado), **no se registra por separado** — solo el Responsable (la IPS) lo hace, y
   probablemente ya esté obligada por ser una entidad pública (ESE), independientemente de sus
   activos. El trámite en sí sigue sin poder ejecutarse desde aquí porque requiere el RUT y las
   credenciales de una entidad legal real — ver el documento para el detalle completo.
7. ~~Completar Rectificación y Supresión (ARCO)~~ — **hecho**: la Supresión anonimiza en vez de
   borrar (Ley 1581/2012 permite esa excepción cuando hay un deber legal de conservación —
   Res. 1995/1999); la Rectificación se limita a datos de identificación, no al contenido
   clínico del encuentro. Ambas probadas de extremo a extremo.
8. ~~Backups automatizados de la base de datos~~ — **hecho**: ver `SECURITY.md`.
