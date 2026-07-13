'use strict';

// Catálogo de secciones operativas que la dueña puede habilitar/deshabilitar
// por empleada. El orden acá define el orden en la nav y a qué sección se
// manda a una empleada al iniciar sesión.
const SECCIONES = [
  { key: 'ventas',    label: 'Ventas',   icon: '🧾' },
  { key: 'stock',     label: 'Stock',    icon: '📦' },
  { key: 'gastos',    label: 'Gastos',   icon: '💸' },
  { key: 'pedidos',   label: 'Pedidos',  icon: '✂️' },
  { key: 'contactos', label: 'Agenda',   icon: '📇' }
];
const SECCION_KEYS = SECCIONES.map(s => s.key);

// Requiere sesión iniciada
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  next();
}

// Requiere uno de los roles indicados
function requireRole(...roles) {
  return function (req, res, next) {
    const u = req.session && req.session.user;
    if (!u) return res.redirect('/login');
    if (!roles.includes(u.rol)) {
      return res.status(403).render('error', {
        titulo: 'Sin permiso',
        mensaje: 'Tu usuario no tiene acceso a esta sección.',
        user: u
      });
    }
    next();
  };
}

/**
 * Multi-tenant: adjunta req.negocioId con el negocio del usuario logueado.
 * El superadmin no opera datos de negocios; lo mandamos a su panel.
 */
function tenant(req, res, next) {
  const u = req.session.user;
  if (u.rol === 'superadmin') {
    return res.redirect('/plataforma');
  }
  req.negocioId = u.negocio_id;
  next();
}

/**
 * Requiere que el usuario tenga habilitada la sección indicada.
 * La dueña (y el superadmin) siempre tiene acceso a todo; a las empleadas
 * se les chequea la lista de permisos que cargó la dueña.
 */
function requireSection(key) {
  return function (req, res, next) {
    const u = req.session && req.session.user;
    if (!u) return res.redirect('/login');
    if (u.rol === 'dueno' || u.rol === 'superadmin') return next();
    const permisos = u.permisos || [];
    if (!permisos.includes(key)) {
      return res.status(403).render('error', {
        titulo: 'Sin permiso',
        mensaje: 'No tenés acceso a esta sección. Pedile a la dueña que te la habilite.',
        user: u
      });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole, tenant, requireSection, SECCIONES, SECCION_KEYS };