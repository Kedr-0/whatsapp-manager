/* ================================================================
   MultiWhats - Lógica de la interfaz
   (IIFE: evita colisión con el binding global expuesto por contextBridge)
   ================================================================ */
(function () {
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  accounts: [],
  statuses: {}, // id -> { status, unread }
  focusedId: null,
  panelOpen: false,
  templates: [],
};

let activeCategory = 'Todos';
let searchTerm = '';
let editingId = null;
let toastTimer = null;
let renameBusy = false;
let menuOpen = false;
let lastAccountsSig = '';

const api = window.api;

const STATUS_LABELS = {
  connected: 'Conectada',
  qr: 'Escanear QR',
  loading: 'Cargando…',
  error: 'Error de sincronización',
};

/* ---------------- Utilidades ---------------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function statusOf(id) {
  return state.statuses[id] || { status: 'loading', unread: 0 };
}

function unreadText(n) {
  return n > 99 ? '99+' : String(n);
}

/* ---------------- Inicialización ---------------- */

function applyState(s) {
  Object.assign(state, s);
  state.accounts = s.accounts || [];
  $('#app').classList.toggle('collapsed', !!state.sidebarCollapsed);
  $('#main').classList.toggle('panel-open', !!state.panelOpen);
  $('#btn-panel').classList.toggle('open', !!state.panelOpen);
  renderAccounts();
  renderZoomControls();
  renderPanelShell();
  $('#empty-state').classList.toggle('hidden', state.accounts.length > 0);
  // El espacio liberable solo cambia cuando cambian las cuentas (añadir /
  // quitar / recuperar), no en cada actualización de estado.
  const sig = state.accounts.map((a) => a.id).join(',');
  if (sig !== lastAccountsSig) {
    lastAccountsSig = sig;
    refreshCleanupButton();
  }
}

async function init() {
  api.onState((s) => applyState(s));

  api.onAccountStatus((s) => {
    const prev = state.statuses[s.id];
    const wasConnected = prev && prev.status === 'connected';
    state.statuses[s.id] = { status: s.status, unread: s.unread };
    if (!renameBusy) renderAccountCard(s.id);
    const acc = state.accounts.find((a) => a.id === s.id);
    if (s.status === 'connected' && !wasConnected && acc) {
      showToast(`📶 Cuenta "${acc.label}" conectada`);
    } else if (s.status === 'error' && acc && (!prev || prev.status !== 'error')) {
      showToast(`⚠️ ${acc.label}: error de sincronización — usa ⋮ → Re-vincular`);
    }
  });

  api.onViewProblem(({ id, type }) => {
    const acc = state.accounts.find((a) => a.id === id);
    if (!acc) return;
    if (type === 'failed') showToast(`⚠️ ${acc.label}: no pudo cargar, reintentando…`);
    else if (type === 'crashed') showToast(`⚠️ ${acc.label}: se reinició sola`);
    else if (type === 'reloading') showToast(`↻ ${acc.label}: recargando…`);
    else if (type === 'relinking') showToast(`🔗 ${acc.label}: sesión limpiada — escanea el QR 📱`);
  });

  wireSidebar();
  wireTopbar();
  wirePanel();
  wireEmptyState();
  observeBounds();

  const s = await api.uiReady();
  if (s) applyState(s);
  await loadTemplates();
}

function observeBounds() {
  const area = $('#views-area');
  const send = () => {
    const r = area.getBoundingClientRect();
    api.sendBounds({
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    });
  };
  const ro = new ResizeObserver(send);
  ro.observe(area);
  window.addEventListener('resize', send);
  window.addEventListener('load', send);
  setTimeout(send, 60);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      togglePanel();
    } else if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
      const idx = Number(e.key) - 1;
      const acc = state.accounts[idx];
      if (acc) focusAccount(acc.id);
    } else if (e.key === 'Escape') {
      // Sin acoplamiento no hay cuadrícula a la que volver: Esc solo cierra lo
      // que esté abierto en la interfaz (menú de cuenta, campos, formulario).
      const menu = $('.account-menu:not(.hidden)');
      if (menu) {
        closeAccountMenus();
        return;
      }
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (typing) {
        if (ae.blur) ae.blur();
        return;
      }
      if (!$('#qform').classList.contains('hidden')) {
        closeForm();
      }
    }
  });
}

