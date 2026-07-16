'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireLogin, requireRole, tenant, SECCIONES, SECCION_KEYS } = require('../middleware/auth');
const { enviarXLSX } = require('../lib/xlsx');
const { camposPedidoDe, TIPOS_CAMPO } = require('../lib/pedidos');
const { leerProductos, CAMPOS } = require('../lib/importar');
const multer = require('multer');

const MAX_EMPLEADOS = 5;

// Recibe el Excel en memoria (no se guarda ningún archivo en el servidor)
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB
});
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

/* ===================== SUELDOS / EQUIPO / JORNADAS / RENTABILIDAD ===================== */

// --- helpers de fechas (para los filtros Hoy / Semana / Mes) ---
function isoDe(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function hoyISO() { return isoDe(new Date()); }
function lunesISO() {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  return isoDe(d);
}
function primeroDeMesISO() {
  const d = new Date();
  d.setDate(1);
  return isoDe(d);
}

// Resuelve el rango de fechas segun el filtro elegido
function resolverRango(q) {
  const r = q.r || 'todo';
  if (r === 'hoy')    return { r, desde: hoyISO(),         hasta: hoyISO() };
  if (r === 'semana') return { r, desde: lunesISO(),       hasta: hoyISO() };
  if (r === 'mes')    return { r, desde: primeroDeMesISO(), hasta: hoyISO() };
  if (r === 'rango')  return { r, desde: (q.desde || ''),  hasta: (q.hasta || '') };
  return { r: 'todo', desde: '', hasta: '' };
}

// Horas entre dos horarios "HH:MM". Si cruza la medianoche, suma 24hs.
function horasEntre(desde, hasta) {
  const m = /^(\d{1,2}):(\d{2})$/;
  const a = m.exec(desde || ''), b = m.exec(hasta || '');
  if (!a || !b) return 0;
  let min = (parseInt(b[1], 10) * 60 + parseInt(b[2], 10)) - (parseInt(a[1], 10) * 60 + parseInt(a[2], 10));
  if (min < 0) min += 24 * 60;       // turno que cruza la medianoche
  return Math.round((min / 60) * 100) / 100;
}

router.get('/sueldos', (req, res) => {
  const neg = req.negocioId;
  const rango = resolverRango(req.query);

  const equipo = db.prepare('SELECT * FROM equipo WHERE negocio_id = ? ORDER BY nombre COLLATE NOCASE').all(neg);

  // --- jornadas del periodo ---
  let sqlJ = 'SELECT j.*, e.nombre AS persona FROM jornadas j JOIN equipo e ON e.id = j.equipo_id WHERE j.negocio_id = ?';
  const parJ = [neg];
  if (rango.desde) { sqlJ += ' AND j.fecha >= ?'; parJ.push(rango.desde); }
  if (rango.hasta) { sqlJ += ' AND j.fecha <= ?'; parJ.push(rango.hasta); }
  sqlJ += ' ORDER BY j.fecha DESC, j.id DESC';
  const jornadas = db.prepare(sqlJ).all(...parJ);

  const horasPorEquipo = {};
  jornadas.forEach(j => { horasPorEquipo[j.equipo_id] = (horasPorEquipo[j.equipo_id] || 0) + j.horas; });

  // --- ventas del periodo, por vendedor (para la comision) ---
  let sqlV = 'SELECT vendedor, SUM(precio) t FROM ventas WHERE negocio_id = ?';
  const parV = [neg];
  if (rango.desde) { sqlV += " AND date(creado_en) >= ?"; parV.push(rango.desde); }
  if (rango.hasta) { sqlV += " AND date(creado_en) <= ?"; parV.push(rango.hasta); }
  sqlV += ' GROUP BY vendedor';
  const ventasPorNombre = {};
  db.prepare(sqlV).all(...parV).forEach(r => { ventasPorNombre[r.vendedor || '-'] = r.t; });

  let totalSueldos = 0, totalHoras = 0;
  const filas = equipo.map(e => {
    const horas = Math.round((horasPorEquipo[e.id] || 0) * 100) / 100;
    const base = horas * e.tarifa;
    const ventasP = ventasPorNombre[e.nombre] || 0;
    const comisionMonto = ventasP * (e.comision / 100);
    const total = base + comisionMonto;
    totalSueldos += total;
    totalHoras += horas;
    return { ...e, horasPeriodo: horas, base, ventasP, comisionMonto, total };
  });

  // --- rentabilidad del mismo periodo ---
  let sqlG = 'SELECT COALESCE(SUM(monto),0) t FROM gastos WHERE negocio_id = ?';
  const parG = [neg];
  if (rango.desde) { sqlG += " AND date(creado_en) >= ?"; parG.push(rango.desde); }
  if (rango.hasta) { sqlG += " AND date(creado_en) <= ?"; parG.push(rango.hasta); }
  const gastosOp = db.prepare(sqlG).get(...parG).t;

  let sqlVT = 'SELECT COALESCE(SUM(precio),0) t FROM ventas WHERE negocio_id = ?';
  const parVT = [neg];
  if (rango.desde) { sqlVT += " AND date(creado_en) >= ?"; parVT.push(rango.desde); }
  if (rango.hasta) { sqlVT += " AND date(creado_en) <= ?"; parVT.push(rango.hasta); }
  const ventasTotal = db.prepare(sqlVT).get(...parVT).t;

  res.render('admin/sueldos', {
    activeAdmin: 'sueldos', filas, jornadas, totalSueldos, totalHoras,
    ventasTotal, gastosOp, neto: ventasTotal - gastosOp - totalSueldos,
    rango, hoy: hoyISO()
  });
});

// Alta de integrante (sin horas: las horas salen de las jornadas)
router.post('/sueldos', (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.redirect('/admin/sueldos');
  db.prepare('INSERT INTO equipo (negocio_id, nombre, rol, tarifa, horas, comision) VALUES (?,?,?,?,0,?)')
    .run(req.negocioId, nombre, req.body.rol || '', num(req.body.tarifa), num(req.body.comision));
  res.redirect('/admin/sueldos');
});

router.post('/sueldos/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM equipo WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect('/admin/sueldos');
});

