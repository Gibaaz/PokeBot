const groupName = document.querySelector('#groupName');
const termInput = document.querySelector('#termInput');
const chips = document.querySelector('#chips');
const interval = document.querySelector('#interval');
const intervalValue = document.querySelector('#intervalValue');
const status = document.querySelector('#status');
const timeline = document.querySelector('#timeline');
const saveNote = document.querySelector('#save-note');
const start = document.querySelector('#start');
const stop = document.querySelector('#stop');
const pause = document.querySelector('#pause');
const productUrl = document.querySelector('#product-url');
const productPrice = document.querySelector('#product-price');
const productInterval = document.querySelector('#product-interval');
const productCustomInterval = document.querySelector('#product-custom-interval');
const productSeller = document.querySelector('#product-seller');
const productShipping = document.querySelector('#product-shipping');
const productGroup = document.querySelector('#product-group');
const productList = document.querySelector('#product-list');
const productEvents = document.querySelector('#product-events');
const productsStatus = document.querySelector('#products-status');
const productsStart = document.querySelector('#products-start');
const productsStop = document.querySelector('#products-stop');
const productsNote = document.querySelector('#products-note');
const productsResumeAll = document.querySelector('#products-resume-all');
const productsImport = document.querySelector('#products-import');
const productsExport = document.querySelector('#products-export');
const productCancel = document.querySelector('#product-cancel');
const openProductForm = document.querySelector('#open-product-form');
const productDialog = document.querySelector('#product-dialog');
const productDialogTitle = document.querySelector('#product-dialog-title');
const alertEnabled = document.querySelector('#alert-enabled');
const alertNotifications = document.querySelector('#alert-notifications');
const alertSound = document.querySelector('#alert-sound');
const alertTest = document.querySelector('#alert-test');
const startWithWindows = document.querySelector('#start-with-windows');
const minimizeToTray = document.querySelector('#minimize-to-tray');
const saveAppSettingsButton = document.querySelector('#save-app-settings');
const appSettingsNote = document.querySelector('#app-settings-note');
const importDialog = document.querySelector('#import-dialog');
const cancelImport = document.querySelector('#cancel-import');
const confirmImport = document.querySelector('#confirm-import');
let terms = [];
let loaded = false;
let configLocked = false;
let products = [];
let productsLoaded = false;
let productsLocked = false;
let alertSettingsLoaded = false;
let customAlertAudio;
let editingProductId = null;
let priceCharts = [];

const viewMeta = {
  'polls-view': ['Enquetes', 'Monitor e voto automático no WhatsApp.'],
  'products-view': ['Compras', 'Monitore produtos e avance até a revisão do pedido.'],
  'settings-view': ['Configurações', 'Preferências do aplicativo e execução no Windows.'],
};

function selectView(id) {
  document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== id; });
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === id));
  document.querySelector('#poll-toolbar').hidden = id !== 'polls-view';
  document.querySelector('#products-toolbar').hidden = id !== 'products-view';
  document.querySelector('#page-title').textContent = viewMeta[id][0];
  document.querySelector('#page-description').textContent = viewMeta[id][1];
}

function renderTerms() {
  chips.innerHTML = terms.map((term, index) => `<span class="chip">${escapeHtml(term)}<button data-index="${index}" aria-label="Remover ${escapeHtml(term)}" ${configLocked ? 'disabled' : ''}>x</button></span>`).join('');
  chips.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    terms.splice(Number(button.dataset.index), 1);
    renderTerms();
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function addTerm() {
  const term = termInput.value.trim();
  if (!term) return;
  if (terms.some((value) => normalize(value) === normalize(term))) {
    showNotice('Esse termo ja foi adicionado.');
    return;
  }
  terms.push(term);
  termInput.value = '';
  renderTerms();
}

function normalize(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/(.)\1{2,}/g, '$1$1').trim();
}

function showNotice(message) {
  saveNote.textContent = message;
  clearTimeout(showNotice.timeout);
  showNotice.timeout = setTimeout(() => { saveNote.textContent = ''; }, 2_500);
}

