import { EVENT_CONFIG, supabase } from './supabase-config.js';

// `pedido` é a Lista de pedido do visitante: um mapa { idDoProduto: quantidade }
// guardado apenas no localStorage do próprio celular. Nada é enviado ao banco.
const state = { produtos: [], sorteios: [], cronograma: [], candidatas: [], category: 'todos', selectedDrawId: null, route: 'inicio', pedido: {}, vibrar: true, evento: null, conexao: 'conectando', canal: null, ultimoAvisoId: 0, tentativas: 0 };
// Rede de festa cai e volta o tempo todo, e ha operadora que bloqueia WebSocket.
// Por isso o site nunca depende so do Realtime: ele tambem recarrega sozinho.
const POLL_AO_VIVO = 45000;
const POLL_SEM_REALTIME = 12000;
const AVISO_VALIDO_MS = 3 * 60 * 1000;
// `numerosVistos` guarda o ultimo numero ja conhecido de cada sorteio, para
// distinguir "numero novo" de "mesma tela recarregada".
const numerosVistos = new Map();
let primeiraCarga = true;
let pollTimer = null;
let reconnectTimer = null;
let recargaTimer = null;
// A lista de pedido é guardada por evento: quem visita duas festas no mesmo
// celular não pode ver a lista de uma aparecendo na outra.
let ORDER_KEY = 'festa-cultural:lista-de-pedido';
const VIBRACAO_KEY = 'festa-cultural:vibrar';
// A Vibration API nao existe no Safari do iPhone. Onde nao ha, o aviso vira
// so o destaque visual do numero, e o controle de liga/desliga some.
const PODE_VIBRAR = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const formatMoney = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatTime = (value) => value ? String(value).slice(0, 5) : 'Horário a confirmar';
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// Monta a data na mão: `new Date('2026-06-24')` seria lido como UTC e viraria o dia anterior no Brasil.
const formatDate = (value) => { if (!value) return ''; const [, month, day] = String(value).slice(0, 10).split('-').map(Number); return MONTHS[month - 1] ? `${day} de ${MONTHS[month - 1]}` : ''; };
const emptyState = (message) => `<div class="empty-state"><span>✦</span><p>${escapeHtml(message)}</p></div>`;
const statusLabel = { disponivel: 'Disponível', poucas_unidades: 'Restam poucas unidades!', esgotado: 'Esgotado', aguardando: 'Aguardando', em_andamento: 'Em andamento', realizado: 'Realizado', pendente: 'Pendente' };
const drawTypeLabel = { bingo: 'Bingo', rifa: 'Rifa', leilao: 'Leilão' };
const cartelaLabel = { bingo: 'Cartela do bingo', rifa: 'Número da rifa', leilao: 'Leilão no palco' };

/* ------------------------------------------------------------------ *
 * Qual festa é esta? O caminho da URL decide: /casavequia, /raimundo-herminio.
 * ------------------------------------------------------------------ */
function slugDaUrl() {
  // `?evento=` existe para rodar o site em servidor local, que não tem o
  // rewrite da Vercel. Em produção quem manda é o caminho.
  const daQuery = new URLSearchParams(location.search).get('evento');
  const doCaminho = location.pathname.split('/').filter(Boolean)[0] || '';
  const escolhido = (daQuery || doCaminho).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,40}$/.test(escolhido) ? escolhido : '';
}

async function mostrarSeletor(titulo, texto) {
  document.querySelector('.site-shell').hidden = true;
  const picker = $('#event-picker');
  picker.hidden = false;
  $('#picker-title').textContent = titulo;
  $('#picker-lead').textContent = texto;
  const { data, error } = await supabase.from('eventos').select('slug, nome, escola, data_evento').eq('ativo', true).order('nome');
  const lista = $('#event-list');
  if (error) { lista.innerHTML = emptyState('Não foi possível carregar as festas agora. Tente de novo em instantes.'); return; }
  lista.innerHTML = data?.length
    ? data.map((evento) => `<a class="event-option" href="/${escapeHtml(evento.slug)}"><span><strong>${escapeHtml(evento.escola || evento.nome)}</strong><small>${escapeHtml(evento.nome)}${evento.data_evento ? ` \u00b7 ${escapeHtml(formatDate(evento.data_evento))}` : ''}</small></span><i aria-hidden="true">\u203a</i></a>`).join('')
    : emptyState('Nenhuma festa publicada ainda.');
}