// Cargar una jornada. Se puede por horario (entrada/salida) o por horas directas.
router.post('/sueldos/jornadas', (req, res) => {
  const equipoId = parseInt(req.body.equipo_id, 10);
  const fecha = (req.body.fecha || '').trim() || hoyISO();
  const volver = req.body.volver || '/admin/sueldos';
  if (!equipoId) return res.redirect(volver);

  // el integrante tiene que ser de este negocio
  const e = db.prepare('SELECT id FROM equipo WHERE id = ? AND negocio_id = ?').get(equipoId, req.negocioId);
  if (!e) return res.redirect(volver);

  let horas = 0, hd = null, hh = null;
  if (req.body.modo === 'horas') {
    horas = num(req.body.horas);
  } else {
    hd = (req.body.hora_desde || '').trim();
    hh = (req.body.hora_hasta || '').trim();
    horas = horasEntre(hd, hh);
  }
  if (horas <= 0) return res.redirect(volver);

  db.prepare('INSERT INTO jornadas (negocio_id, equipo_id, fecha, hora_desde, hora_hasta, horas, nota) VALUES (?,?,?,?,?,?,?)')
    .run(req.negocioId, equipoId, fecha, hd, hh, horas, (req.body.nota || '').trim());
  res.redirect(volver);
});

router.post('/sueldos/jornadas/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM jornadas WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect(req.body.volver || '/admin/sueldos');
});

/* ===================== EMPLEADAS ===================== */
function contarEmpleados(negocioId) {
  return db.prepare("SELECT COUNT(*) c FROM usuarios WHERE negocio_id = ? AND rol = 'empleado'").get(negocioId).c;
}
function listaUsuarios(negocioId) {
  return db.prepare("SELECT id, nombre, usuario, rol, activo, permisos FROM usuarios WHERE negocio_id = ? ORDER BY rol, nombre")
    .all(negocioId)
    .map(u => ({ ...u, permisosArr: (u.permisos || '').split(',').map(s => s.trim()).filter(Boolean) }));
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

/* ===================== AJUSTES · CAMPOS DE PEDIDO ===================== */
router.get('/ajustes', (req, res) => {
  const campos = camposPedidoDe(req.negocioId);
  res.render('admin/ajustes', {
    activeAdmin: 'ajustes', campos, tipos: TIPOS_CAMPO, ok: req.query.ok || null,
    CAMPOS,
    imp: (req.query.nuevos || req.query.act || req.query.ign)
      ? { nuevos: +req.query.nuevos || 0, act: +req.query.act || 0, ign: +req.query.ign || 0 }
      : null,
    impError: req.query.err || null
  });
});

router.post('/ajustes/campos', (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  let tipo = (req.body.tipo || 'texto').trim();
  if (!TIPOS_CAMPO.includes(tipo)) tipo = 'texto';
  if (!nombre) return res.redirect('/admin/ajustes');
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden),-1) m FROM pedido_campos WHERE negocio_id = ?').get(req.negocioId).m;
  db.prepare('INSERT INTO pedido_campos (negocio_id, nombre, tipo, orden) VALUES (?,?,?,?)')
    .run(req.negocioId, nombre, tipo, maxOrden + 1);
  res.redirect('/admin/ajustes?ok=1');
});

