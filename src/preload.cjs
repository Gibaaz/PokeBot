const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pollRunner', {
  status: () => ipcRenderer.invoke('bot:status'),
  saveConfig: (config) => ipcRenderer.invoke('bot:save-config', config),
  saveAppSettings: (settings) => ipcRenderer.invoke('app:save-settings', settings),
  start: () => ipcRenderer.invoke('bot:start'),
  stop: () => ipcRenderer.invoke('bot:stop'),
  pause: () => ipcRenderer.invoke('bot:pause'),
  resume: () => ipcRenderer.invoke('bot:resume'),
  onUpdate: (callback) => ipcRenderer.on('bot:update', (_event, data) => callback(data)),
  searchCards: async (number) => {
    try {
      return await ipcRenderer.invoke('cards:search', number);
    } catch (error) {
      const message = String(error?.message || 'Não foi possível pesquisar a carta.')
        .replace(/^Error invoking remote method 'cards:search': Error:\s*/, '');
      throw new Error(message);
    }
  },
  cardEditions: async () => {
    try {
      return await ipcRenderer.invoke('cards:editions');
    } catch (error) {
      throw new Error(String(error?.message || 'Não foi possível carregar as coleções.').replace(/^Error invoking remote method 'cards:editions': Error:\s*/, ''));
    }
  },
  searchCardEdition: async (edition) => {
    try {
      return await ipcRenderer.invoke('cards:edition', edition);
    } catch (error) {
      throw new Error(String(error?.message || 'Não foi possível carregar a coleção.').replace(/^Error invoking remote method 'cards:edition': Error:\s*/, ''));
    }
  },
  openCard: (url) => ipcRenderer.invoke('cards:open', url),
  productsStatus: () => ipcRenderer.invoke('products:status'),
  saveAlertConfig: (config) => ipcRenderer.invoke('products:save-alert-config', config),
  testAlert: () => ipcRenderer.invoke('products:test-alert'),
  addProduct: (product) => ipcRenderer.invoke('products:add', product),
  updateProduct: async (id, product) => {
    try {
      return await ipcRenderer.invoke('products:update', id, product);
    } catch (error) {
      const message = String(error?.message || 'Não foi possível atualizar o produto.')
        .replace(/^Error invoking remote method 'products:update': Error:\s*/, '');
      throw new Error(message);
    }
  },
  removeProduct: (id) => ipcRenderer.invoke('products:remove', id),
  openScreenshot: (filePath) => ipcRenderer.invoke('products:open-screenshot', filePath),
  setProductEnabled: (id, enabled) => ipcRenderer.invoke('products:set-enabled', id, enabled),
  resumeAllProducts: () => ipcRenderer.invoke('products:resume-all'),
  exportProducts: () => ipcRenderer.invoke('products:export'),
  importProducts: () => ipcRenderer.invoke('products:import'),
  startProducts: () => ipcRenderer.invoke('products:start'),
  stopProducts: () => ipcRenderer.invoke('products:stop'),
  checkoutProduct: (id) => ipcRenderer.invoke('products:checkout', id),
  resumeProduct: (id) => ipcRenderer.invoke('products:resume', id),
  onProductsUpdate: (callback) => ipcRenderer.on('products:update', (_event, data) => callback(data)),
  onAlert: (callback) => ipcRenderer.on('products:play-alert', (_event, data) => callback(data)),
});
