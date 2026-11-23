(() => {
'use strict';

/* ============ utilidades ============ */
const KEY = 'zenzana-inventario-v2';
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
const money = n => (n < -0.5 ? '-' : '') + '$' + nf0.format(Math.abs(Math.round(n || 0)));
const moneyU = n => '$' + nf2.format(n || 0);
const qty = n => nf1.format(n || 0);
const pct = n => nf0.format(Math.round((n || 0) * 100)) + '%';
const r4 = x => Math.round(x * 1e4) / 1e4;
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; };
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => iso(new Date());
const fmtDate = s => { const [y, m, d] = s.split('-'); return `${d}-${m}-${y}`; };
const normName = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const CAT = { tratamiento: 'Tratamiento', limpieza: 'Limpieza', desechable: 'Desechable' };
const UNITS = ['ml', 'gr', 'un'];
const LINES = ['Limpiezas', 'Skinboost', 'Peeling químico', 'Ciclo Zenzana', 'Otros'];

/* ============ datos y bóveda cifrada ============ */
const VKEY = 'zenzana-vault-v1', OLDKEY = 'zenzana-inventario-v2';
const emptyData = () => ({ v: 2, cfg: { sueldo: 0, horas: 120, margen: 0.3, comision: 0, desc: 0.1 }, fijos: [], products: [], treatments: [], packs: [], sessions: [], usos: [], meta: { lastBackup: null } });
let S = emptyData();
const vault = { key: null, salt: null, iter: 600000 };

const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pass, salt, iter) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encStr(str, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(str));
  return { iv: b64(iv), data: b64(ct) };
}
async function decStr(env, key) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data));
  return new TextDecoder().decode(pt);
}
let saving = Promise.resolve();
function save() {
  if (!vault.key) return;
  const snap = JSON.stringify(S), key = vault.key, salt = vault.salt, iter = vault.iter;
  saving = saving.then(() => encStr(snap, key))
    .then(env => localStorage.setItem(VKEY, JSON.stringify({ v: 1, salt, iter, ...env })))
    .catch(() => toast('No se pudo guardar: sin espacio o modo privado'));
}

const prod = id => S.products.find(p => p.id === id);
const tById = id => S.treatments.find(t => t.id === id);
const unitCost = p => (p && p.buyQty > 0 ? p.price / p.buyQty : 0);
const itemsCost = items => sum(items, i => unitCost(prod(i.pid)) * num(i.amount));
const isLow = p => p.stock <= 0 || (p.min > 0 && p.stock <= p.min);

/* ---- costos: insumos + tu hora + gastos fijos (igual que la planilla) ---- */
function rates() {
  const h = num(S.cfg.horas), tot = sum(S.fijos, f => num(f.amount));
  return { h, fijosTot: tot, hora: h > 0 ? num(S.cfg.sueldo) / h : 0, fijoHora: h > 0 ? tot / h : 0 };
}
function costOf(items, min, price) {
  const r = rates(), m = num(min), p = num(price);
  const ins = itemsCost(items), mo = m / 60 * r.hora, fj = m / 60 * r.fijoHora, total = ins + mo + fj;
  const com = p * num(S.cfg.comision), ut = p - com - total, den = 1 - num(S.cfg.margen) - num(S.cfg.comision);
  return { ins, mo, fj, total, com, price: p, ut, mg: p > 0 ? ut / p : null, sug: den > 0 ? total / den : 0 };
}
const tCost = t => costOf(t.items, t.min, t.price);
function packPrice(pk) {
  if (!pk.auto) return num(pk.price);
  const p0 = pk.parts[0], t = p0 && tById(p0.tid);
  return t ? p0.qty * t.price * (1 - num(S.cfg.desc)) : 0;
}
function packInfo(pk) {
  let ins = 0, mo = 0, fj = 0;
  pk.parts.forEach(p => { const t = tById(p.tid); if (!t) return; const c = tCost(t); ins += c.ins * p.qty; mo += c.mo * p.qty; fj += c.fj * p.qty; });
  const price = packPrice(pk), total = ins + mo + fj, com = price * num(S.cfg.comision), ut = price - com - total;
  const den = 1 - num(S.cfg.margen) - num(S.cfg.comision);
  return { n: sum(pk.parts, p => p.qty), ins, mo, fj, total, com, price, ut, mg: price > 0 ? ut / price : null, sug: den > 0 ? total / den : 0 };
}
const mgClass = mg => mg == null ? '' : mg < 0 ? 'neg' : mg < num(S.cfg.margen) ? 'mid' : 'pos';
const mgText = mg => mg == null ? 'sin precio' : pct(mg) + ' margen';

/* ============ estado de interfaz ============ */
const ui = { tab: 'sesion', cat: 'all', q: '', period: 'mes', tview: 'servicios' };
let draft = null, toastFn = null, toastT = null;

/* ============ vistas ============ */
const head = (title, sub) => `<header class="top"><div class="brand">Zenzana · Ritual Beauty Studio</div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</header>`;
const costTable = c => `<div class="ctable">
  <div><span>Insumos</span><b>${money(c.ins)}</b></div>
  <div><span>Tu hora de trabajo</span><b>${money(c.mo)}</b></div>
  <div><span>Gastos fijos</span><b>${money(c.fj)}</b></div>
  ${c.com ? `<div><span>Comisión de pago</span><b>${money(c.com)}</b></div>` : ''}
  <div class="tot"><span>Costo total</span><b>${money(c.total + c.com)}</b></div>
  <div><span>Utilidad</span><b class="${c.ut >= 0 ? 'pos' : 'neg'}">${money(c.ut)}</b></div>
  <div><span>Margen</span><b class="${mgClass(c.mg)}">${c.mg == null ? '—' : pct(c.mg)}</b></div>
  <div><span>Precio sugerido (margen ${pct(num(S.cfg.margen))})</span><b>${money(c.sug)}</b></div></div>`;

function lineGroups() {
  const m = {};
  S.treatments.forEach(t => (m[t.line || 'Otros'] = m[t.line || 'Otros'] || []).push(t));
  return [...LINES.filter(l => m[l]), ...Object.keys(m).filter(l => !LINES.includes(l))].map(l => [l, m[l]]);
}

function vSesion() {
  const recent = [...S.sessions].sort((a, b) => b.ts - a.ts).slice(0, 6);
  const stale = S.meta.lastBackup ? Date.now() - S.meta.lastBackup > 14 * 864e5 : S.sessions.length >= 5;
  let h = head('Registrar sesión', 'Toca un tratamiento y se descuentan los productos usados.');
  if (!S.products.length) {
    h += `<div class="empty"><b>Primero carga tu inventario</b>Carga tu archivo de datos de Zenzana, importa tu Excel o agrega productos a mano.<br><button class="btn" data-action="goRestore">Cargar archivo de datos</button><br><button class="btn ghost" style="margin-top:8px" data-action="goImport">Importar mi Excel</button></div>`;
  } else if (!S.treatments.length) {
    h += `<div class="empty"><b>Crea tu primer tratamiento</b>Define su precio, duración y los productos que gasta.<br><button class="btn" data-action="newTreat">Crear tratamiento</button></div>`;
  } else {
    lineGroups().forEach(([line, ts]) => {
      h += `<h3 class="grp">${esc(line)}</h3><div class="grid">${ts.map(t => {
        const c = tCost(t);
        return `<button class="tcard" data-action="newSession" data-id="${t.id}"><span class="tname">${esc(t.name)}</span><span class="tprice">${t.price > 0 ? money(t.price) : 'sin precio'}</span><span class="tmeta ${mgClass(c.mg)}">${mgText(c.mg)}</span></button>`;
      }).join('')}</div>`;
    });
  }
  if (S.products.length) h += `<button class="btn ghost wide" style="margin-top:6px" data-action="newSession" data-id="">Uso libre · elegir productos</button>`;
  if (stale) h += `<div class="note">Hace tiempo que no haces un respaldo. En Ajustes puedes guardar una copia en tu iPhone.</div>`;
  if (recent.length) {
    h += `<h2>Últimas sesiones</h2><div class="list">${recent.map(s => `
      <div class="item"><div class="main"><div class="t">${esc(s.name)}${s.client ? ' · ' + esc(s.client) : ''}</div><div class="s">${fmtDate(s.date)} · costo ${money((s.ins ?? s.cost ?? 0) + (s.mo || 0) + (s.fj || 0))}</div></div>
      <div class="r"><div class="t">${money(s.price)}</div></div>
      <button class="mini" data-action="undoSession" data-id="${s.id}">Deshacer</button></div>`).join('')}</div>`;
  }
  return h;
}

