'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Estado
  uiReady: () => ipcRenderer.invoke('ui:ready'),
  sendBounds: (rect) => ipcRenderer.send('ui:bounds', rect),
  onState: (cb) => ipcRenderer.on('state:push', (_e, s) => cb(s)),
  onAccountStatus: (cb) => ipcRenderer.on('account:status', (_e, s) => cb(s)),

  // Cuentas
  accountsAdd: () => ipcRenderer.invoke('accounts:add'),
  accountsRemove: (id) => ipcRenderer.invoke('accounts:remove', id),
  accountsRename: (id, label) => ipcRenderer.invoke('accounts:rename', id, label),
  accountsFocus: (id) => ipcRenderer.invoke('accounts:focus', id),
  accountsMute: (id, muted) => ipcRenderer.invoke('accounts:mute', id, muted),
  accountsZoom: (id, zoom) => ipcRenderer.invoke('accounts:zoom', id, zoom),
  accountsReload: (id) => ipcRenderer.invoke('accounts:reload', id),
  accountsRelink: (id) => ipcRenderer.invoke('accounts:relink', id),
  onViewProblem: (cb) => ipcRenderer.on('view:problem', (_e, s) => cb(s)),

  // Utilidades
  sessionsSpace: () => ipcRenderer.invoke('sessions:space'),
  cleanupSessions: () => ipcRenderer.invoke('sessions:cleanup'),
  setPrefs: (prefs) => ipcRenderer.send('ui:prefs', prefs),
  copyText: (text) => ipcRenderer.invoke('copy:text', text),
  templatesLoad: () => ipcRenderer.invoke('templates:load'),
  templatesSave: (list) => ipcRenderer.invoke('templates:save', list),
});
