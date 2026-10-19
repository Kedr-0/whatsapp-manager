'use strict';

const {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  clipboard,
  shell,
  Menu,
  dialog,
  desktopCapturer,
} = require('electron');
const path = require('path');
const fs = require('fs');

/* ------------------------------------------------------------------ */
/*  Constantes                                                          */
/* ------------------------------------------------------------------ */

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WA_URL = 'https://web.whatsapp.com/';
const SMOKE = process.argv.includes('--smoke-test');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/* ------------------------------------------------------------------ */
/*  Plantillas por defecto (se siembran en la primera ejecución)        */
/* ------------------------------------------------------------------ */

const DEFAULT_TEMPLATES = [
  { id: 't1', category: 'Saludos', text: '¡Hola! 👋 ¿En qué puedo ayudarte hoy?' },
  { id: 't2', category: 'Saludos', text: '¡Buenos días! ☀️ Espero que tengas un excelente día.' },
  { id: 't3', category: 'Saludos', text: '¡Buenas tardes! ¿Cómo te puedo ayudar?' },
  { id: 't4', category: 'Saludos', text: '¡Buenas noches! 🌙 Gracias por escribirnos, en breve te atendemos.' },
  { id: 't5', category: 'Seguimiento', text: 'Hola, ¿pudiste revisar la información que te envié?' },
  { id: 't6', category: 'Seguimiento', text: 'Te escribo para darle seguimiento a tu consulta. ¿Quedó todo claro?' },
  { id: 't7', category: 'Seguimiento', text: '👋 Te recuerdo nuestra conversación anterior. ¿Puedo ayudarte en algo más?' },
  { id: 't8', category: 'Promociones', text: '🔥 ¡Promoción especial por tiempo limitado! Hoy tenemos descuentos que no querrás perderte.' },
  { id: 't9', category: 'Promociones', text: '🚀 ¡Nuevo producto disponible! Escríbenos y te pasamos todos los detalles.' },
  { id: 't10', category: 'Ventas', text: '¡Perfecto! ✅ Para confirmar tu pedido solo necesito tu nombre y dirección de entrega. 📦' },
  { id: 't11', category: 'Ventas', text: '¡Gracias por tu compra! 🙌 Te confirmaré el envío en breve.' },
  { id: 't12', category: 'Pagos', text: '¡Hola! Para completar tu pago puedes transferir a la cuenta que te indico a continuación. 💳' },
  { id: 't13', category: 'Pagos', text: '¿Ya realizaste tu pago? Confírmame y te envío tu comprobante. ✅' },
  { id: 't14', category: 'Respuestas rápidas', text: 'Sí, claro. 👌' },
  { id: 't15', category: 'Respuestas rápidas', text: 'Un momento, por favor. 🙏' },
  { id: 't16', category: 'Respuestas rápidas', text: 'Gracias por tu paciencia. 😊' },
  { id: 't17', category: 'Respuestas rápidas', text: '¿Podrías darme un poco más de detalle, por favor?' },
];

/* ------------------------------------------------------------------ */
/*  Estado de la aplicación                                             */
/* ------------------------------------------------------------------ */

let win = null;
const accounts = []; // { id, label, muted }
const views = new Map(); // id -> WebContentsView
const lastStatus = new Map(); // id -> { status, unread }
let focusedId = null;
let sidebarCollapsed = false;
let panelOpen = false;
let bounds = { x: 232, y: 56, width: 1000, height: 700 };

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const templatesPath = () => path.join(app.getPath('userData'), 'templates.json');
const logPath = () => path.join(app.getPath('userData'), 'startup.log');

function log(...args) {
  try {
    fs.appendFileSync(logPath(), `[${new Date().toISOString()}] ${args.join(' ')}${'\n'}`);
  } catch {
    /* noop */
  }
  console.log(...args);
}

/* ------------------------------------------------------------------ */
/*  Persistencia                                                       */
/* ------------------------------------------------------------------ */

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings() {
  const data = {
    accounts: accounts.map((a) => ({ id: a.id, label: a.label, muted: !!a.muted, zoom: a.zoom })),
    sidebarCollapsed,
    panelOpen,
    winBounds: win && !win.isDestroyed() ? win.getBounds() : null,
  };
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(data, null, 2));
  } catch {
    /* noop */
  }
}