// Troca o logo e o nome da escola pelos desta festa.
function aplicarMarca(evento) {
  if (evento.logo_url) {
    $('#brand-picture').outerHTML = `<img class="brand-logo" src="${escapeHtml(evento.logo_url)}" alt="${escapeHtml(evento.nome)} \u2014 ir para o início" />`;
  }
  const tag = $('#event-tag');
  if (evento.escola) { tag.textContent = evento.escola; tag.hidden = false; }
  document.title = `${evento.nome}${evento.escola ? ` | ${evento.escola}` : ''}`;
}

function setNetwork(message, tone = '') { const element = $('#network-status'); element.textContent = message; element.className = `network-status ${tone}`; }
function refreshIcons() { window.lucide?.createIcons(); }
function routeTo(route) { state.route = route; $$('.screen').forEach((screen) => { screen.hidden = screen.dataset.screen !== route; screen.classList.toggle('active', screen.dataset.screen === route); }); $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.route === route)); renderOrderBar(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function renderImage(url, alt, className = 'card-image') { return url ? `<img class="${className}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />` : `<div class="${className} image-placeholder" role="img" aria-label="Espaço reservado para imagem de ${escapeHtml(alt)}"></div>`; }
function renderStatus(status) { return `<span class="status status-${escapeHtml(status)}">${escapeHtml(statusLabel[status] || status)}</span>`; }

// Escolhe um ícone pelo primeiro alérgeno citado, só para dar leitura rápida ao selo.
function allergenIcon(text = '') { const value = text.toLowerCase(); if (value.includes('amendoim') || value.includes('castanha') || value.includes('nozes')) return '🥜'; if (value.includes('glúten') || value.includes('gluten') || value.includes('trigo')) return '🌾'; if (value.includes('leite') || value.includes('lactose')) return '🥛'; if (value.includes('ovo')) return '🥚'; return '⚠️'; }
function renderAllergens(item) { return item.alergenos ? `<span class="allergen-tag"><i aria-hidden="true">${allergenIcon(item.alergenos)}</i>${escapeHtml(item.alergenos)}</span>` : ''; }

/* ------------------------------------------------------------------ *
 * Aviso de numero novo: vibracao + destaque na tela
 * ------------------------------------------------------------------ */
function loadVibracao() { try { return localStorage.getItem(VIBRACAO_KEY) !== '0'; } catch { return true; } }
function saveVibracao() { try { localStorage.setItem(VIBRACAO_KEY, state.vibrar ? '1' : '0'); } catch { /* segue sem persistir */ } }

function vibrar(padrao) {
  if (!state.vibrar || !PODE_VIBRAR) return;
  // O navegador ignora a vibracao sem interacao previa e com a aba escondida.
  try { navigator.vibrate(padrao); } catch { /* aparelho recusou */ }
}

function toggleVibracao() {
  state.vibrar = !state.vibrar;
  saveVibracao();
  if (state.vibrar) vibrar(70); // confirma que funciona no aparelho
  renderHome();
  renderDrawDetail();
}

function vibracaoControl() {
  if (!PODE_VIBRAR) return '<p class="vibra-nota">Fique de olho na tela: o número pisca a cada chamada. Este aparelho não permite vibração pelo navegador.</p>';
  return `<button class="vibra-toggle${state.vibrar ? ' is-on' : ''}" type="button" data-toggle-vibracao aria-pressed="${state.vibrar}"><span class="vibra-switch" aria-hidden="true"></span><span>Vibrar a cada número sorteado</span></button>`;
}

// Compara o que chegou do banco com o que ja estava na tela.
function detectarNumerosNovos() {
  const novos = [];
  state.sorteios.forEach((draw) => {
    const anterior = numerosVistos.get(draw.id);
    const atual = draw.ultimo_numero;
    numerosVistos.set(draw.id, atual);
    if (primeiraCarga || anterior === undefined) return; // nao avisa ao abrir o site
    if (atual === null || atual === undefined || anterior === atual) return;
    if (draw.status !== 'em_andamento') return;
    novos.push(draw);
  });
  primeiraCarga = false;
  return novos;
}

// Chamado depois do render, senao a classe seria apagada na re-renderizacao.
function anunciarNumerosNovos(draws) {
  if (!draws.length) return;
  vibrar([140, 70, 140]);
  draws.forEach((draw) => $$(`[data-numero-de="${draw.id}"]`).forEach((element) => {
    element.classList.remove('numero-novo');
    void element.offsetWidth; // reinicia a animacao
    element.classList.add('numero-novo');
  }));
}

/* ------------------------------------------------------------------ *
 * Lista de pedido
 * ------------------------------------------------------------------ */
function loadOrder() { try { const stored = JSON.parse(localStorage.getItem(ORDER_KEY) || '{}'); return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}; } catch { return {}; } }
// Em aba anônima o localStorage pode falhar: a lista continua valendo para esta visita.
function saveOrder() { try { localStorage.setItem(ORDER_KEY, JSON.stringify(state.pedido)); } catch { /* segue sem persistir */ } }
// Remove da lista o que saiu do cardápio. Só roda depois de uma carga bem-sucedida.
function pruneOrder() { let changed = false; Object.keys(state.pedido).forEach((id) => { if (!state.produtos.some((product) => String(product.id) === id)) { delete state.pedido[id]; changed = true; } }); if (changed) saveOrder(); }
function orderQty(id) { return Number(state.pedido[String(id)] || 0); }
function setOrderQty(id, quantity) {
  const key = String(id);
  const value = Math.max(0, Math.min(99, Math.round(Number(quantity) || 0)));
  if (value === 0) delete state.pedido[key]; else state.pedido[key] = value;
  saveOrder(); renderProducts(); renderOrder(); renderOrderBar();
}
function orderLines() {
  return Object.entries(state.pedido)
    .map(([id, quantity]) => ({ produto: state.produtos.find((product) => String(product.id) === id), quantidade: Number(quantity) }))
    .filter((line) => line.produto && line.quantidade > 0)
    .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome, 'pt-BR'));
}
// Itens que esgotaram enquanto estavam na lista ficam visíveis, mas fora do total.
const orderTotals = (lines) => lines.reduce((totals, line) => line.produto.status === 'esgotado'
  ? { ...totals, indisponiveis: totals.indisponiveis + 1 }
  : { itens: totals.itens + line.quantidade, valor: totals.valor + line.quantidade * Number(line.produto.preco || 0), indisponiveis: totals.indisponiveis }, { itens: 0, valor: 0, indisponiveis: 0 });

