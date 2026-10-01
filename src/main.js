import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell, Tray } from 'electron';
import { z } from 'zod';
import { PollBot, appRoot } from './bot.js';
import { ProductMonitor } from './product-monitor.js';
import { amazonAsinFromUrl, copagProductCodeFromUrl, mercadoLivreCodeFromUrl, storeFromUrl } from './product-utils.js';

let configPath;
let productsPath;
let alertConfigPath;
let appSettingsPath;
let config = { groupName: '', keywords: [], scanIntervalMs: 250 };
let products = [];
let alertConfig = { enabled: true, sound: 'alarm' };
let appSettings = { startWithWindows: false, minimizeToTray: true };
let mainWindow;
let tray;
let isQuitting = false;

const productInputSchema = z.object({
  url: z.string().url(),
  maxPrice: z.union([z.string(), z.number()]),
  intervalMs: z.coerce.number().finite(),
  sellerFilter: z.string().optional(),
  maxShipping: z.union([z.string(), z.number()]).nullable().optional(),
  group: z.string().optional(),
}).passthrough();

function normalizeKeywords(keywords) {
  return keywords.reduce((unique, value) => {
    const term = String(value).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (term && !unique.includes(term)) unique.push(term);
    return unique;
  }, []);
}

function readConfig(filePath = configPath) {
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      groupName: saved.groupName || '',
      keywords: normalizeKeywords(saved.keywords || []),
      scanIntervalMs: Math.max(100, Number(saved.scanIntervalMs) || 250),
    };
  } catch {
    return { groupName: '', keywords: [], scanIntervalMs: 250 };
  }
}

function saveConfig(nextConfig) {
  if (bot.state !== 'stopped') throw new Error('Pare o bot antes de alterar a configuracao.');
  const keywords = normalizeKeywords(nextConfig.keywords || []);
  if (!keywords.length) throw new Error('Adicione ao menos um termo.');
  config = {
    groupName: String(nextConfig.groupName || '').trim(),
    keywords,
    scanIntervalMs: Math.max(100, Number(nextConfig.scanIntervalMs) || 250),
  };
  fs.writeFileSync(configPath, `${JSON.stringify({ ...config, headless: false }, null, 2)}\n`);
  return config;
}

function canonicalProduct(input, existing = null) {
  const parsedInput = productInputSchema.safeParse(input);
  if (!parsedInput.success) throw new Error('Os dados do produto são inválidos.');
  input = parsedInput.data;
  const url = new URL(input.url);
  const store = storeFromUrl(url);
  if (!store) throw new Error('Use um link da Amazon.com.br, Mercado Livre ou Copag.');
  const asin = store === 'amazon'
    ? amazonAsinFromUrl(url)
    : store === 'mercadolivre'
      ? mercadoLivreCodeFromUrl(url)
      : copagProductCodeFromUrl(url);
  const storeName = store === 'amazon' ? 'Amazon' : store === 'mercadolivre' ? 'Mercado Livre' : 'Copag';
  if (!asin) throw new Error(`Use um link de produto da ${storeName}.`);
  const maxPrice = Number(String(input.maxPrice).replace(',', '.'));
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) throw new Error('Informe um preço máximo válido.');
  const intervalMs = Number(input.intervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) throw new Error('Informe um intervalo de ao menos 1 minuto.');
  const sellerFilter = String(input.sellerFilter || '').trim();
  const shippingInput = String(input.maxShipping ?? '').trim();
  const maxShipping = shippingInput ? Number(shippingInput.replace(',', '.')) : null;
  if (maxShipping !== null && (!Number.isFinite(maxShipping) || maxShipping < 0)) throw new Error('Informe um frete máximo válido.');
  return {
    ...existing,
    id: existing?.id || randomUUID(),
    asin,
    title: input.title?.trim() || existing?.title || asin,
    store,
    url: store === 'amazon' ? `https://www.amazon.com.br/dp/${asin}` : url.toString(),
    maxPrice,
    intervalMs,
    sellerFilter,
    maxShipping,
    group: String(input.group || '').trim(),
    seller: existing?.seller || null,
    shipping: existing?.shipping ?? null,
    autoCheckout: existing?.autoCheckout ?? input.autoCheckout !== false,
    enabled: existing?.enabled ?? true,
    state: existing?.state || 'waiting',
    detail: existing?.detail || 'Aguardando monitoramento.',
    lastCheck: existing?.lastCheck || null,
    price: existing?.price ?? null,
    history: Array.isArray(existing?.history) ? existing.history : [],
  };
}

