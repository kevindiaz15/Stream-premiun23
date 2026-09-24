/* =============================================================== */
/* STREAM PREMIUM23 · Panel administrador (Supabase Auth + RLS)    */
/* Gestión de cuentas y pedidos recibidos desde la tienda.         */
/* =============================================================== */

let sb = null;
let admCuentas = [];
let editandoId = null;
let fotoPendiente = null;   /* File a subir (o null) */
let quitarFoto = false;

let pedidos = [];           /* Pedidos recibidos desde la tienda */
let solFiltro = '';
let solBusqueda = '';

const CATS = [
  ['netflix','Netflix'],['disney','Disney+'],['hbomax','HBO Max'],['prime','Prime Video'],
  ['spotify','Spotify'],['youtube','YouTube Premium'],['otras','Otras plataformas']
];

const $ = id => document.getElementById(id);

function uid(){
  try{ if(crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
  return 'f' + Date.now() + Math.floor(Math.random()*1e6);
}
const fmtCOP = n => (n==null||n==='') ? 'Consultar' : '$' + Number(n).toLocaleString('es-CO');

/* Escapa HTML para pintar contenido de la BD con seguridad */
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Link de WhatsApp del cliente (asume Colombia si es número local 3xx...) */
function waNum(n){
  let dig = String(n||'').replace(/[^0-9]/g,'');
  if(dig.length===10 && dig.startsWith('3')) dig = '57'+dig;
  return 'https://wa.me/'+dig;
}

/* Atributo de evento seguro: delimitado con comilla simple, JSON con dobles */
function attrEvt(evt, call){
  return evt+'=\'' + String(call).replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\'';
}
function attrClick(call){ return attrEvt('onclick', call); }

/* ---------- Promos ---------- */
function fechaVigente(ini, fin){
  if(!ini || !fin) return false;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return hoy >= new Date(ini + 'T00:00:00') && hoy <= new Date(fin + 'T23:59:59');
}
function precioInfo(p){
  const base = (p.precio == null || p.precio === '') ? null : Number(p.precio);
  const pct = Number(p.descuento_porcentaje) || 0;
  const vigente = pct > 0 && fechaVigente(p.promo_inicio, p.promo_fin);
  const final = (base != null && vigente) ? Math.round(base * (1 - pct/100)) : base;
  return { base, pct, vigente, final, etiqueta: vigente ? (p.etiqueta_promo || 'Oferta') : '' };
}

/* ---------- Stock ---------- */
function stockValor(p){
  return (p.stock == null || p.stock === '') ? null : Number(p.stock);
}
function agotada(p){
  const s = stockValor(p);
  return s != null && s <= 0;
}

/* ---------- Supabase ---------- */
function clienteSupabase(){
  return import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
    .then(m => m.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key));
}

function toast(msg, tipo){
  const cont = $('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast ' + (tipo || '');
  t.innerHTML = '<i class="fa-solid '+(tipo==='error'?'fa-circle-xmark':'fa-circle-check')+'"></i><span>'+msg+'</span>';
  cont.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 500); }, 2600);
}

/* ---------- Vistas ---------- */
function mostrarLogin(){
  $('loginView').classList.remove('hidden');
  $('dashView').classList.add('hidden');
  $('loginMsg').textContent = '';
}
function mostrarDash(){
  $('loginView').classList.add('hidden');
  $('dashView').classList.remove('hidden');
  cargarCuentas();
  cargarPedidos();
}

/* ---------- Carga y pintado ---------- */
async function cargarCuentas(){
  const { data, error } = await sb.from('stream_accounts').select('*').order('orden',{ascending:true}).order('created_at',{ascending:true});
  if(error){ toast('Error al cargar cuentas','error'); return; }
  admCuentas = data || [];
  renderStats();
  renderFiltroCat();
  renderLista();
}

