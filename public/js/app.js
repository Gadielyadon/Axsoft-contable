// Dictado por voz (Chrome Android / navegadores con Web Speech API)
function dictar(targetId, btn){
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ alert('El dictado por voz no está disponible en este navegador. Probá con Chrome en Android (necesita internet).'); return; }
  var rec = new SR();
  rec.lang = 'es-AR';
  rec.interimResults = false;
  btn.classList.add('on');
  rec.onresult = function(e){
    var texto = e.results[0][0].transcript;
    var el = document.getElementById(targetId);
    el.value = el.value ? (el.value + ' ' + texto) : texto;
  };
  rec.onerror = function(){ alert('No se pudo escuchar. Revisá el micrófono y la conexión.'); };
  rec.onend = function(){ btn.classList.remove('on'); };
  rec.start();
}

// Categoría de gasto: muestra el campo de texto cuando elige "+ Nueva categoría…"
function onCategoriaChange(sel){
  var nuevo = document.getElementById('g-cat-nueva');
  if(!nuevo) return;
  if(sel.value === '__nueva__'){
    nuevo.style.display = 'block';
    nuevo.required = true;
    nuevo.focus();
  } else {
    nuevo.style.display = 'none';
    nuevo.required = false;
    nuevo.value = '';
  }
}

// Confirmación de borrado en cualquier form con data-confirm
document.addEventListener('submit', function(e){
  var f = e.target;
  if(f.dataset && f.dataset.confirm){
    if(!confirm(f.dataset.confirm)) e.preventDefault();
  }
});