function loadTemplates() {
  try {
    const arr = JSON.parse(fs.readFileSync(templatesPath(), 'utf8'));
    if (Array.isArray(arr)) return arr;
  } catch {
    /* noop */
  }
  return DEFAULT_TEMPLATES.map((t) => ({ ...t }));
}

function saveTemplates(list) {
  try {
    fs.writeFileSync(templatesPath(), JSON.stringify(list, null, 2));
  } catch {
    /* noop */
  }
}

/* ------------------------------------------------------------------ */
/*  Recuperación y limpieza de sesiones                                 */
/* ------------------------------------------------------------------ */

function dirSize(p) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, f.name);
      if (f.isDirectory()) total += dirSize(fp);
      else total += fs.statSync(fp).size;
    }
  } catch {
    /* noop */
  }
  return total;
}

const SESSION_NAME_RE = /^whatsapp-\d{13}-[a-z0-9]{4}$/i;

// Sesiones reales (con datos de WhatsApp) que quedaron huérfanas en disco por el
// antiguo bug de ids regenerados. Las carpetas diminutas son restos de pruebas.
// Se ordenan por RECENCIA: la sesión viva del usuario es la que usó por última
// vez (mtime más reciente), no necesariamente la más grande.
function sessionCandidates() {
  const dir = path.join(app.getPath('userData'), 'Partitions');
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((n) => SESSION_NAME_RE.test(n))
    .map((n) => {
      const p = path.join(dir, n);
      let mtime = 0;
      try {
        mtime = fs.statSync(p).mtimeMs;
      } catch {
        /* noop */
      }
      return { name: n, size: dirSize(p), mtime };
    })
    .filter((s) => s.size > 20 * 1024 * 1024) // solo sesiones con datos reales
    .sort((a, b) => b.mtime - a.mtime || b.size - a.size);
}

async function recoverSessions() {
  if (!win || win.isDestroyed()) return;
  const cands = sessionCandidates();
  if (!cands.length) return;
  const n = Math.min(4, cands.length);
  try {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Recuperar sesiones', 'Empezar desde cero'],
      defaultId: 0,
      cancelId: 1,
      title: 'Sesiones de WhatsApp encontradas',
      message: `Se encontraron ${cands.length} sesiones de WhatsApp guardadas de aperturas anteriores.`,
      detail:
        '¿Quieres recuperarlas como cuentas para no tener que escanear el código QR de nuevo?\n\n' +
        `Se crearán las ${n} más recientes${n < cands.length ? ` (de ${cands.length})` : ''}; las que no te sirvan puedes eliminarlas con ⋮ → Eliminar.`,
    });
    if (response !== 0) return;
  } catch {
    return;
  }
  for (let i = 0; i < n; i++) {
    const id = cands[i].name.replace(/^whatsapp-/, '');
    addAccount(`Cuenta ${i + 1}`, WA_URL, false, null, id);
    log(`[recuperación] sesión restaurada: ${id} → Cuenta ${i + 1}`);
  }
}

// Sesiones en disco que NO pertenecen a ninguna cuenta activa (huérfanas).
function orphanedSessions() {
  const dir = path.join(app.getPath('userData'), 'Partitions');
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const active = new Set(accounts.map((a) => a.id));
  const out = [];
  for (const name of entries) {
    if (!SESSION_NAME_RE.test(name)) continue;
    if (active.has(name.replace(/^whatsapp-/, ''))) continue;
    const p = path.join(dir, name);
    try {
      out.push({ name, path: p, size: dirSize(p) });
    } catch {
      /* noop */
    }
  }
  return out;
}

