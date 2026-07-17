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
router.use('/contador', requireSection('contador'));

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

/* ===================== VENTAS ===================== */
router.get('/ventas', (req, res) => {
  const filas = db.prepare('SELECT * FROM ventas WHERE negocio_id = ? ORDER BY id DESC LIMIT 60').all(req.negocioId);

  // Agrupamos por ticket: los productos de una misma venta van juntos en una tarjeta.
  // Las ventas viejas (sin ticket) quedan cada una en su propia tarjeta.
  const mapa = new Map();
  filas.forEach(v => {
    const clave = v.ticket || ('v' + v.id);
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        clave, vendedor: v.vendedor, pago: v.pago, cliente: v.cliente,
        creado_en: v.creado_en, items: [], total: 0
      });
    }
    const g = mapa.get(clave);
    g.items.push(v);
    g.total += v.precio;
  });
  const ventas = Array.from(mapa.values());

  const stock = db.prepare('SELECT id, nombre, cantidad, precio FROM stock WHERE negocio_id = ? ORDER BY nombre').all(req.negocioId);
  const empleados = db.prepare("SELECT nombre FROM usuarios WHERE negocio_id = ? AND activo = 1 ORDER BY nombre").all(req.negocioId);
  res.render('ventas', { activeNav: 'ventas', ventas, stock, empleados, medios: mediosDe(req.negocioId, 'venta') });
});

// Toma las líneas del carrito (items[0][producto], items[0][precio], ...).
// Si no vino ningún item, usa los campos sueltos (compatibilidad).
function lineasDeVenta(body) {
  let crudas = [];
  if (Array.isArray(body.items)) crudas = body.items;
  else if (body.items && typeof body.items === 'object') crudas = Object.values(body.items);

  const lineas = [];
  crudas.forEach(it => {
    if (!it) return;
    const producto = (it.producto || '').trim();
    const precio = num(it.precio);
    let cantidad = Math.floor(num(it.cantidad)) || 1;
    if (cantidad < 1) cantidad = 1;
    if (!producto && precio <= 0) return;
    lineas.push({
      producto,
      detalle: (it.detalle || '').trim(),
      precioUnit: precio,
      cantidad,
      stockId: it.stock_id ? parseInt(it.stock_id, 10) : null
    });
  });

  if (!lineas.length) {
    const precio = num(body.precio);
    if (precio > 0 || (body.producto || '').trim()) {
      lineas.push({
        producto: (body.producto || '').trim(),
        detalle: (body.detalle || '').trim(),
        precioUnit: precio,
        cantidad: 1,
        stockId: body.stock_id ? parseInt(body.stock_id, 10) : null
      });
    }
  }
  return lineas;
}