function vInventario() {
  const q = normName(ui.q);
  const list = S.products.filter(p => {
    if (q && !normName(p.name).includes(q)) return false;
    if (ui.cat === 'bajo') return isLow(p);
    if (ui.cat !== 'all') return p.cat === ui.cat;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const low = S.products.filter(isLow).length;
  const chip = (k, l) => `<button class="chip ${ui.cat === k ? 'on' : ''}" data-action="cat" data-k="${k}">${l}</button>`;
  let h = head('Inventario', `${S.products.length} productos · valor ${money(sum(S.products, p => p.stock * unitCost(p)))}`);
  h += `<input class="search" id="q" type="search" placeholder="Buscar producto…" value="${esc(ui.q)}" autocomplete="off">`;
  h += `<div class="chips">${chip('all', 'Todos')}${chip('tratamiento', 'Tratamientos')}${chip('limpieza', 'Limpieza')}${chip('desechable', 'Desechables')}${chip('bajo', 'Stock bajo' + (low ? ' · ' + low : ''))}</div>`;
  if (!S.products.length) {
    h += `<div class="empty"><b>Sin productos aún</b>Carga tu archivo de datos, importa tu Excel o agrega el primero con el botón +.<br><button class="btn" data-action="goRestore">Cargar archivo de datos</button></div>`;
  } else if (!list.length) {
    h += `<div class="empty">No hay productos en esta vista.</div>`;
  } else {
    h += `<div class="list">${list.map(p => `
      <div class="item"><button class="main" style="text-align:left" data-action="editProd" data-id="${p.id}">
        <div class="t">${esc(p.name)}${p.stock <= 0 ? '<span class="badge out">Agotado</span>' : isLow(p) ? '<span class="badge">Bajo</span>' : ''}</div>
        <div class="s">${moneyU(unitCost(p))} por ${p.unit} · envase ${qty(p.pack || p.buyQty)} ${p.unit}</div></button>
        <div class="r"><div class="big">${qty(p.stock)}<small>${p.unit}</small></div></div>
        <button class="mini" data-action="useProd" data-id="${p.id}">Usar</button></div>`).join('')}</div>`;
  }
  h += `<button class="fab" data-action="newProd" aria-label="Agregar producto">+</button>`;
  return h;
}

function vTratamientos() {
  const seg = (k, l) => `<button class="${ui.tview === k ? 'on' : ''}" data-action="tview" data-k="${k}">${l}</button>`;
  let h = head('Tratamientos', 'Precio, receta de productos, tu hora y gastos fijos en cada servicio.');
  h += `<div class="seg">${seg('servicios', 'Servicios')}${seg('paquetes', 'Paquetes')}</div>`;
  if (ui.tview === 'paquetes') {
    if (!S.packs.length) h += `<div class="empty">No hay paquetes definidos.</div>`;
    S.packs.forEach((pk, i) => {
      if (!i || S.packs[i - 1].line !== pk.line) h += `${i ? '</div>' : ''}<h3 class="grp">${esc(pk.line)}</h3><div class="list">`;
      const c = packInfo(pk);
      h += `<button class="item" data-action="editPack" data-id="${pk.id}"><div class="main"><div class="t">${esc(pk.name)}</div><div class="s">${c.n} sesiones · precio ${money(c.price)} · costo ${money(c.total)}</div></div><div class="r"><div class="t ${c.ut >= 0 ? 'pos' : 'neg'}">${money(c.ut)}</div><div class="s ${mgClass(c.mg)}">${c.mg == null ? '' : pct(c.mg)}</div></div></button>`;
    });
    if (S.packs.length) h += '</div>';
    return h;
  }
  const unconfirmed = S.treatments.filter(t => t.items.some(i => i.est)).length;
  if (unconfirmed) h += `<div class="note" style="margin:0 0 6px">${unconfirmed} tratamientos tienen cantidades estimadas (≈), tal como venían en tu planilla. Confírmalas al editar cada uno para que el costo sea exacto.</div>`;
  if (!S.treatments.length) h += `<div class="empty"><b>Aún no hay tratamientos</b>Crea uno con su precio y los productos que usa.</div>`;
  lineGroups().forEach(([line, ts]) => {
    h += `<h3 class="grp">${esc(line)}</h3><div class="list">${ts.map(t => {
      const c = tCost(t);
      return `<button class="item" data-action="editTreat" data-id="${t.id}"><div class="main"><div class="t">${esc(t.name)}</div><div class="s">${t.price > 0 ? 'Precio ' + money(t.price) : 'Sin precio · sugerido ' + money(c.sug)} · costo ${money(c.total)}</div></div><div class="r"><div class="t ${c.ut >= 0 ? 'pos' : 'neg'}">${t.price > 0 ? money(c.ut) : '—'}</div><div class="s ${mgClass(c.mg)}">${c.mg == null ? '' : pct(c.mg)}</div></div></button>`;
    }).join('')}</div>`;
  });
  h += `<button class="btn wide" style="margin-top:14px" data-action="newTreat">+ Nuevo tratamiento</button>`;
  return h;
}

/* ---- resultados ---- */
function rangeOf(p) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const endThis = iso(new Date(y, m + 1, 0));
  if (p === 'mes') return [iso(new Date(y, m, 1)), endThis];
  if (p === 'prev') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  if (p === '3m') return [iso(new Date(y, m - 2, 1)), endThis];
  const ds = [...S.sessions.map(s => s.date), ...S.usos.map(s => s.date)].sort();
  return [ds[0] || iso(new Date(y, m, 1)), endThis];
}
function compute() {
  const [a, b] = rangeOf(ui.period);
  const ses = S.sessions.filter(s => s.date >= a && s.date <= b);
  const usos = S.usos.filter(s => s.date >= a && s.date <= b);
  const ingresos = sum(ses, s => s.price), com = sum(ses, s => s.com || 0);
  const ins = sum(ses, s => s.ins ?? s.cost ?? 0) + sum(usos, u => u.cost);
  const mo = sum(ses, s => s.mo || 0), fj = sum(ses, s => s.fj || 0), mins = sum(ses, s => s.min || 0);
  const utilidad = ingresos - com - ins - mo - fj;
  const by = {};
  ses.forEach(s => {
    const k = s.tid || 'libre:' + s.name;
    const o = by[k] || (by[k] = { name: s.name, n: 0, ing: 0, cost: 0 });
    o.n++; o.ing += s.price; o.cost += (s.com || 0) + (s.ins ?? s.cost ?? 0) + (s.mo || 0) + (s.fj || 0);
  });
  const rows = Object.values(by).map(o => Object.assign(o, { ut: o.ing - o.cost })).sort((x, y) => y.ut - x.ut);
  return { n: ses.length, ingresos, com, ins, mo, fj, utilidad, horas: mins / 60, rows };
}
function vResultados() {
  const r = compute(), rt = rates();
  const seg = (k, l) => `<button class="${ui.period === k ? 'on' : ''}" data-action="period" data-k="${k}">${l}</button>`;
  let h = head('Resultados', 'Ganancia real: después de insumos, tu hora y gastos fijos.');
  h += `<div class="seg">${seg('mes', 'Este mes')}${seg('prev', 'Mes anterior')}${seg('3m', '3 meses')}${seg('todo', 'Todo')}</div>`;
  const mg = r.ingresos > 0 ? r.utilidad / r.ingresos : null;
  h += `<div class="kpis">
    <div class="kpi hero"><div class="l">Utilidad del período</div><div class="v">${money(r.utilidad)}</div><div class="n">${mg == null ? 'Sin ventas registradas' : pct(mg) + ' de margen, ya pagándote tu hora'}</div></div>
    <div class="kpi"><div class="l">Ingresos</div><div class="v">${money(r.ingresos)}</div><div class="n">${r.n} ${r.n === 1 ? 'sesión' : 'sesiones'}</div></div>
    <div class="kpi"><div class="l">Insumos usados</div><div class="v">${money(r.ins)}</div><div class="n">${r.ingresos > 0 ? pct(r.ins / r.ingresos) + ' de lo vendido' : '&nbsp;'}</div></div>
    <div class="kpi"><div class="l">Tu hora</div><div class="v">${money(r.mo)}</div><div class="n">${qty(r.horas)} h atendidas</div></div>
    <div class="kpi"><div class="l">Gastos fijos</div><div class="v">${money(r.fj)}</div><div class="n">prorrateados por hora</div></div>
    <div class="kpi"><div class="l">Te llevas</div><div class="v">${money(r.utilidad + r.mo)}</div><div class="n">utilidad + tu hora</div></div>
    <div class="kpi"><div class="l">Inventario</div><div class="v">${money(sum(S.products, p => p.stock * unitCost(p)))}</div><div class="n">valor en stock</div></div>
  </div>`;
  if (r.horas > 0) h += `<div class="note">Cada hora atendida te deja ${money((r.utilidad + r.mo) / r.horas)} entre utilidad y tu hora. Tu meta es ${money(rt.hora)} por hora${rt.h ? ` (${rt.h} h al mes)` : ''}.</div>`;
  h += `<h2>Por tratamiento</h2>`;
  if (!r.rows.length) h += `<div class="empty">Cuando registres sesiones verás aquí cuáles te dejan más ganancia.</div>`;
  else {
    const mx = Math.max(...r.rows.map(x => Math.abs(x.ut)), 1);
    h += `<div class="list" style="padding:6px 12px 10px"><table><tr><th>Tratamiento</th><th class="n">Ses.</th><th class="n">Utilidad</th></tr>${r.rows.map(x => `
      <tr><td><b>${esc(x.name)}</b><div class="bar"><i style="width:${Math.max(3, Math.abs(x.ut) / mx * 100)}%"></i></div></td><td class="n">${x.n}</td><td class="n ${x.ut >= 0 ? 'pos' : 'neg'}"><b>${money(x.ut)}</b><div style="font-size:11px;color:var(--ink2)">${x.ing > 0 ? pct(x.ut / x.ing) : '—'}</div></td></tr>`).join('')}</table></div>`;
  }
  return h;
}

function vAjustes() {
  const rt = rates(), lb = S.meta.lastBackup ? new Date(S.meta.lastBackup).toLocaleDateString('es-CL') : 'nunca';
  const cf = (k, label, val, step) => `<label class="field"><span>${label}</span><input type="number" inputmode="decimal" step="${step || 'any'}" data-cfg="${k}" value="${val}"></label>`;
  return head('Ajustes') + `
    <h2 style="margin-top:6px">Tu hora de trabajo</h2>
    <div class="list" style="padding:4px 14px 14px">
      <div class="two">${cf('sueldo', 'Sueldo mensual que quieres ($)', S.cfg.sueldo)}${cf('horas', 'Horas de trabajo al mes', S.cfg.horas)}</div>
      <div class="ctable" style="margin-top:12px"><div><span>Valor de tu hora</span><b>${money(rt.hora)}</b></div><div><span>Gasto fijo por hora</span><b>${money(rt.fijoHora)}</b></div></div>
      <p class="help">Estos valores se suman al costo de cada tratamiento según su duración.</p>
    </div>
    <h2>Gastos fijos mensuales</h2>
    <div class="list">${S.fijos.map(f => `<div class="item"><div class="main"><div class="t">${esc(f.name)}</div></div><div class="iamt"><input type="number" inputmode="numeric" data-fijo="${f.id}" value="${f.amount}" style="width:100px"></div><button class="x" data-action="delFijo" data-id="${f.id}" aria-label="Eliminar">×</button></div>`).join('') || '<div class="item"><div class="s">Aún no hay gastos fijos.</div></div>'}
      <div class="item" style="background:var(--pink-soft)"><div class="main"><div class="t">Total mensual</div></div><div class="r"><div class="t">${money(rt.fijosTot)}</div></div></div></div>
    <button class="btn ghost wide" style="margin-top:10px" data-action="newFijo">+ Agregar gasto fijo</button>
    <h2>Precios</h2>
    <div class="list" style="padding:4px 14px 14px">
      <div class="two">${cf('margen', 'Margen objetivo (%)', Math.round(num(S.cfg.margen) * 1000) / 10)}${cf('comision', 'Comisión medio de pago (%)', Math.round(num(S.cfg.comision) * 1000) / 10)}</div>
      ${cf('desc', 'Descuento pack de 3 Skinboost (%)', Math.round(num(S.cfg.desc) * 1000) / 10)}
    </div>
    <h2>Importar inventario</h2>
    <div class="list" style="padding:14px">
      <button class="btn wide" data-action="goImport">Importar desde Excel</button>
      <p class="help">Lee la hoja de inventario con columnas Productos, Cantidad (por envase), medida, Unidades, Precio Total. Calcula el stock como cantidad × unidades.</p>
    </div>
    <h2>Seguridad</h2>
    <div class="list" style="padding:14px">
      <p class="help" style="margin:0 0 12px">Tus datos están cifrados en este iPhone y se bloquean solos al salir de la app unos minutos.</p>
      <div class="row-actions" style="margin-top:0"><button class="btn" data-action="lockNow">Bloquear ahora</button><button class="btn ghost" data-action="newPass">Cambiar clave</button></div>
    </div>
    <h2>Respaldo</h2>
    <div class="list" style="padding:14px">
      <p class="help" style="margin:0 0 12px">Tus datos viven solo en este iPhone. Último respaldo: <b>${lb}</b>. El respaldo (JSON) va cifrado con tu clave; el Excel exportado no.</p>
      <div class="row-actions" style="margin-top:0"><button class="btn gold" data-action="exportJson">Respaldo (JSON)</button><button class="btn ghost" data-action="goRestore">Cargar / restaurar</button></div>
      <button class="btn ghost wide" style="margin-top:10px" data-action="exportXlsx">Exportar todo a Excel</button>
    </div>
    <h2>Datos</h2>
    <div class="list" style="padding:14px">
      <button class="btn danger wide" data-action="wipe">Borrar todos los datos</button>
    </div>`;
}

/* ============ render ============ */
function render() {
  const v = { sesion: vSesion, inventario: vInventario, tratamientos: vTratamientos, resultados: vResultados, ajustes: vAjustes }[ui.tab];
  const keepQ = ui.tab === 'inventario' && document.activeElement && document.activeElement.id === 'q';
  $('#view').innerHTML = v();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  if (keepQ) { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

/* ============ hoja inferior ============ */
function openSheet() { $('#sheet').classList.remove('hidden'); renderSheet(); }
function closeSheet() { $('#sheet').classList.add('hidden'); draft = null; }
function productOptions() {
  const g = c => { const l = S.products.filter(p => p.cat === c).sort((a, b) => a.name.localeCompare(b.name, 'es')); return l.length ? `<optgroup label="${CAT[c]}">${l.map(p => `<option value="${p.id}">${esc(p.name)} (${qty(p.stock)} ${p.unit})</option>`).join('')}</optgroup>` : ''; };
  return g('tratamiento') + g('limpieza') + g('desechable');
}
function itemsEditor() {
  return draft.items.map((it, i) => {
    const p = prod(it.pid); if (!p) return '';
    const low = draft.kind === 'session' && num(it.amount) > p.stock;
    return `<div class="irow"><div class="iname">${esc(p.name)}<small class="${low ? 'warn' : ''}">${low ? 'stock insuficiente · ' : 'stock '}${qty(p.stock)} ${p.unit}</small>
      ${draft.kind === 'treat' ? `<button class="esttog ${it.est ? 'on' : ''}" data-action="toggleEst" data-i="${i}">${it.est ? '≈ estimado · toca para confirmar' : '✓ confirmado'}</button>` : ''}</div>
      <div class="iamt"><input type="number" inputmode="decimal" step="any" min="0" value="${it.amount}" data-item="${i}"><span>${p.unit}</span></div>
      <button class="x" data-action="rmItem" data-i="${i}" aria-label="Quitar">×</button></div>`;
  }).join('') + `<div class="addrow"><select id="addSel"><option value="">+ Agregar producto…</option>${productOptions()}</select></div>`;
}
function draftCost() { return costOf(draft.items, draft.min, draft.price); }
function summaryHtml() {
  const c = draftCost();
  if (draft.kind === 'session') {
    return `<div class="sum"><div><small>Costo total</small><b>${money(c.total + c.com)}</b></div><div><small>Cobrado</small><b>${money(c.price)}</b></div><div><small>Ganancia</small><b class="${c.ut >= 0 ? 'pos' : 'neg'}">${money(c.ut)}</b></div></div>
      <p class="help" style="text-align:center;margin-top:8px">Insumos ${money(c.ins)} · tu hora ${money(c.mo)} · fijos ${money(c.fj)}</p>`;
  }
  return costTable(c);
}
function refreshItems() { const el = $('#items'); if (el) el.innerHTML = itemsEditor(); refreshSummary(); }
function refreshSummary() { const el = $('#sum'); if (el) el.innerHTML = summaryHtml(); }
const suggestRound = v => Math.ceil(v / 500) * 500;

function renderSheet() {
  const d = draft, b = $('#sheetBody'); let h = '';
  if (d.kind === 'session') {
    h = `<h3>${esc(d.name)}</h3><p class="sub">Ajusta las cantidades si hoy usaste algo distinto.</p>
      <div class="two"><label class="field"><span>Fecha</span><input type="date" data-bind="date" value="${d.date}"></label>
      <label class="field"><span>Precio cobrado ($)</span><input type="number" inputmode="numeric" data-bind="price" value="${d.price || ''}" placeholder="0"></label></div>
      <div class="two"><label class="field"><span>Duración (min)</span><input type="number" inputmode="numeric" data-bind="min" value="${d.min || ''}" placeholder="0"></label>
      <label class="field"><span>Clienta (opcional)</span><input type="text" data-bind="client" value="${esc(d.client)}" placeholder="Nombre"></label></div>
      <h4>Productos usados</h4><div id="items">${itemsEditor()}</div>
      <div id="sum">${summaryHtml()}</div>
      <div class="row-actions"><button class="btn ghost" data-action="closeSheet">Cancelar</button><button class="btn" data-action="saveSession">Registrar sesión</button></div>`;
  } else if (d.kind === 'treat') {
    h = `<h3>${d.id ? 'Editar tratamiento' : 'Nuevo tratamiento'}</h3>
      <label class="field"><span>Nombre</span><input type="text" data-bind="name" value="${esc(d.name)}" placeholder="Ej: Limpieza facial profunda"></label>
      <div class="two"><label class="field"><span>Línea</span><select data-bind="line">${LINES.map(l => `<option ${d.line === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Duración total (min)</span><input type="number" inputmode="numeric" data-bind="min" value="${d.min || ''}" placeholder="atención + preparación"></label></div>
      <label class="field"><span>Precio de venta ($)</span><input type="number" inputmode="numeric" data-bind="price" value="${d.price || ''}" placeholder="0"></label>
      <h4>Receta · lo que gasta una sesión</h4><div id="items">${itemsEditor()}</div>
      <div id="sum">${summaryHtml()}</div>
      <button class="btn gold wide" style="margin-top:12px" data-action="useSug">Usar precio sugerido</button>
      <div class="row-actions"><button class="btn ghost" data-action="closeSheet">Cancelar</button><button class="btn" data-action="saveTreat">Guardar</button></div>
      ${d.id ? `<div class="row-actions"><button class="btn ghost" data-action="dupTreat">Duplicar</button><button class="btn danger" data-action="delTreat">Eliminar</button></div>` : ''}`;
  } else if (d.kind === 'pack') {
    const pk = S.packs.find(x => x.id === d.id), c = packInfo(Object.assign({}, pk, { price: d.price }));
    h = `<h3>${esc(pk.name)}</h3><p class="sub">${c.n} sesiones</p>
      <h4>Incluye</h4><div class="list">${pk.parts.map(p => { const t = tById(p.tid); return t ? `<div class="item"><div class="main"><div class="t">${p.qty} × ${esc(t.name)}</div><div class="s">costo por sesión ${money(tCost(t).total)}</div></div></div>` : ''; }).join('')}</div>
      ${pk.auto ? `<p class="help">Precio = ${pk.parts[0].qty} sesiones × precio individual − ${pct(num(S.cfg.desc))} de descuento. Cambia el descuento en Ajustes.</p>`
        : `<label class="field"><span>Precio del paquete ($)</span><input type="number" inputmode="numeric" data-bind="price" value="${d.price || ''}"></label>`}
      <div id="sum" style="margin-top:12px">${costTable(c)}</div>
      ${pk.auto ? '' : `<button class="btn gold wide" style="margin-top:12px" data-action="useSugPack">Usar precio sugerido</button>`}
      <div class="row-actions"><button class="btn ghost" data-action="closeSheet">Cerrar</button>${pk.auto ? '' : '<button class="btn" data-action="savePack">Guardar precio</button>'}</div>`;
  } else if (d.kind === 'product') {
    const usedIn = d.id ? S.treatments.filter(t => t.items.some(i => i.pid === d.id)) : [];
    h = `<h3>${d.id ? 'Editar producto' : 'Nuevo producto'}</h3>
      <label class="field"><span>Nombre</span><input type="text" data-bind="name" value="${esc(d.name)}" placeholder="Ej: Ácido hialurónico"></label>
      <div class="two"><label class="field"><span>Categoría</span><select data-bind="cat">${Object.keys(CAT).map(k => `<option value="${k}" ${d.cat === k ? 'selected' : ''}>${CAT[k]}</option>`).join('')}</select></label>
      <label class="field"><span>Medida</span><select data-bind="unit">${UNITS.map(u => `<option ${d.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label></div>
      <div class="two"><label class="field"><span>Precio total pagado ($)</span><input type="number" inputmode="numeric" data-bind="price" value="${d.price}" placeholder="0"></label>
      <label class="field"><span>Cantidad total comprada</span><input type="number" inputmode="decimal" step="any" data-bind="buyQty" value="${d.buyQty}" placeholder="ej: 500"></label></div>
      <div class="two"><label class="field"><span>Stock actual (${esc(d.unit)})</span><input type="number" inputmode="decimal" step="any" data-bind="stock" value="${d.stock}" placeholder="0"></label>
      <label class="field"><span>Contenido por envase</span><input type="number" inputmode="decimal" step="any" data-bind="pack" value="${d.pack}" placeholder="ej: 250"></label></div>
      <label class="field"><span>Avisar cuando quede menos de (${esc(d.unit)})</span><input type="number" inputmode="decimal" step="any" data-bind="min" value="${d.min}" placeholder="0"></label>
      <p class="help">El costo por ${esc(d.unit)} = precio total ÷ cantidad total comprada.</p>
      ${usedIn.length ? `<h4>Se usa en</h4><p class="help" style="margin-top:0">${usedIn.map(t => `${esc(t.name)} (${qty(t.items.find(i => i.pid === d.id).amount)} ${esc(d.unit)})`).join(' · ')}</p>` : ''}
      ${d.id ? `<h4>Reponer stock</h4><div class="two"><label class="field" style="margin:0"><span>Envases nuevos</span><input type="number" inputmode="decimal" step="any" data-bind="rn" value="${d.rn || ''}" placeholder="1"></label><label class="field" style="margin:0"><span>Contenido por envase</span><input type="number" inputmode="decimal" step="any" data-bind="rk" value="${d.rk}"></label></div>
        <label class="field"><span>Precio total pagado ($)</span><input type="number" inputmode="numeric" data-bind="rp" value="${d.rp || ''}" placeholder="deja vacío para mantener el costo"></label>
        <button class="btn gold wide" style="margin-top:10px" data-action="restock">Sumar al stock</button>` : ''}
      <div class="row-actions"><button class="btn ghost" data-action="closeSheet">Cancelar</button><button class="btn" data-action="saveProd">Guardar</button></div>
      ${d.id ? `<button class="btn danger wide" style="margin-top:10px" data-action="delProd">Eliminar producto</button>` : ''}`;
  } else if (d.kind === 'use') {
    const p = prod(d.pid), q = p.unit === 'un' ? [1, 2, 5] : [1, 2, 5, 10];
    h = `<h3>${esc(p.name)}</h3><p class="sub">Quedan ${qty(p.stock)} ${p.unit} · ${moneyU(unitCost(p))} por ${p.unit}</p>
      <label class="field"><span>Cantidad usada (${p.unit})</span><input type="number" id="useAmt" inputmode="decimal" step="any" min="0" data-bind="amount" value="${d.amount}" placeholder="0"></label>
      <div class="quick">${q.map(v => `<button data-action="addAmt" data-v="${v}">+${v}</button>`).join('')}<button data-action="addAmt" data-v="clear">Borrar</button></div>
      <div class="row-actions"><button class="btn ghost" data-action="closeSheet">Cancelar</button><button class="btn" data-action="saveUse">Descontar</button></div>`;
  } else if (d.kind === 'pass') {
    h = `<h3>Cambiar clave</h3><p class="sub">Mínimo 8 caracteres. Mejor una frase larga. Si la olvidas no se puede recuperar.</p>
      <label class="field"><span>Clave actual</span><input type="password" autocomplete="current-password" data-bind="cur"></label>
      <label class="field"><span>Clave nueva</span><input type="password" autocomplete="new-password" data-bind="p1"></label>
      <label class="field"><span>Repite la clave nueva</span><input type="password" autocomplete="new-password" data-bind="p2"></label>
      <div class="row-actions"><button class="btn ghost" data-action="closeSheet">Cancelar</button><button class="btn" data-action="savePass">Cambiar</button></div>`;
  } else if (d.kind === 'fijo') {
    h = `<h3>Nuevo gasto fijo</h3>
      <label class="field"><span>Concepto</span><input type="text" data-bind="name" value="${esc(d.name)}" placeholder="Ej: Publicidad, software, contabilidad"></label>
      <label class="field"><span>Monto mensual ($)</span><input type="number" inputmode="numeric" data-bind="amount" value="${d.amount}" placeholder="0"></label>
      <div class="row-actions"><button class="btn ghost" data-action="closeSheet">Cancelar</button><button class="btn" data-action="saveFijo">Guardar</button></div>`;
  } else if (d.kind === 'import') {
    const nw = d.rows.filter(r => !prod2(r.name)).length;
    const help = { prices: 'Agrega los productos nuevos y actualiza precios y envases. No toca tu stock actual.', full: 'Actualiza todo, incluyendo el stock con la cantidad × unidades de la planilla.', replace: 'Igual que "Todo" y además elimina los productos que no estén en la planilla.' }[d.mode];
    h = `<h3>${d.rows.length} productos encontrados</h3><p class="sub">${nw} nuevos · ${d.rows.length - nw} ya existentes. Revisa que precios y stock se vean bien.</p>
      <div class="prev"><table><tr><th>Producto</th><th class="n">Precio</th><th class="n">Stock</th></tr>${d.rows.slice(0, 40).map(r => `<tr><td>${esc(r.name)}<div style="font-size:11px;color:var(--ink2)">${CAT[r.cat]} · envase ${qty(r.pack)} ${r.unit}</div></td><td class="n">${money(r.price)}</td><td class="n">${qty(r.stock)} ${r.unit}</td></tr>`).join('')}</table>${d.rows.length > 40 ? `<p class="help" style="text-align:center">…y ${d.rows.length - 40} más</p>` : ''}</div>
      <div class="seg" style="margin-top:12px"><button class="${d.mode === 'prices' ? 'on' : ''}" data-action="impMode" data-k="prices">Precios y nuevos</button><button class="${d.mode === 'full' ? 'on' : ''}" data-action="impMode" data-k="full">Todo + stock</button><button class="${d.mode === 'replace' ? 'on' : ''}" data-action="impMode" data-k="replace">Reemplazar</button></div>
      <p class="help" style="margin-top:-4px">${help}</p>
      <div class="row-actions"><button class="btn ghost" data-action="closeSheet">Cancelar</button><button class="btn" data-action="applyImport">Importar</button></div>`;
  }
  b.innerHTML = h;
}
const prod2 = name => S.products.find(p => normName(p.name) === normName(name));

/* ============ acciones ============ */
const A = {
  tab(el) { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  closeSheet,
  cat(el) { ui.cat = el.dataset.k; render(); },
  period(el) { ui.period = el.dataset.k; render(); },
  tview(el) { ui.tview = el.dataset.k; render(); },

  /* sesión */
  newSession(el) {
    const t = el.dataset.id ? tById(el.dataset.id) : null;
    draft = { kind: 'session', tid: t ? t.id : null, name: t ? t.name : 'Uso libre', date: today(), client: '', price: t ? t.price || '' : '', min: t ? t.min : 0, items: t ? t.items.filter(i => prod(i.pid)).map(i => ({ pid: i.pid, amount: i.amount })) : [] };
    openSheet();
  },
  saveSession() {
    const d = draft, items = d.items.filter(i => prod(i.pid) && num(i.amount) > 0);
    if (!items.length && !num(d.price)) return toast('Agrega productos o un precio');
    const c = costOf(items, d.min, d.price);
    const s = { id: uid(), ts: Date.now(), date: d.date || today(), tid: d.tid, name: d.name, client: d.client.trim(), price: num(d.price), min: num(d.min), ins: c.ins, mo: c.mo, fj: c.fj, com: c.com, items: [] };
    items.forEach(i => {
      const p = prod(i.pid), a = num(i.amount);
      s.items.push({ pid: p.id, name: p.name, unit: p.unit, amount: a, uc: unitCost(p) });
      p.stock = Math.max(0, r4(p.stock - a));
    });
    S.sessions.push(s); save(); closeSheet(); render();
    toast('Sesión registrada · ' + money(c.ut) + ' de ganancia', 'Deshacer', () => A.undoSession({ dataset: { id: s.id } }, true));
  },
  undoSession(el, silent) {
    const s = S.sessions.find(x => x.id === el.dataset.id); if (!s) return;
    if (!silent && !confirm('¿Deshacer esta sesión? Se devuelven los productos al inventario.')) return;
    s.items.forEach(i => { const p = prod(i.pid); if (p) p.stock = r4(p.stock + i.amount); });
    S.sessions = S.sessions.filter(x => x !== s); save(); render(); toast('Sesión deshecha');
  },

  /* productos */
  newProd() { draft = { kind: 'product', id: null, name: '', cat: ui.cat === 'limpieza' || ui.cat === 'desechable' ? ui.cat : 'tratamiento', unit: 'ml', price: '', stock: '', buyQty: '', pack: '', min: '' }; openSheet(); },
  editProd(el) { const p = prod(el.dataset.id); draft = { kind: 'product', id: p.id, name: p.name, cat: p.cat, unit: p.unit, price: p.price, stock: p.stock, buyQty: p.buyQty, pack: p.pack || p.buyQty, min: p.min || '', rn: '', rk: p.pack || p.buyQty, rp: '' }; openSheet(); },
  saveProd() {
    const d = draft; if (!d.name.trim()) return toast('Falta el nombre');
    const stock = num(d.stock), buyQty = num(d.buyQty) || stock;
    const data = { name: d.name.trim(), cat: d.cat, unit: d.unit, price: num(d.price), stock, buyQty, pack: num(d.pack) || buyQty, min: num(d.min) };
    if (d.id) Object.assign(prod(d.id), data); else S.products.push({ id: uid(), ...data });
    save(); closeSheet(); render(); toast('Producto guardado');
  },
  restock() {
    const d = draft, p = prod(d.id), k = num(d.rk) || num(d.pack), n = num(d.rn) || 1, q = n * k;
    if (q <= 0) return toast('Indica el contenido por envase');
    const price = num(d.rp) > 0 ? num(d.rp) : unitCost(p) * q;
    p.stock = r4(p.stock + q); p.buyQty = q; p.pack = k; p.price = price;
    save(); closeSheet(); render(); toast(`Stock actualizado: ${qty(p.stock)} ${p.unit}`);
  },
  delProd() {
    const p = prod(draft.id);
    if (!confirm(`¿Eliminar "${p.name}"? Se quitará también de las recetas de tratamientos.`)) return;
    S.products = S.products.filter(x => x !== p);
    S.treatments.forEach(t => t.items = t.items.filter(i => i.pid !== p.id));
    save(); closeSheet(); render();
  },
  useProd(el) { draft = { kind: 'use', pid: el.dataset.id, amount: '' }; openSheet(); setTimeout(() => { const i = $('#useAmt'); if (i) i.focus(); }, 250); },
  addAmt(el) { const v = el.dataset.v; draft.amount = v === 'clear' ? '' : r4(num(draft.amount) + num(v)); $('#useAmt').value = draft.amount; },
  saveUse() {
    const p = prod(draft.pid), a = num(draft.amount); if (a <= 0) return toast('Indica cuánto usaste');
    const u = { id: uid(), date: today(), pid: p.id, name: p.name, unit: p.unit, amount: a, uc: unitCost(p), cost: a * unitCost(p) };
    p.stock = Math.max(0, r4(p.stock - a)); S.usos.push(u); save(); closeSheet(); render();
    toast(`−${qty(a)} ${p.unit} de ${p.name}`, 'Deshacer', () => { p.stock = r4(p.stock + a); S.usos = S.usos.filter(x => x !== u); save(); render(); });
  },

  /* tratamientos y paquetes */
  newTreat() { draft = { kind: 'treat', id: null, name: '', line: 'Otros', price: '', min: 60, items: [] }; openSheet(); },
  editTreat(el) { const t = tById(el.dataset.id); draft = { kind: 'treat', id: t.id, name: t.name, line: t.line || 'Otros', price: t.price || '', min: t.min, items: t.items.filter(i => prod(i.pid)).map(i => ({ ...i })) }; openSheet(); },
  saveTreat() {
    const d = draft; if (!d.name.trim()) return toast('Falta el nombre');
    const data = { name: d.name.trim(), line: d.line, price: num(d.price), min: num(d.min), items: d.items.filter(i => num(i.amount) > 0).map(i => ({ pid: i.pid, amount: num(i.amount), est: !!i.est })) };
    if (d.id) Object.assign(tById(d.id), data); else S.treatments.push({ id: uid(), ...data });
    save(); closeSheet(); render(); toast('Tratamiento guardado');
  },
  dupTreat() {
    const d = draft, data = { name: d.name.trim() + ' (copia)', line: d.line, price: num(d.price), min: num(d.min), items: d.items.map(i => ({ pid: i.pid, amount: num(i.amount), est: !!i.est })) };
    S.treatments.push({ id: uid(), ...data }); save(); closeSheet(); render(); toast('Tratamiento duplicado');
  },
  delTreat() {
    if (!confirm('¿Eliminar este tratamiento? Las sesiones ya registradas se mantienen.')) return;
    S.treatments = S.treatments.filter(x => x.id !== draft.id);
    S.packs.forEach(pk => pk.parts = pk.parts.filter(p => p.tid !== draft.id));
    S.packs = S.packs.filter(pk => pk.parts.length);
    save(); closeSheet(); render();
  },
  useSug() { draft.price = suggestRound(draftCost().sug); renderSheet(); },
  toggleEst(el) { const it = draft.items[+el.dataset.i]; it.est = !it.est; refreshItems(); },
  rmItem(el) { draft.items.splice(+el.dataset.i, 1); refreshItems(); },
  editPack(el) { const pk = S.packs.find(x => x.id === el.dataset.id); draft = { kind: 'pack', id: pk.id, price: pk.auto ? 0 : pk.price }; openSheet(); },
  useSugPack() { const pk = S.packs.find(x => x.id === draft.id); draft.price = suggestRound(packInfo(Object.assign({}, pk, { price: draft.price })).sug); renderSheet(); },
  savePack() { S.packs.find(x => x.id === draft.id).price = num(draft.price); save(); closeSheet(); render(); toast('Precio guardado'); },

  /* gastos fijos */
  newFijo() { draft = { kind: 'fijo', name: '', amount: '' }; openSheet(); },
  saveFijo() { const d = draft; if (!d.name.trim()) return toast('Falta el concepto'); S.fijos.push({ id: uid(), name: d.name.trim(), amount: num(d.amount) }); save(); closeSheet(); render(); },
  delFijo(el) { if (!confirm('¿Eliminar este gasto fijo?')) return; S.fijos = S.fijos.filter(f => f.id !== el.dataset.id); save(); render(); },

  /* importar */
  goImport() { $('#fileImport').click(); },
  impMode(el) { draft.mode = el.dataset.k; renderSheet(); },
  applyImport() {
    const d = draft, seen = new Set(); let add = 0, upd = 0;
    d.rows.forEach(r => {
      const k = normName(r.name); seen.add(k);
      const ex = prod2(r.name);
      if (ex) {
        Object.assign(ex, { price: r.price, pack: r.pack, buyQty: r.stock || ex.buyQty });
        if (d.mode !== 'prices') Object.assign(ex, { stock: r.stock, unit: r.unit, cat: r.cat, name: r.name });
        upd++;
      } else { S.products.push({ id: uid(), min: 0, name: r.name, cat: r.cat, unit: r.unit, price: r.price, pack: r.pack, stock: r.stock, buyQty: r.stock }); add++; }
    });
    if (d.mode === 'replace') S.products = S.products.filter(p => seen.has(normName(p.name)));
    save(); closeSheet(); ui.tab = 'inventario'; render();
    toast(`${add} nuevos · ${upd} actualizados`);
  },

  /* respaldo */
  async exportJson() {
    S.meta.lastBackup = Date.now(); save();
    const env = await encStr(JSON.stringify(S), vault.key);
    await saveFile(new Blob([JSON.stringify({ enc: 1, salt: vault.salt, iter: vault.iter, ...env })], { type: 'application/json' }), `zenzana-respaldo-${today()}.json`);
    render();
  },
  goRestore() { $('#fileRestore').click(); },
  async exportXlsx() {
    const wb = XLSX.utils.book_new(), add = (n, a) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a), n);
    add('Inventario', [['Producto', 'Categoría', 'Medida', 'Precio total', 'Cantidad comprada', 'Contenido por envase', 'Stock actual', 'Aviso bajo de', 'Costo por unidad'], ...S.products.map(p => [p.name, CAT[p.cat], p.unit, p.price, p.buyQty, p.pack, p.stock, p.min || '', Math.round(unitCost(p) * 100) / 100])]);
    add('Recetas', [['Tratamiento', 'Producto', 'Uso por sesión', 'Medida', 'Estimado'], ...S.treatments.flatMap(t => t.items.map(i => [t.name, prod(i.pid)?.name || '', i.amount, prod(i.pid)?.unit || '', i.est ? 'Sí' : 'No']))]);
    const row = (n, l, c, mins) => [n, l, mins, Math.round(c.ins), Math.round(c.mo), Math.round(c.fj), Math.round(c.total), Math.round(c.price), Math.round(c.ut), c.mg == null ? '' : Math.round(c.mg * 1000) / 10, Math.round(c.sug)];
    add('Rentabilidad', [['Servicio o paquete', 'Línea', 'Minutos', 'Insumos', 'Tu hora', 'Gastos fijos', 'Costo total', 'Precio', 'Utilidad', 'Margen %', 'Precio sugerido'], ...S.treatments.map(t => row(t.name, t.line, tCost(t), t.min)), ...S.packs.map(p => row(p.name, p.line, packInfo(p), ''))]);
    add('Sesiones', [['Fecha', 'Tratamiento', 'Clienta', 'Cobrado', 'Insumos', 'Tu hora', 'Gastos fijos', 'Ganancia'], ...[...S.sessions].sort((a, b) => a.ts - b.ts).map(s => [s.date, s.name, s.client, s.price, Math.round(s.ins ?? s.cost ?? 0), Math.round(s.mo || 0), Math.round(s.fj || 0), Math.round(s.price - (s.com || 0) - (s.ins ?? s.cost ?? 0) - (s.mo || 0) - (s.fj || 0))])]);
    add('Costos', [['Concepto', 'Valor'], ['Sueldo mensual', S.cfg.sueldo], ['Horas al mes', S.cfg.horas], ['Margen objetivo', S.cfg.margen], ['Comisión', S.cfg.comision], ['Descuento pack 3', S.cfg.desc], ...S.fijos.map(f => [f.name, f.amount])]);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await saveFile(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `zenzana-inventario-${today()}.xlsx`);
  },
  lockNow() { lock(); },
  newPass() { draft = { kind: 'pass', cur: '', p1: '', p2: '' }; openSheet(); },
  async savePass() {
    const d = draft; if (d.p1.length < 8) return toast('La clave nueva debe tener al menos 8 caracteres');
    if (d.p1 !== d.p2) return toast('Las claves nuevas no coinciden');
    try {
      const old = await deriveKey(d.cur, unb64(vault.salt), vault.iter);
      await decStr(JSON.parse(localStorage.getItem(VKEY)), old);
    } catch (e) { return toast('La clave actual no es correcta'); }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    vault.key = await deriveKey(d.p1, salt, vault.iter); vault.salt = b64(salt);
    save(); await saving; closeSheet(); toast('Clave cambiada');
  },
  wipe() {
    if (!confirm('¿Borrar TODOS los datos de este dispositivo? No se puede deshacer.')) return;
    if (!confirm('Última confirmación: se borrarán productos, tratamientos, sesiones y costos.')) return;
    S = emptyData(); save(); render(); toast('Datos borrados');
  },
  toastAct() { const f = toastFn; $('#toast').classList.add('hidden'); toastFn = null; if (f) f(); }
};

async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}
function toast(msg, label, fn) {
  const el = $('#toast'); toastFn = fn || null;
  el.innerHTML = `<span>${esc(msg)}</span>${label ? `<button data-action="toastAct">${esc(label)}</button>` : ''}`;
  el.classList.remove('hidden'); clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), label ? 7000 : 2800);
}

/* ============ importar Excel (formato de la planilla de inventario) ============ */
function parseNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[^\d.,-]/g, ''); if (!s) return 0;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function normUnit(u) {
  const s = String(u || '').toLowerCase().trim().replace(/[.()]/g, '');
  if (/^(ml|cc|mls|mililitros?)$/.test(s)) return { unit: 'ml', f: 1 };
  if (/^(l|lt|lts|litros?)$/.test(s)) return { unit: 'ml', f: 1000 };
  if (/^(g|gr|grs|gramos?)$/.test(s)) return { unit: 'gr', f: 1 };
  if (/^(kg|kgs|kilos?)$/.test(s)) return { unit: 'gr', f: 1000 };
  if (/^(un|und|unid|unidad|unidades|u|uni|pza|pieza|piezas)$/.test(s)) return { unit: 'un', f: 1 };
  return null;
}
const DESECH = /^(cintillo|discos? de algod|esponjas?|gasas?|gorros?|guantes|jeringas?|pa[nñ]os|papel film|pin$|tapabocas|toallas?)/i;
const LIMP = /limpiad|limpieza|cleanser|micelar|lactogel|desengras|higieniz/i;
const guessCat = (name, fallback) => DESECH.test(name) ? 'desechable' : LIMP.test(name) ? 'limpieza' : fallback;

function parseSheet(ws, sheetName) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  const NAME = /produ|nombre|insumo|item|art[ií]culo/i;
  let hi = rows.findIndex(r => r.some(c => NAME.test(String(c))) && r.filter(c => String(c).trim()).length >= 2);
  let cols;
  if (hi >= 0) {
    const h = rows[hi].map(c => String(c).toLowerCase()), f = re => h.findIndex(x => re.test(x));
    cols = { name: f(NAME), qty: f(/cant/), packs: f(/^\s*(unidades?|envases?|und)\s*$/), unit: f(/medida|formato|u\.?m\b/), cat: f(/categ|tipo|rubro|l[ií]nea/) };
    cols.price = f(/precio.*total|total.*precio/);
    if (cols.price < 0) cols.price = h.findIndex(x => /precio|valor|costo/.test(x) && !/unit/.test(x));
    if (cols.price < 0) cols.price = h.findIndex(x => /total/.test(x) && !/cant/.test(x));
  } else { hi = -1; cols = { name: 0, price: 1, qty: 2, unit: 3, packs: -1, cat: -1 }; }
  const body = rows.slice(hi + 1);
  if (cols.unit < 0 && body.length) { // columna de medida sin título: se detecta por su contenido
    const width = Math.max(...body.map(r => r.length));
    for (let c = 0; c < width; c++) {
      if ([cols.name, cols.price, cols.qty, cols.packs].includes(c)) continue;
      const vals = body.map(r => r[c]).filter(v => String(v ?? '').trim());
      if (vals.length >= 3 && vals.filter(v => normUnit(v)).length / vals.length > 0.6) { cols.unit = c; break; }
    }
  }
  let cur = 'tratamiento'; const out = [];
  body.forEach(r => {
    const name = String(r[cols.name] ?? '').replace(/\s+/g, ' ').trim(); if (!name || /^total/i.test(name)) return;
    const pRaw = cols.price >= 0 ? r[cols.price] : '', qRaw = cols.qty >= 0 ? r[cols.qty] : '';
    if (String(pRaw).trim() === '' && String(qRaw).trim() === '') { cur = guessCat(name, cur); return; } // fila de título
    let uo = cols.unit >= 0 ? normUnit(r[cols.unit]) : null;
    if (!uo) { const m = String(qRaw).match(/[a-zA-Z]+/); if (m) uo = normUnit(m[0]); }
    uo = uo || { unit: 'un', f: 1 };
    const pack = r4(parseNum(qRaw) * uo.f), packs = cols.packs >= 0 ? (parseNum(r[cols.packs]) || 1) : 1;
    let cat = guessCat(name, cur); if (cols.cat >= 0 && String(r[cols.cat]).trim()) cat = /limp/i.test(r[cols.cat]) ? 'limpieza' : /desech/i.test(r[cols.cat]) ? 'desechable' : cat;
    out.push({ name, cat, unit: uo.unit, price: parseNum(pRaw), pack, stock: r4(pack * packs) });
  });
  return out;
}
async function readImport(file) {
  try {
    const wb = /\.csv$/i.test(file.name) ? XLSX.read(await file.text(), { type: 'string' }) : XLSX.read(await file.arrayBuffer(), { type: 'array' });
    // si el libro trae varias hojas, usa la del inventario; si no, todas
    const pick = wb.SheetNames.filter(n => /inventario/i.test(n));
    const names = pick.length ? pick : wb.SheetNames.filter(n => !/resumen|rentab|ritual|costos|otros/i.test(n));
    const rows = (names.length ? names : wb.SheetNames).flatMap(n => parseSheet(wb.Sheets[n], n));
    const uniq = new Map(); rows.forEach(r => uniq.set(normName(r.name), r));
    if (!uniq.size) return toast('No encontré productos en ese archivo');
    draft = { kind: 'import', rows: [...uniq.values()], mode: 'prices' }; openSheet();
  } catch (e) { toast('No pude leer el archivo'); }
}

