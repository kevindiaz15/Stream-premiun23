/* =============================================================== */
/* STREAM PREMIUM23 · Tienda (Supabase)                            */
/* Carga cuentas, plataformas, stock, precios, promos y fotos.     */
/* Método de compra: pedido por WhatsApp + envío de la cuenta al   */
/* confirmar el pago.                                              */
/* =============================================================== */

let sb = null;
let cuentasDB = [];
let cuentasById = new Map();

const WHATSAPP_LINK = 'https://wa.me/message/XXXXXX';
const PREFIJO_WA = WHATSAPP_LINK;

let carrito = cargarCarrito();
let filtroActivo = 'todos';
let busqueda = '';
let cuentaAbierta = null;

const ETIQUETAS_CAT = {
  netflix:'Netflix', disney:'Disney+', hbomax:'HBO Max', prime:'Prime Video',
  spotify:'Spotify', youtube:'YouTube Premium', otras:'Otras plataformas'
};
const CAT_ICONOS = {
  netflix:'fa-tv', disney:'fa-film', hbomax:'fa-video', prime:'fa-box-open',
  spotify:'fa-music', youtube:'fa-play', otras:'fa-layer-group'
};

const formatCOP = n => n == null || n === '' ? 'Consultar' : '$' + Number(n).toLocaleString('es-CO');

/* Atributo onclick seguro: delimitado con comilla simple, JSON con dobles */
function attrClick(call){
  return 'onclick=\'' + String(call).replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\'';
}

/* =============================================================== */
/* STOCK                                                           */
/* =============================================================== */
function stockValor(p){
  return (p.stock == null || p.stock === '') ? null : Number(p.stock);
}
function agotado(p){
  const s = stockValor(p);
  return s != null && s <= 0;
}

/* =============================================================== */
/* PROMOCIONES                                                     */
/* =============================================================== */
function fechaVigente(ini, fin){
  if(!ini || !fin) return false;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return hoy >= new Date(ini + 'T00:00:00') && hoy <= new Date(fin + 'T23:59:59');
}
function precioInfo(p){
  const base = (p.precio == null || p.precio === '') ? null : Number(p.precio);
  const pct = Number(p.descuento_porcentaje) || 0;
  const vigente = pct > 0 && fechaVigente(p.promo_inicio, p.promo_fin);
  const final = (base != null && vigente) ? Math.round(base * (1 - pct / 100)) : base;
  const etiqueta = vigente ? (p.etiqueta_promo || 'Oferta') : (p.etiqueta || '');
  return { base, pct, vigente, final, etiqueta };
}

/* =============================================================== */
/* SUPABASE                                                        */
/* =============================================================== */
function clienteSupabase(){
  return import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
    .then(m => m.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key));
}
async function cargarCuentas(){
  const { data, error } = await sb
    .from('stream_accounts')
    .select('*')
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if(error) throw error;
  return data || [];
}

async function cargarBanners(){
  const { data, error } = await sb
    .from('banners')
    .select('*')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if(error) throw error;
  return data || [];
}

/* Guarda el pedido en Supabase sin bloquear el flujo de WhatsApp.
   Devuelve la fila insertada (incluye el codigo de seguimiento). */
async function registrarPedido(nombre, whatsapp, correo, detalles, mensaje_wa, metodo_pago, comprobante_url){
  if(!sb) return null;
  try{
    const { data, error } = await sb.from('solicitudes').insert([{ tipo:'pedido', nombre, whatsapp, correo, detalles, mensaje_wa, metodo_pago: metodo_pago||'', comprobante_url: comprobante_url||'', estado:'nueva' }]).select().single();
    if(error){ console.warn('No se pudo guardar el pedido en Supabase:', error.message); return null; }
    return data || null;
  }catch(e){
    console.warn('No se pudo guardar el pedido en Supabase:', e);
    return null;
  }
}

/* =============================================================== */
/* BANNERS PUBLICITARIOS (carrusel)                                */
/* =============================================================== */
let bannersDB = [];
let indiceBanner = 0;
let timerBanner = null;

function renderBanners(){
  const track = document.getElementById('bannerTrack');
  const dots = document.getElementById('bannerDots');
  const seccion = document.getElementById('banners');
  if(!bannersDB.length){
    seccion.style.display = 'none';
    return;
  }
  seccion.style.display = '';
  indiceBanner = 0;
  track.innerHTML = bannersDB.map((b, i)=>{
    const fondo = b.imagen_url
      ? 'background-image:url(\'' + b.imagen_url + '\')'
      : 'background:linear-gradient(135deg,var(--fucsia),var(--magenta))';
    let ext = '';
    if(b.enlace) ext = '<a class="banner-cta" href="' + b.enlace + '" target="_blank" rel="noopener">Ver más <i class="fa-solid fa-arrow-right"></i></a>';
    return '<div class="banner-slide' + (i===0?' active':'') + '" style="' + fondo + '">'+
      '<div class="banner-sombra"></div>'+
      '<div class="banner-info">'+
        (b.titulo ? '<h3>'+b.titulo+'</h3>' : '')+
        (b.subtitulo ? '<p>'+b.subtitulo+'</p>' : '')+
        ext+
      '</div>'+
    '</div>';
  }).join('');
  dots.innerHTML = bannersDB.map((b,i)=>
    '<button class="banner-dot' + (i===0?' active':'') + '" '+attrClick('irBanner('+i+')')+' aria-label="Banner '+(i+1)+'"></button>'
  ).join('');
  iniciarAutoBanner();
}

