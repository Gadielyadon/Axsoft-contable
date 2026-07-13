'use strict';
const express = require('express');
const { db } = require('../db');
const { requireLogin, tenant, requireSection } = require('../middleware/auth');
const router = express.Router();

// Todas estas rutas requieren login y un negocio (dueno o empleado)
router.use(requireLogin, tenant);

// Cada sección exige su propio permiso (la dueña siempre pasa; a las
// empleadas se les chequea lo que la dueña les habilitó en /admin/empleados)
router.use('/ventas', requireSection('ventas'));
router.use('/stock', requireSection('stock'));
router.use('/gastos', requireSection('gastos'));
router.use('/pedidos', requireSection('pedidos'));
router.use('/contactos', requireSection('contactos'));

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

/* ===================== VENTAS ===================== */
router.get('/ventas', (req, res) => {
  const ventas = db.prepare('SELECT * FROM ventas WHERE negocio_id = ? ORDER BY id DESC LIMIT 40').all(req.negocioId);
  const stock = db.prepare('SELECT id, nombre, cantidad, precio FROM stock WHERE negocio_id = ? ORDER BY nombre').all(req.negocioId);
  const empleados = db.prepare("SELECT nombre FROM usuarios WHERE negocio_id = ? AND activo = 1 ORDER BY nombre").all(req.negocioId);
  res.render('ventas', { activeNav: 'ventas', ventas, stock, empleados });
});

router.post('/ventas', (req, res) => {
  const precio = num(req.body.precio);
  if (precio <= 0) return res.redirect('/ventas');
  const stockId = req.body.stock_id ? parseInt(req.body.stock_id, 10) : null;

  const tx = db.transaction(() => {
    if (stockId) {
      const item = db.prepare('SELECT cantidad FROM stock WHERE id = ? AND negocio_id = ?').get(stockId, req.negocioId);
      if (item && item.cantidad > 0) {
        db.prepare('UPDATE stock SET cantidad = cantidad - 1 WHERE id = ? AND negocio_id = ?').run(stockId, req.negocioId);
      }
    }
    db.prepare(`INSERT INTO ventas (negocio_id, usuario_id, vendedor, producto, detalle, precio, pago, cliente, stock_id)
                VALUES (?,?,?,?,?,?,?,?,?)`).run(
      req.negocioId, req.session.user.id,
      req.body.vendedor || req.session.user.nombre,
      req.body.producto || '', req.body.detalle || '', precio,
      req.body.pago || 'Efectivo', req.body.cliente || '', stockId
    );
  });
  tx();
  res.redirect('/ventas');
});

router.post('/ventas/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM ventas WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect('/ventas');
});

/* ===================== STOCK ===================== */
router.get('/stock', (req, res) => {
  const stock = db.prepare('SELECT * FROM stock WHERE negocio_id = ? ORDER BY id DESC').all(req.negocioId);
  res.render('stock', { activeNav: 'stock', stock });
});

router.post('/stock', (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.redirect('/stock');
  db.prepare(`INSERT INTO stock (negocio_id, categoria, nombre, cantidad, precio, costo)
              VALUES (?,?,?,?,?,?)`).run(
    req.negocioId, req.body.categoria || '', nombre,
    num(req.body.cantidad), num(req.body.precio), num(req.body.costo)
  );
  res.redirect('/stock');
});

router.post('/stock/:id/ajustar', (req, res) => {
  const delta = parseInt(req.body.delta, 10) || 0;
  db.prepare('UPDATE stock SET cantidad = MAX(0, cantidad + ?) WHERE id = ? AND negocio_id = ?')
    .run(delta, req.params.id, req.negocioId);
  res.redirect('/stock');
});

router.post('/stock/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM stock WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect('/stock');
});

/* ===================== GASTOS ===================== */
// Categorías por negocio. La primera vez que un negocio pide sus
// categorías de gasto, si no tiene ninguna, se le cargan unas por
// defecto — de ahí en más, cada categoría nueva que se escribe en el
// formulario queda guardada para la próxima vez.
const CATEGORIAS_GASTO_DEFAULT = ['Insumos', 'Comida / equipo', 'Transporte', 'Stand / feria', 'Otro'];

function categoriasDe(negocioId, tipo, defaults) {
  let filas = db.prepare('SELECT nombre FROM categorias WHERE negocio_id = ? AND tipo = ? ORDER BY nombre COLLATE NOCASE')
    .all(negocioId, tipo);
  if (!filas.length && defaults && defaults.length) {
    const ins = db.prepare('INSERT OR IGNORE INTO categorias (negocio_id, tipo, nombre) VALUES (?,?,?)');
    defaults.forEach(nombre => ins.run(negocioId, tipo, nombre));
    filas = db.prepare('SELECT nombre FROM categorias WHERE negocio_id = ? AND tipo = ? ORDER BY nombre COLLATE NOCASE')
      .all(negocioId, tipo);
  }
  return filas.map(f => f.nombre);
}