function readProducts() {
  try {
    const saved = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    return Array.isArray(saved) ? saved.map((product) => {
      try { return { ...product, store: product.store || storeFromUrl(product.url) || 'amazon' }; } catch { return { ...product, store: product.store || 'amazon' }; }
    }) : [];
  } catch {
    return [];
  }
}

function saveProducts() {
  fs.writeFileSync(productsPath, `${JSON.stringify(products, null, 2)}\n`);
}

function normalizeAlertConfig(nextConfig) {
  return {
    enabled: nextConfig?.enabled !== false,
    notifications: nextConfig?.notifications !== false,
    sound: ['alarm', 'double', 'single', 'rizz', 'custom'].includes(nextConfig?.sound) ? nextConfig.sound : 'alarm',
  };
}

function readAlertConfig() {
  try {
    return normalizeAlertConfig(JSON.parse(fs.readFileSync(alertConfigPath, 'utf8')));
  } catch {
    return { enabled: true, notifications: true, sound: 'alarm' };
  }
}

function saveAlertConfig(nextConfig) {
  alertConfig = normalizeAlertConfig(nextConfig);
  fs.writeFileSync(alertConfigPath, `${JSON.stringify(alertConfig, null, 2)}\n`);
  return alertConfig;
}

function normalizeAppSettings(nextSettings) {
  return {
    startWithWindows: nextSettings?.startWithWindows === true,
    minimizeToTray: nextSettings?.minimizeToTray !== false,
  };
}

function readAppSettings() {
  try {
    return normalizeAppSettings(JSON.parse(fs.readFileSync(appSettingsPath, 'utf8')));
  } catch {
    return { startWithWindows: false, minimizeToTray: true };
  }
}

function saveAppSettings(nextSettings) {
  appSettings = normalizeAppSettings(nextSettings);
  fs.writeFileSync(appSettingsPath, `${JSON.stringify(appSettings, null, 2)}\n`);
  app.setLoginItemSettings({ openAtLogin: appSettings.startWithWindows });
  return appSettings;
}

const logs = [];
const productLogs = [];
let bot;
let productMonitor;

function playAvailabilitySound() {
  if (!alertConfig.enabled) return;
  const patterns = {
    alarm: [0, 180, 360, 720, 900, 1080],
    double: [0, 220],
    single: [0],
  };
  if (!patterns[alertConfig.sound]) {
    mainWindow?.webContents.send('products:play-alert', { sound: alertConfig.sound });
    return;
  }
  patterns[alertConfig.sound].forEach((delay) => {
    setTimeout(() => shell.beep(), delay);
  });
}

function playAttentionSound() {
  if (!alertConfig.enabled) return;
  [0, 180, 360, 720, 900, 1080].forEach((delay) => {
    setTimeout(() => shell.beep(), delay);
  });
}

function showNotification(title, body) {
  if (!alertConfig.notifications) return;
  new Notification({ title, body, icon: path.join(appRoot, 'public', 'pokebot-icon.png') }).show();
}

function createBot() {
  bot = new PollBot((entry) => {
  logs.unshift(entry);
  logs.splice(100);
  mainWindow?.webContents.send('bot:update', { state: bot.state, logs });
  }, app.getPath('userData'));
}

