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
function autocompletarPrecio(sel){
  var opt = sel.options[sel.selectedIndex];
  var precio = opt.getAttribute('data-precio');
  if(precio){ document.getElementById('v-precio').value = precio; }
}

// Registrar service worker (PWA) si está disponible
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('/sw.js').catch(function(){});
  });
}