function renderStatus(state) {
  const labels = { stopped: 'Parado', starting: 'Iniciando', awaiting_login: 'Aguardando QR', opening_group: 'Abrindo grupo', running: 'Monitorando', paused: 'Pausado', error: 'Erro' };
  status.className = `status ${state}`;
  status.innerHTML = `<span></span><strong>${labels[state] || state}</strong>`;
  start.disabled = state !== 'stopped' && state !== 'error';
  stop.disabled = state === 'stopped';
  pause.disabled = state !== 'running' && state !== 'paused';
  pause.textContent = state === 'paused' ? 'Retomar' : 'Pausar';
  configLocked = state !== 'stopped' && state !== 'error';
  groupName.disabled = configLocked;
  termInput.disabled = configLocked;
  interval.disabled = configLocked;
  document.querySelector('#addTerm').disabled = configLocked;
  document.querySelector('#save').disabled = configLocked;
  renderTerms();
}

function renderLogs(logs) {
  if (!logs.length) {
    timeline.innerHTML = '<div class="empty">Nenhuma atividade ainda.<br>Inicie o bot para conectar ao WhatsApp Web.</div>';
    return;
  }
  timeline.innerHTML = logs.map((entry) => `<article class="event ${entry.state}"><i class="event-mark"></i><div><p>${escapeHtml(entry.message)}</p><time>${new Date(entry.at).toLocaleTimeString('pt-BR')}</time></div></article>`).join('');
}

function renderProductStatus(state) {
  const labels = { stopped: 'Parado', starting: 'Iniciando', running: 'Monitorando', checking: 'Verificando', attention: 'Atenção', error: 'Erro' };
  productsStatus.className = `status ${state}`;
  productsStatus.innerHTML = `<span></span><strong>${labels[state] || state}</strong>`;
  productsLocked = state !== 'stopped' && state !== 'error';
  productsStart.disabled = productsLocked;
  productsStop.disabled = state === 'stopped';
  productUrl.disabled = productsLocked;
  productPrice.disabled = productsLocked;
  productInterval.disabled = productsLocked;
  productCustomInterval.disabled = productsLocked;
  productSeller.disabled = productsLocked;
  productShipping.disabled = productsLocked;
  productGroup.disabled = productsLocked;
  document.querySelector('#product-add').disabled = productsLocked;
  productsImport.disabled = productsLocked;
}

function productState(product) {
  const labels = { waiting: 'Aguardando', disabled: 'Pausado', unavailable: 'Esgotado', price_high: 'Acima do limite', seller_mismatch: 'Vendedor diferente', shipping_high: 'Frete acima do limite', available: 'Disponível', review: 'Em revisão', attention: 'Atenção', error: 'Erro' };
  return labels[product.state] || product.state;
}

function storeMeta(store) {
  if (store === 'mercadolivre') return { name: 'Mercado Livre', className: 'store-mercadolivre' };
  if (store === 'copag') return { name: 'Copag', className: 'store-copag' };
  return { name: 'Amazon', className: 'store-amazon' };
}

function renderAppSettings(settings) {
  startWithWindows.checked = settings.startWithWindows;
  minimizeToTray.checked = settings.minimizeToTray;
}

function syncCustomInterval() {
  const custom = productInterval.value === 'custom';
  productCustomInterval.hidden = !custom;
  productCustomInterval.required = custom;
}

function openProductDialog(product = null) {
  editingProductId = product?.id || null;
  productDialogTitle.textContent = product ? 'Editar produto' : 'Adicionar produto';
  productUrl.value = product?.url || '';
  productPrice.value = product?.maxPrice || '';
  productSeller.value = product?.sellerFilter || '';
  productShipping.value = product?.maxShipping ?? '';
  productGroup.value = product?.group || '';
  if (product && ![60000, 120000, 300000].includes(product.intervalMs)) {
    productInterval.value = 'custom';
    productCustomInterval.value = Math.round(product.intervalMs / 60_000);
  } else {
    productInterval.value = String(product?.intervalMs || 60000);
    productCustomInterval.value = '';
  }
  syncCustomInterval();
  document.querySelector('#product-add').textContent = product ? 'Salvar' : 'Adicionar';
  productDialog.showModal();
  productUrl.focus();
}

function renderProductHistory(product) {
  const history = Array.isArray(product.history) ? product.history : [];
  if (!history.length) return '<p class="history-empty">O histórico aparece após a primeira verificação.</p>';
  const prices = history.filter((entry) => Number.isFinite(entry.price)).slice(0, 20).reverse();
  const chart = prices.length > 1 ? `<div class="price-chart"><canvas data-chart-product="${product.id}"></canvas></div>` : '';
  return `${chart}${history.slice(0, 8).map((entry) => `<p><span>${escapeHtml(productState(entry))}</span>${entry.price === null || entry.price === undefined ? '' : ` R$ ${Number(entry.price).toFixed(2)}`}<time>${new Date(entry.at).toLocaleString('pt-BR')}</time></p>`).join('')}`;
}

