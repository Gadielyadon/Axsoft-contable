-- AxSoft Contable · esquema multi-negocio (multi-tenant)
-- Regla de oro: TODO dato de operacion cuelga de un negocio_id.
-- Asi el negocio A nunca ve lo del negocio B aunque compartan la misma base.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Negocios (cada cliente que te compra el sistema)
CREATE TABLE IF NOT EXISTS negocios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  rubro      TEXT,
  plan       TEXT DEFAULT 'basico',
  activo     INTEGER NOT NULL DEFAULT 1,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Usuarios (superadmin de plataforma, dueño de negocio, empleado)
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id    INTEGER,                 -- NULL solo para el superadmin de plataforma
  nombre        TEXT NOT NULL,
  usuario       TEXT NOT NULL UNIQUE,    -- con lo que inicia sesion
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('superadmin','dueno','empleado')),
  activo        INTEGER NOT NULL DEFAULT 1,
  permisos      TEXT NOT NULL DEFAULT 'ventas,stock,gastos,pedidos,contactos', -- secciones visibles (solo aplica a empleados)
  creado_en     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Configuracion por negocio
CREATE TABLE IF NOT EXISTS config (
  negocio_id INTEGER PRIMARY KEY,
  objetivo   REAL NOT NULL DEFAULT 0,
  pin_panel  TEXT,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Ventas
CREATE TABLE IF NOT EXISTS ventas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER NOT NULL,
  usuario_id INTEGER,
  vendedor   TEXT,
  producto   TEXT,
  detalle    TEXT,
  precio     REAL NOT NULL,
  pago       TEXT,
  cliente    TEXT,
  stock_id   INTEGER,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Stock
CREATE TABLE IF NOT EXISTS stock (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER NOT NULL,
  categoria  TEXT,
  nombre     TEXT NOT NULL,
  cantidad   REAL NOT NULL DEFAULT 0,
  precio     REAL NOT NULL DEFAULT 0,
  costo      REAL NOT NULL DEFAULT 0,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Gastos
CREATE TABLE IF NOT EXISTS gastos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id  INTEGER NOT NULL,
  usuario_id  INTEGER,
  responsable TEXT,
  categoria   TEXT,
  monto       REAL NOT NULL,
  pago        TEXT,
  descripcion TEXT,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Pedidos personalizados
CREATE TABLE IF NOT EXISTS pedidos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id  INTEGER NOT NULL,
  cliente     TEXT NOT NULL,
  telefono    TEXT,
  tipo        TEXT,
  tono        TEXT,
  largo       TEXT,
  estructura  TEXT,
  entrega     TEXT,
  estado      TEXT NOT NULL DEFAULT 'pendiente',
  sena        REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0,
  notas       TEXT,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Contactos / agenda
CREATE TABLE IF NOT EXISTS contactos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER NOT NULL,
  tipo       TEXT,
  nombre     TEXT NOT NULL,
  telefono   TEXT,
  notas      TEXT,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Cuentas por pagar
CREATE TABLE IF NOT EXISTS pagos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id  INTEGER NOT NULL,
  concepto    TEXT NOT NULL,
  monto       REAL NOT NULL,
  vencimiento TEXT,
  prioridad   TEXT NOT NULL DEFAULT 'media',
  estado      TEXT NOT NULL DEFAULT 'pendiente',
  creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Produccion (proyeccion de ingresos)
CREATE TABLE IF NOT EXISTS produccion (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER NOT NULL,
  nombre     TEXT NOT NULL,
  cantidad   REAL NOT NULL DEFAULT 0,
  precio     REAL NOT NULL DEFAULT 0,
  costo      REAL NOT NULL DEFAULT 0,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Equipo (sueldos estimados)
CREATE TABLE IF NOT EXISTS equipo (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER NOT NULL,
  nombre     TEXT NOT NULL,
  rol        TEXT,
  tarifa     REAL NOT NULL DEFAULT 0,
  horas      REAL NOT NULL DEFAULT 0,
  comision   REAL NOT NULL DEFAULT 0,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Categorías (de gastos, de stock, etc.) — se van creando solas a medida
-- que la dueña/empleada escribe una categoría nueva en el formulario.
CREATE TABLE IF NOT EXISTS categorias (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER NOT NULL,
  tipo       TEXT NOT NULL DEFAULT 'gasto',  -- 'gasto', 'stock', etc.
  nombre     TEXT NOT NULL,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (negocio_id, tipo, nombre),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

-- Contador de visitantes al stand
CREATE TABLE IF NOT EXISTS visitas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER NOT NULL,
  fecha      TEXT NOT NULL,
  cantidad   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (negocio_id, fecha),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_categorias_neg ON categorias(negocio_id, tipo);
CREATE INDEX IF NOT EXISTS idx_ventas_neg   ON ventas(negocio_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_gastos_neg   ON gastos(negocio_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_stock_neg    ON stock(negocio_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_neg  ON pedidos(negocio_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_neg ON usuarios(negocio_id);
-- Campos personalizados del formulario de Pedidos, por negocio.
-- Cada negocio arma su propio formulario (trenzas, pastelería, ropa, etc.).
CREATE TABLE IF NOT EXISTS pedido_campos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER NOT NULL,
  nombre     TEXT NOT NULL,
  tipo       TEXT NOT NULL DEFAULT 'texto',   -- texto | numero | fecha
  orden      INTEGER NOT NULL DEFAULT 0,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pedidocampos_neg ON pedido_campos(negocio_id, orden);

-- Jornadas trabajadas por cada integrante del equipo.
-- Se puede cargar por horario (entrada/salida) o por horas directas.
-- El sueldo se calcula: horas del período x tarifa + comisión sobre ventas del período.
CREATE TABLE IF NOT EXISTS jornadas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER NOT NULL,
  equipo_id  INTEGER NOT NULL,
  fecha      TEXT NOT NULL,
  hora_desde TEXT,
  hora_hasta TEXT,
  horas      REAL NOT NULL DEFAULT 0,
  nota       TEXT,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE,
  FOREIGN KEY (equipo_id)  REFERENCES equipo(id)   ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_jornadas_neg ON jornadas(negocio_id, fecha);
