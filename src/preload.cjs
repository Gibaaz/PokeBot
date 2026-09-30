const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pollRunner', {
  status: () => ipcRenderer.invoke('bot:status'),
  saveConfig: (config) => ipcRenderer.invoke('bot:save-config', config),
  start: () => ipcRenderer.invoke('bot:start'),
  stop: () => ipcRenderer.invoke('bot:stop'),
  onUpdate: (callback) => ipcRenderer.on('bot:update', (_event, data) => callback(data)),
  productsStatus: () => ipcRenderer.invoke('products:status'),
  saveAlertConfig: (config) => ipcRenderer.invoke('products:save-alert-config', config),
  testAlert: () => ipcRenderer.invoke('products:test-alert'),
  addProduct: (product) => ipcRenderer.invoke('products:add', product),
  removeProduct: (id) => ipcRenderer.invoke('products:remove', id),
  startProducts: () => ipcRenderer.invoke('products:start'),
  stopProducts: () => ipcRenderer.invoke('products:stop'),
  checkoutProduct: (id) => ipcRenderer.invoke('products:checkout', id),
  resumeProduct: (id) => ipcRenderer.invoke('products:resume', id),
  onProductsUpdate: (callback) => ipcRenderer.on('products:update', (_event, data) => callback(data)),
  onAlert: (callback) => ipcRenderer.on('products:play-alert', (_event, data) => callback(data)),
});