router.get('/gastos', (req, res) => {
  const gastos = db.prepare('SELECT * FROM gastos WHERE negocio_id = ? ORDER BY id DESC LIMIT 40').all(req.negocioId);
  const empleados = db.prepare("SELECT nombre FROM usuarios WHERE negocio_id = ? AND activo = 1 ORDER BY nombre").all(req.negocioId);
  const categorias = categoriasDe(req.negocioId, 'gasto', CATEGORIAS_GASTO_DEFAULT);
  res.render('gastos', { activeNav: 'gastos', gastos, empleados, categorias });
});

router.post('/gastos', (req, res) => {
  const monto = num(req.body.monto);
  if (monto <= 0) return res.redirect('/gastos');

  // La categoría puede venir del select (categoria_sel) o, si eligió
  // "+ Nueva categoría…", del campo de texto (categoria_nueva).
  let categoria = (req.body.categoria_sel === '__nueva__')
    ? (req.body.categoria_nueva || '').trim()
    : (req.body.categoria_sel || '').trim();
  if (!categoria) categoria = 'Otro';

  // Si es una categoría que no existía todavía, queda guardada para
  // la próxima vez que cargue un gasto (así "se pueden crear categorías").
  db.prepare('INSERT OR IGNORE INTO categorias (negocio_id, tipo, nombre) VALUES (?,?,?)')
    .run(req.negocioId, 'gasto', categoria);

  db.prepare(`INSERT INTO gastos (negocio_id, usuario_id, responsable, categoria, monto, pago, descripcion)
              VALUES (?,?,?,?,?,?,?)`).run(
    req.negocioId, req.session.user.id,
    req.body.responsable || req.session.user.nombre,
    categoria, monto, req.body.pago || 'Efectivo', req.body.descripcion || ''
  );
  res.redirect('/gastos');
});

// Borrar una categoría de gasto (solo si no quedan gastos cargados con ese nombre)
router.post('/gastos/categorias/:nombre/borrar', (req, res) => {
  const nombre = decodeURIComponent(req.params.nombre);
  const enUso = db.prepare('SELECT COUNT(*) c FROM gastos WHERE negocio_id = ? AND categoria = ?')
    .get(req.negocioId, nombre).c;
  if (!enUso) {
    db.prepare('DELETE FROM categorias WHERE negocio_id = ? AND tipo = ? AND nombre = ?')
      .run(req.negocioId, 'gasto', nombre);
  }
  res.redirect('/gastos');
});

router.post('/gastos/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM gastos WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect('/gastos');
});

/* ===================== PEDIDOS ===================== */
const ORDEN_ESTADOS = ['pendiente', 'proceso', 'listo', 'entregado'];

router.get('/pedidos', (req, res) => {
  const pedidos = db.prepare('SELECT * FROM pedidos WHERE negocio_id = ? ORDER BY id DESC').all(req.negocioId);
  res.render('pedidos', { activeNav: 'pedidos', pedidos, ORDEN_ESTADOS });
});

router.post('/pedidos', (req, res) => {
  const cliente = (req.body.cliente || '').trim();
  if (!cliente) return res.redirect('/pedidos');
  db.prepare(`INSERT INTO pedidos (negocio_id, cliente, telefono, tipo, tono, largo, estructura, entrega, estado, sena, total, notas)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    req.negocioId, cliente, req.body.telefono || '', req.body.tipo || '',
    req.body.tono || '', req.body.largo || '', req.body.estructura || '',
    req.body.entrega || '', req.body.estado || 'pendiente',
    num(req.body.sena), num(req.body.total), req.body.notas || ''
  );
  res.redirect('/pedidos');
});

router.post('/pedidos/:id/avanzar', (req, res) => {
  const p = db.prepare('SELECT estado FROM pedidos WHERE id = ? AND negocio_id = ?').get(req.params.id, req.negocioId);
  if (p) {
    const i = ORDEN_ESTADOS.indexOf(p.estado);
    if (i >= 0 && i < ORDEN_ESTADOS.length - 1) {
      db.prepare('UPDATE pedidos SET estado = ? WHERE id = ? AND negocio_id = ?')
        .run(ORDEN_ESTADOS[i + 1], req.params.id, req.negocioId);
    }
  }
  res.redirect('/pedidos');
});

router.post('/pedidos/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM pedidos WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect('/pedidos');
});

/* ===================== CONTACTOS ===================== */
router.get('/contactos', (req, res) => {
  const contactos = db.prepare('SELECT * FROM contactos WHERE negocio_id = ? ORDER BY id DESC').all(req.negocioId);
  res.render('contactos', { activeNav: 'contactos', contactos });
});

router.post('/contactos', (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.redirect('/contactos');
  db.prepare('INSERT INTO contactos (negocio_id, tipo, nombre, telefono, notas) VALUES (?,?,?,?,?)')
    .run(req.negocioId, req.body.tipo || 'Clienta potencial', nombre, req.body.telefono || '', req.body.notas || '');
  res.redirect('/contactos');
});

router.post('/contactos/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM contactos WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect('/contactos');
});

module.exports = router;