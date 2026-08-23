import { EVENT_CONFIG, supabase } from './supabase-config.js';

const state = { produtos: [], sorteios: [], cronograma: [], candidatas: [], category: 'todos', selectedDrawId: null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const formatMoney = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatTime = (value) => value ? String(value).slice(0, 5) : 'Horário a confirmar';
const emptyState = (message) => `<div class="empty-state"><span>✦</span><p>${escapeHtml(message)}</p></div>`;
const statusLabel = { disponivel: 'Disponível', poucas_unidades: 'Restam poucas unidades!', esgotado: 'Esgotado', aguardando: 'Aguardando', em_andamento: 'Em andamento', realizado: 'Realizado', pendente: 'Pendente' };

function setNetwork(message, tone = '') { const element = $('#network-status'); element.textContent = message; element.className = `network-status ${tone}`; }
function routeTo(route) { $$('.screen').forEach((screen) => { screen.hidden = screen.dataset.screen !== route; screen.classList.toggle('active', screen.dataset.screen === route); }); $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.route === route)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function renderImage(url, alt, className = 'card-image') { return url ? `<img class="${className}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />` : `<div class="${className} image-placeholder" role="img" aria-label="Espaço reservado para imagem de ${escapeHtml(alt)}"></div>`; }
function renderStatus(status) { return `<span class="status status-${escapeHtml(status)}">${escapeHtml(statusLabel[status] || status)}</span>`; }

function renderHome() {
  const current = state.sorteios.find((draw) => draw.status === 'em_andamento');
  const hero = $('#live-hero');
  hero.hidden = !current;
  hero.innerHTML = current ? `<span>🔥 AO VIVO</span><div><strong>Sorteio em andamento: ${escapeHtml(current.premio)}</strong><small>${escapeHtml(current.identificacao)} — toque para acompanhar.</small></div><button class="arrow-button" type="button" data-open-draw="${current.id}" aria-label="Acompanhar sorteio">→</button>` : '';
}

function renderProducts() {
  const items = state.produtos.filter((item) => item.categoria !== 'brincadeira' && (state.category === 'todos' || item.categoria === state.category));
  $('#products-list').innerHTML = items.length ? items.map((item) => `<article class="product-card ${item.status === 'esgotado' ? 'sold-out' : ''}">${renderImage(item.imagem_url, item.nome)}<div class="card-content"><div class="card-topline"><span class="category-tag">${escapeHtml(item.categoria)}</span>${renderStatus(item.status)}</div><h3>${escapeHtml(item.nome)}</h3><p>${escapeHtml(item.descricao || 'Sabor especial da nossa festa.')}</p><strong class="price">${formatMoney(item.preco)}</strong></div>${item.status === 'esgotado' ? '<div class="sold-stamp">ESGOTADO</div>' : ''}</article>`).join('') : emptyState('Ainda não há itens nesta categoria. Volte em breve!');
}

function renderActivities() {
  const items = state.produtos.filter((item) => item.categoria === 'brincadeira');
  $('#activities-list').innerHTML = items.length ? items.map((item) => `<article class="activity-card ${item.status === 'esgotado' ? 'sold-out' : ''}">${renderImage(item.imagem_url, item.nome, 'activity-image')}<div><div class="card-topline">${renderStatus(item.status)}</div><h3>${escapeHtml(item.nome)}</h3><p>${escapeHtml(item.descricao || 'Informações disponíveis na barraca.')}</p><strong class="price">${formatMoney(item.preco)}</strong></div></article>`).join('') : emptyState('As brincadeiras serão divulgadas em breve.');
}

function renderDraws() {
  const container = $('#draws-list');
  container.innerHTML = state.sorteios.length ? state.sorteios.map((draw) => `<article class="draw-card ${draw.status === 'em_andamento' ? 'is-live' : ''}"><div class="draw-image image-placeholder" role="img" aria-label="Espaço reservado para imagem do prêmio ${escapeHtml(draw.premio)}"></div><div class="draw-card-content"><div class="draw-type">${escapeHtml(draw.tipo)}</div>${renderStatus(draw.status)}<h3>${escapeHtml(draw.identificacao)}</h3><p>${escapeHtml(draw.premio)}</p><strong>${draw.valor_cartela > 0 ? `Cartela: ${formatMoney(draw.valor_cartela)}` : 'Participação especial'}</strong><button class="secondary-button" data-open-draw="${draw.id}" type="button">${draw.status === 'em_andamento' ? 'Acompanhar ao vivo' : 'Ver detalhes'}</button></div></article>`).join('') : emptyState('Os sorteios aparecerão aqui assim que forem cadastrados.');
  if (state.selectedDrawId) renderDrawDetail();
}

function renderBingo(numbers) {
  const columns = [['B', 1, 15], ['I', 16, 30], ['N', 31, 45], ['G', 46, 60], ['O', 61, 75]];
  return `<div class="bingo-board">${columns.map(([letter, min, max]) => `<div><b>${letter}</b>${numbers.filter((number) => number >= min && number <= max).map((number) => `<span>${number}</span>`).join('') || '<i>—</i>'}</div>`).join('')}</div>`;
}

function renderDrawDetail() {
  const draw = state.sorteios.find((item) => Number(item.id) === Number(state.selectedDrawId));
  const detail = $('#draw-detail');
  if (!draw) { detail.hidden = true; return; }
  const numbers = Array.isArray(draw.numeros_sorteados) ? draw.numeros_sorteados.map(Number).filter(Number.isFinite) : [];
  detail.hidden = false;
  detail.innerHTML = `<div class="detail-header"><div><p class="kicker">${escapeHtml(draw.tipo)}</p><h2>${escapeHtml(draw.premio)}</h2><p>${escapeHtml(draw.identificacao)}</p></div>${renderStatus(draw.status)}</div><div class="last-number"><span>${draw.tipo === 'leilao' ? 'Último lance' : 'Último número'}</span><strong>${draw.ultimo_numero ?? '—'}</strong></div>${draw.tipo === 'bingo' ? renderBingo(numbers) : `<div class="number-history"><h3>Histórico</h3>${numbers.length ? numbers.map((number) => `<span>${number}</span>`).join('') : '<p>Nenhum número chamado ainda.</p>'}</div>`}`;
}

function renderCandidates() {
  $('#candidates-list').innerHTML = state.candidatas.length ? state.candidatas.map((candidate) => `<article class="candidate-card">${renderImage(candidate.foto_url, candidate.nome, 'candidate-photo')}<div><span class="candidate-crown">♕</span><h3>${escapeHtml(candidate.nome)}</h3><p>${escapeHtml(candidate.detalhes || 'Representante da escola')}</p><strong>Desfile: ${formatTime(candidate.horario_desfile)}</strong></div></article>`).join('') : emptyState('As candidatas serão apresentadas em breve.');
}

function eventCountdown(item) {
  if (item.status === 'realizado') return 'Realizado';
  const [hours, minutes] = String(item.horario_previsto || '00:00').split(':').map(Number);
  const target = new Date(); target.setHours(hours, minutes, 0, 0);
  const diff = target - new Date();
  if (diff <= 0) return 'Horário previsto chegou';
  const totalMinutes = Math.ceil(diff / 60000); return totalMinutes < 60 ? `Faltam ${totalMinutes} min` : `Faltam ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}min`;
}
function renderSchedule() {
  const sorted = [...state.cronograma].sort((a, b) => String(a.horario_previsto).localeCompare(String(b.horario_previsto)));
  $('#schedule-list').innerHTML = sorted.length ? sorted.map((item) => `<article class="timeline-item ${item.status === 'realizado' ? 'done' : ''}"><time>${formatTime(item.horario_previsto)}</time><div><div class="timeline-title"><h3>${escapeHtml(item.evento)}</h3>${renderStatus(item.status)}</div><p>${eventCountdown(item)}</p>${item.sorteio_id ? `<button class="inline-link" type="button" data-open-draw="${item.sorteio_id}">Acompanhar sorteio →</button>` : ''}</div></article>`).join('') : emptyState('A programação será publicada em breve.');
}
function renderAll() { renderHome(); renderProducts(); renderActivities(); renderDraws(); renderCandidates(); renderSchedule(); }

async function loadAll() {
  setNetwork('Atualizando informações...', 'loading');
  const [produtos, sorteios, cronograma, candidatas] = await Promise.all([
    supabase.from('produtos').select('*').order('nome'), supabase.from('sorteios').select('*').order('id', { ascending: false }), supabase.from('cronograma').select('*').order('horario_previsto'), supabase.from('candidatas').select('*').order('nome'),
  ]);
  const errors = [produtos, sorteios, cronograma, candidatas].map((result) => result.error).filter(Boolean);
  if (errors.length) { setNetwork('Não foi possível atualizar agora. Tentaremos reconectar.', 'offline'); console.error(errors); return; }
  state.produtos = produtos.data || []; state.sorteios = sorteios.data || []; state.cronograma = cronograma.data || []; state.candidatas = candidatas.data || [];
  renderAll(); setNetwork('Informações ao vivo', 'online');
}

function showPublicAlert(message) { const alert = $('#public-alert'); alert.textContent = `📣 ${message}`; alert.hidden = false; clearTimeout(showPublicAlert.timer); showPublicAlert.timer = setTimeout(() => { alert.hidden = true; }, 25000); }
function configureStaticInfo() { $('#pix-key').textContent = EVENT_CONFIG.pixKey; $('#pix-holder').textContent = EVENT_CONFIG.pixHolder; $('#pix-bank').textContent = EVENT_CONFIG.pixBank; const help = $('#help-button'); if (EVENT_CONFIG.whatsappNumber) help.href = `https://wa.me/${EVENT_CONFIG.whatsappNumber.replace(/\D/g, '')}`; else help.hidden = true; const qr = $('.qr-placeholder'); if (EVENT_CONFIG.pixQrImage) qr.innerHTML = `<img src="${escapeHtml(EVENT_CONFIG.pixQrImage)}" alt="QR Code PIX" />`; }

async function subscribeRealtime() {
  ['produtos', 'sorteios', 'cronograma', 'candidatas'].forEach((table) => supabase.channel(`festa-${table}`).on('postgres_changes', { event: '*', schema: 'public', table }, () => loadAll()).subscribe((status) => { if (status === 'SUBSCRIBED') setNetwork('Informações ao vivo', 'online'); if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setNetwork('Rede instável. Reconectando...', 'offline'); }));
  // O canal de avisos e privado: so organizadores publicam nele. setAuth() e
  // obrigatorio para o Realtime avaliar as policies de realtime.messages.
  await supabase.realtime.setAuth();
  supabase.channel('avisos-globais', { config: { private: true } }).on('broadcast', { event: 'alerta' }, ({ payload }) => { if (payload?.mensagem) showPublicAlert(payload.mensagem); }).subscribe();
}

const menuToggle = document.querySelector('.menu-toggle');
menuToggle?.addEventListener('click', () => {
  const isOpen = document.body.classList.toggle('menu-open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
});

document.addEventListener('click', (event) => {
  const route = event.target.closest('[data-route]'); if (route) { event.preventDefault(); routeTo(route.dataset.route); document.body.classList.remove('menu-open'); menuToggle?.setAttribute('aria-expanded', 'false'); menuToggle?.setAttribute('aria-label', 'Abrir menu'); }
  const draw = event.target.closest('[data-open-draw]'); if (draw) { state.selectedDrawId = Number(draw.dataset.openDraw); routeTo('sorteios'); renderDrawDetail(); $('#draw-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
$$('.filter').forEach((button) => button.addEventListener('click', () => { state.category = button.dataset.category; $$('.filter').forEach((item) => item.classList.toggle('active', item === button)); renderProducts(); }));
$('#copy-pix').addEventListener('click', async () => { try { await navigator.clipboard.writeText(EVENT_CONFIG.pixKey); $('#pix-feedback').textContent = 'Chave copiada! Abra o app do seu banco.'; } catch { $('#pix-feedback').textContent = 'Não foi possível copiar automaticamente. Selecione a chave acima.'; } });
setInterval(renderSchedule, 30000); configureStaticInfo(); loadAll(); subscribeRealtime();