function createProductMonitor() {
  productMonitor = new ProductMonitor((entry) => {
    productLogs.unshift(entry);
    productLogs.splice(100);
    if (entry.state === 'available') {
      playAvailabilitySound();
      showNotification('PokeBot: produto disponível', entry.message);
    }
    if (entry.alert === 'attention') {
      playAttentionSound();
      showNotification('PokeBot: atenção necessária', entry.message);
    }
    mainWindow?.webContents.send('products:update', { state: productMonitor.state, products, logs: productLogs });
  }, (nextProducts) => {
    products = nextProducts;
    saveProducts();
    mainWindow?.webContents.send('products:update', { state: productMonitor.state, products, logs: productLogs });
  }, app.getPath('userData'));
}

function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(path.join(appRoot, 'public', 'pokebot-icon.png'));
  tray.setToolTip('PokeBot');
  tray.on('click', showMainWindow);
  tray.on('right-click', () => {
    const monitorRunning = productMonitor?.state !== 'stopped';
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir PokeBot', click: showMainWindow },
      { type: 'separator' },
      {
        label: monitorRunning ? 'Parar monitor de compras' : 'Iniciar monitor de compras',
        enabled: monitorRunning || products.some((product) => product.enabled),
        click: () => {
          if (monitorRunning) void productMonitor.stop();
          else void productMonitor.start(products);
        },
      },
      { type: 'separator' },
      { label: 'Sair', click: () => { void quitApp(); } },
    ]));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 720,
    minHeight: 620,
    backgroundColor: '#09100f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  mainWindow.loadFile(path.join(appRoot, 'public', 'index.html'));
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (appSettings.minimizeToTray && tray) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    event.preventDefault();
    void quitApp();
  });
}

async function quitApp() {
  if (isQuitting) return;
  isQuitting = true;
  await bot?.stop();
  await productMonitor?.stop();
  app.quit();
}

app.whenReady().then(() => {
  configPath = path.join(app.getPath('userData'), 'config.json');
  productsPath = path.join(app.getPath('userData'), 'products.json');
  alertConfigPath = path.join(app.getPath('userData'), 'alert-config.json');
  appSettingsPath = path.join(app.getPath('userData'), 'app-settings.json');
  config = fs.existsSync(configPath) ? readConfig() : readConfig(path.join(appRoot, 'config.example.json'));
  products = readProducts();
  alertConfig = readAlertConfig();
  appSettings = readAppSettings();
  app.setLoginItemSettings({ openAtLogin: appSettings.startWithWindows });
  createBot();
  createProductMonitor();
  createWindow();
  createTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') void quitApp();
});