/* ---------------- Cuentas ---------------- */

function renderAccounts() {
  const list = $('#account-list');
  if (!state.accounts.length) {
    list.innerHTML = '<li class="panel-empty">Sin cuentas todavía.<br/>Agrega la primera 👇</li>';
    return;
  }
  list.innerHTML = state.accounts.map((a) => accountCardHtml(a)).join('');
}

function accountCardHtml(a) {
  const st = statusOf(a.id);
  const active = state.focusedId === a.id;
  const dot =
    st.status === 'connected'
      ? 'status-connected'
      : st.status === 'qr'
        ? 'status-qr'
        : st.status === 'error'
          ? 'status-error'
          : 'status-loading';
  return `
    <li class="account-item ${active ? 'active' : ''}" data-id="${a.id}" title="${esc(a.label)} — ${STATUS_LABELS[st.status] || ''}. Clic: mostrar esta cuenta">
      <div class="avatar">${esc(a.label.charAt(0).toUpperCase())}</div>
      <div class="account-info">
        <div class="account-name" data-name>${esc(a.label)}</div>
        <div class="account-meta">${STATUS_LABELS[st.status] || ''}${st.status === 'connected' && st.unread > 0 ? ` · ${st.unread} sin leer` : ''}</div>
      </div>
      ${st.status === 'connected' && st.unread > 0 ? `<span class="unread-badge">${unreadText(st.unread)}</span>` : ''}
      ${a.muted ? '<span class="mute-flag" title="Silenciada">🔇</span>' : ''}
      <span class="status-dot ${dot}" title="${STATUS_LABELS[st.status] || ''}"></span>
      <button class="icon-btn action-menu" data-action="menu" title="Más opciones">⋮</button>
      <div class="account-menu hidden">
        <button class="menu-item" data-menu="reload" title="Recargar la página de WhatsApp">↻ Recargar</button>
        <button class="menu-item" data-menu="relink" title="Borrar los datos y escanear el QR de nuevo">🔗 Re-vincular</button>
        <button class="menu-item" data-menu="mute" title="${a.muted ? 'Activar sonido' : 'Silenciar esta cuenta'}">${a.muted ? '🔊 Activar sonido' : '🔇 Silenciar'}</button>
        <button class="menu-item" data-menu="rename" title="Cambiar el nombre">✎ Renombrar</button>
        <button class="menu-item danger" data-menu="remove" title="Eliminar cuenta">🗑 Eliminar</button>
      </div>
    </li>`;
}

function renderAccountCard(id) {
  if (menuOpen) return; // no reemplazar la tarjeta mientras el menú está abierto
  const acc = state.accounts.find((a) => a.id === id);
  const li = $(`#account-list .account-item[data-id="${id}"]`);
  if (acc && li) li.outerHTML = accountCardHtml(acc);
}

function focusAccount(id) {
  api.accountsFocus(id); // sin acoplamiento: pulsar una cuenta siempre la muestra
}

function startRename(id, li) {
  if (renameBusy) return;
  renameBusy = true;
  const acc = state.accounts.find((a) => a.id === id);
  const nameEl = li.querySelector('[data-name]');
  const input = document.createElement('input');
  input.value = acc.label;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = (save) => {
    const val = input.value.trim();
    if (save && val && val !== acc.label) api.accountsRename(id, val);
    renameBusy = false;
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      finish(true);
      renderAccounts();
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // cancelar el renombrado sin volver a la cuadrícula
      finish(false);
      renderAccounts();
    }
  });
  input.addEventListener('blur', () => {
    if (renameBusy) {
      finish(true);
      renderAccounts();
    }
  });
}