router.post('/ajustes/campos/:id/borrar', (req, res) => {
  db.prepare('DELETE FROM pedido_campos WHERE id = ? AND negocio_id = ?').run(req.params.id, req.negocioId);
  res.redirect('/admin/ajustes');
});

// Mover un campo arriba/abajo (intercambia el orden con el vecino)
router.post('/ajustes/campos/:id/mover', (req, res) => {
  const dir = req.body.dir === 'arriba' ? 'arriba' : 'abajo';
  const campos = db.prepare('SELECT id, orden FROM pedido_campos WHERE negocio_id = ? ORDER BY orden, id').all(req.negocioId);
  const i = campos.findIndex(c => c.id === parseInt(req.params.id, 10));
  if (i === -1) return res.redirect('/admin/ajustes');
  const j = dir === 'arriba' ? i - 1 : i + 1;
  if (j < 0 || j >= campos.length) return res.redirect('/admin/ajustes');
  const a = campos[i], b = campos[j];
  const tx = db.transaction(() => {
    db.prepare('UPDATE pedido_campos SET orden = ? WHERE id = ? AND negocio_id = ?').run(b.orden, a.id, req.negocioId);
    db.prepare('UPDATE pedido_campos SET orden = ? WHERE id = ? AND negocio_id = ?').run(a.orden, b.id, req.negocioId);
  });
  tx();
  res.redirect('/admin/ajustes');
});

/* ===================== AJUSTES · IMPORTAR PRODUCTOS ===================== */

// Plantilla de ejemplo para que la llenen y la suban
router.get('/ajustes/plantilla.xlsx', (req, res) => {
  enviarXLSX(res, 'plantilla-productos.xlsx', 'Productos', CAMPOS, [
    ['Extensión rubia 60cm', 'Extensiones', 10, 12000, 7000],
    ['Trenza kanekalon', 'Trenzas', 25, 8000, 2000]
  ]);
});

router.post('/ajustes/importar', (req, res) => {
  subida.single('archivo')(req, res, (errSubida) => {
    const volverCon = (params) => res.redirect('/admin/ajustes?' + new URLSearchParams(params).toString());

    if (errSubida) {
      const msg = errSubida.code === 'LIMIT_FILE_SIZE'
        ? 'El archivo es muy grande (máximo 2 MB).'
        : 'No se pudo subir el archivo.';
      return volverCon({ err: msg });
    }
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return volverCon({ err: 'Elegí un archivo antes de importar.' });
    }

    const { productos, ignoradas, error } = leerProductos(req.file.buffer);
    if (error) return volverCon({ err: error });
    if (!productos.length) return volverCon({ err: 'No encontré productos con nombre en la planilla.' });

    const neg = req.negocioId;
    const buscar = db.prepare('SELECT id FROM stock WHERE negocio_id = ? AND lower(nombre) = lower(?)');
    const insertar = db.prepare('INSERT INTO stock (negocio_id, categoria, nombre, cantidad, precio, costo) VALUES (?,?,?,?,?,?)');
    const actualizar = db.prepare(`UPDATE stock SET cantidad = cantidad + ?,
                                   precio = CASE WHEN ? > 0 THEN ? ELSE precio END,
                                   costo  = CASE WHEN ? > 0 THEN ? ELSE costo  END,
                                   categoria = CASE WHEN ? <> '' THEN ? ELSE categoria END
                                   WHERE id = ? AND negocio_id = ?`);
    let nuevos = 0, act = 0;
    const tx = db.transaction(() => {
      productos.forEach(p => {
        const ya = buscar.get(neg, p.nombre);
        if (ya) {
          actualizar.run(p.cantidad, p.precio, p.precio, p.costo, p.costo, p.categoria, p.categoria, ya.id, neg);
          act++;
        } else {
          insertar.run(neg, p.categoria, p.nombre, p.cantidad, p.precio, p.costo);
          nuevos++;
        }
      });
    });
    tx();

    volverCon({ nuevos, act, ign: ignoradas });
  });
});

module.exports = router;