function moverBanner(d){
  if(!bannersDB.length) return;
  indiceBanner = (indiceBanner + d + bannersDB.length) % bannersDB.length;
  pintarBanner();
  reiniciarAutoBanner();
}
function irBanner(i){
  indiceBanner = i;
  pintarBanner();
  reiniciarAutoBanner();
}
function pintarBanner(){
  const track = document.getElementById('bannerTrack');
  const dots = document.getElementById('bannerDots');
  track.style.transform = 'translateX(-' + (indiceBanner * 100) + '%)';
  track.querySelectorAll('.banner-slide').forEach((el, i)=>el.classList.toggle('active', i===indiceBanner));
  if(dots) dots.querySelectorAll('.banner-dot').forEach((el, i)=>el.classList.toggle('active', i===indiceBanner));
}
function iniciarAutoBanner(){
  detenerAutoBanner();
  if(bannersDB.length < 2) return;
  timerBanner = setInterval(()=>moverBanner(1), 5000);
}
function detenerAutoBanner(){
  if(timerBanner){ clearInterval(timerBanner); timerBanner = null; }
}
function reiniciarAutoBanner(){
  detenerAutoBanner();
  iniciarAutoBanner();
}

/* =============================================================== */
/* PLATAFORMAS                                                     */
/* =============================================================== */
function renderPlataformas(){
  const cats = [['netflix','Netflix'],['disney','Disney+'],['hbomax','HBO Max'],['prime','Prime Video'],['spotify','Spotify'],['youtube','YouTube Premium'],['otras','Otras plataformas']];
  const grid = document.getElementById('catGrid');
  grid.innerHTML = cats.map(([clave,label])=>{
    const n = cuentasDB.filter(p=>p.activo && p.categoria===clave).length;
    return '<div class="cat-card" data-cat="'+clave+'" onclick="filtrarPorCategoria(\''+clave+'\')">'+
      '<div class="ico"><i class="fa-solid '+CAT_ICONOS[clave]+'"></i></div>'+
      '<h3>'+label+'</h3><small><b>'+n+'</b> cuenta'+(n===1?'':'s')+'</small></div>';
  }).join('');
}

/* =============================================================== */
/* CATÁLOGO                                                        */
/* =============================================================== */
function renderChips(){
  const chips = document.getElementById('chips');
  const opciones = [{k:'todos',v:'Todos'},...Object.entries(ETIQUETAS_CAT).map(([k,v])=>({k,v}))];
  chips.innerHTML = opciones.map(o=>
    '<button class="chip'+(filtroActivo===o.k?' active':'')+'" data-f="'+o.k+'" onclick="setFiltro(\''+o.k+'\')">'+o.v+'</button>'
  ).join('');
}

function cuentasFiltradas(){
  let lista = cuentasDB.filter(p=>p.activo);
  if(filtroActivo!=='todos') lista = lista.filter(p=>p.categoria===filtroActivo);
  if(busqueda){
    const q = busqueda.toLowerCase();
    lista = lista.filter(p=>
      (p.nombre||'').toLowerCase().includes(q) ||
      (p.descripcion||'').toLowerCase().includes(q) ||
      (ETIQUETAS_CAT[p.categoria]||'').toLowerCase().includes(q)
    );
  }
  return lista;
}

function infoTags(p){
  const info = precioInfo(p);
  let tags = '';
  if(info.vigente) tags += '<span class="tag promo">'+info.etiqueta+'</span>';
  else if(info.etiqueta) tags += '<span class="tag">'+info.etiqueta+'</span>';
  if(agotado(p)) tags += '<span class="tag soldout">Agotado</span>';
  else{
    const s = stockValor(p);
    if(s != null && s > 0 && s <= 5) tags += '<span class="tag stocktag">Quedan '+s+'</span>';
  }
  return tags;
}
function precioPillHTML(p){
  const info = precioInfo(p);
  if(info.base == null) return '<span class="price-pill"><span style="color:var(--dorado)">Consultar</span></span>';
  if(info.vigente) return '<span class="price-pill promo"><span class="p-old">'+formatCOP(info.base)+'</span>'+formatCOP(info.final)+'</span>';
  return '<span class="price-pill">'+formatCOP(info.base)+'</span>';
}
function arteCuenta(p){
  let interior = '<div class="art-placeholder"><i class="fa-solid fa-tv"></i></div>';
  if(p.foto_url) interior = '<img class="art-img" src="'+p.foto_url+'" alt="'+(p.nombre||'')+'" loading="lazy" onerror="this.remove()">';
  return '<div class="art">'+interior+infoTags(p)+precioPillHTML(p)+'</div>';
}