function orderControls(item) {
  if (item.status === 'esgotado') return '<span class="add-disabled">Indisponível</span>';
  const quantity = orderQty(item.id);
  if (!quantity) return `<button class="add-button" type="button" data-order-inc="${item.id}">Adicionar <span aria-hidden="true">+</span></button>`;
  return `<div class="qty-stepper"><button type="button" data-order-dec="${item.id}" aria-label="Remover uma unidade de ${escapeHtml(item.nome)}">−</button><span aria-label="${quantity} na lista">${quantity}</span><button type="button" data-order-inc="${item.id}" aria-label="Adicionar mais uma unidade de ${escapeHtml(item.nome)}">+</button></div>`;
}

function renderOrderBar() {
  const bar = $('#order-bar');
  const totals = orderTotals(orderLines());
  const count = totals.itens;
  bar.hidden = !count || state.route === 'lista';
  if (count) $('#order-bar-summary').textContent = `${count} ${count === 1 ? 'item' : 'itens'} • ${formatMoney(totals.valor)}`;
  // Afasta o botão de ajuda e abre espaço no rodapé enquanto a barra está visível.
  document.body.classList.toggle('has-order-bar', !bar.hidden);
}

function renderOrder() {
  const lines = orderLines();
  const container = $('#order-items');
  const summary = $('#order-summary');
  if (!lines.length) {
    container.innerHTML = emptyState('Sua lista está vazia. Vá até o Cardápio e toque em "Adicionar" nos itens que você quer pedir.');
    summary.hidden = true;
    return;
  }
  container.innerHTML = lines.map(({ produto, quantidade }) => `<article class="order-line ${produto.status === 'esgotado' ? 'sold-out' : ''}">
    <div class="order-line-main"><h3>${escapeHtml(produto.nome)}</h3><p>${formatMoney(produto.preco)} a unidade${produto.status === 'esgotado' ? ' · <b>esgotou durante a festa</b>' : ''}</p></div>
    ${orderControls(produto)}
    <strong class="order-line-total">${produto.status === 'esgotado' ? '—' : formatMoney(quantidade * Number(produto.preco || 0))}</strong>
  </article>`).join('');
  const totals = orderTotals(lines);
  summary.hidden = false;
  $('#order-total-value').textContent = formatMoney(totals.valor);
  const note = $('#order-warning');
  if (note) { note.hidden = !totals.indisponiveis; note.textContent = totals.indisponiveis ? `${totals.indisponiveis === 1 ? 'Um item esgotou' : `${totals.indisponiveis} itens esgotaram`} e ficou de fora do total. Remova da lista antes de ir ao caixa.` : ''; }
  refreshIcons();
}

