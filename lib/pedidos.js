'use strict';
const { db } = require('../db');

const TIPOS_CAMPO = ['texto', 'numero', 'fecha'];

// Campo con el que arranca un negocio que todavía no configuró nada
// (así el formulario de Pedidos nunca queda vacío). La dueña lo edita
// o borra desde Ajustes y arma los suyos.
const CAMPOS_DEFAULT = [
  { nombre: 'Detalle', tipo: 'texto' }
];

// Devuelve los campos del formulario de Pedidos de un negocio.
// Si todavía no tiene ninguno, le crea el set por defecto una sola vez.
function camposPedidoDe(negocioId) {
  let filas = db.prepare('SELECT * FROM pedido_campos WHERE negocio_id = ? ORDER BY orden, id').all(negocioId);
  if (!filas.length) {
    const ins = db.prepare('INSERT INTO pedido_campos (negocio_id, nombre, tipo, orden) VALUES (?,?,?,?)');
    CAMPOS_DEFAULT.forEach((c, i) => ins.run(negocioId, c.nombre, c.tipo, i));
    filas = db.prepare('SELECT * FROM pedido_campos WHERE negocio_id = ? ORDER BY orden, id').all(negocioId);
  }
  return filas;
}

// Devuelve los valores personalizados de un pedido como lista [{n:nombre, v:valor}].
// Para pedidos viejos (formato anterior con columnas fijas) arma la lista
// desde esas columnas, así no se pierde la info ya cargada.
function datosDePedido(p) {
  if (p.datos) {
    try {
      const a = JSON.parse(p.datos);
      if (Array.isArray(a)) return a;
    } catch (e) { /* ignorar */ }
  }
  const arr = [];
  if (p.tipo) arr.push({ n: 'Tipo', v: p.tipo });
  if (p.tono) arr.push({ n: 'Tono', v: p.tono });
  if (p.largo) arr.push({ n: 'Largo', v: p.largo });
  if (p.estructura) arr.push({ n: 'Estructura', v: p.estructura });
  return arr;
}

module.exports = { camposPedidoDe, datosDePedido, TIPOS_CAMPO };
