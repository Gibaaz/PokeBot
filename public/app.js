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
const cardSearchForm = document.querySelector('#card-search-form');
const cardSearchMode = document.querySelector('#card-search-mode');
const cardNumber = document.querySelector('#card-number');
const cardEditionQuery = document.querySelector('#card-edition-query');
const cardEditionOptions = document.querySelector('#card-edition-options');
const cardSearchHint = document.querySelector('#card-search-hint');
const cardSearchButton = document.querySelector('#card-search');
const cardSearchNote = document.querySelector('#card-search-note');
const cardFilters = document.querySelector('#card-filters');
const cardEditionFilter = document.querySelector('#card-edition-filter');
const cardRarityFilter = document.querySelector('#card-rarity-filter');
const cardMinPrice = document.querySelector('#card-min-price');
const cardMaxPrice = document.querySelector('#card-max-price');
const cardSort = document.querySelector('#card-sort');
const cardPricedOnly = document.querySelector('#card-priced-only');
const cardFilterSummary = document.querySelector('#card-filter-summary');
const cardResults = document.querySelector('#card-results');
const cardPagination = document.querySelector('#card-pagination');
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
let searchedCards = [];
let cardPage = 1;
let cardEditions = [];
const CARDS_PER_PAGE = 10;

const viewMeta = {
  'polls-view': ['Enquetes', 'Monitor e voto automático no WhatsApp.'],
  'products-view': ['Compras', 'Monitore produtos e avance até a revisão do pedido.'],
  'cards-view': ['Cartas', 'Consulte os preços de cartas na Liga Pokémon.'],
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

function formatProductInterval(intervalMs) {
  return intervalMs < 60_000 ? `${Math.round(intervalMs / 1_000)} s` : `${Math.round(intervalMs / 60_000)} min`;
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
  if (product && ![10000, 60000, 120000, 300000].includes(product.intervalMs)) {
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
    return `<article class="product-row ${store.className}"><div class="product-main"><p class="product-id">${escapeHtml(product.title || product.asin)}</p><span class="muted store-label"><i></i>${store.name} · ${escapeHtml(product.asin)}</span></div><div class="product-price"><strong>${productState(product)}</strong><span>Limite R$ ${Number(product.maxPrice).toFixed(2)}</span></div><div class="product-actions">${primaryAction}<details class="product-menu"><summary aria-label="Mais ações"><i class="ph ph-dots-three"></i></summary><div><button class="menu-edit edit-product" data-id="${product.id}" ${productsLocked ? 'disabled' : ''}>Editar</button><button class="menu-edit toggle-product" data-id="${product.id}" data-enabled="${product.enabled}">${product.enabled ? 'Pausar' : 'Ativar'}</button><button class="menu-edit screenshot" data-path="${escapeHtml(product.screenshotPath || '')}" ${product.screenshotPath ? '' : 'hidden'}>Abrir captura</button><button class="menu-edit danger remove-product" data-id="${product.id}" ${productsLocked ? 'disabled' : ''}>Remover</button></div></details></div><details class="product-details"><summary>Detalhes</summary><p>${escapeHtml(product.detail || productState(product))}</p><p class="muted">A cada ${formatProductInterval(product.intervalMs)}${product.group ? ` · ${escapeHtml(product.group)}` : ''}${product.seller ? ` · ${escapeHtml(product.seller)}` : ''}${Number.isFinite(product.shipping) ? ` · Frete R$ ${product.shipping.toFixed(2)}` : ''}</p><details class="product-history"><summary>Histórico (${Array.isArray(product.history) ? product.history.length : 0})</summary><div>${renderProductHistory(product)}</div></details></details></article>`;
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

function formatPrice(price) {
  return Number.isFinite(price) ? price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Sem preço';
}

function filteredCards() {
  const edition = cardEditionFilter.value;
  const rarity = cardRarityFilter.value;
  const minimum = cardMinPrice.value === '' ? null : Number(cardMinPrice.value);
  const maximum = cardMaxPrice.value === '' ? null : Number(cardMaxPrice.value);
  const priceKey = cardSort.value.split('-')[0] === 'name' ? null : `${cardSort.value.split('-')[0]}Price`;
  const cards = searchedCards.filter((card) => {
    if (edition && card.edition !== edition) return false;
    if (rarity && card.rarity !== rarity) return false;
    if (cardPricedOnly.checked && !Number.isFinite(card.lowestPrice)) return false;
    if (minimum !== null && (!Number.isFinite(card.lowestPrice) || card.lowestPrice < minimum)) return false;
    if (maximum !== null && (!Number.isFinite(card.lowestPrice) || card.lowestPrice > maximum)) return false;
    return true;
  });

  return cards.toSorted((first, second) => {
    if (!priceKey) return first.name.localeCompare(second.name, 'pt-BR');
    const firstPrice = first[priceKey];
    const secondPrice = second[priceKey];
    if (!Number.isFinite(firstPrice) && !Number.isFinite(secondPrice)) return first.name.localeCompare(second.name, 'pt-BR');
    if (!Number.isFinite(firstPrice)) return 1;
    if (!Number.isFinite(secondPrice)) return -1;
    return firstPrice - secondPrice || first.name.localeCompare(second.name, 'pt-BR');
  });
}

function populateCardEditions() {
  const selectedEdition = cardEditionFilter.value;
  const editions = [...new Set(searchedCards.map((card) => card.edition).filter(Boolean))].sort((first, second) => first.localeCompare(second, 'pt-BR'));
  cardEditionFilter.innerHTML = `<option value="">Todas as edições</option>${editions.map((edition) => `<option value="${escapeHtml(edition)}">${escapeHtml(edition)}</option>`).join('')}`;
  cardEditionFilter.value = editions.includes(selectedEdition) ? selectedEdition : '';
}

function populateCardRarities() {
  const selectedRarity = cardRarityFilter.value;
  const rarities = [...new Set(searchedCards.map((card) => card.rarity).filter(Boolean))].sort((first, second) => first.localeCompare(second, 'pt-BR'));
  cardRarityFilter.innerHTML = `<option value="">Todas as raridades</option>${rarities.map((rarity) => `<option value="${escapeHtml(rarity)}">${escapeHtml(rarity)}</option>`).join('')}`;
  cardRarityFilter.value = rarities.includes(selectedRarity) ? selectedRarity : '';
}

function showCardResults(results) {
  searchedCards = results;
  cardPage = 1;
  populateCardEditions();
  populateCardRarities();
  cardFilters.hidden = !searchedCards.length;
  if (searchedCards.length) updateCardResults();
  else {
    renderCardResults(searchedCards);
    cardPagination.hidden = true;
  }
}

async function loadCardEditions() {
  if (cardEditions.length) return;
  cardSearchNote.textContent = 'Carregando coleções disponíveis...';
  const data = await window.pollRunner.cardEditions();
  cardEditions = data.editions.map((edition) => ({ ...edition, label: `${edition.name} (${edition.acronym})` }));
  cardEditionOptions.innerHTML = cardEditions.map((edition) => `<option value="${escapeHtml(edition.label)}"></option>`).join('');
  cardSearchNote.textContent = '';
}

function selectedCardEdition() {
  const query = normalize(cardEditionQuery.value);
  const matches = cardEditions.filter((edition) => [edition.name, edition.acronym, edition.label].some((value) => normalize(value) === query));
  if (matches.length === 1) return matches[0];
  const partialMatches = cardEditions.filter((edition) => normalize(edition.name).includes(query));
  if (partialMatches.length === 1) return partialMatches[0];
  if (!query) throw new Error('Informe ou selecione uma coleção.');
  throw new Error('Selecione uma coleção da lista exibida.');
}

async function updateCardSearchMode() {
  const editionMode = cardSearchMode.value === 'edition';
  cardNumber.hidden = editionMode;
  cardEditionQuery.hidden = !editionMode;
  cardSearchHint.textContent = editionMode
    ? 'Escolha uma coleção para carregar todas as cartas, incluindo as que não possuem preço.'
    : 'Se o número existir em mais de uma coleção, todos os resultados serão exibidos.';
  if (!editionMode) return;
  try {
    await loadCardEditions();
    cardEditionQuery.focus();
  } catch (error) {
    cardSearchNote.textContent = error.message;
  }
}

function updateCardResults() {
  const results = filteredCards();
  cardFilterSummary.textContent = `${results.length} de ${searchedCards.length} ${searchedCards.length === 1 ? 'resultado' : 'resultados'}`;
  if (!results.length) {
    cardResults.innerHTML = '<div class="empty-products">Nenhuma carta corresponde aos filtros selecionados.</div>';
    cardPagination.hidden = true;
    return;
  }
  const pageCount = Math.ceil(results.length / CARDS_PER_PAGE);
  cardPage = Math.min(cardPage, pageCount);
  const start = (cardPage - 1) * CARDS_PER_PAGE;
  renderCardResults(results.slice(start, start + CARDS_PER_PAGE));
  cardPagination.hidden = pageCount === 1;
  if (pageCount > 1) {
    cardPagination.innerHTML = `<button class="small-button" data-card-page="previous" ${cardPage === 1 ? 'disabled' : ''}>Anterior</button><span>Página ${cardPage} de ${pageCount}</span><button class="small-button" data-card-page="next" ${cardPage === pageCount ? 'disabled' : ''}>Próxima</button>`;
  }
}

function renderCardResults(results) {
  if (!results.length) {
    cardResults.innerHTML = '<div class="empty-products">Nenhuma carta encontrada para esse número.</div>';
    return;
  }
  cardResults.innerHTML = results.map((card, index) => `<article class="card-result"><div class="card-result-body">${card.image ? `<div class="card-image-preview"><img class="card-image" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" referrerpolicy="no-referrer"><img class="card-image-zoom" src="${escapeHtml(card.image)}" alt="" aria-hidden="true" referrerpolicy="no-referrer"></div>` : '<div class="card-image card-image-placeholder"><i class="ph ph-image"></i></div>'}<div class="card-result-content"><h3>${escapeHtml(card.name)}</h3><p class="card-meta">${escapeHtml(card.number)}${card.edition ? ` · ${escapeHtml(card.edition)}` : ''}${card.rarity ? ` · ${escapeHtml(card.rarity)}` : ''}</p><div class="card-prices"><span class="card-price-low" title="Menor preço">${formatPrice(card.lowestPrice)}</span><i aria-hidden="true">·</i><span class="card-price-average" title="Preço médio">${formatPrice(card.averagePrice)}</span><i aria-hidden="true">·</i><span class="card-price-high" title="Maior preço">${formatPrice(card.highestPrice)}</span></div><button class="small-button open-card" data-index="${index}">Abrir na Liga</button></div></div></article>`).join('');
  cardResults.querySelectorAll('.open-card').forEach((button) => button.addEventListener('click', async () => {
    try { await window.pollRunner.openCard(results[Number(button.dataset.index)].url); } catch (error) { cardSearchNote.textContent = error.message; }
  }));
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
cardSearchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  cardSearchNote.textContent = '';
  cardSearchButton.disabled = true;
  cardSearchButton.textContent = 'Pesquisando';
  try {
    const edition = cardSearchMode.value === 'edition' ? selectedCardEdition() : null;
    if (edition) cardSearchButton.textContent = 'Carregando coleção';
    const data = edition ? await window.pollRunner.searchCardEdition(edition) : await window.pollRunner.searchCards(cardNumber.value);
    showCardResults(data.results);
  } catch (error) {
    searchedCards = [];
    cardFilters.hidden = true;
    cardPagination.hidden = true;
    cardResults.innerHTML = '<div class="empty-products">Não foi possível concluir a pesquisa.</div>';
    cardSearchNote.textContent = error.message;
  } finally {
    cardSearchButton.disabled = false;
    cardSearchButton.textContent = 'Pesquisar';
  }
});
cardSearchMode.addEventListener('change', () => { void updateCardSearchMode(); });
cardFilters.addEventListener('input', () => { cardPage = 1; updateCardResults(); });
cardFilters.addEventListener('change', () => { cardPage = 1; updateCardResults(); });
cardPagination.addEventListener('click', (event) => {
  const button = event.target.closest('[data-card-page]');
  if (!button) return;
  cardPage += button.dataset.cardPage === 'next' ? 1 : -1;
  updateCardResults();
});
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
