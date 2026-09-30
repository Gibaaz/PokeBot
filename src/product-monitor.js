import path from 'node:path';
import { chromium } from 'playwright';

function priceFromText(text) {
  const match = String(text).match(/R\$\s*([\d.]+,\d{2})/);
  return match ? Number(match[1].replace(/\./g, '').replace(',', '.')) : null;
}

function attentionReason(text) {
  if (/digite os caracteres|captcha/i.test(text)) return 'CAPTCHA';
  if (/faça login|faca login|sign in/i.test(text)) return 'login';
  return null;
}

export class ProductMonitor {
  constructor(onUpdate, onProducts, storagePath) {
    this.onUpdate = onUpdate;
    this.onProducts = onProducts;
    this.profilePath = path.join(storagePath, 'amazon-profile');
    this.state = 'stopped';
    this.context = null;
    this.page = null;
    this.timer = null;
    this.isChecking = false;
    this.products = [];
    this.runId = 0;
  }

  emit(state, message, details = {}) {
    if (['starting', 'running', 'attention', 'stopped', 'error'].includes(state)) this.state = state;
    this.onUpdate({ state, message, at: new Date().toISOString(), ...details });
  }

  updateProduct(id, changes) {
    this.products = this.products.map((product) => {
      if (product.id !== id) return product;
      const nextProduct = { ...product, ...changes };
      if (!changes.state) return nextProduct;
      const history = Array.isArray(product.history) ? product.history : [];
      const entry = {
        at: changes.lastCheck || new Date().toISOString(),
        state: nextProduct.state,
        detail: nextProduct.detail,
        price: nextProduct.price,
      };
      const lastEntry = history[0];
      const changed = !lastEntry || lastEntry.state !== entry.state || lastEntry.price !== entry.price || lastEntry.detail !== entry.detail;
      return { ...nextProduct, history: changed ? [entry, ...history].slice(0, 30) : history };
    });
    this.onProducts(this.products);
  }

  async start(products) {
    if (this.state !== 'stopped') return;
    this.products = products;
    if (!this.products.some((product) => product.enabled)) throw new Error('Adicione e ative ao menos um produto.');

    const runId = ++this.runId;
    this.emit('starting', 'Abrindo a Amazon. Faça login se necessário.');
    try {
      this.context = await chromium.launchPersistentContext(this.profilePath, {
        headless: false,
        viewport: { width: 1280, height: 900 },
      });
      this.context.once('close', () => {
        if (runId !== this.runId) return;
        clearInterval(this.timer);
        this.context = null;
        this.page = null;
        this.emit('error', 'A janela da Amazon foi fechada ou desconectada.');
      });
      this.page = this.context.pages()[0] || await this.context.newPage();
      this.emit('running', 'Monitorando produtos ativos.');
      await this.checkAll(runId);
      this.timer = setInterval(() => this.checkAll(runId), 10_000);
    } catch (error) {
      if (runId === this.runId) {
        this.emit('error', error.message);
        await this.stop();
      }
    }
  }

  async checkAll(runId) {
    if (this.isChecking || this.state === 'attention' || runId !== this.runId || !this.page) return;
    this.isChecking = true;
    try {
      for (const product of this.products.filter((item) => item.enabled)) {
        if (runId !== this.runId) return;
        const lastCheck = product.lastCheck ? Date.parse(product.lastCheck) : 0;
        if (Date.now() - lastCheck < product.intervalMs) continue;
        await this.checkProduct(product, product.autoCheckout);
      }
    } finally {
      this.isChecking = false;
    }
  }

  async checkout(id) {
    const product = this.products.find((item) => item.id === id);
    if (!product) throw new Error('Produto não encontrado.');
    if (this.state !== 'running' || !this.page) throw new Error('Inicie o monitor da Amazon primeiro.');
    await this.checkProduct(product, true);
  }

  resume(id) {
    const product = this.products.find((item) => item.id === id);
    if (!product) throw new Error('Produto não encontrado.');
    this.updateProduct(id, {
      enabled: true,
      state: 'waiting',
      detail: 'Monitoramento retomado.',
      lastCheck: null,
      price: null,
    });
    if (this.state === 'attention') this.emit('running', 'Monitoramento retomado após atenção manual.');
    this.emit('waiting', `${product.asin}: monitoramento retomado.`);
  }