function renderStats(){
  const total = admCuentas.length;
  const activos = admCuentas.filter(p=>p.activo).length;
  const agot = admCuentas.filter(p=>p.activo && agotada(p)).length;
  const enPromo = admCuentas.filter(p=>p.activo && precioInfo(p).vigente).length;
  $('stats').innerHTML =
    '<div class="stat"><div class="ic blue"><i class="fa-solid fa-tv"></i></div><div><b>'+total+'</b><small>Cuentas totales</small></div></div>'+
    '<div class="stat"><div class="ic green"><i class="fa-solid fa-circle-check"></i></div><div><b>'+activos+'</b><small>Activas en tienda</small></div></div>'+
    '<div class="stat"><div class="ic red"><i class="fa-solid fa-boxes-stacked"></i></div><div><b>'+agot+'</b><small>Agotadas</small></div></div>'+
    '<div class="stat"><div class="ic gold"><i class="fa-solid fa-tags"></i></div><div><b>'+enPromo+'</b><small>Con promo vigente</small></div></div>';
}

function renderFiltroCat(){
  const sel = $('admFiltroCat');
  if(sel.options.length > 1) return;
  sel.innerHTML = '<option value="">Todas las plataformas</option>' + CATS.map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('');
}

function listaFiltrada(){
  const q = $('admSearch').value.trim().toLowerCase();
  const c = $('admFiltroCat').value;
  return admCuentas.filter(p=>{
    if(c && p.categoria !== c) return false;
    if(q && !((p.nombre||'')+(p.descripcion||'')).toLowerCase().includes(q)) return false;
    return true;
  });
}

function catNombre(k){
  const f = CATS.find(c=>c[0]===k);
  return f ? f[1] : k;
}

function renderLista(){
  const list = listaFiltrada();
  $('admEmpty').classList.toggle('hidden', list.length>0);
  $('admList').innerHTML = list.map(p=>{
    const info = precioInfo(p);
    const stock = agotada(p)
      ? '<span class="adm-off">Agotada</span>'
      : (stockValor(p)==null ? '<span class="adm-stock">Stock libre</span>' : '<span class="adm-stock">Quedan '+stockValor(p)+'</span>');
    let precios = '<span class="precio">'+fmtCOP(p.precio);
    if(info.vigente) precios += ' <span class="p-old">'+fmtCOP(info.final)+'</span> <span class="adm-promo">-'+info.pct+'% '+(info.etiqueta||'').toUpperCase()+'</span>';
    precios += '</span>';
    const thumb = p.foto_url
      ? '<img src="'+p.foto_url+'" alt="">'
      : '<i class="fa-solid fa-tv"></i>';
    const badge = p.activo ? '' : '<span class="adm-off">Oculta</span>';
    return '<div class="adm-item">'+
      '<div class="thumb">'+thumb+'</div>'+
      '<div class="info">'+
        '<div class="nm">'+esc(p.nombre)+' <span class="adm-cat">'+catNombre(p.categoria)+'</span> '+(p.etiqueta?'<span class="adm-promo">'+esc(p.etiqueta)+'</span>':'')+' '+stock+' '+badge+'</div>'+
        '<div class="aroma">'+(p.garantia?'<i class="fa-solid fa-shield-halved"></i> '+esc(p.garantia):'')+'</div>'+
        precios+
      '</div>'+
      '<div class="acc">'+
        '<label class="switch'+(p.activo?' live':'')+'" title="'+(p.activo?'Activa en tienda':'Oculta de la tienda')+'"><input type="checkbox" '+(p.activo?'checked':'')+' '+attrEvt('onchange','toggleActivo('+JSON.stringify(String(p.id))+',this)')+'><i class="fa-solid '+(p.activo?'fa-eye':'fa-eye-slash')+'"></i></label>'+
        '<button title="Editar" '+attrClick('abrirForm('+JSON.stringify(String(p.id))+')')+'><i class="fa-solid fa-pen"></i></button>'+
        '<button title="Eliminar" class="del" '+attrClick('eliminarCuenta('+JSON.stringify(String(p.id))+')')+'><i class="fa-solid fa-trash-can"></i></button>'+
      '</div>'+
    '</div>';
  }).join('');
}

