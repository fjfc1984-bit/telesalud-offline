# Anexo — Encargo del Tratamiento de Datos Personales

> **Esto es un borrador de trabajo, no un contrato listo para firmar.** Está redactado como
> punto de partida para que el equipo jurídico de la IPS/ESE piloto y el de Telesalud Offline-First
> lo revisen, ajusten y adapten antes de incorporarlo al convenio de piloto (ver
> `CUMPLIMIENTO_SUH.md`, sección 4, y `PROTECCION_DATOS_SIC.md`, sección 2). La estructura sigue
> los requisitos mínimos del Artículo 25 del Decreto 1377/2013 para contratos de encargo del
> tratamiento, adaptados a este proyecto.

## Por qué existe este documento

`PROTECCION_DATOS_SIC.md` identificó que Telesalud Offline-First y la IPS piloto deben definir
contractualmente quién es **Responsable** y quién es **Encargado** del tratamiento de los datos
de los pacientes (Ley 1581/2012, Art. 3, literales d y e). Este anexo asume la opción
recomendada — **la IPS es Responsable; Telesalud Offline-First es Encargado** — porque es el
modelo que ya usa NormaLis con las IPS que lo contratan, y porque evita que el prototipo deba
asumir por sí solo las obligaciones de un Responsable (registro en el RNBD, respuesta directa
ante la SIC, etc.).

---

## ANEXO [N] — ENCARGO DEL TRATAMIENTO DE DATOS PERSONALES

**Entre:** [Nombre de la IPS/ESE] ("el Responsable") y [Razón social/nombre del operador de
Telesalud Offline-First] ("el Encargado"), en el marco del convenio de piloto de teleorientación
suscrito entre las partes.

### 1. Objeto

El Encargado tratará, por cuenta e instrucción del Responsable, los datos personales —incluidos
datos sensibles de salud— de los pacientes y usuarios que reporten casos de teleorientación a
través de la plataforma Telesalud Offline-First, con el único fin de prestar el servicio técnico
de captura, sincronización, triage automatizado de apoyo, y puesta a disposición de dichos casos
al personal de salud designado por el Responsable.

### 2. Instrucciones del Responsable

El Encargado únicamente tratará los datos conforme a las instrucciones documentadas del
Responsable, contenidas en: (i) este anexo, (ii) la configuración operativa del servicio
acordada entre las partes, y (iii) instrucciones adicionales que el Responsable comunique por
escrito. El Encargado informará al Responsable si, a su juicio, alguna instrucción infringe la
Ley 1581/2012 o la normativa de salud aplicable.

### 3. Datos objeto del encargo

- **Identificación:** nombre, número de documento del paciente (cuando se registre).
- **Contacto:** número de teléfono.
- **Salud:** motivo de consulta, síntomas reportados, respuestas al cuestionario de triage,
  nivel de urgencia calculado, orientación y recomendaciones entregadas por el profesional.
- **Metadatos:** ubicación (departamento/municipio/vereda), canal de reporte, marcas de tiempo.

### 4. Obligaciones del Encargado

1. Tratar los datos únicamente para la finalidad descrita en la Sección 1 — no para
   finalidades propias ni de terceros.
2. Guardar confidencialidad sobre los datos, incluso después de finalizado el encargo.
3. Implementar las medidas de seguridad técnicas, humanas y administrativas necesarias
   (cifrado en reposo, control de acceso, bitácora de auditoría — ver `ARQUITECTURA.md` sección
   7), conforme al Art. 5(e) del Decreto 1377/2013.
4. No subcontratar el tratamiento (sub-encargo) sin autorización previa y escrita del
   Responsable. Si se autoriza, el sub-encargado queda sujeto a las mismas obligaciones.
5. Notificar al Responsable, sin demora injustificada, ante cualquier incidente de seguridad que
   pueda afectar los datos personales tratados — para que el Responsable evalúe su propia
   obligación de notificación a los titulares y a la SIC (Art. 17(n) Ley 1581/2012).
6. Al finalizar el encargo, y según la instrucción del Responsable: (a) devolver los datos en un
   formato exportable, y (b) suprimirlos de sus sistemas — salvo la obligación legal de
   conservación de la historia clínica por 15 años mínimo (Resolución 1995/1999), que corresponde
   verificar si aplica a los datos tratados por el Encargado o exclusivamente al sistema de
   Historia Clínica Electrónica del Responsable.
7. Permitir auditorías razonables del Responsable sobre las medidas de seguridad implementadas.
8. Colaborar con el Responsable para atender solicitudes de los titulares (acceso,
   rectificación, supresión, revocación) dentro de los plazos que exige la Ley 1581/2012
   (15 días hábiles, Art. 14).

### 5. Obligaciones del Responsable

1. Contar con la autorización de tratamiento de datos personales de cada titular (paciente),
   independiente del consentimiento clínico de teleorientación — ambos ya se capturan de forma
   separada en la plataforma (ver `PROTECCION_DATOS_SIC.md`, acción 1, ya implementada).
2. Definir y comunicar al Encargado las finalidades e instrucciones del tratamiento.
3. Responder ante los titulares y ante la SIC como Responsable del Tratamiento.
4. Gestionar el registro en el Registro Nacional de Bases de Datos (RNBD) si corresponde
   (ver `PROTECCION_DATOS_SIC.md`, sección 3).
5. Definir la política de retención aplicable a la información clínica generada, conforme a la
   Resolución 1995/1999 y demás normativa de historia clínica vigente.

### 6. Duración

El presente encargo estará vigente durante la duración del convenio de piloto entre las partes,
y se extenderá automáticamente mientras continúe la prestación del servicio, salvo terminación
anticipada notificada por cualquiera de las partes con [30] días de anticipación.

### 7. Responsabilidad

Cada parte responde por los daños y perjuicios que cause por el incumplimiento de sus propias
obligaciones bajo este anexo, conforme a la normativa aplicable. [Cláusula a completar con
asesoría legal — límites de responsabilidad, indemnización, etc.]

---

## Preguntas abiertas para el equipo jurídico (no resueltas por este borrador)

1. ¿El plazo de 15 días para atender solicitudes de titulares corre desde que el titular
   contacta al Responsable (la IPS) o desde que el Encargado (Telesalud) recibe la instrucción
   de este? El Art. 14 de la Ley 1581/2012 no lo precisa para el escenario de dos actores.
2. ¿La obligación de conservar la historia clínica 15 años (Res. 1995/1999) recae sobre el
   sistema del Encargado, o solo sobre la Historia Clínica Electrónica del Responsable una vez
   los datos se integren a ella? Esto determina si Telesalud debe conservar sus propios
   registros más allá de la vigencia del convenio.
3. ¿Qué pasa con los datos si el convenio termina pero el paciente nunca ejerció su derecho de
   supresión? ¿Se transfieren al Responsable, se anonimizan, o se destruyen?
4. Límites de responsabilidad e indemnización (Sección 7) — deliberadamente dejados en blanco;
   son una negociación comercial entre las partes, no una decisión técnica.