function renderCatalogo(){
  const grid = document.getElementById('productGrid');
  const vacio = document.getElementById('emptyState');
  const lista = cuentasFiltradas();

  if(!lista.length){
    grid.innerHTML = '';
    if(!cuentasDB.length){
      vacio.querySelector('h3').textContent = 'Próximamente';
      vacio.querySelector('p').textContent = 'Estamos cargando nuestro catálogo de cuentas premium.';
    }else{
      vacio.querySelector('h3').textContent = 'No encontramos cuentas';
      vacio.querySelector('p').textContent = 'Intenta con otra palabra o pulsa el botón para ver todo el catálogo.';
    }
    vacio.classList.add('show');
    return;
  }
  vacio.classList.remove('show');
  grid.innerHTML = lista.map(p=>{
    const off = agotado(p);
    return '<article class="product-card reveal visible" data-id="'+String(p.id)+'">'+
      arteCuenta(p) +
      '<div class="product-body">'+
        '<h3>'+p.nombre+'</h3>'+
        '<div class="aroma"><i class="fa-solid '+CAT_ICONOS[p.categoria]+'"></i>'+(ETIQUETAS_CAT[p.categoria]||'')+'</div>'+
        '<p>'+(p.descripcion||'')+'</p>'+
        '<div class="meta"><i class="fa-solid fa-shield-halved"></i>'+(p.garantia || 'Con garantía')+'</div>'+
        '<div class="product-actions">'+
          '<button class="btn-sm btn-details" '+attrClick('abrirCuenta('+JSON.stringify(String(p.id))+')')+'><i class="fa-solid fa-eye"></i> Detalles</button>'+
          (off
            ? '<button class="btn-sm btn-add off" disabled><i class="fa-solid fa-ban"></i> Agotado</button>'
            : '<button class="btn-sm btn-add" '+attrClick('agregarRapido('+JSON.stringify(String(p.id))+',this)')+'><i class="fa-solid fa-plus"></i> Agregar</button>')+
        '</div>'+
      '</div>'+
    '</article>';
  }).join('');
}

function setFiltro(k){
  filtroActivo = k;
  renderChips(); renderCatalogo();
  document.querySelectorAll('.cat-card').forEach(c=>c.classList.toggle('active', c.dataset.cat===k));
}
function filtrarPorCategoria(clave){
  setFiltro(clave);
  document.getElementById('catalogo').scrollIntoView({behavior:'smooth'});
}
function resetFilters(){
  filtroActivo = 'todos'; busqueda = '';
  document.getElementById('searchInput').value = '';
  renderChips(); renderCatalogo(); renderPlataformas();
}

/* Búsqueda */
document.getElementById('searchInput').addEventListener('input', e=>{
  busqueda = e.target.value.trim();
  renderCatalogo();
});

/* =============================================================== */
/* MODAL DETALLE DE CUENTA                                         */
/* =============================================================== */
function abrirCuenta(id){
  const p = cuentasById.get(id);
  if(!p) return;
  cuentaAbierta = p;
  document.getElementById('pmHead').innerHTML = p.foto_url
    ? '<img src="'+p.foto_url+'" alt="'+p.nombre+'">'
    : '<div class="pm-placeholder"><i class="fa-solid fa-tv"></i></div>';

  const planes = ['1 mes','3 meses','6 meses','12 meses'];
  const ops = planes.map(o=>'<option>'+o+'</option>').join('');
  const info = precioInfo(p);
  const prec = info.base == null
    ? '<span style="color:var(--fucsia)">Consultar</span>'
    : (info.vigente ? '<span class="p-old">'+formatCOP(info.base)+'</span>'+formatCOP(info.final) : formatCOP(info.base));
  const off = agotado(p);

  document.getElementById('pmBody').innerHTML =
    '<h3>'+p.nombre+'</h3>'+
    '<div class="pm-aroma"><i class="fa-solid '+CAT_ICONOS[p.categoria]+'"></i>Plataforma: '+(ETIQUETAS_CAT[p.categoria]||'')+'</div>'+
    '<div class="pm-price">'+prec+'</div>'+
    '<p class="pm-desc">'+(p.descripcion||'')+'</p>'+
    '<div class="pm-meta">'+
      '<span class="pill '+(off?'sold':'')+'"><i class="fa-solid fa-boxes-stacked"></i>'+(off?'Agotada':(stockValor(p)==null?'Stock disponible':'Quedan '+stockValor(p)))+'</span>'+
      '<span class="pill"><i class="fa-solid fa-shield-halved"></i>'+(p.garantia||'Con garantía')+'</span>'+
    '</div>'+
    '<div class="pm-garantia"><i class="fa-solid fa-circle-info"></i><span>'+(p.garantia||'Garantía de reemplazo según las condiciones de uso.')+'</span></div>'+
    '<div class="modal-field"><label>Duración del plan</label>'+
    '<select id="pmPresent">'+ops+'</select></div>'+
    '<div class="qty-row"><span style="font-weight:600;font-size:.9rem;">Cantidad</span>'+
      '<div class="stepper">'+
        '<button class="step" onclick="cambiarCantModal(-1)"><i class="fa-solid fa-minus"></i></button>'+
        '<span class="n" id="pmQty">1</span>'+
        '<button class="step" onclick="cambiarCantModal(1)"><i class="fa-solid fa-plus"></i></button>'+
      '</div></div>'+
    '<div class="pm-total"><div><small>Subtotal</small><br><b id="pmSubtotal"></b></div>'+
    '<i class="fa-solid fa-fire-flame-curved" style="color:var(--dorado);font-size:1.4rem;"></i></div>'+
    (off
      ? '<button class="btn btn-primary btn-block" disabled><i class="fa-solid fa-ban"></i> Agotada</button>'
      : '<button class="btn btn-primary btn-block" onclick="agregarDesdeModal()"><i class="fa-solid fa-bag-shopping"></i> Agregar al pedido</button>');

  actualizarSubtotalModal();
  document.getElementById('productModal').classList.add('open');
  document.body.style.overflow='hidden';
}

