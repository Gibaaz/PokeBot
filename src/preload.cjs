const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pollRunner', {
  status: () => ipcRenderer.invoke('bot:status'),
  saveConfig: (config) => ipcRenderer.invoke('bot:save-config', config),
  start: () => ipcRenderer.invoke('bot:start'),
  stop: () => ipcRenderer.invoke('bot:stop'),
  onUpdate: (callback) => ipcRenderer.on('bot:update', (_event, data) => callback(data)),
});
