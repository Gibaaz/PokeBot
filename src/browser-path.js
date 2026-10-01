import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { rename } from 'node:fs/promises';

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

function closedDuringLaunch(error) {
  return /Target page, context or browser has been closed|Browser closed/i.test(error.message);
}

function backupProfilePath(profilePath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${profilePath}-backup-${timestamp}`;
}

export async function launchBrowserContext(browserType, profilePath, options) {
  try {
    return {
      context: await browserType.launchPersistentContext(profilePath, options),
      recoveredProfile: false,
    };
  } catch (error) {
    if (!closedDuringLaunch(error)) throw error;

    const backupPath = backupProfilePath(profilePath);
    try {
      await rename(profilePath, backupPath);
    } catch (renameError) {
      throw new Error(`O navegador fechou ao abrir o perfil e nao foi possivel preserva-lo: ${renameError.message}`);
    }

    try {
      return {
        context: await browserType.launchPersistentContext(profilePath, options),
        recoveredProfile: true,
      };
    } catch (retryError) {
      throw new Error(`O navegador fechou mesmo com um perfil novo: ${retryError.message}`);
    }
  }
}
