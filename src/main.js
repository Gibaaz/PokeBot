import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { PollBot, appRoot } from './bot.js';

let configPath;
let config = { groupName: '', keywords: [], scanIntervalMs: 250 };
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

const logs = [];
let bot;

function createBot() {
  bot = new PollBot((entry) => {
  logs.unshift(entry);
  logs.splice(100);
  mainWindow?.webContents.send('bot:update', { state: bot.state, logs });
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
  app.quit();
}

app.whenReady().then(() => {
  configPath = path.join(app.getPath('userData'), 'config.json');
  config = fs.existsSync(configPath) ? readConfig() : readConfig(path.join(appRoot, 'config.example.json'));
  createBot();
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
