import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

function installedBrowserPath() {
  if (process.platform !== 'win32') return null;
  const programFiles = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA];
  const browsers = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  ];
  for (const basePath of programFiles) {
    if (!basePath) continue;
    for (const browserPath of browsers) {
      const executablePath = path.join(basePath, ...browserPath);
      if (existsSync(executablePath)) return executablePath;
    }
  }
  return null;
}

function bundledChromiumPath() {
  const roots = [
    process.resourcesPath && path.join(process.resourcesPath, 'playwright-browsers'),
    path.resolve('playwright-browsers'),
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const directory of readdirSync(root).filter((name) => name.startsWith('chromium-'))) {
      for (const executable of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const executablePath = path.join(root, directory, executable);
        if (existsSync(executablePath)) return executablePath;
      }
    }
  }
  return null;
}

export function browserExecutablePath() {
  return installedBrowserPath() || bundledChromiumPath();
}
