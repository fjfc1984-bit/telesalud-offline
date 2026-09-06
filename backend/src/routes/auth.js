const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../db');
const { audit } = require('../util');
const { verifyPin, JWT_SECRET } = require('../crypto');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de ingreso. Intente de nuevo en unos minutos.' },
});

const loginSchema = z.object({
  documento_profesional: z.string().trim().min(1).max(40),
  pin: z.string().trim().min(4).max(20),
});

// Hash de relleno con formato válido (salt:hash) usado solo para igualar el costo de cómputo
// cuando el documento no existe; no corresponde a ningún PIN real.
const DUMMY_HASH = `${'00'.repeat(16)}:${'00'.repeat(64)}`;

router.post('/login', loginLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'documento_profesional y pin son requeridos', detalle: parsed.error.issues });
  }
  const { documento_profesional, pin } = parsed.data;

  const pro = db.prepare('SELECT * FROM professionals WHERE documento_profesional = ?').get(documento_profesional);
  const registrarIntento = (exitoso) => {
    db.prepare('INSERT INTO login_attempts (documento_profesional, exitoso, ip, timestamp) VALUES (?, ?, ?, ?)')
      .run(documento_profesional, exitoso ? 1 : 0, req.ip, new Date().toISOString());
  };

  // Se calcula un hash igualmente si el usuario no existe, para no filtrar por tiempo de
  // respuesta qué documentos están registrados (mitiga enumeración de usuarios).
  const pinValido = verifyPin(pin, pro ? pro.pin_hash : DUMMY_HASH) && !!pro;

  if (!pro || !pinValido) {
    registrarIntento(false);
    return res.status(401).json({ error: 'Documento o PIN incorrecto' });
  }

  registrarIntento(true);
  audit({ actorId: pro.id, actorRol: pro.rol, accion: 'login', entidad: 'professional', entidadId: pro.id, ip: req.ip });

  const token = jwt.sign(
    { sub: pro.id, rol: pro.rol, nombre: pro.nombre },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    expira_en_horas: 8,
    profesional: { id: pro.id, nombre: pro.nombre, rol: pro.rol, rethus_verificado: !!pro.rethus_verificado },
  });
});

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const pro = db.prepare('SELECT * FROM professionals WHERE id = ?').get(payload.sub);
  if (!pro) return res.status(401).json({ error: 'Profesional no encontrado' });

  req.professional = pro;
  next();
}

module.exports = { router, requireAuth };