function subtotalFinalDeCuenta(){
  const p = cuentaAbierta;
  const c = parseInt(document.getElementById('pmQty').textContent)||1;
  const info = precioInfo(p);
  return { c, info };
}
function actualizarSubtotalModal(){
  const { c, info } = subtotalFinalDeCuenta();
  document.getElementById('pmSubtotal').textContent = info.base == null ? 'Consultar' : formatCOP(info.final * c);
  return c;
}
function cambiarCantModal(d){
  const el = document.getElementById('pmQty');
  let n = parseInt(el.textContent)+d;
  if(n<1) n=1;
  el.textContent = n;
  actualizarSubtotalModal();
}
function agregarDesdeModal(){
  const p = cuentaAbierta;
  const c = actualizarSubtotalModal();
  const plan = document.getElementById('pmPresent').value;
  agregarCuenta(p.id, c, plan);
  toast('<strong>'+p.nombre+'</strong> agregada a tu pedido','success');
  cerrarCuenta();
}
function agregarRapido(id, btn){
  const p = cuentasById.get(id);
  if(!p) return;
  if(agotado(p)){ toast('<strong>'+p.nombre+'</strong> está agotada actualmente','warn'); return; }
  const card = btn.closest('.product-card');
  card.classList.remove('adding'); void card.offsetWidth; card.classList.add('adding');
  agregarCuenta(id, 1, '1 mes');
  toast('<strong>'+p.nombre+'</strong> agregada a tu pedido','success');
}
function cerrarCuenta(){
  document.getElementById('productModal').classList.remove('open');
  if(!document.getElementById('orderModal').classList.contains('open') &&
     !document.getElementById('cartDrawer').classList.contains('open')) document.body.style.overflow='';
}

/* =============================================================== */
/* CARRITO Y PEDIDO                                                */
/* =============================================================== */
function cargarCarrito(){
  try{
    const raw = localStorage.getItem('stream23_pedido');
    let lista = raw ? JSON.parse(raw) : [];
    lista.forEach(l=>{ if(!l.clave) l.clave = String(l.id) + '|' + (l.plan || '1 mes'); });
    return Array.isArray(lista) ? lista : [];
  }catch(e){ return []; }
}
function guardarCarrito(){
  localStorage.setItem('stream23_pedido', JSON.stringify(carrito));
  renderCart(); actualizarBadges();
}

function agregarCuenta(id, cantidad, plan){
  const p = cuentasById.get(id);
  if(!p) return;
  if(agotado(p)){ toast('<strong>'+p.nombre+'</strong> está agotada actualmente','warn'); return; }
  const clave = String(id) + '|' + (plan || '');
  const existente = carrito.find(l=>l.clave===clave);
  const linea = {
    clave, id:String(id),
    name:p.nombre, price:(p.precio==null||p.precio==='') ? null : Number(p.precio),
    descuento_porcentaje:Number(p.descuento_porcentaje)||0,
    promo_inicio:p.promo_inicio||null, promo_fin:p.promo_fin||null,
    etiqueta_promo:p.etiqueta_promo||'',
    plataforma:(ETIQUETAS_CAT[p.categoria]||p.categoria||''), foto_url:p.foto_url||'',
    plan, qty:cantidad
  };
  if(existente) existente.qty += cantidad;
  else carrito.push(linea);
  guardarCarrito(); actualizarBadges(true);
}
function cambiarCantidad(clave, delta){
  const l = carrito.find(x=>x.clave===clave);
  if(!l) return;
  l.qty += delta;
  if(l.qty<1) l.qty=1;
  guardarCarrito();
}
function eliminarItem(clave){
  const l = carrito.find(x=>x.clave===clave);
  carrito = carrito.filter(x=>x.clave!==clave);
  guardarCarrito();
  toast('<strong>'+(l?l.name:'Producto')+'</strong> eliminado del pedido','warn');
}
function contarItems(){
  return carrito.reduce((a,l)=>a+l.qty,0);
}
function comprimirCarrito(){
  const out = [];
  carrito.forEach(l=>{
    const e = out.find(x=>x.clave===l.clave);
    if(e) e.qty+=l.qty; else out.push(Object.assign({}, l));
  });
  return out;
}
function infoViva(linea){
  const viva = cuentasById.get(linea.id);
  if(viva) return viva;
  return linea;
}
function subtotalLinea(linea){
  const info = precioInfo(infoViva(linea));
  return info.final == null ? null : info.final * linea.qty;
}