router.post('/ventas', (req, res) => {
  const lineas = lineasDeVenta(req.body);
  if (!lineas.length) return res.redirect('/ventas');

  // El celular manda un identificador propio (uid). Sirve para que, si una venta
  // se reintenta (por ejemplo, guardada sin señal), NO se cargue dos veces.
  const uid = (req.body.uid || '').trim();
  const ticket = /^[a-z0-9-]{6,40}$/i.test(uid)
    ? uid
    : ('t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));

  const yaEstaba = db.prepare('SELECT 1 x FROM ventas WHERE negocio_id = ? AND ticket = ? LIMIT 1')
    .get(req.negocioId, ticket);
  if (yaEstaba) {
    // Ya la teníamos: contestamos que está todo bien y no duplicamos nada.
    if (req.get('X-AxSoft') === '1') return res.json({ ok: true, ticket, repetida: true, stock: [] });
    return res.redirect('/ventas');
  }

  const vendedor = req.body.vendedor || req.session.user.nombre;
  const pago = req.body.pago || 'Efectivo';
  const cliente = req.body.cliente || '';

  const tx = db.transaction(() => {
    lineas.forEach(l => {
      if (l.stockId) {
        const item = db.prepare('SELECT cantidad FROM stock WHERE id = ? AND negocio_id = ?').get(l.stockId, req.negocioId);
        if (item) {
          db.prepare('UPDATE stock SET cantidad = MAX(0, cantidad - ?) WHERE id = ? AND negocio_id = ?')
            .run(l.cantidad, l.stockId, req.negocioId);
        }
      }
      // precio = total de esa línea (unitario x cantidad), así la caja suma bien
      db.prepare(`INSERT INTO ventas (negocio_id, usuario_id, vendedor, producto, detalle, precio, pago, cliente, stock_id, cantidad, ticket)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        req.negocioId, req.session.user.id, vendedor,
        l.producto, l.detalle, l.precioUnit * l.cantidad,
        pago, cliente, l.stockId, l.cantidad, ticket
      );
    });
  });
  tx();

  // Si la venta vino por JavaScript (sin recargar la página), devolvemos solo
  // lo justo para que el celular pinte la venta nueva: unos pocos bytes en vez
  // de bajar la pantalla entera otra vez. Si no, redirect de toda la vida.
  if (req.get('X-AxSoft') !== '1') return res.redirect('/ventas');

  const fmt = req.app.locals.fmt;
  const fechaCorta = req.app.locals.fechaCorta;
  const fila = db.prepare('SELECT creado_en FROM ventas WHERE ticket = ? LIMIT 1').get(ticket);
  const total = lineas.reduce((s, l) => s + l.precioUnit * l.cantidad, 0);
  const variasLineas = (lineas.length > 1 || lineas[0].cantidad > 1);

  const idsStock = Array.from(new Set(lineas.filter(l => l.stockId).map(l => l.stockId)));
  const stock = idsStock
    .map(id => db.prepare('SELECT id, cantidad FROM stock WHERE id = ? AND negocio_id = ?').get(id, req.negocioId))
    .filter(Boolean);

  res.json({
    ok: true,
    venta: {
      clave: ticket,
      titulo: lineas.length > 1 ? lineas.length + ' productos' : (lineas[0].producto || 'Venta'),
      totalFmt: fmt(total),
      fechaTxt: fechaCorta(fila ? fila.creado_en : null),
      vendedor, pago, cliente,
      mostrarLineas: variasLineas,
      detalleUnico: (!variasLineas && lineas[0].detalle) ? lineas[0].detalle : null,
      items: lineas.map(l => ({
        txt: (l.cantidad > 1 ? l.cantidad + ' x ' : '') + (l.producto || 'Producto') + (l.detalle ? ' — ' + l.detalle : ''),
        montoFmt: fmt(l.precioUnit * l.cantidad)
      }))
    },
    stock
  });
});

// Borra una venta completa (todas sus líneas)
router.post('/ventas/borrar', (req, res) => {
  const clave = (req.body.clave || '').trim();
  if (!clave) return res.redirect('/ventas');
  if (/^v\d+$/.test(clave)) {
    db.prepare('DELETE FROM ventas WHERE id = ? AND negocio_id = ?').run(clave.slice(1), req.negocioId);
  } else {
    db.prepare('DELETE FROM ventas WHERE ticket = ? AND negocio_id = ?').run(clave, req.negocioId);
  }
  res.redirect('/ventas');
});

/* ===================== STOCK ===================== */
router.get('/stock', (req, res) => {
  const stock = db.prepare('SELECT * FROM stock WHERE negocio_id = ? ORDER BY nombre COLLATE NOCASE').all(req.negocioId);
  const categorias = db.prepare("SELECT DISTINCT categoria FROM stock WHERE negocio_id = ? AND categoria <> '' ORDER BY categoria").all(req.negocioId).map(r => r.categoria);
  res.render('stock', { activeNav: 'stock', stock, categorias });
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

// Fija la cantidad exacta que escribió la persona (en vez de sumar de a 1)
router.post('/stock/:id/cantidad', (req, res) => {
  const cant = Math.max(0, num(req.body.cantidad));
  db.prepare('UPDATE stock SET cantidad = ? WHERE id = ? AND negocio_id = ?')
    .run(cant, req.params.id, req.negocioId);
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
  res.render('gastos', { activeNav: 'gastos', gastos, empleados, categorias, medios: mediosDe(req.negocioId, 'gasto') });
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
const { camposPedidoDe, datosDePedido } = require('../lib/pedidos');
const { mediosDe } = require('../lib/medios');

router.get('/pedidos', (req, res) => {
  const campos = camposPedidoDe(req.negocioId);
  const pedidos = db.prepare('SELECT * FROM pedidos WHERE negocio_id = ? ORDER BY id DESC').all(req.negocioId)
    .map(p => ({ ...p, datosArr: datosDePedido(p) }));
  res.render('pedidos', { activeNav: 'pedidos', pedidos, ORDEN_ESTADOS, campos });
});

router.post('/pedidos', (req, res) => {
  const cliente = (req.body.cliente || '').trim();
  if (!cliente) return res.redirect('/pedidos');

  // Armar los valores de los campos personalizados (guardamos nombre + valor,
  // así el pedido conserva su info aunque después se renombre o borre un campo).
  const campos = camposPedidoDe(req.negocioId);
  const datos = [];
  campos.forEach(c => {
    const v = (req.body['campo_' + c.id] || '').toString().trim();
    if (v) datos.push({ n: c.nombre, v });
  });

  db.prepare(`INSERT INTO pedidos (negocio_id, cliente, telefono, entrega, estado, sena, total, notas, datos)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(
    req.negocioId, cliente, req.body.telefono || '',
    req.body.entrega || '', req.body.estado || 'pendiente',
    num(req.body.sena), num(req.body.total), req.body.notas || '',
    JSON.stringify(datos)
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

/* ===================== CONTADOR DE VISITAS ===================== */
router.get('/contador', (req, res) => {
  const neg = req.negocioId;
  const hoyRow = db.prepare("SELECT cantidad FROM visitas WHERE negocio_id = ? AND fecha = date('now','localtime')").get(neg);
  const total = db.prepare('SELECT COALESCE(SUM(cantidad),0) t FROM visitas WHERE negocio_id = ?').get(neg).t;
  const ventasHoy = db.prepare("SELECT COUNT(*) c FROM ventas WHERE negocio_id = ? AND date(creado_en) = date('now','localtime')").get(neg).c;
  const hoyCount = hoyRow ? hoyRow.cantidad : 0;
  res.render('contador', {
    activeNav: 'contador', hoyCount, total, ventasHoy,
    conversion: hoyCount > 0 ? Math.round(ventasHoy / hoyCount * 100) : null
  });
});

router.post('/contador/sumar', (req, res) => {
  const neg = req.negocioId;
  db.prepare(`INSERT INTO visitas (negocio_id, fecha, cantidad) VALUES (?, date('now','localtime'), 1)
              ON CONFLICT(negocio_id, fecha) DO UPDATE SET cantidad = cantidad + 1`).run(neg);
  res.redirect('/contador');
});

module.exports = router;