// En el arranque solo se borra basura diminuta (<1MB): restos de pruebas o de
// sesiones ya eliminadas. Nunca toca las grandes; la limpieza completa de
// huérfanas queda para el botón 'Liberar espacio' de la interfaz.
function cleanupJunkSessions() {
  for (const s of orphanedSessions()) {
    if (s.size >= 1024 * 1024) continue;
    try {
      fs.rmSync(s.path, { recursive: true, force: true });
      log(`[limpieza] sesión basura eliminada: ${s.name}`);
    } catch {
      /* noop */
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Vistas de WhatsApp (una por cuenta)                                 */
/* ------------------------------------------------------------------ */

function smokeUrl() {
  return 'data:text/html,<style>*{margin:0}body{background:#0b141a;color:#25d366;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;font-size:22px}</style><h1>Vista WhatsApp</h1>';
}

function partitionFor(id) {
  // Las particiones persistentes conservan la sesión de WhatsApp entre reinicios.
  // En modo prueba (--smoke-test) se usan particiones efímeras para no llenar el
  // disco con datos de prueba.
  return SMOKE ? `whatsapp-${id}` : `persist:whatsapp-${id}`;
}

// Añade una cuenta. `focus` indica que debe mostrarse de inmediato (al añadirla
// desde la interfaz, para escanear su QR). En el arranque/recuperación se omite:
// solo la PRIMERA cuenta añadida queda enfocada y las demás no roban el foco.
function addAccount(label, url, muted, zoom, existingId, focus) {
  const targetUrl = url || WA_URL; // IMPORTANTE: sin URL por defecto fallaba 'Agregar cuenta'
  // Se reutiliza el id guardado para reabrir SU partición persistente y, con ella,
  // su sesión de WhatsApp. Sin esto, cada reinicio creaba una partición nueva y
  // había que escanear el código QR otra vez.
  let id;
  if (existingId && /^\d{13}-[a-z0-9]{4}$/i.test(existingId)) {
    id = existingId;
  } else {
    if (existingId) log(`[aviso] id guardado inválido, se genera uno nuevo: ${existingId}`);
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }
  const acc = { id, label: label || `Cuenta ${accounts.length + 1}`, muted: !!muted, zoom: typeof zoom === 'number' ? zoom : null };

  const partition = partitionFor(id);
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(true));

  const view = new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  ses.setDisplayMediaRequestHandler((request, callback) => {
    // Compartir pantalla en llamadas de WhatsApp
    desktopCapturer
      .getSources({ types: ['screen', 'window'] })
      .then((sources) => {
        if (!sources.length) return callback({});
        const preferred = sources.find((s) => request.screenId && s.id === request.screenId) || sources[0];
        callback({ video: preferred, audio: 'loopback' });
      })
      .catch(() => callback({}));
  });

  const wc = view.webContents;
  wc.setUserAgent(CHROME_UA);
  wc.setAudioMuted(acc.muted);
  wc.setBackgroundThrottling(false);
  wc.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http')) shell.openExternal(target);
    return { action: 'deny' };
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    log(`[view ${id}] load fail ${code} ${desc} (main=${isMainFrame})`);
    // -3 = ERR_ABORTED (redirecciones/navegación normal) · subframes (imágenes,
    // miniaturas) no deben recargar la página ni gastar reintentos.
    if (code === -3 || !isMainFrame) return;
    reloadView(acc);
  });
  wc.on('did-finish-load', () => {
    acc._reloads = 0;
    acc._stuckPolls = 0;
    applyZoom(acc);
  });
  wc.on('render-process-gone', (_e, details) => {
    log(`[view ${id}] render-process-gone ${details && details.reason}`);
    reloadView(acc);
  });
  // Sin acoplamiento no hay 'vista de todas las cuentas' a la que volver: Esc
  // nunca se intercepta y siempre llega a WhatsApp (para cerrar sus buscadores,
  // menús o paneles).

  view.setVisible(false);
  win.contentView.addChildView(view);
  views.set(id, view);
  // El push va DESPUÉS de las operaciones que pueden fallar: así la cuenta
  // nunca queda fantasma en settings.json si algo lanza a mitad de camino.
  accounts.push(acc);
  wc.loadURL(targetUrl).catch(() => {});

  // Sin acoplamiento solo hay una cuenta visible a la vez. Al añadirla a mano
  // (focus) se muestra de inmediato; en el arranque, la primera cuenta añadida
  // queda enfocada y las demás no le roban el foco.
  if (focus) focusedId = id;
  else if (!focusedId) focusedId = id;

  pushState();
  layoutViews();
  // El foco de teclado debe quedar en la cuenta mostrada: así Esc llega a su
  // WhatsApp (cerrar buscador, menús, paneles) sin tener que hacer clic antes.
  if (focusedId === id) focusView(id);
  return id;
}

function notifyViewProblem(acc, type) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('view:problem', { id: acc.id, type });
  }
}