/* ------------------------------------------------------------------ *
 * Telas
 * ------------------------------------------------------------------ */
function liveCard(draw) {
  const rotulo = draw.tipo === 'leilao' ? 'Último lance' : 'Último número';
  return `<article class="live-card">
    <div class="live-card-top"><span class="draw-type">${escapeHtml(drawTypeLabel[draw.tipo] || draw.tipo)} · ${escapeHtml(draw.identificacao)}</span>${draw.ordem_premio ? `<span class="prize-order is-inline">${draw.ordem_premio}º Prêmio</span>` : ''}</div>
    <h3>${escapeHtml(draw.premio)}</h3>
    <div class="live-number" data-numero-de="${draw.id}"><span>${rotulo}</span><strong>${draw.ultimo_numero ?? '—'}</strong></div>
    <button class="primary-button" type="button" data-open-draw="${draw.id}">Acompanhar ao vivo <span aria-hidden="true">→</span></button>
  </article>`;
}

function renderHome() {
  const live = state.sorteios.filter((draw) => draw.status === 'em_andamento');
  const hero = $('#live-hero');
  hero.hidden = !live.length;
  if (!live.length) { hero.innerHTML = ''; return; }
  hero.innerHTML = `<div class="live-head"><span class="live-badge"><i aria-hidden="true"></i>AO VIVO</span><h2>${live.length === 1 ? 'Sorteio acontecendo agora' : `${live.length} sorteios acontecendo agora`}</h2></div>
    <div class="live-grid">${live.map(liveCard).join('')}</div>
    ${vibracaoControl()}`;
}

function renderProducts() {
  const items = state.produtos.filter((item) => item.categoria !== 'brincadeira' && (state.category === 'todos' || item.categoria === state.category));
  $('#products-list').innerHTML = items.length ? items.map((item) => `<article class="product-card ${item.status === 'esgotado' ? 'sold-out' : ''}">${renderImage(item.imagem_url, item.nome)}<div class="card-content"><div class="card-topline"><span class="category-tag">${escapeHtml(item.categoria)}</span>${renderStatus(item.status)}</div><h3>${escapeHtml(item.nome)}</h3><p>${escapeHtml(item.descricao || 'Sabor especial da nossa festa.')}</p>${renderAllergens(item)}<div class="card-footer"><strong class="price">${formatMoney(item.preco)}</strong>${orderControls(item)}</div></div>${item.status === 'esgotado' ? '<div class="sold-stamp">ESGOTADO</div>' : ''}</article>`).join('') : emptyState('Ainda não há itens nesta categoria. Volte em breve!');
}