function renderCart(){
  const body = document.getElementById('drawerBody');
  const foot = document.getElementById('drawerFoot');
  if(!carrito.length){
    body.innerHTML = '<div class="cart-empty"><i class="fa-solid fa-tv"></i><h4 style="margin-bottom:.4rem;">Tu pedido está vacío</h4><p style="font-size:.85rem;">Explora el catálogo y agrega las cuentas que más te interesen.</p></div>';
    foot.innerHTML = '<button class="btn btn-primary btn-block" onclick="cerrarPedido();document.getElementById(\'catalogo\').scrollIntoView({behavior:\'smooth\'})"><i class="fa-solid fa-tv"></i> Ver catálogo</button>';
    return;
  }

  const items = carrito.map(l=>{
    const p = infoViva(l);
    const info = precioInfo(p);
    const foto = p.foto_url || l.foto_url;
    const thumb = foto
      ? '<img src="'+foto+'" alt="'+(p.nombre||l.name)+'">'
      : '<i class="fa-solid fa-tv"></i>';
    const precioStr = info.base == null ? 'Consultar' : (info.vigente ? '<span class="p-old">'+formatCOP(info.base)+'</span>'+formatCOP(info.final) : formatCOP(info.base));
    const sub = info.final == null ? '' : '<span class="sub">'+formatCOP(info.final * l.qty)+'</span>';
    return '<div class="cart-item">'+
      '<div class="thumb">'+thumb+'</div>'+
      '<div class="info">'+
        '<div class="nm">'+(p.nombre||l.name)+'</div>'+
        '<div class="pr">'+precioStr+' · '+(l.plataforma||'')+'</div>'+
        '<div class="present">'+l.plan+'</div>'+
        '<div class="line">'+
          '<div class="mini-step">'+
            '<button '+attrClick('cambiarCantidad('+JSON.stringify(l.clave)+',-1)')+' aria-label="Restar"><i class="fa-solid fa-minus"></i></button>'+
            '<span class="qn">'+l.qty+'</span>'+
            '<button '+attrClick('cambiarCantidad('+JSON.stringify(l.clave)+',1)')+' aria-label="Sumar"><i class="fa-solid fa-plus"></i></button>'+
          '</div>'+sub+
          '<button class="remove" '+attrClick('eliminarItem('+JSON.stringify(l.clave)+')')+' title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>'+
        '</div>'+
      '</div></div>';
  }).join('');

  const subtotales = carrito.map(subtotalLinea).filter(x=>x!=null);
  const sub = subtotales.reduce((a,x)=>a+x,0);
  const hayConsultar = carrito.some(l=>precioInfo(infoViva(l)).final == null);

  body.innerHTML = items;
  foot.innerHTML =
    '<div class="row"><span>Subtotal</span><span>'+formatCOP(sub)+'</span></div>'+
    (hayConsultar?'<div class="row" style="color:var(--fucsia);font-style:italic;"><span>Planes especiales</span><span>Consultar</span></div>':'')+
    '<div class="row total"><span>Total estimado</span><b>'+(hayConsultar ? formatCOP(sub)+' + consulta' : formatCOP(sub))+'</b></div>'+
    '<div class="note"><i class="fa-solid fa-circle-info"></i><span>La cuenta se entrega por WhatsApp una vez confirmado el pago.</span></div>'+
    '<button class="btn btn-primary btn-block" onclick="abrirSolicitudPedido()"><i class="fa-solid fa-paper-plane"></i> Solicitar pedido</button>';
}

function actualizarBadges(pop){
  const n = contarItems();
  const badge = document.getElementById('cartBadge');
  const fbadge = document.getElementById('fBadge');
  badge.textContent = n;
  fbadge.textContent = n;
  badge.classList.toggle('show', n>0);
  fbadge.style.display = n>0?'':'none';
  if(pop){
    badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop');
  }
}

/* Drawer */
function abrirPedido(e){
  if(e) e.preventDefault();
  renderCart();
  document.getElementById('cartDrawer').classList.add('open');
  document.body.style.overflow='hidden';
}
function cerrarPedido(){
  document.getElementById('cartDrawer').classList.remove('open');
  if(!document.getElementById('productModal').classList.contains('open') &&
     !document.getElementById('orderModal').classList.contains('open')) document.body.style.overflow='';
}
function toggleMenu(){
  document.getElementById('hamburger').classList.toggle('open');
  document.getElementById('navLinks').classList.toggle('open');
}
document.getElementById('navLinks').addEventListener('click', e=>{
  if(e.target.closest('a')){ document.getElementById('hamburger').classList.remove('open'); document.getElementById('navLinks').classList.remove('open'); }
});