  async checkProduct(product, proceedToCheckout) {
    this.emit('checking', `Verificando ${product.asin}.`);
    try {
      await this.page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const pageText = await this.page.locator('body').innerText({ timeout: 10_000 });
      const productTitle = await this.page.locator('#productTitle').innerText().then((text) => text.trim()).catch(() => product.title);
      if (productTitle && productTitle !== product.title) this.updateProduct(product.id, { title: productTitle });
      const reason = attentionReason(pageText);
      if (reason) {
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: `A Amazon exige ${reason}.` });
        this.emit('attention', `${product.asin}: a Amazon exige ${reason}.`, { alert: 'attention' });
        return;
      }

      const cartButton = this.page.locator('#add-to-cart-button, input[name*="submit.add-to-cart"]').first();
      if (!await cartButton.isVisible().catch(() => false)) {
        this.updateProduct(product.id, { state: 'unavailable', lastCheck: new Date().toISOString(), detail: 'A oferta principal deste link está indisponível.' });
        this.emit('waiting', `${product.asin}: oferta principal sem estoque.`);
        return;
      }

      const priceText = await this.page.locator('.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice').first().innerText().catch(() => '');
      const price = priceFromText(priceText);
      if (price === null) {
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Preço não identificado. Revise a oferta manualmente.' });
        this.emit('attention', `${product.asin}: preço não identificado.`);
        return;
      }
      if (price > product.maxPrice) {
        this.updateProduct(product.id, { state: 'price_high', lastCheck: new Date().toISOString(), price, detail: `Preço acima do limite: R$ ${price.toFixed(2)}.` });
        this.emit('waiting', `${product.asin}: R$ ${price.toFixed(2)} acima do limite.`);
        return;
      }

      this.updateProduct(product.id, { state: 'available', lastCheck: new Date().toISOString(), price, detail: `Disponível por R$ ${price.toFixed(2)}.` });
      this.emit('available', `${product.asin} disponível por R$ ${price.toFixed(2)}.`);
      if (!proceedToCheckout) return;

      await cartButton.click();
      await this.page.goto('https://www.amazon.com.br/gp/cart/view.html', { waitUntil: 'domcontentloaded' });
      const cartText = await this.page.locator('body').innerText({ timeout: 10_000 });
      const cartHasItem = await this.page.locator('#sc-active-cart .sc-list-item, [data-name="Active Items"] .sc-list-item').count() > 0;
      if (!cartHasItem && !cartText.includes(productTitle)) {
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Carrinho não confirmou o produto.' });
        this.emit('attention', `${product.asin}: confira o carrinho manualmente.`);
        return;
      }
      const checkoutButton = this.page.locator('input[name="proceedToRetailCheckout"], a[href*="proceedToRetailCheckout"], :text("Finalizar compra")').first();
      if (!await checkoutButton.isVisible().catch(() => false)) {
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Carrinho aberto. A revisão precisa ser iniciada manualmente.' });
        this.emit('attention', `${product.asin}: carrinho aberto para revisão.`);
        return;
      }
      await checkoutButton.click();
      await this.page.waitForLoadState('domcontentloaded');
      this.updateProduct(product.id, { state: 'review', enabled: false, lastCheck: new Date().toISOString(), price, detail: 'Revisão do pedido aberta. Confirme manualmente.' });
      this.emit('review', `${product.asin}: revisão do pedido aberta. Nenhum pedido foi enviado.`);
    } catch (error) {
      this.updateProduct(product.id, { state: 'error', lastCheck: new Date().toISOString(), detail: error.message });
      this.emit('warning', `${product.asin}: ${error.message}`);
    }
  }

  async stop() {
    ++this.runId;
    clearInterval(this.timer);
    this.timer = null;
    const context = this.context;
    this.context = null;
    this.page = null;
    if (context) await context.close().catch(() => {});
    this.emit('stopped', 'Monitor de produtos parado.');
  }
}