function renderActivities() {
  const items = state.produtos.filter((item) => item.categoria === 'brincadeira');
  $('#activities-list').innerHTML = items.length ? items.map((item) => `<article class="activity-card ${item.status === 'esgotado' ? 'sold-out' : ''}">${renderImage(item.imagem_url, item.nome, 'activity-image')}<div class="activity-body"><div class="card-topline">${renderStatus(item.status)}</div><h3>${escapeHtml(item.nome)}</h3>${item.destaque ? `<span class="highlight-tag">${escapeHtml(item.destaque)}</span>` : ''}<p>${escapeHtml(item.descricao || 'Informações disponíveis na barraca.')}</p><div class="card-footer"><strong class="price"><small>Ficha:</small> ${formatMoney(item.preco)}</strong>${item.regras ? `<button class="secondary-button rules-button" type="button" data-rules="${item.id}" aria-expanded="false">Regras <span aria-hidden="true">›</span></button>` : ''}</div>${item.regras ? `<div class="activity-rules" id="regras-${item.id}" hidden><strong>Como funciona</strong><ul>${String(item.regras).split('\n').filter(Boolean).map((rule) => `<li>${escapeHtml(rule.trim())}</li>`).join('')}</ul></div>` : ''}</div></article>`).join('') : emptyState('As brincadeiras serão divulgadas em breve.');
}

function renderCartela(draw) {
  if (draw.tipo === 'leilao' || !(Number(draw.valor_cartela) > 0)) return '<div class="cartela-box"><span class="cartela-label">Participação especial</span><p class="cartela-note">Os lances são feitos ao vivo, no palco.</p></div>';
  const promo = draw.cartelas_promo_qtd && draw.cartelas_promo_valor != null
    ? `<div class="cartela-row"><span>${draw.cartelas_promo_qtd} por</span><strong>${formatMoney(draw.cartelas_promo_valor)}</strong></div>` : '';
  return `<div class="cartela-box"><span class="cartela-label">${escapeHtml(cartelaLabel[draw.tipo] || 'Cartela')}</span><div class="cartela-row"><span>1 por</span><strong>${formatMoney(draw.valor_cartela)}</strong></div>${promo}</div>`;
}

function renderDrawWhen(draw) {
  if (!draw.horario_sorteio) return '';
  const date = formatDate(draw.data_sorteio);
  return `<div class="draw-when"><i data-lucide="clock-3" aria-hidden="true"></i><div><small>Sorteio às</small><strong>${formatTime(draw.horario_sorteio)}</strong>${date ? `<small>${escapeHtml(date)}</small>` : ''}</div></div>`;
}

