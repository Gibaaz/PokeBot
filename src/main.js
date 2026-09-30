import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import { PollBot, appRoot } from './bot.js';
import { ProductMonitor } from './product-monitor.js';

let configPath;
let productsPath;
let config = { groupName: '', keywords: [], scanIntervalMs: 250 };
let products = [];
let mainWindow;
let isQuitting = false;

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
  if (!nextConfig.groupName?.trim()) throw new Error('Informe o nome do grupo.');
  const keywords = normalizeKeywords(nextConfig.keywords || []);
  if (!keywords.length) throw new Error('Adicione ao menos um termo.');
  config = {
    groupName: nextConfig.groupName.trim(),
    keywords,
    scanIntervalMs: Math.max(100, Number(nextConfig.scanIntervalMs) || 250),
  };
  fs.writeFileSync(configPath, `${JSON.stringify({ ...config, headless: false }, null, 2)}\n`);
  return config;
}

function canonicalProduct(input) {
  const url = new URL(input.url);
  if (!/amazon\.com\.br$/i.test(url.hostname)) throw new Error('Por enquanto, use um link da Amazon.com.br.');
  const asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase();
  if (!asin) throw new Error('Não foi possível identificar o ASIN no link do produto.');
  const maxPrice = Number(String(input.maxPrice).replace(',', '.'));
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) throw new Error('Informe um preço máximo válido.');
  return {
    id: randomUUID(),
    asin,
    title: input.title?.trim() || asin,
    url: `https://www.amazon.com.br/dp/${asin}`,
    maxPrice,
    intervalMs: Math.max(60_000, Number(input.intervalMs) || 60_000),
    autoCheckout: input.autoCheckout !== false,
    enabled: true,
    state: 'waiting',
    detail: 'Aguardando monitoramento.',
    lastCheck: null,
    price: null,
  };
}

function readProducts() {
  try {
    const saved = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveProducts() {
  fs.writeFileSync(productsPath, `${JSON.stringify(products, null, 2)}\n`);
}

const logs = [];
const productLogs = [];
let bot;
let productMonitor;

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
    mainWindow?.webContents.send('products:update', { state: productMonitor.state, products, logs: productLogs });
  }, (nextProducts) => {
    products = nextProducts;
    saveProducts();
    mainWindow?.webContents.send('products:update', { state: productMonitor.state, products, logs: productLogs });
  }, app.getPath('userData'));
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
    },
  });
  mainWindow.loadFile(path.join(appRoot, 'public', 'index.html'));
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
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
  config = fs.existsSync(configPath) ? readConfig() : readConfig(path.join(appRoot, 'config.example.json'));
  products = readProducts();
  createBot();
  createProductMonitor();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') void quitApp();
});

ipcMain.handle('bot:status', () => ({ state: bot.state, config, logs }));
ipcMain.handle('bot:save-config', (_event, nextConfig) => ({ config: saveConfig(nextConfig) }));
ipcMain.handle('bot:start', () => {
  if (bot.state !== 'stopped') throw new Error('O bot ja esta em execucao.');
  void bot.start(config);
  return { state: 'starting' };
});
ipcMain.handle('bot:stop', async () => {
  await bot.stop();
  return { state: 'stopped' };
});
ipcMain.handle('products:status', () => ({ state: productMonitor.state, products, logs: productLogs }));
ipcMain.handle('products:add', (_event, input) => {
  if (productMonitor.state !== 'stopped') throw new Error('Pare o monitor antes de alterar a lista.');
  const product = canonicalProduct(input);
  if (products.some((item) => item.asin === product.asin)) throw new Error('Esse produto já está na lista.');
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
