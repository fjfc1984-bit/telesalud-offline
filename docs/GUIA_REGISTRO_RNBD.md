# Guía — Registro Nacional de Bases de Datos (RNBD)

> **Por qué este documento no es "hacer el registro"**: el RNBD es un trámite ante la
> Superintendencia de Industria y Comercio que requiere el RUT de una entidad legal real,
> credenciales de acceso vía DIAN/Muisca, e información institucional (activos, políticas
> internas) que no existen para un prototipo de software. Nadie puede tramitarlo "en nombre
> del código" — lo tramita la entidad legal responsable, cuando exista un convenio real. Lo que
> sí se puede hacer ahora es dejar claro, con la norma verificada, **quién tendría que
> registrarse y cuándo**, para que no se descubra tarde en el proceso del convenio.

## 1. Respuesta directa: ¿Telesalud Offline-First debe registrarse en el RNBD?

**No, si opera como Encargado del Tratamiento** (el modelo recomendado en
`PROTECCION_DATOS_SIC.md` y `ANEXO_ENCARGO_TRATAMIENTO_DATOS.md`). La norma es explícita: **solo
el Responsable del Tratamiento se registra en el RNBD — el Encargado no lo hace por separado.**
Si el equipo de Telesalud decide en algún momento operar de forma independiente, sin convenio con
una IPS (es decir, como Responsable), esta pregunta se reabre — ver sección 3.

## 2. ¿La IPS/ESE piloto (el Responsable) debe registrarse?

Depende de dos criterios independientes — basta con cumplir **uno** de los dos:

| Criterio | Obligada a registrarse |
|---|---|
| **Es una entidad de naturaleza pública** (ej. una ESE — Empresa Social del Estado, que es la figura jurídica de la mayoría de hospitales/IPS públicos rurales en Colombia) | ✅ Sí, sin importar el tamaño de sus activos |
| **Es una entidad privada o sin ánimo de lucro** con activos totales superiores a **100.000 UVT** (≈ **$5.237.400.000 COP en 2026**) | ✅ Sí, si supera ese umbral. Si no lo supera, no está obligada por este umbral (aunque puede estarlo por otra norma sectorial de salud) |

**Implicación práctica:** la mayoría de las IPS/ESE rurales candidatas a un piloto (ver
`CUMPLIMIENTO_SUH.md`, municipios con condiciones especiales) son **entidades públicas** — así
que lo más probable es que **sí estén obligadas a registrarse**, independientemente de sus
activos. Esto **no es una carga nueva causada por Telesalud** — si la IPS ya maneja historias
clínicas, seguramente ya debería estar registrada. Lo que sí genera una obligación nueva es
**actualizar** ese registro existente para incluir a Telesalud como un nuevo Encargado y una
nueva finalidad de tratamiento (ver sección 4).

**No hay excepción por el tipo de dato.** Aunque los datos sean de salud (sensibles), eso no
exime del registro ni lo hace obligatorio por sí solo — el criterio es el umbral de activos o la
naturaleza pública, no la sensibilidad del dato.

## 3. Si Telesalud opera de forma independiente (sin convenio, como Responsable)

Si en algún escenario futuro Telesalud Offline-First presta el servicio directamente, sin ser
Encargado de una IPS, entonces Telesalud mismo pasaría a ser Responsable del Tratamiento, y
debería evaluar si sus propios activos totales superan las 100.000 UVT. Para un prototipo o una
startup en etapa temprana, esto es poco probable — pero la evaluación debe rehacerse si cambia
el modelo de operación descrito en `PROTECCION_DATOS_SIC.md`, sección 2.

## 4. Qué activa una actualización obligatoria del registro (si la IPS ya está registrada)

Si la IPS piloto ya tiene un registro RNBD vigente (lo esperable si ya opera con historia
clínica), sumar el servicio de Telesalud Offline-First cuenta como un **cambio sustancial** que
obliga a actualizar ese registro — no a esperar al ciclo anual. Los cambios sustanciales
incluyen, entre otros:

- Cambio en la **finalidad** de una base de datos (agregar teleorientación como finalidad).
- Cambio o adición de un **Encargado del Tratamiento** (Telesalud entraría como uno nuevo).
- Cambio en los **tipos de datos personales tratados** (si se agregan datos que la IPS no
  procesaba antes por este canal, ej. ubicación geográfica, canal USSD/SMS).
- Cambio en las **medidas de seguridad de la información**.
- Cambio en la **Política de Tratamiento** (si se actualiza para cubrir la teleorientación).

## 5. Calendario relevante (vigente para 2026, verificar cada año)

| Trámite | Ventana |
|---|---|
| Actualización anual del RNBD | 2 de enero – 31 de marzo de 2026 |
| Reporte de reclamos, segundo semestre de 2025 | Hasta el 20 de febrero de 2026 |
| Reporte de reclamos, primer semestre de 2026 | Hasta el 25 de agosto de 2026 |
| Cambios sustanciales (sección 4) | En cualquier momento, sin esperar al ciclo anual |

## 6. Pasos del trámite (para referencia de quien lo ejecute — la IPS, no Telesalud)

1. Descargar el RUT vigente de la entidad desde la plataforma MUISCA de la DIAN.
2. Acceder al sistema RNBD en `www.sic.gov.co` con esas credenciales.
3. Inventariar todas las bases de datos con información personal de la entidad (no solo la de
   Telesalud) — físicas y digitales.
4. Registrar, por cada base de datos: finalidad, tipos de datos, número aproximado de
   titulares, medidas de seguridad, información del/los Encargado(s) del Tratamiento, política
   de tratamiento aplicable, y transferencias internacionales si las hay.
5. Registrar los canales de atención al titular para ejercer sus derechos (ver
   `PROTECCION_DATOS_SIC.md`, derechos ARCO).
6. Adjuntar el documento de Política de Tratamiento de Datos vigente de la entidad.

**Importante:** el RNBD no aloja los datos personales en sí — solo la información de
identificación de cada base de datos (Circular 002 de 2015 de la SIC). No se sube ningún dato
de pacientes al registro.

## 7. Resumen para el convenio con la IPS piloto

Añadir explícitamente al convenio (o al anexo de encargo, `ANEXO_ENCARGO_TRATAMIENTO_DATOS.md`):

1. Confirmación de si la IPS ya tiene un registro RNBD vigente.
2. Compromiso de la IPS de actualizarlo para incluir a Telesalud como Encargado y la
   teleorientación como nueva finalidad, **antes de iniciar el piloto** (no después).
3. Confirmación de que Telesalud, como Encargado, no requiere registro propio — y que esto se
   reevalúa si el modelo de operación cambia (sección 3).