/* ============ eventos ============ */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const fn = A[el.dataset.action]; if (fn) fn(el);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { ui.q = t.value; render(); return; }
  if (!draft) return;
  if (t.dataset.item !== undefined) { draft.items[+t.dataset.item].amount = t.value; refreshSummary(); return; }
  if (t.dataset.bind) {
    draft[t.dataset.bind] = t.type === 'checkbox' ? t.checked : t.value;
    if (['price', 'min'].includes(t.dataset.bind)) {
      if (draft.kind === 'pack') { const pk = S.packs.find(x => x.id === draft.id); $('#sum').innerHTML = costTable(packInfo(Object.assign({}, pk, { price: draft.price }))); }
      else refreshSummary();
    }
    if (t.dataset.bind === 'unit' && draft.kind === 'product') renderSheet();
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'addSel' && t.value && draft) { draft.items.push({ pid: t.value, amount: 1, est: false }); refreshItems(); return; }
  if (t.dataset.cfg) {
    const k = t.dataset.cfg, v = num(t.value);
    S.cfg[k] = ['margen', 'comision', 'desc'].includes(k) ? v / 100 : v; save(); render(); return;
  }
  if (t.dataset.fijo) { const f = S.fijos.find(x => x.id === t.dataset.fijo); if (f) { f.amount = num(t.value); save(); render(); } }
});
$('#fileImport').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) readImport(f); });
$('#fileRestore').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    let d = JSON.parse(await f.text());
    if (d.enc) {
      let key = vault.key;
      if (d.salt !== vault.salt || d.iter !== vault.iter) {
        const pass = prompt('Escribe la clave con la que se hizo este respaldo');
        if (!pass) return;
        key = await deriveKey(pass, unb64(d.salt), d.iter);
      }
      d = JSON.parse(await decStr(d, key));
    }
    if (!Array.isArray(d.products)) throw 0;
    if (S.products.length && !confirm('Esto reemplazará los datos actuales. ¿Continuar?')) return;
    S = Object.assign(emptyData(), d); save(); render();
    toast(`Cargué ${S.products.length} productos y ${S.treatments.length} tratamientos`);
  } catch (err) { toast('No pude abrir ese archivo (¿clave incorrecta?)'); }
});