async function requestAddAccount() {
  try {
    const r = await api.accountsAdd();
    if (r && r.ok === false) showToast('⚠️ No se pudo agregar la cuenta');
    else showToast('Cuenta agregada · escanea el QR 📱');
  } catch {
    showToast('⚠️ No se pudo agregar la cuenta');
  }
}

function removeAccount(id) {
  const acc = state.accounts.find((a) => a.id === id);
  if (!acc) return;
  if (confirm(`¿Eliminar la cuenta "${acc.label}"?\nSe cerrará su sesión de WhatsApp en esta app.`)) {
    api.accountsRemove(id).catch(() => showToast('⚠️ No se pudo eliminar'));
    showToast('Cuenta eliminada');
  }
}

function closeAccountMenus() {
  menuOpen = false;
  $$('.account-menu').forEach((m) => m.classList.add('hidden'));
}

function handleCardMenu(li, action, id) {
  const acc = state.accounts.find((a) => a.id === id);
  if (action === 'reload') {
    api.accountsReload(id);
    showToast('↻ Recargando cuenta…');
  } else if (action === 'relink') {
    if (!acc) return;
    if (
      confirm(
        `¿Re-vincular la cuenta "${acc.label}"?\nSe cerrará su sesión en la app (no en tu teléfono) y deberás escanear el código QR de nuevo. Sirve para arreglar el error de sincronización.`
      )
    ) {
      showToast('🔗 Limpiando datos de la cuenta…');
      api.accountsRelink(id).then((r) => {
        if (r && r.ok) showToast('🔗 Datos limpiados — escanea el QR 📱');
      });
    }
  } else if (action === 'mute') {
    if (acc) api.accountsMute(id, !acc.muted);
  } else if (action === 'rename') {
    startRename(id, li);
  } else if (action === 'remove') {
    removeAccount(id);
  }
}

function wireSidebar() {
  $('#account-list').addEventListener('click', (e) => {
    const li = e.target.closest('.account-item');
    if (!li) return;
    const id = li.dataset.id;
    const actionBtn = e.target.closest('[data-action="menu"]');
    const menuItem = e.target.closest('.menu-item');
    if (actionBtn) {
      const menu = li.querySelector('.account-menu');
      const willOpen = menu.classList.contains('hidden');
      closeAccountMenus();
      if (willOpen) {
        menuOpen = true;
        menu.classList.remove('hidden');
        setTimeout(() => li.classList.add('menu-open'), 0);
      }
      return;
    }
    if (menuItem) {
      const act = menuItem.dataset.menu;
      closeAccountMenus();
      handleCardMenu(li, act, id);
      return;
    }
    closeAccountMenus();
    focusAccount(id);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.account-item')) closeAccountMenus();
  });

  $('#btn-add').addEventListener('click', requestAddAccount);

  $('#btn-collapse').addEventListener('click', () => {
    const app = document.getElementById('app');
    const collapsed = !app.classList.contains('collapsed');
    app.classList.toggle('collapsed', collapsed);
    api.setPrefs({ sidebarCollapsed: collapsed });
  });
}

/* ---------------- Topbar / layouts ---------------- */

function renderZoomControls() {
  const acc = state.accounts.find((a) => a.id === state.focusedId);
  const zc = $('#zoom-controls');
  zc.classList.toggle('disabled', !acc);
  const zv = $('#zoom-val');
  const manual = acc && typeof acc.zoom === 'number';
  const applied = acc ? Math.round((acc.appliedZoom || 1) * 100) : null;
  zv.textContent = !acc ? 'Auto' : applied + '%';
  zv.classList.toggle('manual', !!manual);
  zv.title = !acc
    ? 'Zoom de la cuenta enfocada'
    : manual
      ? `Zoom fijo ${Math.round(acc.zoom * 100)}% (actual ${applied}%) — clic para volver a automático`
      : `Zoom automático ${applied}% — se ajusta al tamaño de la ventana. Clic para restablecer`;
}

function focusedAccount() {
  return state.accounts.find((a) => a.id === state.focusedId);
}