function renderDraws() {
  const container = $('#draws-list');
  const sorted = [...state.sorteios].sort((a, b) => (a.ordem_premio ?? 99) - (b.ordem_premio ?? 99));
  container.innerHTML = sorted.length ? sorted.map((draw) => `<article class="draw-card ${draw.status === 'em_andamento' ? 'is-live' : ''}"><div class="draw-media">${renderImage(draw.imagem_url, `prêmio ${draw.premio}`, 'draw-image')}${draw.ordem_premio ? `<span class="prize-order">${draw.ordem_premio}º Prêmio</span>` : ''}</div><div class="draw-card-content"><div class="card-topline"><span class="draw-type">${escapeHtml(drawTypeLabel[draw.tipo] || draw.tipo)} · ${escapeHtml(draw.identificacao)}</span>${renderStatus(draw.status)}</div><h3>${escapeHtml(draw.premio)}</h3><p class="draw-disclaimer">Imagem meramente ilustrativa</p>${renderCartela(draw)}${renderDrawWhen(draw)}<button class="secondary-button" data-open-draw="${draw.id}" type="button">${draw.status === 'em_andamento' ? 'Acompanhe o sorteio' : 'Ver detalhes'} <span aria-hidden="true">›</span></button></div></article>`).join('') : emptyState('Os sorteios aparecerão aqui assim que forem cadastrados.');
  if (state.selectedDrawId) renderDrawDetail();
  refreshIcons();
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
  detail.innerHTML = `<div class="detail-header"><div><p class="kicker">${escapeHtml(drawTypeLabel[draw.tipo] || draw.tipo)}${draw.ordem_premio ? ` · ${draw.ordem_premio}º Prêmio` : ''}</p><h2>${escapeHtml(draw.premio)}</h2><p>${escapeHtml(draw.identificacao)}</p></div>${renderStatus(draw.status)}</div><div class="last-number" data-numero-de="${draw.id}"><span>${draw.tipo === 'leilao' ? 'Último lance' : 'Último número'}</span><strong>${draw.ultimo_numero ?? '—'}</strong></div>${draw.status === 'em_andamento' ? vibracaoControl() : ''}${draw.tipo === 'bingo' ? renderBingo(numbers) : `<div class="number-history"><h3>Histórico</h3>${numbers.length ? numbers.map((number) => `<span>${number}</span>`).join('') : '<p>Nenhum número chamado ainda.</p>'}</div>`}`;
}

function renderCandidates() {
  $('#candidates-list').innerHTML = state.candidatas.length ? state.candidatas.map((candidate) => `<article class="candidate-card">${renderImage(candidate.foto_url, candidate.nome, 'candidate-photo')}<div><span class="candidate-crown">♕</span><h3>${escapeHtml(candidate.nome)}</h3>${candidate.idade ? `<span class="candidate-age"><i aria-hidden="true">✦</i>${candidate.idade} anos</span>` : ''}<p>${escapeHtml(candidate.detalhes || 'Representante da escola')}</p><strong>Desfile: ${formatTime(candidate.horario_desfile)}</strong></div></article>`).join('') : emptyState('As candidatas serão apresentadas em breve.');
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
function renderAll() { renderHome(); renderProducts(); renderActivities(); renderDraws(); renderCandidates(); renderSchedule(); renderOrder(); renderOrderBar(); refreshIcons(); }

function applyNetworkLabel() {
  if (state.conexao === 'ao-vivo') setNetwork('Informações ao vivo', 'online');
  else if (state.conexao === 'reconectando') setNetwork('Rede instável — atualizando sozinho', 'offline');
  else setNetwork('Conectando ao evento...', 'loading');
}

// Com o Realtime funcionando o polling e so uma rede de seguranca; sem ele, e o
// que mantem a tela do visitante viva.
function schedulePolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(loadAll, state.conexao === 'ao-vivo' ? POLL_AO_VIVO : POLL_SEM_REALTIME);
}

// Varias tabelas podem mudar no mesmo instante: espera um pouco e recarrega uma vez so.
function agendarRecarga() { clearTimeout(recargaTimer); recargaTimer = setTimeout(loadAll, 180); }

function handleAviso(aviso) {
  if (!aviso) return;
  const id = Number(aviso.id);
  if (!Number.isFinite(id) || id <= state.ultimoAvisoId) return;
  state.ultimoAvisoId = id;
  // Nao reabre recado velho para quem acabou de chegar.
  if (Date.now() - new Date(aviso.criado_em).getTime() > AVISO_VALIDO_MS) return;
  showPublicAlert(aviso.mensagem);
}

// A tabela de avisos e nova: se ela ainda nao existe, o site continua normal.
async function loadAvisos() {
  const { data, error } = await supabase.from('avisos').select('*').eq('evento_id', state.evento.id).order('id', { ascending: false }).limit(1);
  if (error) { console.warn('Avisos indisponíveis:', error.message); return; }
  handleAviso(data?.[0]);
}