/* =============================================================== */
/* SOLICITAR PEDIDO (formulario)                                   */
/* =============================================================== */
function abrirSolicitudPedido(){
  if(!carrito.length){
    toast('Tu pedido está vacío. Agrega algunas cuentas primero','warn');
    return;
  }
  cerrarPedido();
  document.getElementById('orderForm').reset();
  document.getElementById('orderForm')._abierto = Date.now();
  document.getElementById('orderSuccess').classList.remove('show');
  document.getElementById('orderFormView').style.display='';
  document.querySelectorAll('.field .msg').forEach(m=>m.classList.remove('show'));
  document.querySelectorAll('.field input,.field select,.field textarea').forEach(el=>el.classList.remove('err'));
  limpiarComprobanteUI(true);

  const comp = comprimirCarrito();
  const subtotales = comp.map(subtotalLinea).filter(x=>x!=null);
  const sub = subtotales.reduce((a,x)=>a+x,0);
  const hayConsultar = comp.some(l=>precioInfo(infoViva(l)).final == null);
  const lineas = comp.map(l=>'<div class="rl"><span>'+l.name+' × '+l.qty+'</span><span>'+ (subtotalLinea(l)==null?'Consultar':formatCOP(subtotalLinea(l))) +'</span></div>').join('');
  document.getElementById('orderResume').innerHTML =
    '<h4><i class="fa-solid fa-bag-shopping"></i> Resumen de tu pedido</h4>'+lineas+
    '<div class="rl total"><span>Total estimado</span><b>'+(hayConsultar?'Consultar':formatCOP(sub))+'</b></div>';

  document.getElementById('orderModal').classList.add('open');
  document.body.style.overflow='hidden';
}
function cerrarPedidoModal(){
  document.getElementById('orderModal').classList.remove('open');
  if(!document.getElementById('productModal').classList.contains('open') &&
     !document.getElementById('cartDrawer').classList.contains('open')) document.body.style.overflow='';
}

/* Validación simple */
function campoError(id, cond){
  const el = document.getElementById(id);
  const msg = el.parentElement.querySelector('.msg');
  const bad = !cond;
  el.classList.toggle('err', bad);
  if(msg) msg.classList.toggle('show', bad);
  return bad;
}
function validarEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

/* =============================================================== */
/* COMPROBANTE DE PAGO                                             */
/* =============================================================== */
let comprobanteFile = null;

function limpiarComprobanteUI(resetSel){
  comprobanteFile = null;
  if(resetSel) document.getElementById('oMetodoPago').value = '';
  const file = document.getElementById('capFile');
  if(file) file.value = '';
  const prev = document.getElementById('capPreviewWrap');
  const drop = document.getElementById('capDrop');
  if(prev){ prev.classList.add('hidden'); prev.querySelector('img').removeAttribute('src'); }
  if(drop) drop.classList.remove('hidden');
}

function prepararComprobante(file){
  if(!file) return;
  if(!file.type.startsWith('image/')){
    toast('El comprobante debe ser una imagen','warn');
    return;
  }
  if(file.size > 5 * 1024 * 1024){
    toast('El comprobante supera los 5 MB','warn');
    return;
  }
  comprobanteFile = file;
  document.getElementById('capPreview').src = URL.createObjectURL(file);
  document.getElementById('capPreviewWrap').classList.remove('hidden');
  document.getElementById('capDrop').classList.add('hidden');
}

async function subirComprobante(file){
  const nombre = 'c' + Date.now() + '_' + Math.random().toString(36).slice(2, 10) + '.img';
  const { error } = await sb.storage.from('comprobantes').upload(nombre, file, { upsert: true });
  if(error) throw error;
  return sb.storage.from('comprobantes').getPublicUrl(nombre).data.publicUrl;
}

document.getElementById('capDrop').addEventListener('click', ()=> document.getElementById('capFile').click());
document.getElementById('capFile').addEventListener('change', e=> prepararComprobante(e.target.files[0]));
['dragover','dragenter'].forEach(evt=>{
  document.getElementById('capDrop').addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); document.getElementById('capDrop').classList.add('over'); });
});
['dragleave','drop'].forEach(evt=>{
  document.getElementById('capDrop').addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); document.getElementById('capDrop').classList.remove('over'); });
});
document.getElementById('capDrop').addEventListener('drop', e=> prepararComprobante(e.dataTransfer.files[0]));
document.getElementById('capQuitar').addEventListener('click', e=>{ e.stopPropagation(); limpiarComprobanteUI(false); });

/* =============================================================== */
/* ANTI-SPAM                                                       */
/* =============================================================== */
const ANTI_KEY = 'stream23_anti_spam_1';
function antiSpam(form){
  const hp = form.querySelector('.hp-field');
  if(hp && hp.value.trim() !== '') return 'spam';
  const desde = form._abierto || 0;
  if(desde && (Date.now() - desde) < 3500) return 'spam';
  const last = parseInt(localStorage.getItem(ANTI_KEY)||'0', 10);
  if(Date.now() - last < 60000) return 'again';
  localStorage.setItem(ANTI_KEY, String(Date.now()));
  return 'ok';
}