ipcMain.handle('bot:status', () => ({ state: bot.state, config, logs, appSettings }));
ipcMain.handle('bot:save-config', (_event, nextConfig) => ({ config: saveConfig(nextConfig) }));
ipcMain.handle('app:save-settings', (_event, nextSettings) => ({ appSettings: saveAppSettings(nextSettings) }));
ipcMain.handle('bot:start', () => {
  if (bot.state !== 'stopped') throw new Error('O bot ja esta em execucao.');
  void bot.start(config);
  return { state: 'starting' };
});
ipcMain.handle('bot:stop', async () => {
  await bot.stop();
  return { state: 'stopped' };
});
ipcMain.handle('bot:pause', () => {
  bot.pause();
  return { state: 'paused' };
});
ipcMain.handle('bot:resume', () => {
  bot.resume();
  return { state: 'running' };
});
ipcMain.handle('products:status', () => ({ state: productMonitor.state, products, logs: productLogs, alertConfig }));
ipcMain.handle('products:save-alert-config', (_event, nextConfig) => ({ alertConfig: saveAlertConfig(nextConfig) }));
ipcMain.handle('products:test-alert', () => {
  playAvailabilitySound();
  return { alertConfig };
});
ipcMain.handle('products:add', (_event, input) => {
  if (productMonitor.state !== 'stopped') throw new Error('Pare o monitor antes de alterar a lista.');
  const product = canonicalProduct(input);
  if (products.some((item) => item.store === product.store && item.asin === product.asin)) throw new Error('Esse produto já está na lista.');
  products = [...products, product];
  saveProducts();
  return { products };
});
ipcMain.handle('products:remove', (_event, id) => {
  if (productMonitor.state !== 'stopped') throw new Error('Pare o monitor antes de alterar a lista.');
  products = products.filter((product) => product.id !== id);
  saveProducts();
  return { products };
});
ipcMain.handle('products:update', (_event, id, input) => {
  if (productMonitor.state !== 'stopped') throw new Error('Pare o monitor antes de alterar a lista.');
  const existing = products.find((product) => product.id === id);
  if (!existing) throw new Error('Produto não encontrado.');
  const product = canonicalProduct(input, existing);
  if (products.some((item) => item.id !== id && item.store === product.store && item.asin === product.asin)) throw new Error('Esse produto já está na lista.');
  products = products.map((item) => item.id === id ? product : item);
  saveProducts();
  return { products };
});
ipcMain.handle('products:open-screenshot', async (_event, filePath) => {
  const screenshotRoot = path.resolve(app.getPath('userData'), 'monitor-failures');
  const screenshotPath = path.resolve(String(filePath));
  if (!screenshotPath.startsWith(`${screenshotRoot}${path.sep}`)) throw new Error('Captura inválida.');
  const error = await shell.openPath(screenshotPath);
  if (error) throw new Error(error);
});
ipcMain.handle('products:set-enabled', (_event, id, enabled) => {
  if (productMonitor.state !== 'stopped') {
    productMonitor.setEnabled(id, enabled);
    return { products };
  }
  const product = products.find((item) => item.id === id);
  if (!product) throw new Error('Produto não encontrado.');
  products = products.map((item) => item.id === id ? {
    ...item,
    enabled,
    state: enabled ? 'waiting' : 'disabled',
    detail: enabled ? 'Monitoramento ativado.' : 'Monitoramento pausado.',
    lastCheck: enabled ? null : item.lastCheck,
  } : item);
  saveProducts();
  return { products };
});
ipcMain.handle('products:resume-all', () => {
  if (productMonitor.state !== 'stopped') {
    productMonitor.resumeAll();
    return { products };
  }
  products = products.map((product) => ['review', 'attention'].includes(product.state) ? {
    ...product,
    enabled: true,
    state: 'waiting',
    detail: 'Monitoramento retomado.',
    lastCheck: null,
    price: null,
  } : product);
  saveProducts();
  return { products };
});
ipcMain.handle('products:export', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar lista de produtos',
    defaultPath: 'pokebot-produtos.json',
    filters: [{ name: 'Arquivo JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  fs.writeFileSync(filePath, `${JSON.stringify(products, null, 2)}\n`);
  return { canceled: false };
});
ipcMain.handle('products:import', async () => {
  if (productMonitor.state !== 'stopped') throw new Error('Pare o monitor antes de importar uma lista.');
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Importar lista de produtos',
    properties: ['openFile'],
    filters: [{ name: 'Arquivo JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths[0]) return { canceled: true };
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  } catch {
    throw new Error('O arquivo selecionado não é uma lista JSON válida.');
  }
  const parsedProducts = z.array(productInputSchema).safeParse(saved);
  if (!parsedProducts.success) throw new Error('O arquivo deve conter produtos válidos.');
  const restored = parsedProducts.data.map((product) => canonicalProduct(product, product));
  if (new Set(restored.map((product) => `${product.store}:${product.asin}`)).size !== restored.length) throw new Error('O arquivo possui produtos duplicados.');
  products = restored;
  saveProducts();
  return { canceled: false, products };
});
ipcMain.handle('products:start', () => {
  if (productMonitor.state !== 'stopped') throw new Error('O monitor já está em execução.');
  void productMonitor.start(products);
  return { state: 'starting' };
});
ipcMain.handle('products:stop', async () => {
  await productMonitor.stop();
  return { state: 'stopped' };
});
ipcMain.handle('products:checkout', async (_event, id) => {
  await productMonitor.checkout(id);
  return { products };
});
ipcMain.handle('products:resume', (_event, id) => {
  productMonitor.resume(id);
  return { products };
});