// Autocompletar precio al vincular con stock (en ventas)
// ---- Buscador de productos del stock (Ventas) ----
// Filtra en el propio celular: los productos ya vienen en la página,
// asi que no consume internet mientras buscas.
function sinAcentos(t){
  return (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function buscarStock(q){
  var panel = document.getElementById('v-sug');
  if(!panel) return;
  var texto = sinAcentos(q);
  var items = panel.querySelectorAll('.sug-item');
  var visibles = 0;
  for(var i = 0; i < items.length; i++){
    var coincide = sinAcentos(items[i].getAttribute('data-q')).indexOf(texto) !== -1;
    items[i].hidden = !coincide;
    if(coincide) visibles++;
  }
  var vacio = document.getElementById('v-sug-vacio');
  if(vacio) vacio.hidden = (visibles > 0);
  panel.hidden = false;
}

function elegirStock(btn){
  var id     = btn.getAttribute('data-id');
  var nombre = btn.getAttribute('data-nombre');
  var precio = parseFloat(btn.getAttribute('data-precio')) || 0;

  // Si ya está en la venta, le sumamos una unidad en vez de repetirlo.
  var encontrado = -1;
  for(var i = 0; i < CARRITO.length; i++){
    if(CARRITO[i].stock_id === id && CARRITO[i].precio === precio && !CARRITO[i].detalle){ encontrado = i; break; }
  }
  if(encontrado >= 0){
    CARRITO[encontrado].cantidad += 1;
  } else {
    CARRITO.push({ producto: nombre, detalle: '', precio: precio, cantidad: 1, stock_id: id });
  }

  var buscar = document.getElementById('v-buscar');
  if(buscar) buscar.value = '';
  var panel = document.getElementById('v-sug');
  if(panel) panel.hidden = true;
  pintarCarrito();
  if(buscar) buscar.focus();
}

// Cerrar las sugerencias al tocar fuera del buscador
document.addEventListener('click', function(e){
  var panel = document.getElementById('v-sug');
  if(!panel || panel.hidden) return;
  var caja = e.target.closest ? e.target.closest('.buscador') : null;
  if(!caja) panel.hidden = true;
});

// ---- Carrito de la venta (varios productos en una sola venta) ----
var CARRITO = [];

function pesos(n){
  return '$' + Math.round(n).toLocaleString('es-AR');
}

function agregarAlCarrito(){
  var prod   = document.getElementById('v-producto');
  var precio = document.getElementById('v-precio');
  var cant   = document.getElementById('v-cant');
  var det    = document.getElementById('v-detalle');
  if(!prod || !precio) return false;

  var nombre = (prod.value || '').trim();
  var p = parseFloat(precio.value) || 0;
  var c = parseInt(cant && cant.value, 10) || 1;
  if(c < 1) c = 1;

  if(!nombre){ alert('Escribí el producto.'); prod.focus(); return false; }
  if(p <= 0){ alert('Poné el precio del producto.'); precio.focus(); return false; }

  CARRITO.push({
    producto: nombre,
    detalle: det ? (det.value || '').trim() : '',
    precio: p, cantidad: c, stock_id: ''
  });

  prod.value = ''; precio.value = '';
  if(cant) cant.value = '1';
  if(det) det.value = '';
  pintarCarrito();
  prod.focus();
  return true;
}

function toggleManual(){
  var b = document.getElementById('bloque-manual');
  if(b) b.hidden = !b.hidden;
}

function cambiarCantidad(i, delta){
  if(!CARRITO[i]) return;
  CARRITO[i].cantidad += delta;
  if(CARRITO[i].cantidad < 1) CARRITO.splice(i, 1);
  pintarCarrito();
}

function quitarDelCarrito(i){
  CARRITO.splice(i, 1);
  pintarCarrito();
}

function pintarCarrito(){
  var caja  = document.getElementById('carrito');
  var lista = document.getElementById('carrito-items');
  if(!caja || !lista) return;

  lista.innerHTML = '';
  var total = 0;

  CARRITO.forEach(function(it, i){
    total += it.precio * it.cantidad;

    var fila = document.createElement('div');
    fila.className = 'carrito-item';

    var txt = document.createElement('div');
    txt.className = 'carrito-txt';
    var nom = document.createElement('span');
    nom.className = 'carrito-nom';
    nom.textContent = it.producto + (it.detalle ? ' — ' + it.detalle : '');
    var sub = document.createElement('span');
    sub.className = 'carrito-sub';
    sub.textContent = pesos(it.precio) + ' c/u';
    txt.appendChild(nom); txt.appendChild(sub);
    fila.appendChild(txt);

    // control de cantidad:  −  2  +
    var ctrl = document.createElement('div');
    ctrl.className = 'cant-ctrl';
    var menos = document.createElement('button');
    menos.type = 'button'; menos.textContent = '−';
    menos.onclick = (function(idx){ return function(){ cambiarCantidad(idx, -1); }; })(i);
    var n = document.createElement('span');
    n.className = 'cant-num'; n.textContent = it.cantidad;
    var mas = document.createElement('button');
    mas.type = 'button'; mas.textContent = '+';
    mas.onclick = (function(idx){ return function(){ cambiarCantidad(idx, 1); }; })(i);
    ctrl.appendChild(menos); ctrl.appendChild(n); ctrl.appendChild(mas);
    fila.appendChild(ctrl);

    var monto = document.createElement('span');
    monto.className = 'carrito-monto';
    monto.textContent = pesos(it.precio * it.cantidad);
    fila.appendChild(monto);

    var quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'carrito-x';
    quitar.textContent = '×';
    quitar.onclick = (function(idx){ return function(){ quitarDelCarrito(idx); }; })(i);
    fila.appendChild(quitar);

    ['producto','detalle','precio','cantidad','stock_id'].forEach(function(campo){
      var h = document.createElement('input');
      h.type = 'hidden';
      h.name = 'items[' + i + '][' + campo + ']';
      h.value = it[campo];
      fila.appendChild(h);
    });

    lista.appendChild(fila);
  });

  document.getElementById('carrito-total').textContent = pesos(total);
  caja.hidden = (CARRITO.length === 0);
}

// Al enviar: si se olvidó de tocar "Agregar", igual tomamos lo que escribió.
// Y si el navegador puede, mandamos la venta por atrás (sin recargar la página):
// se registra al toque y gasta muchísimo menos internet.
// IMPORTANTE: si algo de esto falla, el formulario se manda como siempre.
document.addEventListener('submit', function(e){
  var form = e.target;
  if(!form || form.id !== 'form-venta') return;

  if(CARRITO.length === 0){
    var prod = document.getElementById('v-producto');
    var precio = document.getElementById('v-precio');
    var hayAlgo = (prod && prod.value.trim()) || (precio && parseFloat(precio.value) > 0);
    if(hayAlgo){
      if(!agregarAlCarrito()){ e.preventDefault(); return; }
    } else {
      e.preventDefault();
      alert('Agregá al menos un producto a la venta.');
      if(prod) prod.focus();
      return;
    }
  }

  // Sin fetch o sin FormData: que lo mande el navegador como toda la vida.
  if(!window.fetch || !window.FormData || !window.URLSearchParams) return;

  e.preventDefault();
  enviarVenta(form);
});

function enviarVenta(form){
  var boton = document.getElementById('v-guardar');
  var uid = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Armamos el resumen ACÁ, así la venta se puede mostrar aunque no haya señal.
  var resumen = resumenLocal(form);
  var fd = new FormData(form);
  fd.append('uid', uid);
  var datos = new URLSearchParams(fd).toString();

  if(boton){ boton.disabled = true; boton.textContent = 'Guardando...'; }

  var limpiar = function(){
    CARRITO = [];
    pintarCarrito();
    var cli = document.getElementById('v-cliente');
    if(cli) cli.value = '';
    if(boton){ boton.disabled = false; boton.textContent = 'Registrar venta'; }
  };

  fetch('/ventas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-AxSoft': '1' },
    body: datos,
    credentials: 'same-origin'
  })
  .then(function(r){
    if(!r.ok) { var e = new Error('servidor'); e.tipo = 'servidor'; throw e; }
    return r.json().catch(function(){ var e = new Error('formato'); e.tipo = 'servidor'; throw e; });
  })
  .then(function(data){
    if(!data || !data.ok){ var e = new Error('sin ok'); e.tipo = 'servidor'; throw e; }
    pintarVentaNueva(resumen, uid, false);
    refrescarStock(data.stock);
    limpiar();
    avisar('Venta registrada');
  })
  .catch(function(err){
    if(err && err.tipo === 'servidor'){
      // El servidor está, pero algo pasó (sesión vencida, error).
      // Lo mandamos a la vieja usanza para no perder la venta.
      if(boton){ boton.disabled = false; boton.textContent = 'Registrar venta'; }
      form.submit();
      return;
    }
    // Sin señal: la venta se guarda en el celular y se sube sola después.
    guardarPendiente(uid, datos, resumen);
    pintarVentaNueva(resumen, uid, true);
    limpiar();
    avisar('Sin internet: la venta quedó guardada en el celular');
  });
}

