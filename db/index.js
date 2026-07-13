'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'axsoft.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Aplica el esquema si las tablas no existen (idempotente)
function migrar() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Migraciones incrementales: agregan columnas nuevas a bases ya creadas
  // con una versión anterior del esquema (sin romper los datos existentes).
  const columnas = db.prepare("PRAGMA table_info(usuarios)").all().map(c => c.name);
  if (!columnas.includes('permisos')) {
    db.exec("ALTER TABLE usuarios ADD COLUMN permisos TEXT NOT NULL DEFAULT 'ventas,stock,gastos,pedidos,contactos'");
  }

  const columnasConfig = db.prepare("PRAGMA table_info(config)").all().map(c => c.name);
  if (!columnasConfig.includes('pin_panel')) {
    db.exec("ALTER TABLE config ADD COLUMN pin_panel TEXT");
  }
}

module.exports = { db, migrar, DB_PATH };