function renderPriceCharts() {
  priceCharts.forEach((chart) => chart.destroy());
  priceCharts = [];
  if (!window.Chart) return;
  productList.querySelectorAll('canvas[data-chart-product]').forEach((canvas) => {
    const product = products.find((item) => item.id === canvas.dataset.chartProduct);
    const history = (product?.history || []).filter((entry) => Number.isFinite(entry.price)).slice(0, 20).reverse();
    priceCharts.push(new window.Chart(canvas, {
      type: 'line',
      data: {
        labels: history.map((entry) => new Date(entry.at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
        datasets: [{ data: history.map((entry) => entry.price), borderColor: '#fafafa', borderWidth: 1.5, pointRadius: 2, pointBackgroundColor: '#a1a1aa', tension: 0.25 }],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { displayColors: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    }));
  });
}

function closeProductMenus(except = null) {
  document.querySelectorAll('.product-menu[open]').forEach((menu) => {
    if (menu !== except) menu.open = false;
  });
}

function renderProducts() {
  if (!products.length) {
    productList.innerHTML = '<div class="empty-products">Nenhum produto monitorado.</div>';
    return;
  }
  productList.innerHTML = products.map((product) => {
    const store = storeMeta(product.store);
    const primaryAction = product.state === 'available'
      ? `<button class="small-button checkout" data-id="${product.id}" ${productsLocked ? 'disabled' : ''}>Revisar</button>`
      : ['review', 'attention'].includes(product.state)
        ? `<button class="small-button resume-product" data-id="${product.id}">Voltar a monitorar</button>`
        : '';
    return `<article class="product-row ${store.className}"><div class="product-main"><p class="product-id">${escapeHtml(product.title || product.asin)}</p><span class="muted store-label"><i></i>${store.name} · ${escapeHtml(product.asin)}</span></div><div class="product-price"><strong>${productState(product)}</strong><span>Limite R$ ${Number(product.maxPrice).toFixed(2)}</span></div><div class="product-actions">${primaryAction}<details class="product-menu"><summary aria-label="Mais ações"><i class="ph ph-dots-three"></i></summary><div><button class="menu-edit edit-product" data-id="${product.id}" ${productsLocked ? 'disabled' : ''}>Editar</button><button class="menu-edit toggle-product" data-id="${product.id}" data-enabled="${product.enabled}">${product.enabled ? 'Pausar' : 'Ativar'}</button><button class="menu-edit screenshot" data-path="${escapeHtml(product.screenshotPath || '')}" ${product.screenshotPath ? '' : 'hidden'}>Abrir captura</button><button class="menu-edit danger remove-product" data-id="${product.id}" ${productsLocked ? 'disabled' : ''}>Remover</button></div></details></div><details class="product-details"><summary>Detalhes</summary><p>${escapeHtml(product.detail || productState(product))}</p><p class="muted">A cada ${Math.round(product.intervalMs / 60_000)} min${product.group ? ` · ${escapeHtml(product.group)}` : ''}${product.seller ? ` · ${escapeHtml(product.seller)}` : ''}${Number.isFinite(product.shipping) ? ` · Frete R$ ${product.shipping.toFixed(2)}` : ''}</p><details class="product-history"><summary>Histórico (${Array.isArray(product.history) ? product.history.length : 0})</summary><div>${renderProductHistory(product)}</div></details></details></article>`;
  }).join('');
  productList.querySelectorAll('.remove-product').forEach((button) => button.addEventListener('click', async () => {
    try { const data = await window.pollRunner.removeProduct(button.dataset.id); products = data.products; renderProducts(); } catch (error) { productsNote.textContent = error.message; }
  }));
  productList.querySelectorAll('.checkout').forEach((button) => button.addEventListener('click', async () => {
    try { await window.pollRunner.checkoutProduct(button.dataset.id); } catch (error) { productsNote.textContent = error.message; }
  }));
  productList.querySelectorAll('.resume-product').forEach((button) => button.addEventListener('click', async () => {
    try { const data = await window.pollRunner.resumeProduct(button.dataset.id); products = data.products; renderProducts(); } catch (error) { productsNote.textContent = error.message; }
  }));
  productList.querySelectorAll('.edit-product').forEach((button) => button.addEventListener('click', () => {
    const product = products.find((item) => item.id === button.dataset.id);
    if (product) openProductDialog(product);
  }));
  productList.querySelectorAll('.toggle-product').forEach((button) => button.addEventListener('click', async () => {
    try {
      const data = await window.pollRunner.setProductEnabled(button.dataset.id, button.dataset.enabled !== 'true');
      products = data.products;
      renderProducts();
    } catch (error) { productsNote.textContent = error.message; }
  }));
  productList.querySelectorAll('.screenshot').forEach((button) => button.addEventListener('click', async () => {
    try { await window.pollRunner.openScreenshot(button.dataset.path); } catch (error) { productsNote.textContent = error.message; }
  }));
  productList.querySelectorAll('.product-menu').forEach((menu) => menu.addEventListener('toggle', () => {
    if (menu.open) closeProductMenus(menu);
  }));
  productList.querySelectorAll('.product-menu').forEach((menu) => menu.addEventListener('click', (event) => {
    if (event.target.closest('button')) menu.open = false;
  }));
  renderPriceCharts();
}

function renderProductLogs(logs) {
  if (!logs.length) { productEvents.innerHTML = ''; return; }
  productEvents.innerHTML = logs.slice(0, 5).map((entry) => `<article class="event ${entry.state}"><i class="event-mark"></i><div><p>${escapeHtml(entry.message)}</p><time>${new Date(entry.at).toLocaleTimeString('pt-BR')}</time></div></article>`).join('');
}

function renderAlertConfig(config) {
  alertEnabled.checked = config.enabled;
  alertNotifications.checked = config.notifications;
  alertSound.value = config.sound;
  alertSound.disabled = !config.enabled;
}

function playCustomAlert(sound) {
  const tracks = {
    rizz: 'sounds/rizz-sound-effect.mp3',
    custom: 'sounds/custom-alert.mp3',
  };
  if (!tracks[sound]) return;
  customAlertAudio?.pause();
  customAlertAudio = new Audio(tracks[sound]);
  customAlertAudio.play().catch(() => { productsNote.textContent = 'Não foi possível tocar o alerta sonoro.'; });
}

async function request(url, options) {
  if (url === '/api/status') return window.pollRunner.status();
  if (url === '/api/config') return window.pollRunner.saveConfig(JSON.parse(options.body));
  if (url === '/api/start') return window.pollRunner.start();
  if (url === '/api/stop') return window.pollRunner.stop();
  if (url === '/api/pause') return window.pollRunner.pause();
  if (url === '/api/resume') return window.pollRunner.resume();
  throw new Error('Acao desconhecida.');
}

async function refresh() {
  try {
    const data = await request('/api/status');
    if (!loaded) {
      groupName.value = data.config.groupName;
      terms = data.config.keywords;
      interval.value = data.config.scanIntervalMs;
      renderTerms();
      renderAppSettings(data.appSettings);
      loaded = true;
    }
    intervalValue.textContent = `${interval.value} ms`;
    renderStatus(data.state);
    renderLogs(data.logs);
  } catch {
    renderStatus('error');
  }
}

async function refreshProducts() {
  try {
    const data = await window.pollRunner.productsStatus();
    if (!productsLoaded) { products = data.products; productsLoaded = true; }
    if (!alertSettingsLoaded) { renderAlertConfig(data.alertConfig); alertSettingsLoaded = true; }
    renderProductStatus(data.state);
    renderProducts();
    renderProductLogs(data.logs);
  } catch (error) { productsNote.textContent = error.message; }
}

document.querySelector('#addTerm').addEventListener('click', addTerm);
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));
document.addEventListener('click', (event) => {
  if (!event.target.closest('.product-menu')) closeProductMenus();
});
termInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') addTerm(); });
interval.addEventListener('input', () => { intervalValue.textContent = `${interval.value} ms`; });
productInterval.addEventListener('change', syncCustomInterval);
openProductForm.addEventListener('click', () => openProductDialog());
document.querySelector('#save').addEventListener('click', async () => {
  try {
    const data = await request('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupName: groupName.value, keywords: terms, scanIntervalMs: interval.value }) });
    terms = data.config.keywords;
    renderTerms();
    showNotice('Salvo');
  } catch (error) { showNotice(error.message); }
});
start.addEventListener('click', async () => { try { await request('/api/start', { method: 'POST' }); refresh(); } catch (error) { showNotice(error.message); } });
stop.addEventListener('click', async () => { await request('/api/stop', { method: 'POST' }); refresh(); });
pause.addEventListener('click', async () => {
  try { await request(pause.textContent === 'Retomar' ? '/api/resume' : '/api/pause', { method: 'POST' }); refresh(); } catch (error) { showNotice(error.message); }
});
document.querySelector('#product-add').addEventListener('click', async () => {
  try {
    const intervalMs = productInterval.value === 'custom' ? Number(productCustomInterval.value) * 60_000 : productInterval.value;
    if (productInterval.value === 'custom' && (!Number.isInteger(Number(productCustomInterval.value)) || Number(productCustomInterval.value) < 1)) throw new Error('Informe um intervalo inteiro de ao menos 1 minuto.');
    const input = { url: productUrl.value, maxPrice: productPrice.value, intervalMs, sellerFilter: productSeller.value, maxShipping: productShipping.value, group: productGroup.value };
    const data = editingProductId ? await window.pollRunner.updateProduct(editingProductId, input) : await window.pollRunner.addProduct(input);
    products = data.products;
    productUrl.value = '';
    productPrice.value = '';
    productCustomInterval.value = '';
    productSeller.value = '';
    productShipping.value = '';
    productGroup.value = '';
    productInterval.value = '60000';
    syncCustomInterval();
    editingProductId = null;
    document.querySelector('#product-add').textContent = 'Adicionar';
    productDialog.close();
    productsNote.textContent = 'Produto salvo. O checkout para na revisão do pedido.';
    renderProducts();
  } catch (error) { productsNote.textContent = error.message; }
});
productCancel.addEventListener('click', () => {
  editingProductId = null;
  productUrl.value = '';
  productPrice.value = '';
  productCustomInterval.value = '';
  productSeller.value = '';
  productShipping.value = '';
  productGroup.value = '';
  productInterval.value = '60000';
  syncCustomInterval();
  document.querySelector('#product-add').textContent = 'Adicionar';
  productDialog.close();
});
productsStart.addEventListener('click', async () => {
  try {
    await window.pollRunner.startProducts();
  } catch (error) { productsNote.textContent = error.message; }
});
productsStop.addEventListener('click', async () => { await window.pollRunner.stopProducts(); });
productsResumeAll.addEventListener('click', async () => {
  try { const data = await window.pollRunner.resumeAllProducts(); products = data.products; renderProducts(); } catch (error) { productsNote.textContent = error.message; }
});
productsExport.addEventListener('click', async () => {
  try { const data = await window.pollRunner.exportProducts(); if (!data.canceled) productsNote.textContent = 'Lista exportada.'; } catch (error) { productsNote.textContent = error.message; }
});
productsImport.addEventListener('click', () => importDialog.showModal());
cancelImport.addEventListener('click', () => importDialog.close());
confirmImport.addEventListener('click', async () => {
  importDialog.close();
  try { const data = await window.pollRunner.importProducts(); if (!data.canceled) { products = data.products; productsNote.textContent = 'Lista importada.'; renderProducts(); } } catch (error) { productsNote.textContent = error.message; }
});
async function saveAlertConfig() {
  try {
    const data = await window.pollRunner.saveAlertConfig({ enabled: alertEnabled.checked, notifications: alertNotifications.checked, sound: alertSound.value });
    renderAlertConfig(data.alertConfig);
  } catch (error) { productsNote.textContent = error.message; }
}
alertEnabled.addEventListener('change', saveAlertConfig);
alertNotifications.addEventListener('change', saveAlertConfig);
alertSound.addEventListener('change', saveAlertConfig);
alertTest.addEventListener('click', async () => {
  try { await window.pollRunner.testAlert(); } catch (error) { productsNote.textContent = error.message; }
});
saveAppSettingsButton.addEventListener('click', async () => {
  try {
    const data = await window.pollRunner.saveAppSettings({ startWithWindows: startWithWindows.checked, minimizeToTray: minimizeToTray.checked });
    renderAppSettings(data.appSettings);
    appSettingsNote.textContent = 'Salvo';
  } catch (error) { appSettingsNote.textContent = error.message; }
});

refresh();
refreshProducts();
syncCustomInterval();
window.pollRunner.onUpdate(({ state, logs }) => {
  renderStatus(state);
  renderLogs(logs);
});
window.pollRunner.onProductsUpdate((data) => {
  products = data.products;
  renderProductStatus(data.state);
  renderProducts();
  renderProductLogs(data.logs);
});
window.pollRunner.onAlert(({ sound }) => playCustomAlert(sound));