// ---------- Ventas sin internet ----------
var CLAVE_PEND = 'axsoft_pendientes';

function leerPendientes(){
  try { return JSON.parse(localStorage.getItem(CLAVE_PEND) || '[]'); }
  catch(e){ return []; }
}
function escribirPendientes(lista){
  try { localStorage.setItem(CLAVE_PEND, JSON.stringify(lista)); } catch(e){}
}
function guardarPendiente(uid, datos, resumen){
  var lista = leerPendientes();
  lista.push({ uid: uid, datos: datos, resumen: resumen });
  escribirPendientes(lista);
  pintarBannerPendientes();
}

// Arma el resumen de la venta con lo que hay en pantalla (sin pedir nada al servidor)
function resumenLocal(form){
  var vendedor = form.querySelector('#v-vendedor');
  var pago = form.querySelector('#v-pago');
  var cliente = form.querySelector('#v-cliente');
  var total = 0;
  var items = CARRITO.map(function(it){
    total += it.precio * it.cantidad;
    return {
      txt: (it.cantidad > 1 ? it.cantidad + ' x ' : '') + it.producto + (it.detalle ? ' — ' + it.detalle : ''),
      montoFmt: pesos(it.precio * it.cantidad)
    };
  });
  var d = new Date();
  return {
    titulo: CARRITO.length > 1 ? CARRITO.length + ' productos' : (CARRITO[0] ? CARRITO[0].producto : 'Venta'),
    totalFmt: pesos(total),
    fechaTxt: d.toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit'}) + ' ' +
              d.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'}),
    vendedor: vendedor ? vendedor.value : '',
    pago: pago ? pago.value : '',
    cliente: cliente ? cliente.value : '',
    mostrarLineas: (CARRITO.length > 1 || (CARRITO[0] && CARRITO[0].cantidad > 1)),
    detalleUnico: (CARRITO.length === 1 && CARRITO[0].cantidad === 1 && CARRITO[0].detalle) ? CARRITO[0].detalle : null,
    items: items
  };
}

// Intenta subir todo lo que quedó guardado sin señal
function sincronizarPendientes(){
  var lista = leerPendientes();
  if(!lista.length || !window.fetch) return;
  if(navigator.onLine === false) return;

  var siguiente = function(i){
    if(i >= lista.length){
      pintarBannerPendientes();
      return;
    }
    var p = lista[i];
    fetch('/ventas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-AxSoft': '1' },
      body: p.datos,
      credentials: 'same-origin'
    })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      if(data && data.ok){
        // subió (o ya estaba): la sacamos de la cola
        var quedan = leerPendientes().filter(function(x){ return x.uid !== p.uid; });
        escribirPendientes(quedan);
        var card = document.querySelector('.item[data-uid="' + p.uid + '"]');
        if(card){
          card.classList.remove('pendiente');
          var chip = card.querySelector('.chip-pend');
          if(chip) chip.remove();
        }
        if(data.stock) refrescarStock(data.stock);
      }
      siguiente(i + 1);
    })
    .catch(function(){ pintarBannerPendientes(); }); // sigue sin señal: queda para después
  };
  siguiente(0);
}

function pintarBannerPendientes(){
  var b = document.getElementById('banner-pend');
  if(!b) return;
  var n = leerPendientes().length;
  if(n === 0){ b.hidden = true; return; }
  b.hidden = false;
  b.textContent = n === 1
    ? '1 venta guardada en el celular, esperando internet'
    : n + ' ventas guardadas en el celular, esperando internet';
}

