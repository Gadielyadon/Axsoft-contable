'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const router = express.Router();

router.use(requireLogin, requireRole('superadmin'));

router.get('/', (req, res) => {
  const negocios = db.prepare(`
    SELECT n.*,
      (SELECT COUNT(*) FROM usuarios u WHERE u.negocio_id = n.id) AS usuarios,
      (SELECT COALESCE(SUM(precio),0) FROM ventas v WHERE v.negocio_id = n.id) AS facturado
    FROM negocios n ORDER BY n.id DESC`).all();
  res.render('plataforma/index', { negocios, error: req.query.err || null, ok: req.query.ok || null });
});

router.post('/negocios', (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  const rubro = (req.body.rubro || '').trim();
  const plan = req.body.plan || 'basico';
  const duenoNombre = (req.body.dueno_nombre || '').trim();
  const duenoUser = (req.body.dueno_usuario || '').trim().toLowerCase();
  const duenoPass = req.body.dueno_password || '';

  const negocios = () => db.prepare(`
    SELECT n.*, (SELECT COUNT(*) FROM usuarios u WHERE u.negocio_id = n.id) AS usuarios,
      (SELECT COALESCE(SUM(precio),0) FROM ventas v WHERE v.negocio_id = n.id) AS facturado
    FROM negocios n ORDER BY n.id DESC`).all();

  if (!nombre || !duenoNombre || !duenoUser || duenoPass.length < 4) {
    return res.render('plataforma/index', { negocios: negocios(), error: 'Completá nombre del negocio, y nombre/usuario/clave (4+) de la dueña.', ok: null });
  }
  if (db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(duenoUser)) {
    return res.render('plataforma/index', { negocios: negocios(), error: 'Ese usuario de dueña ya existe, elegí otro.', ok: null });
  }

  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO negocios (nombre, rubro, plan) VALUES (?,?,?)').run(nombre, rubro, plan);
    const negId = info.lastInsertRowid;
    db.prepare('INSERT INTO config (negocio_id, objetivo) VALUES (?, 0)').run(negId);
    db.prepare("INSERT INTO usuarios (negocio_id, nombre, usuario, password_hash, rol) VALUES (?,?,?,?,'dueno')")
      .run(negId, duenoNombre, duenoUser, bcrypt.hashSync(duenoPass, 10));
  });
  tx();
  res.redirect('/plataforma?ok=1');
});

router.post('/negocios/:id/toggle', (req, res) => {
  db.prepare('UPDATE negocios SET activo = 1 - activo WHERE id = ?').run(req.params.id);
  res.redirect('/plataforma');
});

// BORRAR un negocio y TODOS sus datos. No se puede deshacer.
// Traba de seguridad: hay que escribir el nombre exacto del negocio.
router.post('/negocios/:id/borrar', (req, res) => {
  const neg = db.prepare('SELECT id, nombre FROM negocios WHERE id = ?').get(req.params.id);
  if (!neg) return res.redirect('/plataforma');

  const escrito = (req.body.confirmar || '').trim().toLowerCase();
  if (escrito !== neg.nombre.trim().toLowerCase()) {
    return res.redirect('/plataforma?err=' + encodeURIComponent('No se borró nada: el nombre no coincide.'));
  }

  // Las tablas tienen ON DELETE CASCADE y foreign_keys está activo,
  // así que al borrar el negocio se van también sus ventas, stock,
  // gastos, pedidos, usuarios, jornadas, etc.
  db.prepare('DELETE FROM negocios WHERE id = ?').run(neg.id);
  res.redirect('/plataforma?ok=' + encodeURIComponent('Se borró "' + neg.nombre + '" y todos sus datos.'));
});

module.exports = router;