document.getElementById('orderForm').addEventListener('submit', async function(e){
  e.preventDefault();
  let ok = true;
  ok = !campoError('oNombre', document.getElementById('oNombre').value.trim().length>=2) && ok;
  ok = !campoError('oWhats', /^[0-9]{7,12}$/.test((document.getElementById('oWhats').value||'').replace(/[^0-9]/g,''))) && ok;
  ok = !campoError('oCorreo', validarEmail(document.getElementById('oCorreo').value.trim())) && ok;
  const metodo = document.getElementById('oMetodoPago').value;
  ok = !campoError('oMetodoPago', metodo !== '') && ok;
  const capMsg = document.querySelector('.comprobante-zone + .msg');
  if(!comprobanteFile){
    ok = false;
    if(capMsg) capMsg.classList.add('show');
  }else{
    if(capMsg) capMsg.classList.remove('show');
  }
  if(!ok){ toast('Revisa los campos marcados','warn'); return; }

  const proteccion = antiSpam(this);
  if(proteccion !== 'ok'){
    if(proteccion === 'again'){ toast('Ya enviaste un pedido recientemente. Te contactaremos pronto.','warn'); return; }
    document.getElementById('orderFormView').style.display='none';
    document.getElementById('orderSuccess').classList.add('show');
    toast('¡Pedido recibido con éxito!','success');
    return;
  }

  const nombre = document.getElementById('oNombre').value.trim();
  const comp = comprimirCarrito();
  const subtotales = comp.map(subtotalLinea).filter(x=>x!=null);
  const sub = subtotales.reduce((a,x)=>a+x,0);
  const hayConsultar = comp.some(l=>precioInfo(infoViva(l)).final == null);

  let prod = '';
  comp.forEach(l=>{ prod += '\n* '+l.name+' ('+l.plan+') x'+l.qty+(subtotalLinea(l)==null?' (Consultar)':' '+formatCOP(subtotalLinea(l))); });

  let msg = 'Hola, Stream Premium23.\n\nQuiero realizar un pedido.\n\nNombre: '+nombre+'\nMétodo de pago: '+metodo+'\nCuentas:'+prod+
    '\n\nTotal estimado: '+(hayConsultar?'Consultar':formatCOP(sub))+
    '\n\nAdjunto el comprobante de mi pago para tu confirmación y el envío de la cuenta. Gracias.';

  const btn = this.querySelector('button[type="submit"]');
  if(btn){ btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando…'; }

  try{
    let comprobante_url = '';
    if(comprobanteFile) comprobante_url = await subirComprobante(comprobanteFile);

    const fila = await registrarPedido(
      nombre,
      (document.getElementById('oWhats').value||'').trim(),
      (document.getElementById('oCorreo').value||'').trim(),
      {
        items: comp.map(l=>({ id: String(l.id), nombre: l.name, plan: l.plan||'', plataforma: l.plataforma||'', cantidad: l.qty, subtotal: subtotalLinea(l) })),
        total: hayConsultar ? null : sub
      },
      msg,
      metodo,
      comprobante_url
    );

    const codigo = fila && fila.codigo ? fila.codigo : '';
    let msgWA = msg;
    if(codigo) msgWA += '\n\nNo. de seguimiento: '+codigo+' (guárdalo para tu garantía)';
    document.getElementById('waOrderBtn').href = PREFIJO_WA+'?text='+encodeURIComponent(msgWA);

    const oc = document.getElementById('orderCode');
    if(oc){
      if(codigo){ oc.style.display=''; oc.querySelector('b').textContent = codigo; }
      else oc.style.display='none';
    }

    document.getElementById('orderFormView').style.display='none';
    document.getElementById('orderSuccess').classList.add('show');
    carrito = [];
    guardarCarrito();
    toast('¡Pedido recibido con éxito!','success');
  }catch(err){
    console.error('Error enviando el pedido', err);
    toast('No se pudo enviar tu pedido. Intenta de nuevo.','warn');
    if(btn){ btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar solicitud'; }
  }
});

/* =============================================================== */
/* TOASTS                                                          */
/* =============================================================== */
function toast(mensaje, tipo){
  const cont = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast '+(tipo||'');
  t.innerHTML = '<i class="fa-solid '+(tipo==='warn'?'fa-triangle-exclamation':tipo==='success'?'fa-circle-check':'fa-fire-flame-curved')+' ic"></i><span>'+mensaje+'</span>';
  cont.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{
    t.classList.remove('show');
    setTimeout(()=>t.remove(),500);
  },2800);
}

/* =============================================================== */
/* REVEAL AL SCROLL + ESC                                           */
/* =============================================================== */
const io = new IntersectionObserver((entries)=>{
  entries.forEach(en=>{
    if(en.isIntersecting){
      en.target.classList.add('visible');
      io.unobserve(en.target);
    }
  });
},{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));

document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
    cerrarCuenta(); cerrarPedido(); cerrarPedidoModal();
    document.getElementById('hamburger').classList.remove('open');
    document.getElementById('navLinks').classList.remove('open');
  }
});