window.addEventListener('online', sincronizarPendientes);
window.addEventListener('load', function(){
  if(!document.getElementById('form-venta')) return;
  // Mostramos las que quedaron pendientes de la vez anterior
  leerPendientes().forEach(function(p){
    if(!document.querySelector('.item[data-uid="' + p.uid + '"]')){
      pintarVentaNueva(p.resumen, p.uid, true);
    }
  });
  pintarBannerPendientes();
  sincronizarPendientes();
});

function avisar(msg){
  var a = document.getElementById('v-aviso');
  if(!a) return;
  a.textContent = msg || 'Venta registrada';
  a.hidden = false;
  clearTimeout(a._t);
  a._t = setTimeout(function(){ a.hidden = true; }, 2200);
}

function pintarVentaNueva(v, uid, pendiente){
  var lista = document.getElementById('lista-ventas');
  if(!lista || !v) return;
  var vacio = document.getElementById('ventas-vacio');
  if(vacio) vacio.hidden = true;

  var item = document.createElement('div');
  item.className = 'item recien' + (pendiente ? ' pendiente' : '');
  if(uid) item.setAttribute('data-uid', uid);

  var fBorrar = document.createElement('form');
  fBorrar.className = 'inline-form';
  fBorrar.method = 'post';
  fBorrar.action = '/ventas/borrar';
  fBorrar.setAttribute('data-confirm', '¿Borrar esta venta?');
  var hid = document.createElement('input');
  hid.type = 'hidden'; hid.name = 'clave'; hid.value = uid || '';
  var bx = document.createElement('button');
  bx.className = 'del'; bx.type = 'submit'; bx.innerHTML = '&times;';
  fBorrar.appendChild(hid); fBorrar.appendChild(bx);
  item.appendChild(fBorrar);

  var head = document.createElement('div');
  head.className = 'head';
  var nom = document.createElement('span');
  nom.className = 'name'; nom.textContent = v.titulo;
  var monto = document.createElement('span');
  monto.className = 'amount pos'; monto.textContent = v.totalFmt;
  head.appendChild(nom); head.appendChild(monto);
  item.appendChild(head);

  if(v.mostrarLineas){
    var cont = document.createElement('div');
    cont.className = 'lineas';
    v.items.forEach(function(i){
      var l = document.createElement('div');
      l.className = 'linea';
      var t = document.createElement('span'); t.textContent = i.txt;
      var m = document.createElement('span'); m.className = 'linea-monto'; m.textContent = i.montoFmt;
      l.appendChild(t); l.appendChild(m);
      cont.appendChild(l);
    });
    item.appendChild(cont);
  } else if(v.detalleUnico){
    var d = document.createElement('div');
    d.className = 'muted';
    d.style.margin = '2px 0 4px';
    d.textContent = v.detalleUnico;
    item.appendChild(d);
  }

  var meta = document.createElement('div');
  meta.className = 'meta';
  var chip = function(txt, clase){
    var s = document.createElement('span');
    s.className = clase || '';
    s.textContent = txt;
    return s;
  };
  meta.appendChild(chip(v.vendedor, 'chip'));
  meta.appendChild(chip(v.pago, 'chip pay'));
  if(v.cliente) meta.appendChild(chip(v.cliente));
  meta.appendChild(chip(v.fechaTxt));
  if(pendiente) meta.appendChild(chip('sin subir', 'chip chip-pend'));
  item.appendChild(meta);

  lista.insertBefore(item, lista.firstChild);
}

// Actualiza el "quedan N" del buscador sin volver a pedir nada al servidor
function refrescarStock(stock){
  if(!stock || !stock.length) return;
  stock.forEach(function(s){
    var btn = document.querySelector('.sug-item[data-id="' + s.id + '"]');
    if(!btn) return;
    var chip = btn.querySelector('.chip');
    if(chip){
      chip.textContent = 'quedan ' + s.cantidad;
      if(s.cantidad <= 0) chip.classList.add('low'); else chip.classList.remove('low');
    }
  });
}

// ---- Stock: filtro en tiempo real y +/- sobre un campo ----
function sumarCampo(id, delta){
  var el = document.getElementById(id);
  if(!el) return;
  var v = (parseFloat(el.value) || 0) + delta;
  if(v < 0) v = 0;
  el.value = v;
}

function filtrarStock(q){
  var texto = sinAcentos(q);
  var items = document.querySelectorAll('#lista-stock .stock-item');
  var visibles = 0;
  for(var i = 0; i < items.length; i++){
    var coincide = sinAcentos(items[i].getAttribute('data-q')).indexOf(texto) !== -1;
    items[i].hidden = !coincide;
    if(coincide) visibles++;
  }
  var sin = document.getElementById('s-sin');
  if(sin) sin.hidden = (visibles > 0);
}