function changeZoom(delta) {
  const a = focusedAccount();
  if (!a) return;
  // Parte del zoom realmente aplicado (no de 100%): evita saltos bruscos.
  const cur = typeof a.zoom === 'number' ? a.zoom : a.appliedZoom || 1;
  const next = Math.min(1.5, Math.max(0.25, Math.round((cur + delta / 100) * 100) / 100));
  api.accountsZoom(a.id, next);
}

/* ---------------- Liberar espacio ---------------- */

function fmtBytes(n) {
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  return Math.max(1, Math.round(n / (1024 * 1024))) + ' MB';
}

async function refreshCleanupButton() {
  const btn = $('#btn-cleanup');
  try {
    const r = await api.sessionsSpace();
    const freeable = (r && r.freeable) || 0;
    btn.classList.toggle('hidden', freeable < 1024 * 1024);
    if (freeable >= 1024 * 1024) btn.textContent = `🧹 Liberar espacio (${fmtBytes(freeable)})`;
  } catch {
    btn.classList.add('hidden');
  }
}

async function onCleanupClick() {
  const btn = $('#btn-cleanup');
  if (btn.disabled) return;
  let r;
  try {
    r = await api.sessionsSpace();
  } catch {
    return;
  }
  const freeable = (r && r.freeable) || 0;
  if (freeable < 1024 * 1024) {
    refreshCleanupButton();
    return;
  }
  const accCount = state.accounts.length;
  const msg =
    `¿Liberar ${fmtBytes(freeable)} de espacio?\n\n` +
    'Se eliminarán las sesiones antiguas de WhatsApp que ya no usa ninguna cuenta activa (carpetas huérfanas en disco).\n\n' +
    (accCount === 0
      ? '⚠️ No tienes cuentas activas en este momento: esto borraría TODAS las sesiones guardadas, incluidas las que puedes recuperar al reiniciar la app.'
      : `Tus ${accCount} cuenta${accCount === 1 ? '' : 's'} activa${accCount === 1 ? '' : 's'} no se tocan.`);
  if (!confirm(msg)) return;
  btn.disabled = true;
  btn.textContent = '🧹 Liberando…';
  try {
    const res = await api.cleanupSessions();
    if (res && res.freed > 0) {
      showToast(`🧹 ${fmtBytes(res.freed)} liberados · ${res.count} sesiones viejas eliminadas`);
    } else {
      showToast('🧹 No había sesiones que eliminar');
    }
  } catch {
    showToast('⚠️ No se pudo liberar espacio');
  } finally {
    btn.disabled = false;
    refreshCleanupButton();
  }
}

function wireTopbar() {
  $('#zoom-out').addEventListener('click', () => changeZoom(-10));
  $('#zoom-in').addEventListener('click', () => changeZoom(10));
  $('#zoom-val').addEventListener('click', () => {
    const a = focusedAccount();
    if (a) api.accountsZoom(a.id, 'auto');
  });

  $('#btn-cleanup').addEventListener('click', onCleanupClick);

  $('#btn-panel').addEventListener('click', togglePanel);
  $('#btn-panel-close').addEventListener('click', togglePanel);
}

function togglePanel() {
  const main = $('#main');
  const open = !main.classList.contains('panel-open');
  main.classList.toggle('panel-open', open);
  $('#btn-panel').classList.toggle('open', open);
  state.panelOpen = open;
  api.setPrefs({ panelOpen: open });
}

/* ---------------- Mensajes rápidos ---------------- */

async function loadTemplates() {
  state.templates = await api.templatesLoad();
  renderPanelShell();
}

function renderPanelShell() {
  $('#msg-count').textContent = state.templates.length;
  renderChips();
  renderTemplateList();
  renderCategoryDatalist();
}

function renderChips() {
  const cats = ['Todos', ...Array.from(new Set(state.templates.map((t) => t.category)))];
  $('#qcats').innerHTML = cats
    .map(
      (c) =>
        `<button class="cat-chip${c === activeCategory ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`
    )
    .join('');
}

function renderCategoryDatalist() {
  const cats = Array.from(new Set(state.templates.map((t) => t.category)));
  $('#cat-options').innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
}

