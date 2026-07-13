'use strict';
/**
 * Inicializa la base y crea SOLO el superadmin de plataforma.
 * (Versión de producción: sin negocio demo. Se arranca de cero.)
 *
 * Uso:  npm run init-db
 *
 * Credenciales del superadmin desde variables de entorno (.env):
 *   SUPERADMIN_USER, SUPERADMIN_PASS, SUPERADMIN_NAME
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, migrar } = require('./index');

migrar();

const SUPER_USER = process.env.SUPERADMIN_USER || 'admin';
const SUPER_PASS = process.env.SUPERADMIN_PASS || 'axsoft123';
const SUPER_NAME = process.env.SUPERADMIN_NAME || 'AxSoft';

function hash(pass) { return bcrypt.hashSync(pass, 10); }

const existeSuper = db.prepare("SELECT id FROM usuarios WHERE rol='superadmin' LIMIT 1").get();

if (!existeSuper) {
  db.prepare(
    "INSERT INTO usuarios (negocio_id, nombre, usuario, password_hash, rol) VALUES (NULL, ?, ?, ?, 'superadmin')"
  ).run(SUPER_NAME, SUPER_USER, hash(SUPER_PASS));
  console.log(`✔ Superadmin creado → usuario: "${SUPER_USER}"`);
} else {
  console.log('• El superadmin ya existe, no se toca.');
}

console.log('\nBase lista (sin negocios). Entrá como superadmin y creá tus negocios desde /plataforma.');