/* =============================================================== */
/* PEDIDOS (recibidos desde la tienda)                             */
/* =============================================================== */

async function cargarPedidos(){
  const { data, error } = await sb
    .from('solicitudes')
    .select('*')
    .order('created_at', { ascending: false });
  if(error){ console.warn('Error cargando pedidos', error); return; }
  pedidos = data || [];
  actualizarBadgePedidos();
  renderPedidos();
}

function actualizarBadgePedidos(){
  const nP = pedidos.filter(s=>s.estado==='nueva').length;
  const b = $('badgePedidos');
  b.textContent = nP;
  b.classList.toggle('show', nP>0);
}

function setVista(v){
  const esPed = v === 'pedidos';
  $('productosView').classList.toggle('hidden', esPed);
  $('pedidosView').classList.toggle('hidden', !esPed);
  $('btnNavProductos').classList.toggle('active', !esPed);
  $('btnNavPedidos').classList.toggle('active', esPed);
  if(esPed) renderPedidos();
}

function estadoLabel(e){ return ({nueva:'Nueva',vista:'Vista',atendida:'Atendida',cerrada:'Cerrada'})[e]||e; }

function pedidosFiltrados(){
  return pedidos.filter(s=>{
    if(s.tipo !== 'pedido') return false;
    if(solFiltro && s.estado !== solFiltro) return false;
    if(solBusqueda){
      const hay = ((s.nombre||'')+' '+(s.whatsapp||'')+' '+(s.correo||'')+' '+(s.mensaje_wa||'')).toLowerCase();
      if(!hay.includes(solBusqueda)) return false;
    }
    return true;
  });
}

function renderPedidos(){
  const list = pedidosFiltrados();
  $('solEmpty').classList.toggle('hidden', list.length>0);
  $('solList').innerHTML = list.map(solCard).join('');
}

function detPedido(d){
  const items = Array.isArray(d.items) ? d.items : [];
  const lineas = items.map(it=>{
    const sub = it.subtotal==null ? 'Consultar' : fmtCOP(it.subtotal);
    return '<div class="rl"><span>'+esc(it.nombre)+(it.plan?' <em>· '+esc(it.plan)+'</em>':'')+' × '+it.cantidad+'</span><span>'+sub+'</span></div>';
  }).join('');
  const total = d.total==null ? 'Consultar' : fmtCOP(d.total);
  return '<div class="sol-ped">'+
    '<div class="sol-items">'+lineas+'<div class="rl total"><span>Total estimado</span><b>'+total+'</b></div></div>'+
  '</div>';
}