async function loadAll() {
  if (state.conexao === 'conectando') setNetwork('Atualizando informações...', 'loading');
  const evento = state.evento.id;
  const [produtos, sorteios, cronograma, candidatas] = await Promise.all([
    supabase.from('produtos').select('*').eq('evento_id', evento).order('nome'),
    supabase.from('sorteios').select('*').eq('evento_id', evento).order('id', { ascending: false }),
    supabase.from('cronograma').select('*').eq('evento_id', evento).order('horario_previsto'),
    supabase.from('candidatas').select('*').eq('evento_id', evento).order('nome'),
  ]);
  const errors = [produtos, sorteios, cronograma, candidatas].map((result) => result.error).filter(Boolean);
  if (errors.length) { setNetwork('Não foi possível atualizar agora. Tentando de novo...', 'offline'); console.error(errors); return; }
  state.produtos = produtos.data || []; state.sorteios = sorteios.data || []; state.cronograma = cronograma.data || []; state.candidatas = candidatas.data || [];
  pruneOrder();
  const numerosNovos = detectarNumerosNovos();
  renderAll();
  anunciarNumerosNovos(numerosNovos);
  applyNetworkLabel();
  loadAvisos();
}

function showPublicAlert(message) { const alert = $('#public-alert'); alert.textContent = `📣 ${message}`; alert.hidden = false; clearTimeout(showPublicAlert.timer); showPublicAlert.timer = setTimeout(() => { alert.hidden = true; }, 25000); }
// Cada festa tem PIX e WhatsApp próprios; EVENT_CONFIG só vale de reserva
// para um evento ainda sem esses campos preenchidos.
function pixDoEvento() {
  const evento = state.evento || {};
  return {
    chave: evento.pix_chave || EVENT_CONFIG.pixKey,
    favorecido: evento.pix_favorecido || EVENT_CONFIG.pixHolder,
    banco: evento.pix_banco || EVENT_CONFIG.pixBank,
    qr: evento.pix_qr_url || EVENT_CONFIG.pixQrImage,
    whatsapp: evento.whatsapp || EVENT_CONFIG.whatsappNumber,
  };
}

function configureStaticInfo() {
  const pix = pixDoEvento();
  $('#pix-key').textContent = pix.chave;
  $('#pix-holder').textContent = pix.favorecido;
  $('#pix-bank').textContent = pix.banco;
  const help = $('#help-button');
  if (pix.whatsapp) help.href = `https://wa.me/${String(pix.whatsapp).replace(/\D/g, '')}`; else help.hidden = true;
  const qr = $('.qr-placeholder');
  if (pix.qr) qr.innerHTML = `<img src="${escapeHtml(pix.qr)}" alt="QR Code PIX" />`;
}

function agendarReconexao() {
  clearTimeout(reconnectTimer);
  state.tentativas = Math.min(state.tentativas + 1, 6);
  const espera = Math.min(1000 * 2 ** state.tentativas, 30000);
  reconnectTimer = setTimeout(subscribeRealtime, espera);
}

async function subscribeRealtime() {
  // setAuth ANTES de assinar: o token precisa estar no socket quando o canal
  // entra, senao o Realtime avalia as policies com a credencial errada.
  await supabase.realtime.setAuth();
  if (state.canal) { await supabase.removeChannel(state.canal); state.canal = null; }
  // Um canal so para tudo: menos juncao para dar errado em rede ruim.
  // O filtro por evento_id é o que impede o visitante de uma festa receber
  // atualização da outra.
  const filtro = `evento_id=eq.${state.evento.id}`;
  const canal = supabase.channel(`festa-${state.evento.slug}`);
  ['produtos', 'sorteios', 'cronograma', 'candidatas'].forEach((table) => canal.on('postgres_changes', { event: '*', schema: 'public', table, filter: filtro }, agendarRecarga));
  canal.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'avisos', filter: filtro }, (payload) => handleAviso(payload.new));
  canal.subscribe((status) => {
    if (status === 'SUBSCRIBED') { state.conexao = 'ao-vivo'; state.tentativas = 0; clearTimeout(reconnectTimer); loadAll(); }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { state.conexao = 'reconectando'; agendarReconexao(); }
    applyNetworkLabel();
    schedulePolling();
  });
  state.canal = canal;
  schedulePolling();
}

