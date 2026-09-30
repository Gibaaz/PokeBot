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
const productUrl = document.querySelector('#product-url');
const productPrice = document.querySelector('#product-price');
const productInterval = document.querySelector('#product-interval');
const productList = document.querySelector('#product-list');
const productEvents = document.querySelector('#product-events');
const productsStatus = document.querySelector('#products-status');
const productsStart = document.querySelector('#products-start');
const productsStop = document.querySelector('#products-stop');
const productsNote = document.querySelector('#products-note');
const alertEnabled = document.querySelector('#alert-enabled');
const alertSound = document.querySelector('#alert-sound');
let terms = [];
let loaded = false;
let configLocked = false;
let products = [];
let productsLoaded = false;
let productsLocked = false;
let alertSettingsLoaded = false;
let customAlertAudio;

const viewMeta = {
  'polls-view': ['Enquetes', 'Monitor e voto automático no WhatsApp.'],
  'products-view': ['Compras', 'Monitore produtos e avance até a revisão do pedido.'],
};

function selectView(id) {
  document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== id; });
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === id));
  document.querySelector('#poll-toolbar').hidden = id !== 'polls-view';
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
  document.querySelector('#product-add').disabled = productsLocked;
}

function productState(product) {
  const labels = { waiting: 'Aguardando', unavailable: 'Esgotado', price_high: 'Acima do limite', available: 'Disponível', review: 'Em revisão', attention: 'Atenção', error: 'Erro' };
  return labels[product.state] || product.state;
}

function renderProducts() {
  if (!products.length) {
    productList.innerHTML = '<div class="empty-products">Nenhum produto monitorado.</div>';
    return;
  }
  productList.innerHTML = products.map((product) => `<article class="product-row"><div><p class="product-id">${escapeHtml(product.title || product.asin)} <span class="muted">${escapeHtml(product.asin)}</span></p><p class="product-detail">${escapeHtml(product.detail || productState(product))}</p></div><div class="product-price">Limite R$ ${Number(product.maxPrice).toFixed(2)}<br><span class="muted">${productState(product)}</span></div><div class="product-actions"><button class="small-button checkout" data-id="${product.id}" ${productsLocked || product.state !== 'available' ? 'disabled' : ''}>Revisar</button><button class="small-button resume-product" data-id="${product.id}" ${product.state !== 'review' && product.state !== 'attention' ? 'hidden' : ''}>Voltar a monitorar</button><button class="small-button remove-product" data-id="${product.id}" ${productsLocked ? 'disabled' : ''}>Remover</button></div></article>`).join('');
  productList.querySelectorAll('.remove-product').forEach((button) => button.addEventListener('click', async () => {
    try { const data = await window.pollRunner.removeProduct(button.dataset.id); products = data.products; renderProducts(); } catch (error) { productsNote.textContent = error.message; }
  }));
  productList.querySelectorAll('.checkout').forEach((button) => button.addEventListener('click', async () => {
    try { await window.pollRunner.checkoutProduct(button.dataset.id); } catch (error) { productsNote.textContent = error.message; }
  }));
  productList.querySelectorAll('.resume-product').forEach((button) => button.addEventListener('click', async () => {
    try { const data = await window.pollRunner.resumeProduct(button.dataset.id); products = data.products; renderProducts(); } catch (error) { productsNote.textContent = error.message; }
  }));
}

function renderProductLogs(logs) {
  if (!logs.length) { productEvents.innerHTML = ''; return; }
  productEvents.innerHTML = logs.slice(0, 5).map((entry) => `<article class="event ${entry.state}"><i class="event-mark"></i><div><p>${escapeHtml(entry.message)}</p><time>${new Date(entry.at).toLocaleTimeString('pt-BR')}</time></div></article>`).join('');
}

function renderAlertConfig(config) {
  alertEnabled.checked = config.enabled;
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
termInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') addTerm(); });
interval.addEventListener('input', () => { intervalValue.textContent = `${interval.value} ms`; });
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
document.querySelector('#product-add').addEventListener('click', async () => {
  try {
    const data = await window.pollRunner.addProduct({ url: productUrl.value, maxPrice: productPrice.value, intervalMs: productInterval.value });
    products = data.products;
    productUrl.value = '';
    productPrice.value = '';
    productsNote.textContent = 'Produto adicionado. O checkout para na revisão do pedido.';
    renderProducts();
  } catch (error) { productsNote.textContent = error.message; }
});
productsStart.addEventListener('click', async () => {
  try {
    await window.pollRunner.startProducts();
  } catch (error) { productsNote.textContent = error.message; }
});
productsStop.addEventListener('click', async () => { await window.pollRunner.stopProducts(); });
async function saveAlertConfig() {
  try {
    const data = await window.pollRunner.saveAlertConfig({ enabled: alertEnabled.checked, sound: alertSound.value });
    renderAlertConfig(data.alertConfig);
  } catch (error) { productsNote.textContent = error.message; }
}
alertEnabled.addEventListener('change', saveAlertConfig);
alertSound.addEventListener('change', saveAlertConfig);

refresh();
refreshProducts();
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
