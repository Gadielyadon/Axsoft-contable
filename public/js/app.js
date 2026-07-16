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
  var datos = new URLSearchParams(new FormData(form)).toString();

  if(boton){ boton.disabled = true; boton.textContent = 'Guardando...'; }

  fetch('/ventas', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-AxSoft': '1'
    },
    body: datos,
    credentials: 'same-origin'
  })
  .then(function(r){
    if(!r.ok) throw new Error('respuesta ' + r.status);
    return r.json();
  })
  .then(function(data){
    if(!data || !data.ok) throw new Error('sin ok');
    pintarVentaNueva(data.venta);
    refrescarStock(data.stock);
    CARRITO = [];
    pintarCarrito();
    var cli = document.getElementById('v-cliente');
    if(cli) cli.value = '';
    if(boton){ boton.disabled = false; boton.textContent = 'Registrar venta'; }
    avisar();
  })
  .catch(function(){
    // Cualquier problema (sin señal, sesión vencida, etc): lo mandamos
    // de la forma tradicional, así la venta NO se pierde.
    if(boton){ boton.textContent = 'Registrar venta'; boton.disabled = false; }
    form.submit();
  });
}

function avisar(){
  var a = document.getElementById('v-aviso');
  if(!a) return;
  a.hidden = false;
  clearTimeout(a._t);
  a._t = setTimeout(function(){ a.hidden = true; }, 2200);
}

function pintarVentaNueva(v){
  var lista = document.getElementById('lista-ventas');
  if(!lista || !v) return;
  var vacio = document.getElementById('ventas-vacio');
  if(vacio) vacio.hidden = true;

  var item = document.createElement('div');
  item.className = 'item recien';

  var fBorrar = document.createElement('form');
  fBorrar.className = 'inline-form';
  fBorrar.method = 'post';
  fBorrar.action = '/ventas/borrar';
  fBorrar.setAttribute('data-confirm', '¿Borrar esta venta?');
  var hid = document.createElement('input');
  hid.type = 'hidden'; hid.name = 'clave'; hid.value = v.clave;
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
