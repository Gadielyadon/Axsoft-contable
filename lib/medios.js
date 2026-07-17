'use strict';
const { db } = require('../db');

// Con esto arranca cada negocio; después los edita desde Ajustes.
const POR_DEFECTO = {
  venta: ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'QR / Mercado Pago'],
  gasto: ['Efectivo', 'Transferencia', 'Débito', 'Crédito']
};

// Devuelve los medios de pago de un negocio. Si nunca configuró ninguno,
// le crea los de la lista de arriba (una sola vez).
function mediosDe(negocioId, para) {
  const tipo = (para === 'gasto') ? 'gasto' : 'venta';
  let filas = db.prepare('SELECT * FROM medios_pago WHERE negocio_id = ? AND para = ? ORDER BY orden, id')
    .all(negocioId, tipo);
  if (!filas.length) {
    const ins = db.prepare('INSERT INTO medios_pago (negocio_id, nombre, para, orden) VALUES (?,?,?,?)');
    POR_DEFECTO[tipo].forEach((n, i) => ins.run(negocioId, n, tipo, i));
    filas = db.prepare('SELECT * FROM medios_pago WHERE negocio_id = ? AND para = ? ORDER BY orden, id')
      .all(negocioId, tipo);
  }
  return filas;
}

module.exports = { mediosDe };
