'use strict';
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { migrar } = require('./db');
migrar(); // asegura que las tablas existan al arrancar

const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = 'AxSoft Contable';

// Detrás de Nginx (necesario para cookies "secure" con SSL)
app.set('trust proxy', 1);

// Vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing y estáticos
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sesiones persistidas en SQLite (sobreviven reinicios de PM2)
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'db') }),
  secret: process.env.SESSION_SECRET || 'cambiame-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12 // 12 horas
  }
}));

// Helpers disponibles en todas las vistas
app.locals.APP_NAME = APP_NAME;
// Cache-busting: cambia solo cada vez que se reinicia el server, así el
// celular/PC del cliente siempre baja el CSS nuevo después de un deploy
// (sin esto, el navegador puede quedarse con el styles.css viejo cacheado).
app.locals.ASSET_V = Date.now();
app.locals.fmt = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
app.locals.fechaCorta = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

// Usuario disponible en todas las vistas
app.use((req, res, next) => {
  res.locals.user = (req.session && req.session.user) || null;
  res.locals.negocioNombre = (req.session && req.session.negocioNombre) || null;
  res.locals.activeNav = '';
  next();
});

// Rutas — el orden importa: primero los prefijos específicos; el router de
// operación se monta en '/' y por eso va al final (si no, interceptaría todo).
app.use('/', require('./routes/auth'));                 // /login, /logout
app.use('/plataforma', require('./routes/plataforma')); // superadmin
app.use('/admin', require('./routes/admin'));           // panel de la dueña

// Home → redirige según rol (antes del router de operación)
app.get('/', (req, res) => {
  const u = req.session.user;
  if (!u) return res.redirect('/login');
  if (u.rol === 'superadmin') return res.redirect('/plataforma');
  if (u.rol === 'dueno') return res.redirect('/ventas');
  const orden = ['ventas', 'stock', 'gastos', 'pedidos', 'contactos', 'contador'];
  const primera = orden.find(s => (u.permisos || []).includes(s));
  if (!primera) {
    return res.status(403).render('error', {
      titulo: 'Sin secciones habilitadas',
      mensaje: 'Todavía no tenés ninguna sección habilitada. Pedile a la dueña que te dé acceso desde Empleadas.',
      user: u
    });
  }
  return res.redirect('/' + primera);
});

app.use('/', require('./routes/operacion'));            // /ventas, /stock, /gastos, /pedidos, /contactos

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    titulo: 'No encontrado',
    mensaje: 'La página que buscás no existe.',
    user: res.locals.user
  });
});

// Errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    titulo: 'Error del servidor',
    mensaje: 'Ocurrió un problema. Volvé a intentar en un momento.',
    user: res.locals.user
  });
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} corriendo en http://localhost:${PORT}`);
});