/* =============================================================== */
/* CONSULTA DE ESTADO POR CÓDIGO                                  */
/* =============================================================== */
const ESTADO_COMPRA = {
  nueva:'En revisión', vista:'En revisión', atendida:'Entregada',
  garantia:'En garantía', cerrada:'Cerrada'
};

async function consultarPedido(){
  const inp = document.getElementById('consCodigo');
  if(!inp) return;
  const codigo = (inp.value||'').trim().toUpperCase();
  const res = document.getElementById('consResult');
  if(!codigo){ toast('Ingresa tu código de compra (SP-XXXXXX)','warn'); if(res) res.innerHTML=''; return; }
  if(res) res.innerHTML = '<div class="cons-loading"><i class="fa-solid fa-spinner fa-spin"></i> Consultando tu pedido…</div>';
  try{
    const { data, error } = await sb.rpc('consultar_pedido', { p_codigo: codigo });
    if(error) throw error;
    if(!data || !data.length){
      if(res) res.innerHTML = '<div class="cons-empty"><i class="fa-solid fa-circle-question"></i><p>No encontramos un pedido con ese código.<br>Verifica que esté bien escrito e inténtalo de nuevo.</p></div>';
      return;
    }
    const p = data[0];
    const label = ESTADO_COMPRA[p.estado] || p.estado || '';
    const art = p.estado==='garantia' ? '<i class="fa-solid fa-shield-halved"></i>' :
                p.estado==='atendida' ? '<i class="fa-solid fa-circle-check"></i>' :
                p.estado==='cerrada' ? '<i class="fa-solid fa-lock"></i>' :
                '<i class="fa-regular fa-clock"></i>';
    const items = (Array.isArray(p.items)?p.items:[]).map(it=>
      '<div class="rl"><span>'+esc_html(it.nombre||'')+(it.plan?' <em>· '+esc_html(it.plan)+'</em>':'')+' × '+(it.cantidad||1)+'</span><span>'+(it.subtotal==null?'Consultar':formatCOP(it.subtotal))+'</span></div>'
    ).join('');
    const resumen = items ? '<div class="cons-items"><h4><i class="fa-solid fa-bag-shopping"></i> Tu pedido</h4>'+items+(p.total!=null?'<div class="rl total"><span>Total</span><b>'+formatCOP(p.total)+'</b></div>':'')+'</div>' : '';
    if(res) res.innerHTML =
      '<div class="cons-card">'+
        '<div class="cons-head">'+
          '<div><small>Código</small><b>'+esc_html(p.codigo)+'</b></div>'+
          '<span class="cons-pill '+esc_html(p.estado)+'">'+art+' '+label+'</span>'+
        '</div>'+
        '<div class="cons-meta">'+
          '<span><i class="fa-regular fa-calendar"></i> Solicitud: '+new Date(p.creado).toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'})+'</span>'+
          (p.fecha_cierre?'<span><i class="fa-solid fa-circle-check"></i> Entregada: '+new Date(p.fecha_cierre).toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'})+'</span>':'')+
          (p.fecha_garantia?'<span><i class="fa-solid fa-shield-halved"></i> Garantía desde: '+new Date(p.fecha_garantia).toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'})+'</span>':'')+
          (p.metodo_pago?'<span><i class="fa-solid fa-wallet"></i> '+esc_html(p.metodo_pago)+'</span>':'')+
        '</div>'+
        resumen+
      '</div>';
  }catch(err){
    console.error('Error consultando pedido', err);
    if(res) res.innerHTML = '<div class="cons-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Ocurrió un error al consultar. Intenta de nuevo en unos segundos.</p></div>';
  }
}

function esc_html(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* =============================================================== */
/* INICIALIZACIÓN                                                   */
/* =============================================================== */
async function init(){
  try{
    sb = await clienteSupabase();
    document.getElementById('orderForm')._abierto = Date.now();
    cuentasDB = await cargarCuentas();
    cuentasById = new Map(cuentasDB.map(p=>[String(p.id), p]));
    renderPlataformas();
    renderChips();
    renderCatalogo();
    renderCart();
    actualizarBadges();
  }catch(err){
    console.error('Error cargando catálogo', err);
    const vacio = document.getElementById('emptyState');
    vacio.querySelector('h3').textContent = 'No pudimos cargar el catálogo';
    vacio.querySelector('p').textContent = 'Revisa tu conexión o intenta de nuevo en unos segundos.';
    const btn = vacio.querySelector('button');
    btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Reintentar';
    btn.onclick = ()=>{ location.reload(); };
    vacio.classList.add('show');
  }
  try{
    bannersDB = await cargarBanners();
    renderBanners();
  }catch(err){
    console.warn('Error cargando banners', err);
    const seccion = document.getElementById('banners');
    if(seccion) seccion.style.display = 'none';
  }
}
init();