function solCard(s){
  const d = (s.detalles && typeof s.detalles==='object') ? s.detalles : {};
  const fechaTxt = new Date(s.created_at).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});

  const estados = ['nueva','vista','atendida','cerrada'];
  const contacto =
    '<div class="sol-contacto">'+
      '<span class="sol-nombre"><i class="fa-solid fa-user"></i>'+esc(s.nombre)+'</span>'+
      (s.whatsapp ? '<a href="'+waNum(s.whatsapp)+'" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>'+esc(s.whatsapp)+'</a>' : '')+
      (s.correo ? '<a href="mailto:'+esc(s.correo)+'"><i class="fa-solid fa-envelope"></i>'+esc(s.correo)+'</a>' : '')+
    '</div>';

  return '<div class="sol-card">'+
    '<div class="sol-head">'+
      '<div class="sol-left">'+
        '<span class="sol-tipo ped"><i class="fa-solid fa-bag-shopping"></i>Pedido</span>'+
        '<span class="sol-date"><i class="fa-regular fa-clock"></i>'+fechaTxt+'</span>'+
      '</div>'+
      '<div class="sol-head-acc">'+
        '<select class="sol-estado '+s.estado+'" title="Cambiar estado" '+attrEvt('onchange','cambiarEstado('+JSON.stringify(String(s.id))+',this.value)')+'>'+
          estados.map(e=>'<option value="'+e+'"'+(s.estado===e?' selected':'')+'>'+estadoLabel(e)+'</option>').join('')+
        '</select>'+
        '<button class="acc-btn del" title="Eliminar" '+attrClick('eliminarPedido('+JSON.stringify(String(s.id))+')')+'><i class="fa-solid fa-trash-can"></i></button>'+
      '</div>'+
    '</div>'+
    contacto+
    detPedido(d)+
    (s.mensaje_wa ? '<div class="sol-msg"><pre>'+esc(s.mensaje_wa)+'</pre></div>' : '')+
    '<div class="sol-acc">'+
      (s.whatsapp ? '<a class="btn small wa" href="'+waNum(s.whatsapp)+'" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> Hablar por WhatsApp</a>' : '')+
      (s.mensaje_wa ? '<button type="button" class="btn small ghost" '+attrClick('copiarMensaje('+JSON.stringify(String(s.id))+')')+'><i class="fa-regular fa-copy"></i> Copiar mensaje</button>' : '')+
    '</div>'+
  '</div>';
}

async function cambiarEstado(id, estado){
  const { error } = await sb.from('solicitudes').update({ estado }).eq('id', id);
  if(error){ toast('No se pudo actualizar el estado','error'); renderPedidos(); return; }
  const s = pedidos.find(x=>String(x.id)===String(id));
  if(s) s.estado = estado;
  actualizarBadgePedidos();
  toast('Estado actualizado: '+estadoLabel(estado));
}

async function eliminarPedido(id){
  if(!confirm('¿Eliminar este pedido definitivamente?')) return;
  const { error } = await sb.from('solicitudes').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar','error'); return; }
  pedidos = pedidos.filter(x=>String(x.id)!==String(id));
  actualizarBadgePedidos();
  renderPedidos();
  toast('Pedido eliminado');
}

