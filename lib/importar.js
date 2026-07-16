'use strict';
const XLSX = require('xlsx');

// Columnas que entiende el importador. Acepta varios nombres para lo mismo,
// sin importar mayúsculas ni acentos (ej: "Categoría", "categoria", "RUBRO").
const ALIAS = {
  nombre:    ['nombre', 'producto', 'descripcion', 'detalle', 'articulo'],
  categoria: ['categoria', 'rubro', 'tipo'],
  cantidad:  ['cantidad', 'stock', 'cant', 'unidades'],
  precio:    ['precio', 'precioventa', 'preciodeventa', 'venta'],
  costo:     ['costo', 'preciocosto', 'preciodecosto', 'compra']
};

const CAMPOS = ['Nombre', 'Categoría', 'Cantidad', 'Precio', 'Costo'];

function normalizar(t) {
  return String(t === null || t === undefined ? '' : t)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Convierte a número aceptando "12.500", "12,50", "$ 3.000"
function aNumero(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let t = String(v === null || v === undefined ? '' : v).trim();
  if (!t) return 0;
  t = t.replace(/[^\d,.-]/g, '');
  if (t.indexOf(',') !== -1 && t.indexOf('.') !== -1) {
    t = t.replace(/\./g, '').replace(',', '.');   // 1.234,56
  } else if (t.indexOf(',') !== -1) {
    t = t.replace(',', '.');                      // 1234,56
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');                     // 12.500 = miles
  }
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

// Descubre qué columna del archivo corresponde a cada campo
function mapearColumnas(encabezados) {
  const mapa = {};
  encabezados.forEach(h => {
    const n = normalizar(h);
    Object.keys(ALIAS).forEach(campo => {
      if (!mapa[campo] && ALIAS[campo].indexOf(n) !== -1) mapa[campo] = h;
    });
  });
  return mapa;
}

/**
 * Lee un Excel/CSV y devuelve los productos encontrados.
 * { productos: [{nombre, categoria, cantidad, precio, costo}], ignoradas, error }
 */
function leerProductos(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    return { productos: [], ignoradas: 0, error: 'No pude leer el archivo. ¿Es un Excel (.xlsx) o un CSV?' };
  }

  const nombreHoja = wb.SheetNames[0];
  const hoja = nombreHoja && wb.Sheets[nombreHoja];
  if (!hoja) return { productos: [], ignoradas: 0, error: 'El archivo no tiene ninguna hoja con datos.' };

  const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
  if (!filas.length) return { productos: [], ignoradas: 0, error: 'La planilla está vacía.' };

  const mapa = mapearColumnas(Object.keys(filas[0]));
  if (!mapa.nombre) {
    return {
      productos: [], ignoradas: 0,
      error: 'No encontré la columna "Nombre". Descargá la plantilla y usá esos encabezados.'
    };
  }

  const productos = [];
  let ignoradas = 0;
  filas.forEach(f => {
    const nombre = String(f[mapa.nombre] === null || f[mapa.nombre] === undefined ? '' : f[mapa.nombre]).trim();
    if (!nombre) { ignoradas++; return; }   // sin nombre no se puede cargar
    productos.push({
      nombre,
      categoria: mapa.categoria ? String(f[mapa.categoria] || '').trim() : '',
      cantidad:  mapa.cantidad  ? aNumero(f[mapa.cantidad]) : 0,
      precio:    mapa.precio    ? aNumero(f[mapa.precio])   : 0,
      costo:     mapa.costo     ? aNumero(f[mapa.costo])    : 0
    });
  });

  return { productos, ignoradas, error: null };
}

module.exports = { leerProductos, CAMPOS };
