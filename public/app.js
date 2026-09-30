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
let terms = [];
let loaded = false;
let configLocked = false;

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

document.querySelector('#addTerm').addEventListener('click', addTerm);
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

refresh();
window.pollRunner.onUpdate(({ state, logs }) => {
  renderStatus(state);
  renderLogs(logs);
});
