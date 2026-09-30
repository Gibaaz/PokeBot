import path from 'node:path';
import { chromium } from 'playwright';

export const appRoot = path.resolve(import.meta.dirname, '..');

function normalize(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function matches(text, keywords) {
  const normalized = normalize(text);
  const words = normalized.split(' ');
  return keywords.some((keyword) => normalized.includes(keyword)
    || words.some((word) => keyword.length >= 3 && distance(word, keyword) <= 1));
}

function optionIdentity(text) {
  return normalize(text).replace(/(?:\s+\d+)+$/, '').trim();
}

function normalizeKeywords(keywords) {
  return [...new Set(keywords.map(normalize).filter(Boolean))];
}

export class PollBot {
  constructor(onUpdate, storagePath) {
    this.onUpdate = onUpdate;
    this.state = 'stopped';
    this.context = null;
    this.page = null;
    this.timer = null;
    this.isScanning = false;
    this.processed = new Set();
    this.runId = 0;
    this.profilePath = path.join(storagePath, 'whatsapp-profile');
  }

  update(state, message) {
    this.state = state;
    this.onUpdate({ state, message, at: new Date().toISOString() });
  }

  async start(config) {
    if (this.state !== 'stopped') return;

    const runId = ++this.runId;
    const activeConfig = { ...config, keywords: normalizeKeywords(config.keywords) };
    this.update('starting', 'Abrindo o WhatsApp Web.');
    try {
      this.context = await chromium.launchPersistentContext(this.profilePath, {
        headless: false,
        viewport: { width: 1280, height: 900 },
      });
      this.context.once('close', () => {
        if (runId !== this.runId) return;
        clearInterval(this.timer);
        this.timer = null;
        this.context = null;
        this.page = null;
        this.update('error', 'A janela do WhatsApp Web foi fechada ou desconectada.');
      });
      this.page = this.context.pages()[0] || await this.context.newPage();
      await this.page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded' });
      this.update('awaiting_login', 'Leia o QR code no WhatsApp Web, se ele aparecer.');

      await this.page.waitForFunction(
        () => document.querySelectorAll('[contenteditable="true"]').length > 0,
        undefined,
        { timeout: 0 },
      );
      if (runId !== this.runId) return;

      this.update('opening_group', `Abrindo o grupo ${activeConfig.groupName}.`);
      const editableFields = this.page.locator('[contenteditable="true"], input[type="search"], input[placeholder]');
      let searchBox = null;
      for (let index = 0; index < await editableFields.count(); index += 1) {
        const candidate = editableFields.nth(index);
        const isSidebarField = await candidate.evaluate((element) => element.offsetParent !== null && !element.closest('#main'));
        if (isSidebarField) {
          searchBox = candidate;
          break;
        }
      }
      if (!searchBox) throw new Error('Campo de busca do WhatsApp nao encontrado.');
      await searchBox.click();
      await searchBox.fill('');
      await searchBox.fill(activeConfig.groupName);
      const groupMatches = this.page.getByText(activeConfig.groupName, { exact: true });
      await groupMatches.last().waitFor({ state: 'visible', timeout: 15_000 });
      let group = null;
      for (let index = (await groupMatches.count()) - 1; index >= 0; index -= 1) {
        const candidate = groupMatches.nth(index);
        const isSidebarResult = await candidate.evaluate((element) => element.offsetParent !== null && !element.closest('#main'));
        if (isSidebarResult) {
          group = candidate;
          break;
        }
      }
      if (!group) throw new Error(`Grupo nao encontrado na lista: ${activeConfig.groupName}.`);
      await group.click();
      if (runId !== this.runId) return;

      await this.page.waitForFunction((groupName) => {
        const header = document.querySelector('#main header');
        return header?.innerText?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          .includes(groupName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
      }, activeConfig.groupName, { timeout: 10_000 });

      this.processed.clear();
      this.update('running', `Monitorando ${activeConfig.groupName}. Termos: ${activeConfig.keywords.join(', ')}.`);
      this.timer = setInterval(() => this.scan(activeConfig, runId), activeConfig.scanIntervalMs);
    } catch (error) {
      if (runId === this.runId) {
        this.update('error', error.message);
        await this.stop();
      }
    }
  }

  async scan(config, runId) {
    if (this.isScanning || runId !== this.runId || !this.page) return;
    this.isScanning = true;
    try {
      const headerText = await this.page.locator('#main header').first().innerText({ timeout: 1_000 }).catch(() => '');
      if (!normalize(headerText).includes(normalize(config.groupName))) {
        if (this.state !== 'paused') this.update('paused', 'Monitoramento pausado: abra novamente o grupo configurado.');
        return;
      }
      if (this.state === 'paused') this.update('running', `Monitorando ${config.groupName}.`);

      const selector = '#main [role="button"], #main button';
      const latestMessageId = await this.page.locator('#main [data-id]').evaluateAll((messages) => messages
        .filter((message) => message.offsetParent !== null)
        .at(-1)?.getAttribute('data-id') || '');
      if (!latestMessageId) return;

      const candidates = await this.page.locator(selector).evaluateAll((elements, currentMessageId) => elements
        .map((element, sourceIndex) => ({ element, sourceIndex }))
        .filter(({ element }) => {
          const bounds = element.getBoundingClientRect();
          const messageId = element.closest('[data-id]')?.getAttribute('data-id');
          let ancestor = element.parentElement;
          let isPollOption = false;
          while (ancestor && ancestor !== document.body) {
            const text = ancestor.innerText || '';
            if (text.length < 1_000 && /mostrar votos|view votes/i.test(text)) {
              isPollOption = true;
              break;
            }
            ancestor = ancestor.parentElement;
          }
          return bounds.width > 0 && bounds.height > 0 && element.offsetParent !== null
            && messageId === currentMessageId && isPollOption;
        })
        .map(({ element, sourceIndex }) => ({
          sourceIndex,
          text: (element.innerText || element.textContent || '').trim(),
          selected: element.getAttribute('aria-checked') === 'true',
          messageId: element.closest('[data-id]')?.getAttribute('data-id') || '',
        }))
        .filter((element) => element.text.length > 0 && element.text.length < 300), latestMessageId);

      for (const candidate of candidates) {
        const key = `${candidate.messageId || candidate.sourceIndex}:${optionIdentity(candidate.text)}`;
        if (candidate.selected || this.processed.has(key) || !matches(candidate.text, config.keywords)) continue;

        this.processed.add(key);
        try {
          await this.page.locator(selector).nth(candidate.sourceIndex).click({ timeout: 500, noWaitAfter: true });
          this.onUpdate({ state: 'vote', message: `Voto clicado: ${optionIdentity(candidate.text)}`, at: new Date().toISOString() });
        } catch {
          this.processed.delete(key);
        }
      }
    } catch (error) {
      this.onUpdate({ state: 'warning', message: `Falha na varredura: ${error.message}`, at: new Date().toISOString() });
    } finally {
      this.isScanning = false;
    }
  }

  async stop() {
    ++this.runId;
    clearInterval(this.timer);
    this.timer = null;
    this.processed.clear();
    const context = this.context;
    this.context = null;
    this.page = null;
    if (context) await context.close().catch(() => {});
    this.update('stopped', 'Bot parado.');
  }
}
