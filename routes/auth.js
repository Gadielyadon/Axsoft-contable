'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const usuario = (req.body.usuario || '').trim();
  const password = req.body.password || '';

  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(usuario);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).render('login', { error: 'Usuario o contraseña incorrectos.' });
  }

  // Si el usuario pertenece a un negocio, verificar que el negocio esté activo
  if (u.negocio_id) {
    const neg = db.prepare('SELECT nombre, activo FROM negocios WHERE id = ?').get(u.negocio_id);
    if (!neg || !neg.activo) {
      return res.status(403).render('login', { error: 'El negocio está desactivado. Contactá a AxSoft.' });
    }
    req.session.negocioNombre = neg.nombre;
  }

  req.session.user = {
    id: u.id,
    nombre: u.nombre,
    usuario: u.usuario,
    rol: u.rol,
    negocio_id: u.negocio_id,
    permisos: (u.permisos || '').split(',').map(s => s.trim()).filter(Boolean)
  };
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;