function renderTemplateList() {
  const term = searchTerm.toLowerCase();
  const list = state.templates.filter((t) => {
    const okCat = activeCategory === 'Todos' || t.category === activeCategory;
    const okTerm = !term || t.text.toLowerCase().includes(term) || t.category.toLowerCase().includes(term);
    return okCat && okTerm;
  });

  const box = $('#qlist');
  if (!list.length) {
    box.innerHTML = `<div class="panel-empty">${
      state.templates.length ? 'Sin resultados para tu búsqueda 🔍' : 'No hay mensajes todavía.<br/>Crea el primero 👇'
    }</div>`;
    return;
  }
  box.innerHTML = list
    .map(
      (t) => `
      <div class="msg-card" data-id="${t.id}">
        <div class="msg-cat">${esc(t.category)}</div>
        <div class="msg-text">${esc(t.text)}</div>
        <div class="msg-actions">
          <button class="copy-btn" data-copy="${t.id}">📋 Copiar</button>
          <button class="icon-btn" data-edit="${t.id}" title="Editar">✎</button>
          <button class="icon-btn danger" data-del="${t.id}" title="Eliminar">🗑</button>
        </div>
      </div>`
    )
    .join('');
}

async function copyMessage(id) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return;
  await api.copyText(t.text);
  const btn = $(`[data-copy="${id}"]`);
  if (btn) {
    btn.classList.add('copied');
    btn.textContent = '✓ Copiado';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = '📋 Copiar';
    }, 1300);
  }
  showToast('📋 Mensaje copiado al portapapeles');
}

function openForm(id) {
  const form = $('#qform');
  editingId = id || null;
  const t = id ? state.templates.find((x) => x.id === id) : null;
  $('#qtext').value = t ? t.text : '';
  $('#qcat').value = t ? t.category : '';
  form.classList.remove('hidden');
  form.scrollIntoView({ block: 'nearest' });
  $('#qtext').focus();
}

function closeForm() {
  editingId = null;
  $('#qform').classList.add('hidden');
}

async function saveForm(e) {
  e.preventDefault();
  const text = $('#qtext').value.trim();
  const category = $('#qcat').value.trim() || 'Otros';
  if (!text) {
    showToast('Escribe el texto del mensaje ✏️');
    return;
  }
  let list;
  if (editingId) {
    list = state.templates.map((t) => (t.id === editingId ? { ...t, text, category } : t));
    showToast('Mensaje actualizado ✓');
  } else {
    list = [...state.templates, { id: `${Date.now()}`, category, text }];
    showToast('Mensaje guardado ✓');
  }
  await api.templatesSave(list);
  state.templates = list;
  closeForm();
  renderPanelShell();
}

async function deleteTemplate(id) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return;
  if (!confirm('¿Eliminar este mensaje?')) return;
  const list = state.templates.filter((x) => x.id !== id);
  await api.templatesSave(list);
  state.templates = list;
  renderPanelShell();
  showToast('Mensaje eliminado');
}

function wirePanel() {
  $('#qsearch').addEventListener('input', (e) => {
    searchTerm = e.target.value;
    renderTemplateList();
  });

  $('#qcats').addEventListener('click', (e) => {
    const chip = e.target.closest('.cat-chip');
    if (!chip) return;
    activeCategory = chip.dataset.cat;
    renderChips();
    renderTemplateList();
  });

  $('#btn-new-msg').addEventListener('click', () => openForm(null));

  $('#qform').addEventListener('submit', saveForm);
  $('#qcancel').addEventListener('click', closeForm);

  $('#qlist').addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (copy) copyMessage(copy.dataset.copy);
    else if (edit) openForm(edit.dataset.edit);
    else if (del) deleteTemplate(del.dataset.del);
  });
}

/* ---------------- Estado vacío ---------------- */

function wireEmptyState() {
  $('#btn-empty-add').addEventListener('click', requestAddAccount);
}

/* ---------------- Arranque ---------------- */

document.addEventListener('DOMContentLoaded', init);

})();