function reloadView(acc) {
  const view = views.get(acc.id);
  if (!view || view.webContents.isDestroyed()) return;
  // Deduplica recargas muy seguidas (un crash puede disparar render-process-gone
  // y did-fail-load a la vez).
  const now = Date.now();
  if (acc._lastReloadAt && now - acc._lastReloadAt < 2000) return;
  acc._lastReloadAt = now;
  const n = (acc._reloads || 0) + 1;
  acc._reloads = n;
  acc._stuckPolls = 0;
  if (n > 4) {
    log(`[view ${acc.id}] se detienen los reintentos (${n})`);
    return; // nunca en bucle infinito
  }
  const doReload = () => {
    if (!view.webContents.isDestroyed()) view.webContents.reload();
  };
  if (n >= 2) {
    // En el segundo reintento se limpia la caché del servicio (causa común de
    // pantalla en blanco en WhatsApp Web). No cierra la sesión. La recarga se
    // encadena a la limpieza para no competir con ella.
    session
      .fromPartition(partitionFor(acc.id))
      .clearCache()
      .then(doReload)
      .catch(doReload);
  } else {
    doReload();
  }
  log(`[view ${acc.id}] recargando (intento ${n})`);
  notifyViewProblem(acc, 'reloading');
}

function removeAccount(id) {
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) return;
  const view = views.get(id);
  if (view && !view.webContents.isDestroyed()) {
    win.contentView.removeChildView(view);
    view.webContents.close();
  }
  views.delete(id);
  lastStatus.delete(id);
  accounts.splice(idx, 1);
  session.fromPartition(partitionFor(id)).clearStorageData().catch(() => {});
  if (focusedId === id) focusedId = null;
  layoutViews();
  pushState();
}

/* ------------------------------------------------------------------ */
/*  Distribución (una sola cuenta visible)                              */
/* ------------------------------------------------------------------ */

/* Zoom automático: WhatsApp Web no se adapta a paneles pequeños y sus
   mensajes se superponen. Reducimos el zoom de la vista para que el diseño
   completo quepa sin pisarse. Ancho natural objetivo: ~900px. */
function autoZoomFor(vw) {
  const zf = vw / 900;
  return Math.min(1, Math.max(0.3, Math.round(zf * 100) / 100));
}

// Da el foco de teclado a la vista de una cuenta para que las teclas (Esc,
// flechas, etc.) lleguen a su WhatsApp y no a la interfaz.
function focusView(id) {
  const view = views.get(id);
  if (view && !view.webContents.isDestroyed()) view.webContents.focus();
}

function applyZoom(acc) {
  const view = views.get(acc.id);
  if (!view || view.webContents.isDestroyed()) return;
  let zf;
  if (typeof acc.zoom === 'number') {
    zf = acc.zoom; // zoom manual elegido por el usuario
  } else {
    const st = lastStatus.get(acc.id);
    const vw = view.getBounds().width;
    if (st && st.status === 'qr') {
      // QR escaneable: se ajusta solo si el panel es muy angosto (nunca desborda).
      zf = Math.min(1, Math.max(0.3, Math.round((vw / 560) * 100) / 100));
    } else {
      zf = autoZoomFor(vw);
    }
  }
  if (Math.abs((acc._appliedZoom || 1) - zf) > 0.02) {
    acc._appliedZoom = zf;
    view.webContents.setZoomFactor(zf);
  }
}

function layoutViews() {
  if (!win || win.isDestroyed()) return;
  if (bounds.width < 100 || bounds.height < 100) return;

  const visible = accounts.filter((a) => views.has(a.id));
  if (!visible.length) return;

  // Sin acoplamiento: siempre hay UNA cuenta visible ocupando todo el área.
  // Si no hay ninguna enfocada (o la enfocada ya no existe), se elige la primera
  // y se notifica al renderer (p. ej. tras eliminar la cuenta enfocada).
  if (!visible.some((a) => a.id === focusedId)) {
    focusedId = visible[0].id;
    pushState();
    focusView(focusedId);
  }

  visible.forEach((acc) => {
    const view = views.get(acc.id);
    if (!view || view.webContents.isDestroyed()) return;
    if (focusedId !== acc.id) {
      view.setVisible(false);
      return;
    }
    view.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
    view.setVisible(true);
    applyZoom(acc);
  });
}

