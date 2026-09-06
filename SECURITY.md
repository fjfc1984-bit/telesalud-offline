# Política de Seguridad — Telesalud Offline-First

Este documento describe cómo reportar una vulnerabilidad de seguridad en este prototipo y
cómo se respondería internamente ante un incidente. Está adaptado del mismo documento usado en
[NormaLis](https://normalis.co) (proyecto hermano del mismo autor), ajustado a que aquí el dato
en juego es información de salud de pacientes, no información institucional de una IPS — un
nivel de sensibilidad mayor.

## Reportar una vulnerabilidad

Si encuentras una vulnerabilidad de seguridad en este prototipo (código en
`telesalud-offline/`, o una instancia desplegada de él), repórtala de forma responsable:

- **Correo:** fjfc1984@gmail.com con el asunto `[SEGURIDAD-TELESALUD]`.
- **Qué incluir:** pasos para reproducir, impacto estimado, y si es posible, una prueba de
  concepto no destructiva.
- **Qué NO hacer:** no accedas, modifiques ni elimines datos de pacientes reales; no ejecutes
  pruebas de denegación de servicio; no divulgues la vulnerabilidad públicamente antes de que
  se confirme una corrección.

**Tiempo de respuesta objetivo:** confirmación de recepción en 2 días hábiles, evaluación de
severidad en 5 días hábiles. (Este es un objetivo de un prototipo en fase de piloto, no un SLA
contractual — ver "Estado de madurez" más abajo.)

## Alcance

Dentro de alcance: la API (`backend/`, Express + `node:sqlite`), la PWA (`frontend/`), el
Service Worker, y los endpoints de los canales USSD/SMS.

Fuera de alcance: ingeniería social, ataques físicos, y vulnerabilidades en infraestructura de
terceros (el hosting que use la IPS piloto, o un futuro agregador de SMS/USSD) — deben
reportarse directamente a esos proveedores.

## Proceso interno de respuesta a incidentes

1. **Detección** — vía este canal de reporte, la bitácora de auditoría (`audit_log` en la base
   de datos), o revisión manual.
2. **Contención** — para un token JWT comprometido: no hay revocación individual de tokens hoy
   (expiran solos en 8h); rotar `TELESALUD_JWT_SECRET` invalida todos los tokens activos de
   golpe, incluidos los legítimos — es una medida de contención de emergencia, no rutinaria.
   Para una cuenta profesional comprometida: no hay hoy un mecanismo de "desactivar cuenta"
   distinto de borrarla de la tabla `professionals` — ver "Estado de madurez".
3. **Evaluación de alcance** — ¿qué encuentros (pacientes) pudieron verse afectados? La
   bitácora de auditoría (`audit_log`) es la fuente primaria: registra actor, rol, acción,
   entidad y marca de tiempo de cada operación relevante.
4. **Notificación** — si hay datos personales de pacientes comprometidos, corresponde notificar
   a los titulares y, cuando aplique, a la Superintendencia de Industria y Comercio (SIC),
   conforme al artículo 17(n) de la Ley 1581/2012. **Este paso requiere confirmación con
   asesoría legal** — no hay un plazo único codificado en la ley, y el criterio de "riesgo para
   los titulares" requiere análisis caso a caso. Ver `docs/PROTECCION_DATOS_SIC.md`.
5. **Remediación** — corregir la causa raíz, desplegar el fix, rotar la llave de cifrado
   (`TELESALUD_ENCRYPTION_KEY`) solo si se sospecha que la llave misma quedó expuesta — nótese
   que rotarla sin re-cifrar los datos existentes los deja ilegibles, así que no es una acción
   trivial (ver `backend/src/crypto.js`).

## Estado de madurez (honesto, septiembre 2026)

Este es un **prototipo**, no un sistema en producción con un piloto real de pacientes:

- No hay equipo de seguridad dedicado ni SLA de respuesta certificado externamente.
- No hay mecanismo de revocación individual de sesión/token de un profesional (solo expiración
  natural a las 8h o rotación global del secreto JWT).
- La llave de cifrado y el secreto JWT viven en archivos locales de desarrollo
  (`backend/data/.encryption_key`, `backend/data/.jwt_secret`) — deben migrarse a un gestor de
  secretos (KMS/Vault) antes de cualquier despliegue con datos reales.
- No hay escaneo automatizado de dependencias/vulnerabilidades en el flujo de desarrollo.
- Los backups automáticos (ver más abajo) viven en el mismo disco que la base de datos —
  protegen contra corrupción o error humano, pero no contra la pérdida de la máquina completa.
  Para eso se necesita una copia fuera de sitio (otro disco, almacenamiento en la nube).

## Copias de seguridad

`backend/src/backup.js` crea una copia de `data/telesalud.db` al iniciar el servidor y luego
cada 24 horas (`server.js`), reteniendo las últimas 30. Hace un `PRAGMA wal_checkpoint(FULL)`
antes de copiar, para no omitir escrituras recientes que SQLite en modo WAL aún no haya volcado
al archivo principal. Un profesional autenticado puede ver el historial
(`GET /api/backups`) o forzar una copia manual (`POST /api/backups`) — útil antes de una
migración o un despliegue.

Ver `docs/ARQUITECTURA.md` (sección 7, "Seguridad implementada") para el detalle de lo que sí
está construido: cifrado en reposo, autenticación PIN+JWT, límite de intentos, validación de
entradas, bitácora de auditoría inmutable por diseño (solo inserciones, sin actualización ni
borrado de `audit_log` en el código de la aplicación).
