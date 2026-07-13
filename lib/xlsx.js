'use strict';
const XLSX = require('xlsx');

// Arma y manda un archivo .xlsx (Excel de verdad) como descarga.
// headers: array de nombres de columna. rows: array de arrays (una fila = un array de valores).
function enviarXLSX(res, nombreArchivo, hoja, headers, rows) {
  const datos = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(datos);

  // Ancho de columna aproximado, para que no quede todo apretado
  ws['!cols'] = headers.map((h, i) => {
    const largoMax = datos.reduce((m, fila) => {
      const v = fila[i];
      return Math.max(m, v === null || v === undefined ? 0 : String(v).length);
    }, 0);
    return { wch: Math.min(Math.max(largoMax + 2, 10), 40) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja.slice(0, 31)); // Excel limita el nombre de hoja a 31 caracteres
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.send(buffer);
}

module.exports = { enviarXLSX };
