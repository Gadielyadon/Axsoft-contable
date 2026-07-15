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

  // Pedidos: columna 'datos' (JSON) para los campos personalizados del formulario.
  const columnasPedidos = db.prepare("PRAGMA table_info(pedidos)").all().map(c => c.name);
  if (!columnasPedidos.includes('datos')) {
    db.exec("ALTER TABLE pedidos ADD COLUMN datos TEXT");
  }

  // Sueldos: las horas fijas que estaban cargadas en 'equipo' pasan a ser una
  // jornada, así el dato no se pierde al empezar a usar el cálculo por período.
  // Es idempotente: al migrar se pone equipo.horas = 0, así no vuelve a correr.
  const legacy = db.prepare('SELECT id, negocio_id, horas, creado_en FROM equipo WHERE horas > 0').all();
  if (legacy.length) {
    const hoy = new Date().toISOString().slice(0, 10);
    const ins = db.prepare("INSERT INTO jornadas (negocio_id, equipo_id, fecha, horas, nota) VALUES (?,?,?,?,?)");
    const upd = db.prepare('UPDATE equipo SET horas = 0 WHERE id = ?');
    const tx = db.transaction(() => {
      legacy.forEach(e => {
        const fecha = (e.creado_en || '').slice(0, 10) || hoy;
        ins.run(e.negocio_id, e.id, fecha, e.horas, 'Horas cargadas antes del cálculo por jornadas');
        upd.run(e.id);
      });
    });
    tx();
  }
}

module.exports = { db, migrar, DB_PATH };