/* ------------------------------------------------------------------ */
/*  Estado de conexión (polling ligero)                                 */
/* ------------------------------------------------------------------ */

const STATUS_SCRIPT = `(function () {
  try {
    var chats = !!document.querySelector('#pane-side') || !!document.querySelector('[data-testid="chat-list"]');
    var qr = !!document.querySelector('[data-testid="qrcode"]') ||
      (!chats && document.querySelector('canvas') !== null);
    var unread = 0;
    var nodes = document.querySelectorAll('[data-testid="unread-count"], .pane-chat-unread');
    for (var i = 0; i < nodes.length; i++) {
      var t = parseInt(nodes[i].innerText, 10);
      if (!isNaN(t)) unread += t;
    }
    // Solo se inspecciona el texto cuando no hay chat ni QR (el error de
    // sincronización aparece en una pantalla propia). textContent no fuerza layout.
    var syncError = false;
    if (!chats && !qr) {
      var bodyText = document.body ? document.body.textContent : '';
      syncError = /(error de sincroniz|error al sincroniz|sync error|sync failed|error syncing|no se pudo sincroniz|failed to sync)/i.test(bodyText);
    }
    var status = chats ? 'connected' : (qr ? 'qr' : (syncError ? 'error' : 'loading'));
    return { status: status, unread: unread };
  } catch (e) {
    return { status: 'loading', unread: 0 };
  }
})()`;

function pollStatuses() {
  if (SMOKE) return;
  for (const acc of accounts) {
    const view = views.get(acc.id);
    if (!view || view.webContents.isDestroyed() || view.webContents.isLoadingMainFrame()) continue;
    view.webContents
      .executeJavaScript(STATUS_SCRIPT, true)
      .then((res) => {
        if (!res) return;
        const prev = lastStatus.get(acc.id);
        const changed = !prev || prev.status !== res.status || prev.unread !== res.unread;
        lastStatus.set(acc.id, res);
        if (changed) log(`[view ${acc.id}] estado: ${res.status} (${res.unread} sin leer)`);
        if (changed && win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('account:status', { id: acc.id, status: res.status, unread: res.unread });
          applyZoom(acc); // el zoom depende del estado (QR a 100%, conectado se ajusta)
        }
        // Detección de pantalla en blanco: atascado en 'loading' sin QR ni
        // chat mientras la página terminó de cargar → se recarga sola.
        // Las vistas ocultas (modo vista única) no cuentan.
        const hidden = focusedId && focusedId !== acc.id;
        if (res.status === 'loading' && !hidden && !view.webContents.isLoadingMainFrame()) {
          acc._stuckPolls = (acc._stuckPolls || 0) + 1;
        } else {
          acc._stuckPolls = 0;
        }
        if ((acc._stuckPolls || 0) >= 20) {
          log(`[view ${acc.id}] pantalla en blanco detectada, recargando`);
          acc._stuckPolls = 0;
          reloadView(acc);
        }
      })
      .catch(() => {});
  }
}
setInterval(pollStatuses, 2500);

/* ------------------------------------------------------------------ */
/*  Comunicación con la UI                                              */
/* ------------------------------------------------------------------ */

function makeState() {
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      label: a.label,
      muted: !!a.muted,
      zoom: a.zoom,
      appliedZoom: a._appliedZoom || 1,
    })),
    focusedId,
    sidebarCollapsed,
    panelOpen,
    statuses: Object.fromEntries(lastStatus),
  };
}

function pushState() {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isLoading()) return;
  win.webContents.send('state:push', makeState());
}

