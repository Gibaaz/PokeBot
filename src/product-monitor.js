import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserExecutablePath, launchBrowserContext } from './browser-path.js';
import { normalizeText, priceFromText, shippingFromText } from './product-utils.js';

function attentionReason(text) {
  if (/digite os caracteres|captcha/i.test(text)) return 'CAPTCHA';
  if (/faça login|faca login|sign in|inicia sesi[oó]n/i.test(text)) return 'login';
  return null;
}

function mercadoLivreAttentionReason(text, url) {
  if (url.includes('accounts.google.com') && /n[aã]o foi poss[ií]vel fazer o login|navegador ou app pode n[aã]o ser seguro/i.test(text)) {
    return 'login com Google bloqueado neste navegador; entre com e-mail e senha do Mercado Livre';
  }
  return attentionReason(text);
}

export class ProductMonitor {
  constructor(onUpdate, onProducts, storagePath) {
    this.onUpdate = onUpdate;
    this.onProducts = onProducts;
    this.profilePath = path.join(storagePath, 'amazon-profile');
    this.screenshotPath = path.join(storagePath, 'monitor-failures');
    this.state = 'stopped';
    this.context = null;
    this.initialPage = null;
    this.pages = new Map();
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
        seller: nextProduct.seller,
        shipping: nextProduct.shipping,
      };
      const lastEntry = history[0];
      const changed = !lastEntry || lastEntry.state !== entry.state || lastEntry.price !== entry.price || lastEntry.detail !== entry.detail;
      return { ...nextProduct, history: changed ? [entry, ...history].slice(0, 30) : history };
    });
    this.onProducts(this.products);
  }

  async captureFailure(product, reason, page) {
    if (!page) return null;
    const safeReason = String(reason).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${product.asin}-${safeReason}.png`;
    const filePath = path.join(this.screenshotPath, filename);
    try {
      await fs.mkdir(this.screenshotPath, { recursive: true });
      await page.screenshot({ path: filePath, fullPage: true });
      return filePath;
    } catch {
      return null;
    }
  }

  async findAmazonPrice(page) {
    const selectors = [
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#corePrice_feature_div .a-price .a-offscreen',
      '.reinventPricePriceToPayMargin .a-price .a-offscreen',
      '#corePriceDisplay_desktop_feature_div',
      '#corePrice_feature_div',
      '#apex_desktop .a-price',
      '.a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
    ];
    for (const selector of selectors) {
      const text = await page.locator(selector).first().innerText().catch(() => '');
      const price = priceFromText(text);
      if (price !== null) return price;
    }
    return null;
  }

  async pageForProduct(product) {
    const existing = this.pages.get(product.id);
    if (existing && !existing.isClosed()) return existing;
    const page = this.initialPage && !this.initialPage.isClosed() ? this.initialPage : await this.context.newPage();
    this.initialPage = null;
    this.pages.set(product.id, page);
    return page;
  }

  async start(products) {
    if (this.state !== 'stopped') return;
    this.products = products;
    if (!this.products.some((product) => product.enabled)) throw new Error('Adicione e ative ao menos um produto.');

    const runId = ++this.runId;
    this.emit('starting', 'Abrindo as lojas. Faça login se necessário.');
    try {
      const executablePath = browserExecutablePath();
      const { context, recoveredProfile } = await launchBrowserContext(chromium, this.profilePath, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        ...(executablePath ? { executablePath } : {}),
      });
      this.context = context;
      this.context.once('close', () => {
        if (runId !== this.runId) return;
        clearInterval(this.timer);
        this.context = null;
        this.initialPage = null;
        this.pages.clear();
        this.emit('error', 'A janela das lojas foi fechada ou desconectada.');
      });
      this.initialPage = this.context.pages()[0] || await this.context.newPage();
      this.emit('running', recoveredProfile
        ? 'O perfil anterior foi preservado por falha do navegador. Faça login nas lojas novamente.'
        : 'Monitorando produtos ativos.');
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
    if (this.isChecking || this.state === 'attention' || runId !== this.runId || !this.context) return;
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
    if (this.state !== 'running' || !this.context) throw new Error('Inicie o monitor primeiro.');
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

  resumeAll() {
    this.products.filter((product) => ['review', 'attention'].includes(product.state)).forEach((product) => this.resume(product.id));
  }

  setEnabled(id, enabled) {
    const product = this.products.find((item) => item.id === id);
    if (!product) throw new Error('Produto não encontrado.');
    this.updateProduct(id, {
      enabled,
      state: enabled ? 'waiting' : 'disabled',
      detail: enabled ? 'Monitoramento ativado.' : 'Monitoramento pausado.',
      lastCheck: enabled ? null : product.lastCheck,
    });
    this.emit('waiting', `${product.asin}: monitoramento ${enabled ? 'ativado' : 'pausado'}.`);
  }

  async checkProduct(product, proceedToCheckout) {
    const page = await this.pageForProduct(product);
    if (product.store === 'mercadolivre') return this.checkMercadoLivreProduct(product, proceedToCheckout, page);
    if (product.store === 'copag') return this.checkCopagProduct(product, proceedToCheckout, page);
    this.emit('checking', `Verificando ${product.asin}.`);
    try {
      await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const pageText = await page.locator('body').innerText({ timeout: 10_000 });
      const productTitle = await page.locator('#productTitle').innerText().then((text) => text.trim()).catch(() => product.title);
      if (productTitle && productTitle !== product.title) this.updateProduct(product.id, { title: productTitle });
      const reason = attentionReason(pageText);
      if (reason) {
        const screenshotPath = await this.captureFailure(product, reason, page);
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: `A Amazon exige ${reason}.`, screenshotPath });
        this.emit('attention', `${product.asin}: a Amazon exige ${reason}.`, { alert: 'attention' });
        return;
      }

      const cartButton = page.locator('#add-to-cart-button, input[name*="submit.add-to-cart"]').first();
      if (!await cartButton.isVisible().catch(() => false)) {
        this.updateProduct(product.id, { state: 'unavailable', lastCheck: new Date().toISOString(), detail: 'A oferta principal deste link está indisponível.' });
        this.emit('waiting', `${product.asin}: oferta principal sem estoque.`);
        return;
      }

      if (product.sellerFilter || Number.isFinite(product.maxShipping)) {
        const seller = await page.locator('#merchant-info, #sellerProfileTriggerId').first().innerText().then((text) => text.trim()).catch(() => '');
        const shippingText = await page.locator('#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE, #deliveryBlockMessage, #fulfillerInfoFeature_feature_div').first().innerText().catch(() => '');
        const shipping = shippingFromText(shippingText);
        this.updateProduct(product.id, { seller: seller || null, shipping });
        if (product.sellerFilter && !seller) {
          const screenshotPath = await this.captureFailure(product, 'seller', page);
          this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Vendedor não identificado. Revise a oferta manualmente.', screenshotPath });
          this.emit('attention', `${product.asin}: vendedor não identificado.`);
          return;
        }
        if (product.sellerFilter && !normalizeText(seller).includes(normalizeText(product.sellerFilter))) {
          this.updateProduct(product.id, { state: 'seller_mismatch', lastCheck: new Date().toISOString(), detail: `Vendedor diferente do filtro: ${seller}.` });
          this.emit('waiting', `${product.asin}: vendedor diferente do filtro.`);
          return;
        }
        if (Number.isFinite(product.maxShipping) && shipping === null) {
          const screenshotPath = await this.captureFailure(product, 'shipping', page);
          this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Frete não identificado. Revise a oferta manualmente.', screenshotPath });
          this.emit('attention', `${product.asin}: frete não identificado.`);
          return;
        }
        if (Number.isFinite(product.maxShipping) && shipping > product.maxShipping) {
          this.updateProduct(product.id, { state: 'shipping_high', lastCheck: new Date().toISOString(), shipping, detail: `Frete acima do limite: R$ ${shipping.toFixed(2)}.` });
          this.emit('waiting', `${product.asin}: frete acima do limite.`);
          return;
        }
      }

      const price = await this.findAmazonPrice(page);
      if (price === null) {
        const screenshotPath = await this.captureFailure(product, 'price', page);
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Preço não identificado. Revise a oferta manualmente.', screenshotPath });
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
      await page.goto('https://www.amazon.com.br/gp/cart/view.html', { waitUntil: 'domcontentloaded' });
      const cartItem = page.locator(`#sc-active-cart [data-asin="${product.asin}"], [data-name="Active Items"] [data-asin="${product.asin}"]`).first();
      const cartItemText = await cartItem.innerText().catch(() => '');
      if (!cartItemText) {
        const screenshotPath = await this.captureFailure(product, 'cart-item', page);
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Carrinho não confirmou o ASIN do produto.', screenshotPath });
        this.emit('attention', `${product.asin}: o carrinho não confirmou o item correto.`);
        return;
      }
      const cartPrice = priceFromText(cartItemText);
      if (cartPrice !== null && cartPrice > product.maxPrice) {
        const screenshotPath = await this.captureFailure(product, 'cart-price', page);
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), price: cartPrice, detail: `Preço no carrinho acima do limite: R$ ${cartPrice.toFixed(2)}.`, screenshotPath });
        this.emit('attention', `${product.asin}: preço no carrinho acima do limite.`);
        return;
      }
      const checkoutButton = page.locator('input[name="proceedToRetailCheckout"], a[href*="proceedToRetailCheckout"], :text("Finalizar compra")').first();
      if (!await checkoutButton.isVisible().catch(() => false)) {
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Carrinho aberto. A revisão precisa ser iniciada manualmente.' });
        this.emit('attention', `${product.asin}: carrinho aberto para revisão.`);
        return;
      }
      await checkoutButton.click();
      await page.waitForLoadState('domcontentloaded');
      this.updateProduct(product.id, { state: 'review', enabled: false, lastCheck: new Date().toISOString(), price: cartPrice ?? price, detail: `Revisão do pedido aberta para ${product.asin}. Confirme manualmente.` });
      this.emit('review', `${product.asin}: revisão do pedido aberta. Nenhum pedido foi enviado.`);
    } catch (error) {
      const screenshotPath = await this.captureFailure(product, 'error', page);
      this.updateProduct(product.id, { state: 'error', lastCheck: new Date().toISOString(), detail: error.message, screenshotPath });
      this.emit('warning', `${product.asin}: ${error.message}`);
    }
  }

  async checkMercadoLivreProduct(product, proceedToCheckout, page) {
    this.emit('checking', `Verificando ${product.asin} no Mercado Livre.`);
    try {
      await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const pageText = await page.locator('body').innerText({ timeout: 10_000 });
      const reason = mercadoLivreAttentionReason(pageText, page.url());
      if (reason) {
        const screenshotPath = await this.captureFailure(product, reason, page);
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: `O Mercado Livre exige ${reason}.`, screenshotPath });
        this.emit('attention', `${product.asin}: o Mercado Livre exige ${reason}.`, { alert: 'attention' });
        return;
      }
      const title = await page.locator('.ui-pdp-title, h1').first().innerText().then((text) => text.trim()).catch(() => product.title);
      if (title && title !== product.title) this.updateProduct(product.id, { title });
      const cartButton = page.locator('button:has-text("Adicionar ao carrinho"), a:has-text("Adicionar ao carrinho")').first();
      const buyButton = page.locator('button:has-text("Comprar agora"), a:has-text("Comprar agora")').first();
      const canAddToCart = await cartButton.isVisible().catch(() => false);
      const canBuyNow = await buyButton.isVisible().catch(() => false);
      if (!canAddToCart && !canBuyNow) {
        this.updateProduct(product.id, { state: 'unavailable', lastCheck: new Date().toISOString(), detail: 'A oferta principal deste link está indisponível.' });
        this.emit('waiting', `${product.asin}: oferta principal sem estoque.`);
        return;
      }
      if (product.sellerFilter || Number.isFinite(product.maxShipping)) {
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Filtros de vendedor e frete ainda exigem revisão manual no Mercado Livre.' });
        this.emit('attention', `${product.asin}: filtros exigem revisão manual no Mercado Livre.`);
        return;
      }
      const priceText = await page.locator('.ui-pdp-price__second-line .andes-money-amount__fraction, .ui-pdp-price .andes-money-amount__fraction, [data-testid="price-part"]').first().innerText().catch(() => '');
      const price = Number(String(priceText).replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(price) || price <= 0) {
        const screenshotPath = await this.captureFailure(product, 'price', page);
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Preço não identificado. Revise a oferta manualmente.', screenshotPath });
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
      if (canAddToCart) {
        await cartButton.click();
        await page.goto('https://www.mercadolivre.com.br/gz/cart', { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const cartText = await page.locator('body').innerText({ timeout: 10_000 });
        if (!cartText.includes(product.asin) && !cartText.includes(title)) {
          const screenshotPath = await this.captureFailure(product, 'cart-item', page);
          this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Carrinho não confirmou o produto.', screenshotPath });
          this.emit('attention', `${product.asin}: o carrinho não confirmou o item correto.`);
          return;
        }
        const checkoutButton = page.locator('a[href*="checkout"], button:has-text("Continuar compra"), a:has-text("Continuar compra")').first();
        if (!await checkoutButton.isVisible().catch(() => false)) {
          const screenshotPath = await this.captureFailure(product, 'checkout', page);
          this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Carrinho aberto. A revisão precisa ser iniciada manualmente.', screenshotPath });
          this.emit('attention', `${product.asin}: carrinho aberto para revisão manual.`);
          return;
        }
        await checkoutButton.click();
        await page.waitForLoadState('domcontentloaded');
      } else {
        await buyButton.click();
        await page.waitForLoadState('domcontentloaded');
      }
      await page.bringToFront();
      this.updateProduct(product.id, { state: 'review', enabled: false, lastCheck: new Date().toISOString(), price, detail: 'Revisão da compra aberta no Mercado Livre. Confirme manualmente.' });
      this.emit('review', `${product.asin}: revisão da compra aberta. Nenhum pedido foi enviado.`);
    } catch (error) {
      const screenshotPath = await this.captureFailure(product, 'error', page);
      this.updateProduct(product.id, { state: 'error', lastCheck: new Date().toISOString(), detail: error.message, screenshotPath });
      this.emit('warning', `${product.asin}: ${error.message}`);
    }
  }

  async checkCopagProduct(product, proceedToCheckout, page) {
    this.emit('checking', `Verificando ${product.asin} na Copag.`);
    try {
      await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const pageText = await page.locator('body').innerText({ timeout: 10_000 });
      const reason = attentionReason(pageText);
      if (reason) {
        const screenshotPath = await this.captureFailure(product, reason, page);
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: `A Copag exige ${reason}.`, screenshotPath });
        this.emit('attention', `${product.asin}: a Copag exige ${reason}.`, { alert: 'attention' });
        return;
      }
      const item = await page.evaluate(() => {
        const sku = globalThis.skuJson?.skus?.find((candidate) => candidate.available);
        return sku ? { available: true, price: Number(sku.bestPrice) / 100 } : { available: false, price: null };
      });
      const title = await page.locator('h1.produtoNome .productName, h1[itemprop="name"], meta[itemprop="name"]').first().evaluate((element) => element.getAttribute('content') || element.textContent || '').then((text) => text.trim()).catch(() => product.title);
      if (title && title !== product.title) this.updateProduct(product.id, { title });
      if (!item.available) {
        this.updateProduct(product.id, { state: 'unavailable', lastCheck: new Date().toISOString(), detail: 'O produto está indisponível na Copag.' });
        this.emit('waiting', `${product.asin}: produto sem estoque na Copag.`);
        return;
      }
      if (!Number.isFinite(item.price) || item.price <= 0) {
        const screenshotPath = await this.captureFailure(product, 'price', page);
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Preço não identificado. Revise a oferta manualmente.', screenshotPath });
        this.emit('attention', `${product.asin}: preço não identificado.`);
        return;
      }
      if (item.price > product.maxPrice) {
        this.updateProduct(product.id, { state: 'price_high', lastCheck: new Date().toISOString(), price: item.price, detail: `Preço acima do limite: R$ ${item.price.toFixed(2)}.` });
        this.emit('waiting', `${product.asin}: R$ ${item.price.toFixed(2)} acima do limite.`);
        return;
      }
      this.updateProduct(product.id, { state: 'available', lastCheck: new Date().toISOString(), price: item.price, detail: `Disponível por R$ ${item.price.toFixed(2)}.` });
      this.emit('available', `${product.asin} disponível por R$ ${item.price.toFixed(2)}.`);
      if (!proceedToCheckout) return;

      const buyButton = page.locator('.buy-button:not(.btn-comprar), .buy-button-ref:not(.btn-comprar)').filter({ visible: true }).first();
      if (!await buyButton.isVisible().catch(() => false)) {
        const screenshotPath = await this.captureFailure(product, 'buy-button', page);
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), detail: 'Botão de compra principal não identificado. Revise a oferta manualmente.', screenshotPath });
        this.emit('attention', `${product.asin}: botão de compra não identificado.`);
        return;
      }
      await Promise.all([
        page.waitForURL(/\/checkout\//, { timeout: 30_000 }),
        buyButton.click(),
      ]);
      const cartText = await page.locator('body').innerText({ timeout: 10_000 });
      const cartPrice = priceFromText(cartText);
      if (!normalizeText(cartText).includes(normalizeText(title)) || cartPrice === null || cartPrice > product.maxPrice) {
        const screenshotPath = await this.captureFailure(product, 'cart-item', page);
        this.updateProduct(product.id, { state: 'attention', lastCheck: new Date().toISOString(), price: cartPrice, detail: 'O carrinho não confirmou título e preço dentro do limite.', screenshotPath });
        this.emit('attention', `${product.asin}: carrinho não confirmou título e preço.`);
        return;
      }
      await page.bringToFront();
      this.updateProduct(product.id, { state: 'review', enabled: false, lastCheck: new Date().toISOString(), price: cartPrice, detail: 'Revisão da compra aberta na Copag. Confirme manualmente.' });
      this.emit('review', `${product.asin}: revisão da compra aberta. Nenhum pedido foi enviado.`);
    } catch (error) {
      const screenshotPath = await this.captureFailure(product, 'error', page);
      this.updateProduct(product.id, { state: 'error', lastCheck: new Date().toISOString(), detail: error.message, screenshotPath });
      this.emit('warning', `${product.asin}: ${error.message}`);
    }
  }

  async stop() {
    ++this.runId;
    clearInterval(this.timer);
    this.timer = null;
    const context = this.context;
    this.context = null;
    this.initialPage = null;
    this.pages.clear();
    if (context) await context.close().catch(() => {});
    this.emit('stopped', 'Monitor de produtos parado.');
  }
}
