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
  document.getElementById('v-producto').value = btn.getAttribute('data-nombre');
  document.getElementById('v-stock-id').value = btn.getAttribute('data-id');
  var precio = btn.getAttribute('data-precio');
  var campoPrecio = document.getElementById('v-precio');
  if(precio && campoPrecio) campoPrecio.value = precio;

  document.getElementById('v-vinculo-txt').textContent = btn.getAttribute('data-nombre');
  document.getElementById('v-vinculo').hidden = false;
  document.getElementById('v-sug').hidden = true;
}

function desvincularStock(){
  document.getElementById('v-stock-id').value = '';
  document.getElementById('v-vinculo').hidden = true;
}

// Cerrar las sugerencias al tocar fuera del buscador
document.addEventListener('click', function(e){
  var panel = document.getElementById('v-sug');
  if(!panel || panel.hidden) return;
  var caja = e.target.closest ? e.target.closest('.buscador') : null;
  if(!caja) panel.hidden = true;
});

// Si borra el nombre a mano, se corta el vinculo con el stock
document.addEventListener('input', function(e){
  if(e.target && e.target.id === 'v-producto'){
    var v = document.getElementById('v-vinculo');
    if(v && !v.hidden && e.target.value !== document.getElementById('v-vinculo-txt').textContent){
      desvincularStock();
    }
  }
});

// Registrar service worker (PWA) si está disponible
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('/sw.js').catch(function(){});
  });
}

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
  var sid    = document.getElementById('v-stock-id');
  if(!prod || !precio) return false;

  var nombre = (prod.value || '').trim();
  var p = parseFloat(precio.value) || 0;
  var c = parseInt(cant && cant.value, 10) || 1;
  if(c < 1) c = 1;

  if(!nombre){ alert('Escribí o elegí un producto.'); prod.focus(); return false; }
  if(p <= 0){ alert('Poné el precio del producto.'); precio.focus(); return false; }

  CARRITO.push({
    producto: nombre,
    detalle: det ? (det.value || '').trim() : '',
    precio: p,
    cantidad: c,
    stock_id: sid ? (sid.value || '') : ''
  });

  // limpiar para cargar el siguiente
  prod.value = '';
  precio.value = '';
  if(cant) cant.value = '1';
  if(det) det.value = '';
  if(sid) sid.value = '';
  desvincularStock();
  var panel = document.getElementById('v-sug');
  if(panel) panel.hidden = true;

  pintarCarrito();
  prod.focus();
  return true;
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
    sub.textContent = it.cantidad + ' x ' + pesos(it.precio);
    txt.appendChild(nom); txt.appendChild(sub);

    var monto = document.createElement('span');
    monto.className = 'carrito-monto';
    monto.textContent = pesos(it.precio * it.cantidad);

    var quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'carrito-x';
    quitar.textContent = '×';
    quitar.onclick = (function(idx){ return function(){ quitarDelCarrito(idx); }; })(i);

    fila.appendChild(txt); fila.appendChild(monto); fila.appendChild(quitar);

    // datos que viajan al servidor
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
document.addEventListener('submit', function(e){
  if(!e.target || e.target.id !== 'form-venta') return;
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
    }
  }
});