function registerIpc() {
  ipcMain.handle('ui:ready', () => makeState());
  ipcMain.on('ui:bounds', (_e, rect) => {
    if (!rect) return;
    bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    layoutViews();
  });

  ipcMain.handle('accounts:add', () => {
    try {
      // focus=true: la cuenta nueva se muestra de inmediato (escanear su QR).
      addAccount(`Cuenta ${accounts.length + 1}`, undefined, undefined, undefined, undefined, true);
      return { ok: true };
    } catch (err) {
      log('[accounts:add]', err);
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle('accounts:remove', (_e, id) => {
    try {
      removeAccount(id);
      return { ok: true };
    } catch (err) {
      log('[accounts:remove]', err);
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle('accounts:rename', (_e, id, label) => {
    const acc = accounts.find((a) => a.id === id);
    if (acc && label && label.trim()) {
      acc.label = label.trim();
      pushState();
    }
    return true;
  });
  ipcMain.handle('accounts:focus', (_e, id) => {
    focusedId = id;
    layoutViews();
    pushState();
    // Si el id era válido, layoutViews lo mantuvo: enfocar para que Esc llegue
    // al WhatsApp de la cuenta mostrada (si no, layoutViews ya enfocó otra).
    if (focusedId === id) focusView(id);
    return true;
  });
  ipcMain.on('ui:prefs', (_e, prefs) => {
    if (prefs && typeof prefs === 'object') {
      if (typeof prefs.panelOpen === 'boolean') panelOpen = prefs.panelOpen;
      if (typeof prefs.sidebarCollapsed === 'boolean') sidebarCollapsed = prefs.sidebarCollapsed;
    }
  });
  ipcMain.handle('accounts:mute', (_e, id, muted) => {
    const acc = accounts.find((a) => a.id === id);
    if (acc) {
      acc.muted = !!muted;
      const view = views.get(id);
      if (view && !view.webContents.isDestroyed()) view.webContents.setAudioMuted(acc.muted);
      pushState();
    }
    return true;
  });
  ipcMain.handle('accounts:zoom', (_e, id, zoom) => {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return true;
    if (zoom === null || zoom === 'auto') {
      acc.zoom = null;
    } else {
      const z = Math.min(1.5, Math.max(0.25, Number(zoom) || 1));
      acc.zoom = Math.round(z * 100) / 100;
    }
    acc._appliedZoom = undefined; // fuerza la reaplicación
    applyZoom(acc);
    pushState();
    return true;
  });
  ipcMain.handle('accounts:reload', (_e, id) => {
    const acc = accounts.find((a) => a.id === id);
    if (acc) {
      acc._reloads = 0; // recarga manual: contador en cero
      reloadView(acc);
    }
    return true;
  });
  ipcMain.handle('accounts:relink', async (_e, id) => {
    const acc = accounts.find((a) => a.id === id);
    if (!acc || acc._relinking) return { ok: false };
    acc._relinking = true;
    try {
      const view = views.get(id);
      const partition = partitionFor(id);
      try {
        // Borra los datos locales de la sesión (IndexedDB, cookies, caché,
        // service workers...). Es la solución para el 'error de sincronización'.
        await session.fromPartition(partition).clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem'],
        });
        log(`[view ${id}] datos de la cuenta limpiados (re-vinculación)`);
      } catch (err) {
        log('[accounts:relink]', err);
      }
      acc._reloads = 0;
      acc._stuckPolls = 0;
      lastStatus.delete(id);
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.loadURL(WA_URL).catch(() => {});
      }
      pushState();
      notifyViewProblem(acc, 'relinking');
      return { ok: true };
    } finally {
      acc._relinking = false;
    }
  });

  // Espacio que liberaría el botón 'Liberar espacio' (solo sesiones huérfanas,
  // nunca las de cuentas activas). Con caché de TTL: recorrer el disco con
  // dirSize es síncrono y no debe congelar el proceso principal en cada cambio
  // de cuentas (añadir/quitar/recuperar).
  let spaceCache = { at: 0, freeable: 0 };
  const SPACE_TTL_MS = 15000;
  const freeableSpace = (force) => {
    const now = Date.now();
    if (!force && now - spaceCache.at < SPACE_TTL_MS) return spaceCache.freeable;
    const v = orphanedSessions().reduce((sum, s) => sum + s.size, 0);
    spaceCache = { at: now, freeable: v };
    return v;
  };
  ipcMain.handle('sessions:space', () => ({ freeable: freeableSpace(false) }));
  ipcMain.handle('sessions:cleanup', () => {
    const list = orphanedSessions();
    let freed = 0;
    let deleted = 0;
    for (const s of list) {
      try {
        fs.rmSync(s.path, { recursive: true, force: true });
        freed += s.size;
        deleted += 1;
        log(`[liberar espacio] sesión eliminada: ${s.name}`);
      } catch (err) {
        log('[sessions:cleanup]', err);
      }
    }
    spaceCache = { at: 0, freeable: 0 }; // invalidar caché tras borrar
    return { freed, count: deleted };
  });

  ipcMain.handle('copy:text', (_e, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });
  ipcMain.handle('templates:load', () => loadTemplates());
  ipcMain.handle('templates:save', (_e, list) => {
    if (Array.isArray(list)) saveTemplates(list);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*  Ventana principal                                                   */
/* ------------------------------------------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b141a',
    show: false,
    autoHideMenuBar: true,
    title: 'MultiWhats - Gestor Multi-Cuenta',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Respaldo: si 'ready-to-show' no llega (renderer lento o roto), muestra la ventana igualmente.
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  }, 4000);
  win.on('resize', () => layoutViews());
  win.on('maximize', () => layoutViews());
  win.on('unmaximize', () => layoutViews());
  win.on('close', () => saveSettings());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log('[ui] did-fail-load', code, desc, url);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log('[ui] render-process-gone', details && details.reason);
  });
}

/* ------------------------------------------------------------------ */
/*  Arranque                                                            */
/* ------------------------------------------------------------------ */

let fatalErrorShown = false;
process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(
      logPath(),
      `[${new Date().toISOString()}] UNCAUGHT: ${(err && err.stack) || err}\n`
    );
  } catch {
    /* noop */
  }
  if (!fatalErrorShown) {
    fatalErrorShown = true;
    dialog.showErrorBox('MultiWhats - Error inesperado', `${(err && err.message) || err}\n\nEl detalle completo se guardó en startup.log`);
  }
  // Salir para no dejar un proceso zombi que bloquee el lanzamiento siguiente.
  app.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log('[unhandledRejection]', reason);
});

// En modo test (--smoke-test) ignoramos el candado de instancia única
// para poder verificar la app aunque el usuario la tenga abierta.
const gotLock = SMOKE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  // Ya hay una instancia corriendo: la primera instancia recibirá
  // 'second-instance' y enfocará su ventana. Salir en silencio.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => saveSettings());

  app.whenReady().then(() => {
    log('=== MultiWhats iniciando === electron', process.versions.electron, 'node', process.versions.node);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'Archivo',
          submenu: [{ label: 'Salir', accelerator: 'Alt+F4', role: 'quit' }],
        },
        {
          label: 'Edición',
          submenu: [
            { role: 'undo', label: 'Deshacer' },
            { role: 'redo', label: 'Rehacer' },
            { type: 'separator' },
            { role: 'cut', label: 'Cortar' },
            { role: 'copy', label: 'Copiar' },
            { role: 'paste', label: 'Pegar' },
            { role: 'selectAll', label: 'Seleccionar todo' },
          ],
        },
        {
          label: 'Ver',
          submenu: [
            { role: 'reload', label: 'Recargar interfaz' },
            { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
            { type: 'separator' },
            { role: 'resetZoom', label: 'Tamaño real' },
            { role: 'zoomIn', label: 'Acercar' },
            { role: 'zoomOut', label: 'Alejar' },
            { type: 'separator' },
            { role: 'togglefullscreen', label: 'Pantalla completa' },
          ],
        },
      ])
    );

    registerIpc();
    createWindow();

    const saved = loadSettings();
    sidebarCollapsed = !!saved.sidebarCollapsed;
    panelOpen = !!saved.panelOpen;

    const savedAccounts = Array.isArray(saved.accounts) ? saved.accounts : [];
    if (SMOKE) {
      // Smoke test determinista: siempre 3 cuentas frescas, ignora lo guardado.
      const urls = [smokeUrl(), smokeUrl(), smokeUrl()];
      for (let i = 0; i < 3; i++) addAccount(`Cuenta ${i + 1}`, urls[i]);
      // Verifica que un id guardado se reutiliza tal cual (fijación de sesiones:
      // antes cada reinicio regeneraba el id y se perdía la sesión del QR).
      const fixedId = '1234567890123-abcd';
      addAccount('Temporal', smokeUrl(), false, null, fixedId);
      const reuseOk = views.has(fixedId);
      removeAccount(fixedId);
      console.log('SMOKE_REUSE=' + reuseOk);
      if (!reuseOk) {
        console.error('SMOKE_REUSE_FAILED');
        app.exit(1);
        return;
      }
    } else if (savedAccounts.length) {
      // Restaurar cada cuenta con SU id reutiliza su partición persistente y, con
      // ella, su sesión de WhatsApp: no hay que volver a escanear el QR.
      // Un zoom guardado de 1 se trata como 'auto': evita que un zoom manual
      // accidental anule el auto-ajuste y vuelva la superposición de mensajes.
      savedAccounts.forEach((a) => addAccount(a.label, WA_URL, a.muted, a.zoom === 1 ? null : a.zoom, a.id));
      cleanupJunkSessions();
    } else {
      // Sin cuentas guardadas: recupera las sesiones reales que el antiguo bug de
      // ids regenerados dejó huérfanas en disco, y luego limpia la basura.
      recoverSessions().then(() => cleanupJunkSessions());
    }

    if (saved.winBounds && !SMOKE) {
      try {
        win.setBounds(saved.winBounds);
      } catch {
        /* noop */
      }
    }

    if (SMOKE) {
      win.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const viewsInfo = Array.from(views.entries()).map(([id, v]) => {
              const b = v.getBounds();
              return { id: id.slice(-5), x: b.x, y: b.y, w: b.width, h: b.height };
            });
            console.log('SMOKE_BOUNDS=' + JSON.stringify(bounds));
            console.log('SMOKE_VIEWS=' + JSON.stringify(viewsInfo));
            // Verifica la detección de sesiones huérfanas (botón 'Liberar espacio').
            const orphans = orphanedSessions();
            const freeable = orphans.reduce((sum, s) => sum + s.size, 0);
            console.log('SMOKE_SPACE=' + JSON.stringify({ orphans: orphans.length, freeable }));
            const check = await win.webContents.executeJavaScript(`(function () {
              return {
                accounts: document.querySelectorAll('#account-list .account-item').length,
                templates: parseInt(document.querySelector('#msg-count').innerText, 10) || 0,
                cards: document.querySelectorAll('#qlist .msg-card').length,
                emptyHidden: document.querySelector('#empty-state').classList.contains('hidden')
              };
            })()`);
            console.log('SMOKE_UI=' + JSON.stringify(check));
            if (check.accounts !== 3 || check.templates <= 0 || check.cards <= 0 || !check.emptyHidden) {
              console.error('SMOKE_TEST_FAILED');
              app.exit(1);
              return;
            }
            // Sin acoplamiento: la primera cuenta queda enfocada al arrancar y
            // ocupa SIEMPRE toda el área; las demás permanecen ocultas.
            const firstId = accounts[0].id;
            const b0 = views.get(firstId).getBounds();
            const singleOk =
              focusedId === firstId &&
              b0.x === bounds.x && b0.y === bounds.y && b0.width === bounds.width && b0.height === bounds.height;
            console.log('SMOKE_SINGLE=' + JSON.stringify(b0) + ' focusedId=' + focusedId + ' ok=' + singleOk);
            // Enfocar la 2ª cuenta: debe ocupar toda el área y la 1ª quedar oculta.
            focusedId = accounts[1].id;
            layoutViews();
            const fb = views.get(accounts[1].id).getBounds();
            let hiddenFirst = false;
            try {
              hiddenFirst = !views.get(accounts[0].id).getVisible();
            } catch {
              /* API no disponible: se omite */
            }
            const focusOk =
              fb.x === bounds.x && fb.y === bounds.y && fb.width === bounds.width && fb.height === bounds.height;
            console.log('SMOKE_FOCUS=' + JSON.stringify(fb) + ' hiddenFirst=' + hiddenFirst + ' ok=' + focusOk);
            // Sin un foco válido, la app elige sola la primera cuenta (no hay rejilla).
            focusedId = null;
            layoutViews();
            const autoOk = focusedId === accounts[0].id;
            console.log('SMOKE_AUTO=' + focusedId + ' ok=' + autoOk);
            if (!singleOk || !focusOk || !autoOk) {
              console.error('SMOKE_FOCUS_FAILED');
              app.exit(1);
              return;
            }
            console.log('SMOKE_FOCUS_OK');
            console.log('SMOKE_TEST_OK');
            app.exit(0);
          } catch (err) {
            console.error('SMOKE_TEST_ERROR', err);
            app.exit(1);
          }
        }, 2000);
      });
    }
  });
}