async function copiarMensaje(id){
  const s = pedidos.find(x=>String(x.id)===String(id));
  if(!s || !s.mensaje_wa) return;
  try{
    await navigator.clipboard.writeText(s.mensaje_wa);
  }catch(e){
    const ta = document.createElement('textarea');
    ta.value = s.mensaje_wa;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Mensaje copiado al portapapeles');
}

/* ---------- Acciones ---------- */
async function toggleActivo(id, chk){
  const ok = chk.checked;
  const { error } = await sb.from('stream_accounts').update({ activo: ok }).eq('id', id);
  if(error){ toast('No se pudo actualizar','error'); cargarCuentas(); return; }
  toast(ok ? 'Cuenta visible en la tienda' : 'Cuenta oculta de la tienda');
  cargarCuentas();
}

async function eliminarCuenta(id){
  const p = admCuentas.find(x=>String(x.id)===String(id));
  if(!p) return;
  if(!confirm('¿Eliminar "'+(p.nombre||'esta cuenta')+'" definitivamente?')) return;
  if(p.foto_url) await quitarFotoDeUrl(p.foto_url);
  const { error } = await sb.from('stream_accounts').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar','error'); return; }
  toast('Cuenta eliminada');
  cargarCuentas();
}

/* ---------- Storage ---------- */
async function subirArchivo(file){
  const path = 'cuentas/' + uid() + '_' + file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const { error } = await sb.storage.from('cuentas').upload(path, file, { upsert: true });
  if(error) throw error;
  return sb.storage.from('cuentas').getPublicUrl(path).data.publicUrl;
}
async function quitarFotoDeUrl(url){
  try{
    const marca = '/cuentas/';
    const idx = url.indexOf(marca);
    if(idx < 0) return;
    const path = decodeURIComponent(url.slice(idx + marca.length).split('?')[0]);
    await sb.storage.from('cuentas').remove([path]);
  }catch(e){}
}

/* ---------- Formulario ---------- */
function abrirForm(id){
  editandoId = id ? String(id) : null;
  fotoPendiente = null;
  quitarFoto = false;

  $('formMsg').textContent = '';
  $('modTitle').textContent = editandoId ? 'Editar cuenta' : 'Nueva cuenta';

  if(editandoId){
    const p = admCuentas.find(x=>String(x.id)===editandoId) || {};
    $('fNombre').value = p.nombre || '';
    $('fCategoria').value = p.categoria || CATS[0][0];
    $('fStock').value = (p.stock == null || p.stock === '') ? '' : String(p.stock);
    $('fPrecio').value = (p.precio == null || p.precio === '') ? '' : String(p.precio);
    $('fGarantia').value = p.garantia || '';
    $('fEtiqueta').value = p.etiqueta || '';
    $('fDescripcion').value = p.descripcion || '';
    $('fDescuento').value = p.descuento_porcentaje ? String(p.descuento_porcentaje) : '';
    $('fEtiquetaPromo').value = p.etiqueta_promo || '';
    $('fInicio').value = p.promo_inicio || '';
    $('fFin').value = p.promo_fin || '';
    $('fActivo').checked = p.activo !== false;

    if(p.foto_url){
      $('fotoPreview').src = p.foto_url;
      $('fotoPreviewWrap').classList.remove('hidden');
      $('fotoDrop').classList.add('hidden');
    }else{
      $('fotoPreviewWrap').classList.add('hidden');
      $('fotoDrop').classList.remove('hidden');
    }
  }else{
    $('productForm').reset();
    $('fActivo').checked = true;
    $('fotoPreviewWrap').classList.add('hidden');
    $('fotoDrop').classList.remove('hidden');
  }

  $('formModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function cerrarForm(){
  $('formModal').classList.remove('open');
  document.body.style.overflow = '';
}

function prepararFoto(file){
  if(!file) return;
  if(!file.type.startsWith('image/')){
    toast('El archivo debe ser una imagen','error');
    return;
  }
  if(file.size > 5 * 1024 * 1024){
    toast('La imagen supera los 5 MB','error');
    return;
  }
  fotoPendiente = file;
  quitarFoto = false;
  $('fotoPreview').src = URL.createObjectURL(file);
  $('fotoPreviewWrap').classList.remove('hidden');
  $('fotoDrop').classList.add('hidden');
}

async function guardarCuenta(e){
  e.preventDefault();
  const btn = $('btnGuardar');
  btn.disabled = true;

  try{
    const nombre = $('fNombre').value.trim();
    if(!nombre){ $('formMsg').textContent = 'El nombre es obligatorio.'; btn.disabled = false; return; }

    const precioVal = $('fPrecio').value.trim();
    const descuentoVal = $('fDescuento').value.trim();
    const stockVal = $('fStock').value.trim();
    const payload = {
      nombre,
      categoria: $('fCategoria').value,
      descripcion: $('fDescripcion').value.trim(),
      stock: stockVal === '' ? null : Math.max(0, parseInt(stockVal, 10)),
      precio: precioVal === '' ? null : parseInt(precioVal, 10),
      garantia: $('fGarantia').value.trim(),
      etiqueta: $('fEtiqueta').value.trim(),
      descuento_porcentaje: descuentoVal === '' ? 0 : Math.max(0, Math.min(100, parseInt(descuentoVal, 10))),
      etiqueta_promo: $('fEtiquetaPromo').value.trim(),
      promo_inicio: $('fInicio').value || null,
      promo_fin: $('fFin').value || null,
      activo: $('fActivo').checked
    };

    /* Foto */
    let fotoUrl = editandoId ? ((admCuentas.find(x=>String(x.id)===editandoId)||{}).foto_url || '') : '';
    if(fotoPendiente){
      const urlNueva = await subirArchivo(fotoPendiente);
      if(fotoUrl) await quitarFotoDeUrl(fotoUrl);
      fotoUrl = urlNueva;
    }else if(editandoId && quitarFoto){
      if(fotoUrl) await quitarFotoDeUrl(fotoUrl);
      fotoUrl = '';
    }
    payload.foto_url = fotoUrl;

    let error = null;
    if(editandoId){
      ({ error } = await sb.from('stream_accounts').update(payload).eq('id', editandoId));
    }else{
      ({ error } = await sb.from('stream_accounts').insert([payload]));
    }
    if(error) throw error;

    toast(editandoId ? 'Cuenta actualizada' : 'Cuenta creada');
    cerrarForm();
    cargarCuentas();
  }catch(err){
    console.error(err);
    $('formMsg').textContent = (err && err.message) ? err.message : 'Ocurrió un error al guardar.';
  }finally{
    btn.disabled = false;
  }
}

/* ---------- Inicialización ---------- */
document.getElementById('loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  $('loginMsg').textContent = '';
  const email = $('admEmail').value.trim();
  const pass = $('admPass').value;
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if(error){
    $('loginMsg').textContent = 'Usuario o contraseña incorrectos.';
    toast('No se pudo iniciar sesión','error');
  }else{
    toast('¡Bienvenida! Sesión iniciada');
    mostrarDash();
  }
});

$('btnLogout').addEventListener('click', ()=> sb.auth.signOut());

$('btnNuevo').addEventListener('click', ()=> abrirForm());
$('productForm').addEventListener('submit', guardarCuenta);
$('admSearch').addEventListener('input', renderLista);
$('admFiltroCat').addEventListener('change', renderLista);

/* Navegación: cuentas / pedidos */
$('btnNavProductos').addEventListener('click', ()=> setVista('productos'));
$('btnNavPedidos').addEventListener('click', ()=> setVista('pedidos'));
$('solFiltroEstado').addEventListener('change', e=>{ solFiltro = e.target.value; renderPedidos(); });
$('solSearch').addEventListener('input', e=>{ solBusqueda = e.target.value.trim().toLowerCase(); renderPedidos(); });

/* Foto: clic y arrastrar */
$('fotoDrop').addEventListener('click', ()=> $('fFoto').click());
$('fFoto').addEventListener('change', e=> prepararFoto(e.target.files[0]));
['dragover','dragenter'].forEach(evt=>{
  $('fotoDrop').addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); $('fotoDrop').classList.add('over'); });
});
['dragleave','drop'].forEach(evt=>{
  $('fotoDrop').addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); $('fotoDrop').classList.remove('over'); });
});
$('fotoDrop').addEventListener('drop', e=> prepararFoto(e.dataTransfer.files[0]));
$('btnQuitarFoto').addEventListener('click', ()=>{
  fotoPendiente = null;
  if(!editandoId){ quitarFoto = false; $('fotoPreviewWrap').classList.add('hidden'); $('fotoDrop').classList.remove('hidden'); return; }
  quitarFoto = true;
  $('fotoPreviewWrap').classList.add('hidden');
  $('fotoDrop').classList.remove('hidden');
});

/* Cerrar modal con tecla Escape */
document.addEventListener('keydown', e=>{
  if(e.key==='Escape') cerrarForm();
});

/* Arranque */
async function initAdmin(){
  try{
    sb = await clienteSupabase();
    const { data: { session } } = await sb.auth.getSession();
    if(session) mostrarDash(); else mostrarLogin();

    sb.auth.onAuthStateChange((evt, ses)=>{
      if(ses) mostrarDash(); else mostrarLogin();
    });
  }catch(err){
    console.error(err);
    $('loginMsg').textContent = 'No se pudo conectar con Supabase. Revisa js/config.js';
  }
}
initAdmin();