/* ============ pantalla de clave ============ */
let hiddenAt = 0, fails = 0;
const lockEl = () => $('#lock'), lockBody = () => $('#lockBody');
function showLock(mode, msg) {
  lockEl().classList.remove('hidden');
  const setup = mode === 'setup';
  lockBody().innerHTML = `<div class="brand">Zenzana · Ritual Beauty Studio</div>
    <h1>${setup ? 'Crea tu clave' : 'Bienvenida'}</h1>
    <p class="sub">${setup ? 'Protege tu inventario y tus costos. Usa una frase larga (mínimo 8 caracteres). Si la olvidas no hay forma de recuperar los datos, así que guarda también un respaldo.' : 'Escribe tu clave para ver tus datos.'}</p>
    <form id="lockForm" autocomplete="off">
      <input id="lp1" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" placeholder="Clave" autofocus>
      ${setup ? '<input id="lp2" type="password" autocomplete="new-password" placeholder="Repite la clave">' : ''}
      <p class="lock-msg" id="lockMsg">${esc(msg || '')}</p>
      <button class="btn gold wide" id="lockBtn" type="submit">${setup ? 'Crear clave' : 'Entrar'}</button>
    </form>`;
  $('#lockForm').addEventListener('submit', ev => { ev.preventDefault(); setup ? doSetup() : doUnlock(); });
}
function lockBusy(on, msg) { const b = $('#lockBtn'); if (b) { b.disabled = on; b.textContent = on ? 'Verificando…' : b.dataset.t || b.textContent; } if (msg != null) $('#lockMsg').textContent = msg; }
async function doSetup() {
  const p1 = $('#lp1').value, p2 = $('#lp2').value;
  if (p1.length < 8) return ($('#lockMsg').textContent = 'La clave debe tener al menos 8 caracteres.');
  if (p1 !== p2) return ($('#lockMsg').textContent = 'Las claves no coinciden.');
  lockBusy(true, '');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  vault.salt = b64(salt); vault.iter = 600000; vault.key = await deriveKey(p1, salt, vault.iter);
  try { const old = JSON.parse(localStorage.getItem(OLDKEY)); if (old && Array.isArray(old.products)) { S = Object.assign(emptyData(), old); localStorage.removeItem(OLDKEY); } } catch (e) {}
  save(); await saving; enter();
}
async function doUnlock() {
  const pass = $('#lp1').value; if (!pass) return;
  lockBusy(true, '');
  try {
    const env = JSON.parse(localStorage.getItem(VKEY));
    const key = await deriveKey(pass, unb64(env.salt), env.iter);
    const d = JSON.parse(await decStr(env, key));
    vault.key = key; vault.salt = env.salt; vault.iter = env.iter; S = Object.assign(emptyData(), d); fails = 0; enter();
  } catch (e) {
    fails++; const wait = Math.min(30, fails * 2);
    showLock('unlock', `Clave incorrecta. Espera ${wait} segundos para reintentar.`);
    $('#lockBtn').disabled = true; setTimeout(() => { const b = $('#lockBtn'); if (b) b.disabled = false; $('#lockMsg').textContent = ''; }, wait * 1000);
  }
}
function enter() { lockEl().classList.add('hidden'); lockBody().innerHTML = ''; render(); }
function lock() {
  vault.key = null; S = emptyData(); draft = null;
  $('#sheet').classList.add('hidden'); $('#toast').classList.add('hidden'); $('#view').innerHTML = '';
  showLock('unlock');
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (vault.key && hiddenAt && Date.now() - hiddenAt > 2 * 60 * 1000) lock();
});
function boot() { showLock(localStorage.getItem(VKEY) ? 'unlock' : 'setup'); }

/* ============ inicio ============ */
boot();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
