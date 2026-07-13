'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireLogin, requireRole, tenant, SECCIONES, SECCION_KEYS } = require('../middleware/auth');
const { enviarXLSX } = require('../lib/xlsx');
const MAX_EMPLEADOS = 3;
const router = express.Router();

function configDe(negocioId) {
  return db.prepare('SELECT * FROM config WHERE negocio_id = ?').get(negocioId) || {};
}
function upsertConfig(negocioId, campos) {
  const existe = db.prepare('SELECT negocio_id FROM config WHERE negocio_id = ?').get(negocioId);
  if (existe) {
    const sets = Object.keys(campos).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE config SET ${sets} WHERE negocio_id = ?`).run(...Object.values(campos), negocioId);
  } else {
    const cols = Object.keys(campos);
    db.prepare(`INSERT INTO config (negocio_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`)
      .run(negocioId, ...Object.values(campos));
  }
}

// PIN opcional para entrar al Panel de la dueña. Si no configuró PIN,
// no se pide nada (no rompe a nadie que ya lo venía usando sin PIN).
// Si configuró uno, hay que ingresarlo una vez por sesión.
function requirePanelPin(req, res, next) {
  if (req.path === '/pin' || req.path.startsWith('/pin/')) return next(); // no bloqueamos la pantalla del PIN en sí
  const cfg = configDe(req.negocioId);
  if (!cfg.pin_panel) return next(); // no tiene PIN configurado
  if (req.session.panelUnlocked === req.negocioId) return next();
  return res.redirect('/admin/pin?next=' + encodeURIComponent(req.originalUrl));
}

// Solo la dueña del negocio entra al panel (y, si configuró un PIN, con el PIN)
router.use(requireLogin, requireRole('dueno'), tenant, requirePanelPin);

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const sum = (rows, campo) => rows.reduce((s, r) => s + (Number(r[campo]) || 0), 0);

function objetivoDe(negocioId) {
  const c = db.prepare('SELECT objetivo FROM config WHERE negocio_id = ?').get(negocioId);
  return c ? c.objetivo : 0;
}

// Arma la condición SQL de fecha (hoy / rango / todos) a partir de los
// query params, para reusar en la vista de Caja y en su exportación.
function filtroFecha(query) {
  const filtro = ['hoy', 'todos', 'rango'].includes(query.filtro) ? query.filtro : 'hoy';
  const desde = query.desde || '';
  const hasta = query.hasta || '';
  let cond = '';
  const extra = [];
  if (filtro === 'hoy') {
    cond = "AND date(creado_en) = date('now','localtime')";
  } else if (filtro === 'rango' && desde) {
    if (hasta && hasta !== desde) {
      cond = 'AND date(creado_en) BETWEEN ? AND ?';
      extra.push(desde, hasta);
    } else {
      cond = 'AND date(creado_en) = ?';
      extra.push(desde);
    }
  }
  return { filtro, desde, hasta, cond, extra };
}

/* ===================== CAJA / RESUMEN ===================== */
router.get('/', (req, res) => res.redirect('/admin/caja'));

router.get('/caja', (req, res) => {
  const neg = req.negocioId;
  const { filtro, desde, hasta, cond, extra } = filtroFecha(req.query);
  const params = [neg, ...extra];

  const ventas = db.prepare(`SELECT * FROM ventas WHERE negocio_id = ? ${cond}`).all(...params);
  const gastos = db.prepare(`SELECT * FROM gastos WHERE negocio_id = ? ${cond}`).all(...params);

  const totalVentas = sum(ventas, 'precio');
  const totalGastos = sum(gastos, 'monto');
  const neto = totalVentas - totalGastos;

  // Por medio de pago
  const porPago = {};
  ventas.forEach(v => { porPago[v.pago || '—'] = (porPago[v.pago || '—'] || 0) + v.precio; });

  // Por vendedora
  const porVendedor = {};
  ventas.forEach(v => { porVendedor[v.vendedor || '—'] = (porVendedor[v.vendedor || '—'] || 0) + v.precio; });
  const vendedores = Object.entries(porVendedor).sort((a, b) => b[1] - a[1]);

  // Proyección (producción) vs real acumulado
  const produccion = db.prepare('SELECT * FROM produccion WHERE negocio_id = ?').all(neg);
  const proyTotal = produccion.reduce((s, p) => s + p.cantidad * p.precio, 0);
  const realAcum = db.prepare('SELECT COALESCE(SUM(precio),0) t FROM ventas WHERE negocio_id = ?').get(neg).t;

  // Pedidos con saldo pendiente
  const pedientes = db.prepare(
    "SELECT cliente, tipo, total, sena FROM pedidos WHERE negocio_id = ? AND estado != 'entregado' AND (total - sena) > 0 ORDER BY id DESC"
  ).all(neg);

  res.render('admin/caja', {
    activeAdmin: 'caja', filtro, desde, hasta, totalVentas, totalGastos, neto,
    porPago: Object.entries(porPago), vendedores,
    proyTotal, realAcum,
    proyPct: proyTotal > 0 ? Math.round(realAcum / proyTotal * 100) : null,
    pedientes
  });
});

/* ===================== PIN DEL PANEL ===================== */
router.get('/pin', (req, res) => {
  const cfg = configDe(req.negocioId);
  const next = req.query.next || '/admin/caja';
  if (!cfg.pin_panel || req.session.panelUnlocked === req.negocioId) {
    return res.redirect(next);
  }
  res.render('admin/pin', { activeAdmin: 'pin', error: null, next });
});

router.post('/pin', (req, res) => {
  const cfg = configDe(req.negocioId);
  const next = req.body.next || '/admin/caja';
  const pin = (req.body.pin || '').trim();
  if (cfg.pin_panel && pin === cfg.pin_panel) {
    req.session.panelUnlocked = req.negocioId;
    return res.redirect(next);
  }
  res.render('admin/pin', { activeAdmin: 'pin', error: 'PIN incorrecto.', next });
});

/* ===================== PAGOS ===================== */
router.get('/pagos', (req, res) => {
  const neg = req.negocioId;
  const pagos = db.prepare('SELECT * FROM pagos WHERE negocio_id = ? ORDER BY estado, ' +
    "CASE prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, vencimiento").all(neg);
  const netoTotal = db.prepare('SELECT COALESCE(SUM(precio),0) t FROM ventas WHERE negocio_id = ?').get(neg).t
                  - db.prepare('SELECT COALESCE(SUM(monto),0) t FROM gastos WHERE negocio_id = ?').get(neg).t;
  const yaPagado = db.prepare("SELECT COALESCE(SUM(monto),0) t FROM pagos WHERE negocio_id = ? AND estado='pagado'").get(neg).t;
  res.render('admin/pagos', {
    activeAdmin: 'pagos', pagos, netoTotal, yaPagado, disponible: netoTotal - yaPagado
  });
});

router.post('/pagos', (req, res) => {
  const concepto = (req.body.concepto || '').trim();
  const monto = num(req.body.monto);
  if (!concepto || monto <= 0) return res.redirect('/admin/pagos');
  db.prepare('INSERT INTO pagos (negocio_id, concepto, monto, vencimiento, prioridad) VALUES (?,?,?,?,?)')
    .run(req.negocioId, concepto, monto, req.body.vencimiento || '', req.body.prioridad || 'media');
  res.redirect('/admin/pagos');
});

router.post('/pagos/:id/pagar', (req, res) => {
  db.prepare("UPDATE pagos SET estado='pagado' WHERE id = ? AND negocio_id = ?").run(req.params.id, req.negocioId);
  res.redirect('/admin/pagos');
});

router.post('/pagos/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM pagos WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect('/admin/pagos');
});

/* ===================== PRODUCCIÓN / OBJETIVO ===================== */
router.get('/produccion', (req, res) => {
  const neg = req.negocioId;
  const produccion = db.prepare('SELECT * FROM produccion WHERE negocio_id = ? ORDER BY id DESC').all(neg);
  const ingreso = produccion.reduce((s, p) => s + p.cantidad * p.precio, 0);
  const costo = produccion.reduce((s, p) => s + p.cantidad * p.costo, 0);
  const objetivo = objetivoDe(neg);
  res.render('admin/produccion', {
    activeAdmin: 'produccion', produccion, ingreso, costo, margen: ingreso - costo, objetivo,
    diffObjetivo: objetivo > 0 ? ingreso - objetivo : null
  });
});

router.post('/produccion', (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.redirect('/admin/produccion');
  db.prepare('INSERT INTO produccion (negocio_id, nombre, cantidad, precio, costo) VALUES (?,?,?,?,?)')
    .run(req.negocioId, nombre, num(req.body.cantidad), num(req.body.precio), num(req.body.costo));
  res.redirect('/admin/produccion');
});

router.post('/produccion/objetivo', (req, res) => {
  const neg = req.negocioId;
  const obj = num(req.body.objetivo);
  const existe = db.prepare('SELECT negocio_id FROM config WHERE negocio_id = ?').get(neg);
  if (existe) db.prepare('UPDATE config SET objetivo = ? WHERE negocio_id = ?').run(obj, neg);
  else db.prepare('INSERT INTO config (negocio_id, objetivo) VALUES (?,?)').run(neg, obj);
  res.redirect('/admin/produccion');
});

router.post('/produccion/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM produccion WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect('/admin/produccion');
});

/* ===================== SUELDOS / EQUIPO / RENTABILIDAD ===================== */
router.get('/sueldos', (req, res) => {
  const neg = req.negocioId;
  const equipo = db.prepare('SELECT * FROM equipo WHERE negocio_id = ? ORDER BY id DESC').all(neg);

  // ventas por nombre para calcular comisiones
  const ventasPorNombre = {};
  db.prepare('SELECT vendedor, SUM(precio) t FROM ventas WHERE negocio_id = ? GROUP BY vendedor').all(neg)
    .forEach(r => { ventasPorNombre[r.vendedor || '—'] = r.t; });

  let totalSueldos = 0;
  const filas = equipo.map(e => {
    const base = e.tarifa * e.horas;
    const ventasP = ventasPorNombre[e.nombre] || 0;
    const comisionMonto = ventasP * (e.comision / 100);
    const total = base + comisionMonto;
    totalSueldos += total;
    return { ...e, base, ventasP, comisionMonto, total };
  });

  const produccion = db.prepare('SELECT * FROM produccion WHERE negocio_id = ?').all(neg);
  const ingreso = produccion.reduce((s, p) => s + p.cantidad * p.precio, 0);
  const materiales = produccion.reduce((s, p) => s + p.cantidad * p.costo, 0);
  const gastosOp = db.prepare('SELECT COALESCE(SUM(monto),0) t FROM gastos WHERE negocio_id = ?').get(neg).t;
  const netoEvento = ingreso - materiales - gastosOp - totalSueldos;

  res.render('admin/sueldos', {
    activeAdmin: 'sueldos', filas, totalSueldos,
    ingreso, materiales, gastosOp, netoEvento
  });
});

router.post('/sueldos', (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.redirect('/admin/sueldos');
  db.prepare('INSERT INTO equipo (negocio_id, nombre, rol, tarifa, horas, comision) VALUES (?,?,?,?,?,?)')
    .run(req.negocioId, nombre, req.body.rol || '', num(req.body.tarifa), num(req.body.horas), num(req.body.comision));
  res.redirect('/admin/sueldos');
});

router.post('/sueldos/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM equipo WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect('/admin/sueldos');
});

/* ===================== CONTADOR DE VISITAS ===================== */
router.get('/contador', (req, res) => {
  const neg = req.negocioId;
  const hoyRow = db.prepare("SELECT cantidad FROM visitas WHERE negocio_id = ? AND fecha = date('now','localtime')").get(neg);
  const total = db.prepare('SELECT COALESCE(SUM(cantidad),0) t FROM visitas WHERE negocio_id = ?').get(neg).t;
  const ventasHoy = db.prepare("SELECT COUNT(*) c FROM ventas WHERE negocio_id = ? AND date(creado_en) = date('now','localtime')").get(neg).c;
  const hoyCount = hoyRow ? hoyRow.cantidad : 0;
  res.render('admin/contador', {
    activeAdmin: 'contador', hoyCount, total, ventasHoy,
    conversion: hoyCount > 0 ? Math.round(ventasHoy / hoyCount * 100) : null
  });
});

router.post('/contador/sumar', (req, res) => {
  const neg = req.negocioId;
  db.prepare(`INSERT INTO visitas (negocio_id, fecha, cantidad) VALUES (?, date('now','localtime'), 1)
              ON CONFLICT(negocio_id, fecha) DO UPDATE SET cantidad = cantidad + 1`).run(neg);
  res.redirect('/admin/contador');
});

/* ===================== EMPLEADAS ===================== */
function listaUsuarios(negocioId) {
  return db.prepare("SELECT id, nombre, usuario, rol, activo, permisos FROM usuarios WHERE negocio_id = ? ORDER BY rol, nombre")
    .all(negocioId)
    .map(u => ({ ...u, permisosArr: (u.permisos || '').split(',').map(s => s.trim()).filter(Boolean) }));
}
function contarEmpleados(negocioId) {
  return db.prepare("SELECT COUNT(*) c FROM usuarios WHERE negocio_id = ? AND rol = 'empleado'").get(negocioId).c;
}
function permisosDeBody(body) {
  let elegidos = body.permisos;
  if (!elegidos) elegidos = [];
  if (!Array.isArray(elegidos)) elegidos = [elegidos];
  const validos = elegidos.filter(p => SECCION_KEYS.includes(p));
  return validos.length ? validos.join(',') : SECCION_KEYS.join(','); // si no tildó nada, le damos acceso a todo por defecto
}

router.get('/empleados', (req, res) => {
  const usuarios = listaUsuarios(req.negocioId);
  res.render('admin/empleados', {
    activeAdmin: 'empleados', usuarios, error: null, ok: req.query.ok || null,
    SECCIONES, limite: MAX_EMPLEADOS, alcanzoLimite: contarEmpleados(req.negocioId) >= MAX_EMPLEADOS,
    pinActivo: !!configDe(req.negocioId).pin_panel
  });
});

router.post('/empleados', (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  const usuario = (req.body.usuario || '').trim().toLowerCase();
  const pass = req.body.password || '';

  const rerender = (error) => res.render('admin/empleados', {
    activeAdmin: 'empleados', usuarios: listaUsuarios(req.negocioId), error, ok: null,
    SECCIONES, limite: MAX_EMPLEADOS, alcanzoLimite: contarEmpleados(req.negocioId) >= MAX_EMPLEADOS,
    pinActivo: !!configDe(req.negocioId).pin_panel
  });

  if (contarEmpleados(req.negocioId) >= MAX_EMPLEADOS) {
    return rerender(`Ya tenés las ${MAX_EMPLEADOS} empleadas que incluye tu plan. Desactivá alguna si querés dar de alta otra persona.`);
  }
  if (!nombre || !usuario || pass.length < 4) {
    return rerender('Completá nombre, usuario y una clave de 4+ caracteres.');
  }
  const existe = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(usuario);
  if (existe) {
    return rerender('Ese usuario ya está tomado, elegí otro.');
  }
  const permisos = permisosDeBody(req.body);
  db.prepare("INSERT INTO usuarios (negocio_id, nombre, usuario, password_hash, rol, permisos) VALUES (?,?,?,?,'empleado',?)")
    .run(req.negocioId, nombre, usuario, bcrypt.hashSync(pass, 10), permisos);
  res.redirect('/admin/empleados?ok=1');
});

// Guarda qué secciones puede ver cada empleada (se puede editar en cualquier momento)
router.post('/empleados/:id/permisos', (req, res) => {
  const permisos = permisosDeBody(req.body);
  db.prepare("UPDATE usuarios SET permisos = ? WHERE id = ? AND negocio_id = ? AND rol = 'empleado'")
    .run(permisos, req.params.id, req.negocioId);
  res.redirect('/admin/empleados?ok=2');
});

router.post('/empleados/:id/toggle', (req, res) => {
  // no permitir desactivarse a sí misma
  if (parseInt(req.params.id, 10) !== req.session.user.id) {
    db.prepare("UPDATE usuarios SET activo = 1 - activo WHERE id = ? AND negocio_id = ? AND rol = 'empleado'")
      .run(req.params.id, req.negocioId);
  }
  res.redirect('/admin/empleados');
});

// PIN de 4 dígitos para entrar al Panel (opcional, protege caja/sueldos/etc.
// en un celular compartido)
router.post('/pin/cambiar', (req, res) => {
  const pin = (req.body.pin || '').trim();
  if (!/^\d{4}$/.test(pin)) {
    return res.redirect('/admin/empleados?ok=3'); // "tiene que ser de 4 números"
  }
  upsertConfig(req.negocioId, { pin_panel: pin });
  req.session.panelUnlocked = req.negocioId; // ya lo está usando, no hace falta que lo reingrese ahora
  res.redirect('/admin/empleados?ok=4');
});

router.post('/pin/quitar', (req, res) => {
  upsertConfig(req.negocioId, { pin_panel: null });
  delete req.session.panelUnlocked;
  res.redirect('/admin/empleados?ok=5');
});

// Bloquear el panel ahora mismo (para probar el PIN sin cerrar sesión).
// Olvida el desbloqueo de esta sesión y manda a Caja, que pedirá el PIN.
router.post('/pin/bloquear', (req, res) => {
  delete req.session.panelUnlocked;
  res.redirect('/admin/caja');
});

/* ===================== REPORTES ===================== */
// Todos los Excel se bajan desde acá, para no llenar de botones cada
// sección. Ventas, Gastos y Caja respetan el filtro de fecha de arriba;
// Stock, Pedidos y Agenda bajan siempre completos (son "estado actual",
// no movimientos de un día puntual).
router.get('/reportes', (req, res) => {
  const { filtro, desde, hasta } = filtroFecha(req.query);
  res.render('admin/reportes', { activeAdmin: 'reportes', filtro, desde, hasta });
});

router.get('/reportes/ventas.xlsx', (req, res) => {
  const { cond, extra } = filtroFecha(req.query);
  const filas = db.prepare(`SELECT * FROM ventas WHERE negocio_id = ? ${cond} ORDER BY id DESC`).all(req.negocioId, ...extra);
  enviarXLSX(res, 'ventas.xlsx', 'Ventas',
    ['Fecha', 'Vendedor', 'Producto', 'Detalle', 'Precio', 'Medio de pago', 'Cliente'],
    filas.map(v => [v.creado_en, v.vendedor, v.producto, v.detalle, v.precio, v.pago, v.cliente])
  );
});

router.get('/reportes/gastos.xlsx', (req, res) => {
  const { cond, extra } = filtroFecha(req.query);
  const filas = db.prepare(`SELECT * FROM gastos WHERE negocio_id = ? ${cond} ORDER BY id DESC`).all(req.negocioId, ...extra);
  enviarXLSX(res, 'gastos.xlsx', 'Gastos',
    ['Fecha', 'Responsable', 'Categoría', 'Monto', 'Medio de pago', 'Descripción'],
    filas.map(g => [g.creado_en, g.responsable, g.categoria, g.monto, g.pago, g.descripcion])
  );
});

router.get('/reportes/caja.xlsx', (req, res) => {
  const { cond, extra } = filtroFecha(req.query);
  const params = [req.negocioId, ...extra];
  const ventas = db.prepare(`SELECT * FROM ventas WHERE negocio_id = ? ${cond}`).all(...params);
  const gastos = db.prepare(`SELECT * FROM gastos WHERE negocio_id = ? ${cond}`).all(...params);
  const filas = [
    ...ventas.map(v => ['Venta', v.creado_en, v.precio, v.pago, v.vendedor, `${v.producto || ''}${v.detalle ? ' — ' + v.detalle : ''}`.trim()]),
    ...gastos.map(g => ['Gasto', g.creado_en, -g.monto, g.pago, g.responsable, `${g.categoria || ''}${g.descripcion ? ' — ' + g.descripcion : ''}`])
  ].sort((a, b) => (a[1] < b[1] ? 1 : -1)); // más reciente primero
  enviarXLSX(res, 'caja.xlsx', 'Caja',
    ['Tipo', 'Fecha', 'Monto', 'Medio de pago', 'Responsable', 'Detalle'],
    filas
  );
});

router.get('/reportes/stock.xlsx', (req, res) => {
  const filas = db.prepare('SELECT * FROM stock WHERE negocio_id = ? ORDER BY nombre').all(req.negocioId);
  enviarXLSX(res, 'stock.xlsx', 'Stock',
    ['Categoría', 'Nombre', 'Cantidad', 'Precio', 'Costo', 'Cargado'],
    filas.map(s => [s.categoria, s.nombre, s.cantidad, s.precio, s.costo, s.creado_en])
  );
});

router.get('/reportes/pedidos.xlsx', (req, res) => {
  const filas = db.prepare('SELECT * FROM pedidos WHERE negocio_id = ? ORDER BY id DESC').all(req.negocioId);
  enviarXLSX(res, 'pedidos.xlsx', 'Pedidos',
    ['Fecha', 'Cliente', 'Teléfono', 'Tipo', 'Tono', 'Largo', 'Estructura', 'Entrega', 'Estado', 'Seña', 'Total', 'Saldo', 'Notas'],
    filas.map(p => [p.creado_en, p.cliente, p.telefono, p.tipo, p.tono, p.largo, p.estructura, p.entrega, p.estado, p.sena, p.total, Math.max(p.total - p.sena, 0), p.notas])
  );
});

router.get('/reportes/contactos.xlsx', (req, res) => {
  const filas = db.prepare('SELECT * FROM contactos WHERE negocio_id = ? ORDER BY id DESC').all(req.negocioId);
  enviarXLSX(res, 'agenda.xlsx', 'Agenda',
    ['Fecha', 'Tipo', 'Nombre', 'Teléfono', 'Notas'],
    filas.map(c => [c.creado_en, c.tipo, c.nombre, c.telefono, c.notas])
  );
});

module.exports = router;