// Celular guardado no bolso congela timers e derruba o socket. Ao voltar para a
// tela, recarrega na hora em vez de esperar o proximo ciclo.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadAll(); if (state.conexao !== 'ao-vivo') agendarReconexao(); } });
window.addEventListener('online', () => { loadAll(); agendarReconexao(); });

const menuToggle = document.querySelector('.menu-toggle');
menuToggle?.addEventListener('click', () => {
  const isOpen = document.body.classList.toggle('menu-open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
});

document.addEventListener('click', (event) => {
  const increase = event.target.closest('[data-order-inc]');
  if (increase) { const id = increase.dataset.orderInc; setOrderQty(id, orderQty(id) + 1); return; }
  const decrease = event.target.closest('[data-order-dec]');
  if (decrease) { const id = decrease.dataset.orderDec; setOrderQty(id, orderQty(id) - 1); return; }
  if (event.target.closest('[data-toggle-vibracao]')) { toggleVibracao(); return; }
  const rules = event.target.closest('[data-rules]');
  if (rules) { const panel = document.getElementById(`regras-${rules.dataset.rules}`); if (panel) { panel.hidden = !panel.hidden; rules.setAttribute('aria-expanded', String(!panel.hidden)); } return; }
  const route = event.target.closest('[data-route]'); if (route) { event.preventDefault(); routeTo(route.dataset.route); document.body.classList.remove('menu-open'); menuToggle?.setAttribute('aria-expanded', 'false'); menuToggle?.setAttribute('aria-label', 'Abrir menu'); }
  const draw = event.target.closest('[data-open-draw]'); if (draw) { state.selectedDrawId = Number(draw.dataset.openDraw); routeTo('sorteios'); renderDrawDetail(); $('#draw-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
$$('.filter').forEach((button) => button.addEventListener('click', () => { state.category = button.dataset.category; $$('.filter').forEach((item) => item.classList.toggle('active', item === button)); renderProducts(); }));
$('#clear-order').addEventListener('click', () => { if (!Object.keys(state.pedido).length || !window.confirm('Limpar toda a sua lista de pedido?')) return; state.pedido = {}; saveOrder(); renderProducts(); renderOrder(); renderOrderBar(); });
$('#copy-pix').addEventListener('click', async () => { try { await navigator.clipboard.writeText(pixDoEvento().chave); $('#pix-feedback').textContent = 'Chave copiada! Abra o app do seu banco.'; } catch { $('#pix-feedback').textContent = 'Não foi possível copiar automaticamente. Selecione a chave acima.'; } });

async function iniciar() {
  state.vibrar = loadVibracao();
  const slug = slugDaUrl();
  if (!slug) {
    await mostrarSeletor('Escolha a sua festa', 'Cada escola tem a sua própria página. Toque na sua para ver o cardápio, os sorteios e a programação.');
    return;
  }
  const { data: evento, error } = await supabase.from('eventos').select('*').eq('slug', slug).maybeSingle();
  if (error || !evento) {
    await mostrarSeletor('Festa não encontrada', `Não existe festa no endereço /${slug}. Veja as que estão no ar:`);
    return;
  }
  state.evento = evento;
  ORDER_KEY = `festa-cultural:lista-de-pedido:${evento.slug}`;
  state.pedido = loadOrder();
  aplicarMarca(evento);
  configureStaticInfo();
  renderOrder(); renderOrderBar();
  setInterval(renderSchedule, 30000);
  await loadAll();
  subscribeRealtime();
}

iniciar();
