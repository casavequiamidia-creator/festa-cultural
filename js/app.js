import { EVENT_CONFIG, supabase } from './supabase-config.js';

// `pedido` é a Lista de pedido do visitante: um mapa { idDoProduto: quantidade }
// guardado apenas no localStorage do próprio celular. Nada é enviado ao banco.
const state = { produtos: [], sorteios: [], cronograma: [], candidatas: [], category: 'todos', selectedDrawId: null, route: 'inicio', pedido: {}, vibrar: true, evento: null, modoEdicao: false, mostrarChips: true, conexao: 'conectando', canal: null, ultimoAvisoId: 0, tentativas: 0, perfilId: null, perfilAba: 'biografia' };
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
 * Modo organizador: a mesma tela do visitante, com "Editar" em cada item.
 *
 * O editor mora em js/editor.js e é carregado sob demanda — quem só quer ver
 * o cardápio não baixa nada disso.
 * ------------------------------------------------------------------ */
let editorAdmin = null;

function chipEditar(table, id) {
  if (!state.modoEdicao || !state.mostrarChips) return '';
  return `<button class="edit-chip" type="button" data-admin-edit="${table}|${id}" aria-label="Editar este item"><i aria-hidden="true">✎</i>Editar</button>`;
}

function renderAdminBar() {
  const barra = $('#admin-bar');
  if (!barra) return;
  barra.innerHTML = `<span class="admin-bar-tag">Modo organizador</span>
    <span class="admin-bar-text">${state.mostrarChips ? 'Toque em <b>Editar</b> em qualquer item para alterá-lo aqui mesmo.' : 'Edição oculta: a tela está exatamente como o visitante vê.'}</span>
    <span class="admin-bar-acoes">
      <button class="small-button" type="button" data-toggle-chips>${state.mostrarChips ? 'Ocultar edição' : 'Mostrar edição'}</button>
      <button class="small-button" type="button" data-admin-edit="eventos|${state.evento.id}">Dados da festa</button>
      <a class="small-button" href="/admin">Painel</a>
    </span>`;
}

async function ativarModoOrganizador() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { createEditor, souOrganizador } = await import('./editor.js');
  // Só entra no modo edição quem realmente pode gravar; caso contrário o
  // organizador clicaria em "Editar" e levaria um erro de permissão a cada item.
  if (await souOrganizador() !== true) return;
  state.modoEdicao = true;
  editorAdmin = createEditor({
    getEventoId: () => state.evento?.id ?? null,
    getRecord: (table, id) => (table === 'eventos' ? state.evento : (state[table] || []).find((entry) => String(entry.id) === String(id))),
    getSorteios: () => state.sorteios,
    getOrganizador: () => true,
    onSaved: async (table) => {
      if (table === 'eventos') {
        const { data } = await supabase.from('eventos').select('*').eq('id', state.evento.id).maybeSingle();
        if (data) { state.evento = data; aplicarMarca(data); configureStaticInfo(); }
      }
      await loadAll();
    },
  });
  const barra = document.createElement('div');
  barra.id = 'admin-bar';
  barra.className = 'admin-bar';
  document.body.appendChild(barra);
  document.body.classList.add('modo-organizador');
  renderAdminBar();
  renderAll();
}

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

/* ------------------------------------------------------------------ *
 * Contagem regressiva para a festa
 *
 * O relógio corre no horário do próprio celular, e a data vem do painel como
 * hora de parede ("24/06 às 19h"), sem fuso: é assim que a organização pensa e
 * é assim que o visitante lê. Por isso a data é montada na mão, campo a campo
 * — `new Date('2026-06-24T19:00')` até funcionaria, mas a versão com números
 * evita a interpretação como UTC que já derrubava um dia em `formatDate`.
 * ------------------------------------------------------------------ */
// Sem hora de término cadastrada, o convite da agenda dura este tanto.
const DURACAO_PADRAO_H = 4;
const doisDigitos = (value) => String(value).padStart(2, '0');
// O que já está desenhado na tela. Só remontamos o bloco quando o estado muda
// de verdade (a festa começou, a data foi alterada) — a cada segundo mexemos
// apenas nos números, senão a animação recomeçaria do zero o tempo todo.
let countdownDesenhado = '';

function festaInicio(evento) {
  const dia = String(evento?.data_evento || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const [ano, mes, diaDoMes] = dia.split('-').map(Number);
  const [hora, minuto] = String(evento.hora_evento || '00:00').slice(0, 5).split(':').map(Number);
  const inicio = new Date(ano, mes - 1, diaDoMes, hora || 0, minuto || 0, 0, 0);
  return Number.isFinite(inicio.getTime()) ? inicio : null;
}

function festaFim(evento, inicio) {
  if (!inicio) return null;
  const fim = new Date(inicio);
  const termino = String(evento?.hora_fim || '').slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(termino)) {
    const [hora, minuto] = termino.split(':').map(Number);
    fim.setHours(hora, minuto, 0, 0);
    // Arraial que vira a noite: começa 19h e termina 1h — do dia seguinte.
    if (fim <= inicio) fim.setDate(fim.getDate() + 1);
    return fim;
  }
  // Festa só com o dia marcado ocupa o dia inteiro; com hora de início, dura
  // o padrão a partir dela.
  if (!evento?.hora_evento) { fim.setDate(fim.getDate() + 1); return fim; }
  fim.setHours(fim.getHours() + DURACAO_PADRAO_H);
  return fim;
}

const DIA_E_MES = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
function quandoPorExtenso(inicio, temHora) {
  // O pt-BR devolve "sábado, 24 de junho"; só a inicial sobe, porque
  // `capitalize` no CSS deixaria "24 De Junho".
  const extenso = DIA_E_MES.format(inicio);
  const dia = extenso.charAt(0).toUpperCase() + extenso.slice(1);
  if (!temHora) return dia;
  const hora = inicio.getMinutes() ? `${inicio.getHours()}h${doisDigitos(inicio.getMinutes())}` : `${inicio.getHours()}h`;
  return `${dia}, às ${hora}`;
}

function partesDoTempo(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return [
    [Math.floor(total / 86400), 'dia', 'dias'],
    [Math.floor(total / 3600) % 24, 'hora', 'horas'],
    [Math.floor(total / 60) % 60, 'min', 'min'],
    [total % 60, 'seg', 'seg'],
  ];
}

function renderCountdown() {
  const bloco = $('#countdown');
  if (!bloco) return;
  const evento = state.evento;
  const inicio = festaInicio(evento);
  const fim = festaFim(evento, inicio);
  const agora = Date.now();
  // A festa que já acabou some da tela: contagem parada em zero só confunde.
  const modo = !inicio ? 'oculto' : (agora < inicio ? 'contando' : (agora < fim ? 'agora' : 'oculto'));
  const assinatura = `${modo}|${inicio?.getTime() ?? ''}`;
  if (assinatura !== countdownDesenhado) {
    countdownDesenhado = assinatura;
    bloco.hidden = modo === 'oculto';
    bloco.innerHTML = modo === 'contando' ? countdownContando(evento, inicio)
      : modo === 'agora' ? countdownAgora(evento) : '';
    refreshIcons();
  }
  if (modo === 'contando') atualizarDigitos(inicio - agora);
}

function countdownContando(evento, inicio) {
  const digitos = partesDoTempo(inicio - Date.now())
    .map(([valor, singular, plural], indice) => `<div class="cd-bloco"><strong data-cd="${indice}">${indice ? doisDigitos(valor) : valor}</strong><small data-cd-rotulo="${indice}">${valor === 1 ? singular : plural}</small></div>`)
    .join('');
  return `<p class="section-label">Contagem regressiva</p>
    <h2 id="countdown-title">Falta pouco para o nosso arraial</h2>
    <p class="cd-quando"><i data-lucide="calendar-days" aria-hidden="true"></i>${escapeHtml(quandoPorExtenso(inicio, Boolean(evento.hora_evento)))}</p>
    <div class="cd-relogio" role="timer" aria-live="off">${digitos}</div>
    <div class="cd-acoes">
      <button class="primary-button" type="button" data-add-agenda><i data-lucide="calendar-plus" aria-hidden="true"></i>Adicionar na agenda</button>
      <p class="cd-aviso" id="agenda-feedback" role="status"></p>
    </div>`;
}

function countdownAgora(evento) {
  return `<p class="section-label">É agora</p>
    <h2 id="countdown-title">A festa começou!</h2>
    <p class="cd-quando"><i data-lucide="party-popper" aria-hidden="true"></i>${escapeHtml(evento.escola || evento.nome)} está com as portas abertas. Bom arraial!</p>
    <div class="cd-acoes"><button class="primary-button" type="button" data-route="cronograma">Ver a programação <span aria-hidden="true">→</span></button></div>`;
}

function atualizarDigitos(restante) {
  partesDoTempo(restante).forEach(([valor, singular, plural], indice) => {
    const numero = document.querySelector(`[data-cd="${indice}"]`);
    if (!numero) return;
    const texto = indice ? doisDigitos(valor) : String(valor);
    if (numero.textContent !== texto) numero.textContent = texto;
    const rotulo = document.querySelector(`[data-cd-rotulo="${indice}"]`);
    const nome = valor === 1 ? singular : plural;
    if (rotulo && rotulo.textContent !== nome) rotulo.textContent = nome;
  });
}

/* ------------------------------------------------------------------ *
 * "Adicionar na agenda": cria o evento no calendário do celular
 *
 * Android abre o app do Google Agenda direto pelo link de template — é o
 * caminho que exige menos toques de quem está com o celular na mão. iPhone e
 * computador recebem um arquivo .ics, que o iOS mostra como "Adicionar ao
 * Calendário" e o computador abre no calendário padrão.
 * ------------------------------------------------------------------ */
function dadosDaAgenda() {
  const evento = state.evento;
  const inicio = festaInicio(evento);
  if (!inicio) return null;
  return {
    inicio,
    fim: festaFim(evento, inicio),
    titulo: [evento.nome, evento.escola].filter(Boolean).join(' — '),
    local: evento.local_evento || evento.escola || '',
    endereco: `${location.origin}/${evento.slug}`,
  };
}

// Carimbo "de parede", sem Z e sem fuso: o calendário lê a hora exatamente
// como ela está escrita, que é a hora da festa para quem vai.
const carimboAgenda = (data) => `${data.getFullYear()}${doisDigitos(data.getMonth() + 1)}${doisDigitos(data.getDate())}T${doisDigitos(data.getHours())}${doisDigitos(data.getMinutes())}00`;

function montarIcs(agenda) {
  const escapar = (texto) => String(texto).replace(/\\/g, '\\\\').replace(/[;,]/g, (char) => `\\${char}`).replace(/\n/g, '\\n');
  const detalhes = `Cardápio, sorteios e programação em ${agenda.endereco}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Festa Cultural//Arraial Digital//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:festa-${state.evento.slug}-${agenda.inicio.getTime()}@festa-cultural`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${carimboAgenda(agenda.inicio)}`,
    `DTEND:${carimboAgenda(agenda.fim)}`,
    `SUMMARY:${escapar(agenda.titulo)}`,
    agenda.local ? `LOCATION:${escapar(agenda.local)}` : '',
    `DESCRIPTION:${escapar(detalhes)}`,
    `URL:${agenda.endereco}`,
    // Lembrete duas horas antes, para dar tempo de arrumar e sair de casa.
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapar(agenda.titulo)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

function urlGoogleAgenda(agenda) {
  const parametros = new URLSearchParams({
    action: 'TEMPLATE',
    text: agenda.titulo,
    dates: `${carimboAgenda(agenda.inicio)}/${carimboAgenda(agenda.fim)}`,
    details: `Cardápio, sorteios e programação em ${agenda.endereco}`,
  });
  if (agenda.local) parametros.set('location', agenda.local);
  // Sem `ctz` o Google leria os carimbos como UTC e jogaria a festa para outra hora.
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (fuso) parametros.set('ctz', fuso);
  return `https://calendar.google.com/calendar/render?${parametros}`;
}

function adicionarNaAgenda() {
  const agenda = dadosDaAgenda();
  const aviso = $('#agenda-feedback');
  if (!agenda) return;
  if (/android/i.test(navigator.userAgent)) {
    window.open(urlGoogleAgenda(agenda), '_blank', 'noopener');
    if (aviso) aviso.textContent = 'Abrimos a sua agenda com a festa preenchida. É só confirmar.';
    return;
  }
  const arquivo = new Blob([montarIcs(agenda)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(arquivo);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.evento.slug}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // O navegador ainda está lendo o arquivo no instante do clique: soltar a
  // memória na hora cancelaria o download em alguns aparelhos.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  if (aviso) aviso.textContent = 'Convite baixado. Toque nele para adicionar ao seu calendário.';
}

function renderProducts() {
  const items = state.produtos.filter((item) => item.categoria !== 'brincadeira' && (state.category === 'todos' || item.categoria === state.category));
  $('#products-list').innerHTML = items.length ? items.map((item) => `<article class="product-card ${item.status === 'esgotado' ? 'sold-out' : ''}">${renderImage(item.imagem_url, item.nome)}<div class="card-content"><div class="card-topline"><span class="category-tag">${escapeHtml(item.categoria)}</span>${renderStatus(item.status)}</div><h3>${escapeHtml(item.nome)}</h3><p>${escapeHtml(item.descricao || 'Sabor especial da nossa festa.')}</p>${renderAllergens(item)}<div class="card-footer"><strong class="price">${formatMoney(item.preco)}</strong>${orderControls(item)}</div>${chipEditar('produtos', item.id)}</div>${item.status === 'esgotado' ? '<div class="sold-stamp">ESGOTADO</div>' : ''}</article>`).join('') : emptyState('Ainda não há itens nesta categoria. Volte em breve!');
}

function renderActivities() {
  const items = state.produtos.filter((item) => item.categoria === 'brincadeira');
  $('#activities-list').innerHTML = items.length ? items.map((item) => `<article class="activity-card ${item.status === 'esgotado' ? 'sold-out' : ''}">${renderImage(item.imagem_url, item.nome, 'activity-image')}<div class="activity-body"><div class="card-topline">${renderStatus(item.status)}</div><h3>${escapeHtml(item.nome)}</h3>${item.destaque ? `<span class="highlight-tag">${escapeHtml(item.destaque)}</span>` : ''}<p>${escapeHtml(item.descricao || 'Informações disponíveis na barraca.')}</p><div class="card-footer"><strong class="price"><small>Ficha:</small> ${formatMoney(item.preco)}</strong>${item.regras ? `<button class="secondary-button rules-button" type="button" data-rules="${item.id}" aria-expanded="false">Regras <span aria-hidden="true">›</span></button>` : ''}${chipEditar('produtos', item.id)}</div>${item.regras ? `<div class="activity-rules" id="regras-${item.id}" hidden><strong>Como funciona</strong><ul>${String(item.regras).split('\n').filter(Boolean).map((rule) => `<li>${escapeHtml(rule.trim())}</li>`).join('')}</ul></div>` : ''}</div></article>`).join('') : emptyState('As brincadeiras serão divulgadas em breve.');
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
  container.innerHTML = sorted.length ? sorted.map((draw) => `<article class="draw-card ${draw.status === 'em_andamento' ? 'is-live' : ''}"><div class="draw-media">${renderImage(draw.imagem_url, `prêmio ${draw.premio}`, 'draw-image')}${draw.ordem_premio ? `<span class="prize-order">${draw.ordem_premio}º Prêmio</span>` : ''}</div><div class="draw-card-content"><div class="card-topline"><span class="draw-type">${escapeHtml(drawTypeLabel[draw.tipo] || draw.tipo)} · ${escapeHtml(draw.identificacao)}</span>${renderStatus(draw.status)}</div><h3>${escapeHtml(draw.premio)}</h3><p class="draw-disclaimer">Imagem meramente ilustrativa</p>${renderCartela(draw)}${renderDrawWhen(draw)}<button class="secondary-button" data-open-draw="${draw.id}" type="button">${draw.status === 'em_andamento' ? 'Acompanhe o sorteio' : 'Ver detalhes'} <span aria-hidden="true">›</span></button>${chipEditar('sorteios', draw.id)}</div></article>`).join('') : emptyState('Os sorteios aparecerão aqui assim que forem cadastrados.');
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

/* ------------------------------------------------------------------ *
 * Rainha Caipira: galeria e perfil da candidata
 *
 * O card da galeria continua curto — foto, nome e horário do desfile — e o
 * resto (biografia, redes e rifa online) mora no perfil, que abre por cima da
 * tela sem tirar o visitante da festa.
 * ------------------------------------------------------------------ */

// Os campos de rede viram `href`. Um `javascript:` que passasse pelo banco
// seria XSS servido pela própria escola, então só http e https viram link.
const linkSeguro = (valor) => (/^https?:\/\//i.test(String(valor || '').trim()) ? String(valor).trim() : '');

// Lucide não traz logo de marca — WhatsApp e TikTok não existem lá de forma
// alguma. Os quatro desenhos ficam aqui para o conjunto ter o mesmo peso.
const REDES = [
  { campo: 'whatsapp', nome: 'WhatsApp', path: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z' },
  { campo: 'instagram', nome: 'Instagram', path: 'M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.846-10.405a1.441 1.441 0 0 1-2.88 0 1.44 1.44 0 0 1 2.88 0z' },
  { campo: 'facebook', nome: 'Facebook', path: 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z' },
  { campo: 'tiktok', nome: 'TikTok', path: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z' },
];

function renderRedes(candidate) {
  const links = REDES.map((rede) => ({ rede, url: linkSeguro(candidate[rede.campo]) })).filter((item) => item.url);
  if (!links.length) return '';
  return `<div class="profile-social">${links.map(({ rede, url }) => `<a class="social-link is-${rede.campo}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(rede.nome)}" aria-label="${escapeHtml(rede.nome)} de ${escapeHtml(candidate.nome)}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${rede.path}" /></svg></a>`).join('')}</div>`;
}

function renderBiografia(candidate) {
  const texto = String(candidate.biografia || '').trim();
  if (!texto) return `<p class="profile-empty">${escapeHtml(candidate.nome)} ainda não escreveu a apresentação dela. Volte em breve!</p>`;
  return `<div class="profile-bio">${texto.split(/\n+/).map((paragrafo) => paragrafo.trim()).filter(Boolean).map((paragrafo) => `<p>${escapeHtml(paragrafo)}</p>`).join('')}</div>`;
}

function renderRifaDaCandidata(candidate) {
  const link = linkSeguro(candidate.rifa_url);
  if (!link) return `<p class="profile-empty">${escapeHtml(candidate.nome)} ainda não publicou uma rifa online. Assim que o link sair, ele aparece aqui.</p>`;
  return `<div class="rifa-box">
      <span class="cartela-label">Rifa online</span>
      <h3>${escapeHtml(candidate.rifa_titulo || `Rifa da ${candidate.nome}`)}</h3>
      <p>${escapeHtml(candidate.rifa_descricao || 'Compre o seu número e ajude a candidata na disputa pela coroa.')}</p>
      <a class="primary-button" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Comprar número da rifa <span aria-hidden="true">→</span></a>
      <p class="rifa-nota">O link abre fora do site da festa: a compra e o pagamento são combinados direto com a candidata.</p>
    </div>`;
}

function renderCandidates() {
  $('#candidates-list').innerHTML = state.candidatas.length
    ? state.candidatas.map((candidate) => `<article class="candidate-card">${renderImage(candidate.foto_url, candidate.nome, 'candidate-photo')}<div class="candidate-body"><span class="candidate-crown">♕</span><h3>${escapeHtml(candidate.nome)}</h3>${candidate.idade ? `<span class="candidate-age"><i aria-hidden="true">✦</i>${candidate.idade} anos</span>` : ''}<p>${escapeHtml(candidate.detalhes || 'Representante da escola')}</p><strong>Desfile: ${formatTime(candidate.horario_desfile)}</strong><button class="secondary-button" type="button" data-open-candidate="${candidate.id}">Ver perfil <span aria-hidden="true">›</span></button>${chipEditar('candidatas', candidate.id)}</div></article>`).join('')
    : emptyState('As candidatas serão apresentadas em breve.');
}

/* --- Perfil da candidata ------------------------------------------ */
// A recarga automática roda a cada poucos segundos e não pode redesenhar o
// perfil que o visitante está lendo — a assinatura abaixo só muda quando o
// registro, a aba ou o modo organizador realmente mudaram.
let perfilAssinatura = '';

function perfilTab(id, rotulo, ativa) {
  return `<button class="profile-tab${ativa ? ' is-active' : ''}" type="button" role="tab" id="aba-${id}" aria-selected="${ativa}" aria-controls="painel-${id}" data-profile-tab="${id}">${rotulo}</button>`;
}

function renderCandidateProfile() {
  const dialogo = $('#candidate-profile');
  if (!dialogo) return;
  const candidate = state.candidatas.find((item) => String(item.id) === String(state.perfilId));
  // Candidata excluída no meio da visita: fecha em vez de mostrar tela vazia.
  if (!candidate) { perfilAssinatura = ''; if (dialogo.open) dialogo.close(); return; }
  const aba = state.perfilAba === 'rifa' ? 'rifa' : 'biografia';
  const assinatura = JSON.stringify([candidate, aba, state.modoEdicao, state.mostrarChips]);
  if (dialogo.open && assinatura === perfilAssinatura) return;
  perfilAssinatura = assinatura;
  dialogo.innerHTML = `<button class="profile-close" type="button" data-close-profile aria-label="Fechar perfil">×</button>
  <article class="profile-card">
    <header class="profile-head">
      ${renderImage(candidate.foto_url, candidate.nome, 'profile-photo')}
      <div class="profile-id">
        <span class="candidate-crown">♕</span>
        <h2 id="profile-name">${escapeHtml(candidate.nome)}</h2>
        ${candidate.idade ? `<span class="candidate-age"><i aria-hidden="true">✦</i>${candidate.idade} anos</span>` : ''}
        <p>${escapeHtml(candidate.detalhes || 'Representante da escola')}</p>
        <strong>Desfile: ${formatTime(candidate.horario_desfile)}</strong>
      </div>
    </header>
    ${renderRedes(candidate)}
    <div class="profile-tabs" role="tablist" aria-label="Conteúdo do perfil">
      ${perfilTab('biografia', 'Biografia', aba === 'biografia')}
      ${perfilTab('rifa', 'Rifa online', aba === 'rifa')}
    </div>
    <div class="profile-panel" role="tabpanel" id="painel-biografia" aria-labelledby="aba-biografia"${aba === 'biografia' ? '' : ' hidden'}>${renderBiografia(candidate)}</div>
    <div class="profile-panel" role="tabpanel" id="painel-rifa" aria-labelledby="aba-rifa"${aba === 'rifa' ? '' : ' hidden'}>${renderRifaDaCandidata(candidate)}</div>
    <footer class="profile-foot">
      <button class="primary-button" type="button" data-share-candidate="${candidate.id}">Compartilhar perfil <span aria-hidden="true">↗</span></button>
      ${chipEditar('candidatas', candidate.id)}
    </footer>
    <p id="profile-feedback" class="feedback" role="status" aria-live="polite"></p>
  </article>`;
  if (!dialogo.open) dialogo.showModal();
  refreshIcons();
}

// O endereço na barra passa a ser o do perfil aberto: recarregar volta para
// ele, e quem compartilhar pelo menu do próprio navegador manda o link certo.
function sincronizarUrlDoPerfil() {
  const url = new URL(location.href);
  if (state.perfilId) url.searchParams.set('candidata', state.perfilId);
  else url.searchParams.delete('candidata');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function abrirPerfil(id, aba = 'biografia') {
  if (!state.candidatas.some((item) => String(item.id) === String(id))) return;
  state.perfilId = String(id);
  state.perfilAba = aba;
  sincronizarUrlDoPerfil();
  renderCandidateProfile();
}

function fecharPerfil() {
  const dialogo = $('#candidate-profile');
  if (dialogo?.open) dialogo.close(); // o evento `close` limpa o estado
  else if (state.perfilId) { state.perfilId = null; sincronizarUrlDoPerfil(); }
}

function urlDoPerfil(id) {
  const url = new URL(location.href);
  url.hash = '';
  url.searchParams.set('candidata', String(id));
  return url.toString();
}

async function compartilharPerfil(id) {
  const candidate = state.candidatas.find((item) => String(item.id) === String(id));
  if (!candidate) return;
  const url = urlDoPerfil(id);
  const escola = state.evento?.escola ? ` da ${state.evento.escola}` : '';
  const texto = `${candidate.nome} é candidata a Rainha Caipira${escola}. Conheça o perfil dela:`;
  const nota = $('#profile-feedback');
  const avisar = (mensagem, erro = false) => { if (nota) { nota.textContent = mensagem; nota.classList.toggle('error', erro); } };
  // No celular o menu nativo já cobre WhatsApp, Instagram e o resto de uma vez.
  if (navigator.share) {
    try { await navigator.share({ title: `${candidate.nome} — Rainha Caipira`, text: texto, url }); return; }
    catch (error) { if (error?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${texto} ${url}`); avisar('Link do perfil copiado! Agora é só colar no WhatsApp.'); }
  catch { avisar(`Não deu para copiar sozinho. Envie este endereço: ${url}`, true); }
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
  $('#schedule-list').innerHTML = sorted.length ? sorted.map((item) => `<article class="timeline-item ${item.status === 'realizado' ? 'done' : ''}"><time>${formatTime(item.horario_previsto)}</time><div><div class="timeline-title"><h3>${escapeHtml(item.evento)}</h3>${renderStatus(item.status)}</div><p>${eventCountdown(item)}</p>${item.sorteio_id ? `<button class="inline-link" type="button" data-open-draw="${item.sorteio_id}">Acompanhar sorteio →</button>` : ''}${chipEditar('cronograma', item.id)}</div></article>`).join('') : emptyState('A programação será publicada em breve.');
}
function renderAll() { renderHome(); renderCountdown(); renderProducts(); renderActivities(); renderDraws(); renderCandidates(); renderCandidateProfile(); renderSchedule(); renderOrder(); renderOrderBar(); refreshIcons(); }

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
  const chip = event.target.closest('[data-admin-edit]');
  if (chip) { const [table, id] = chip.dataset.adminEdit.split('|'); editorAdmin?.open(table, id); return; }
  const perfil = event.target.closest('[data-open-candidate]');
  if (perfil) { abrirPerfil(perfil.dataset.openCandidate); return; }
  const aba = event.target.closest('[data-profile-tab]');
  if (aba) { state.perfilAba = aba.dataset.profileTab; renderCandidateProfile(); return; }
  const compartilhar = event.target.closest('[data-share-candidate]');
  if (compartilhar) { compartilharPerfil(compartilhar.dataset.shareCandidate); return; }
  if (event.target.closest('[data-close-profile]')) { fecharPerfil(); return; }
  if (event.target.closest('[data-toggle-chips]')) { state.mostrarChips = !state.mostrarChips; renderAdminBar(); renderAll(); return; }
  if (event.target.closest('[data-toggle-vibracao]')) { toggleVibracao(); return; }
  if (event.target.closest('[data-add-agenda]')) { adicionarNaAgenda(); return; }
  const rules = event.target.closest('[data-rules]');
  if (rules) { const panel = document.getElementById(`regras-${rules.dataset.rules}`); if (panel) { panel.hidden = !panel.hidden; rules.setAttribute('aria-expanded', String(!panel.hidden)); } return; }
  const route = event.target.closest('[data-route]'); if (route) { event.preventDefault(); routeTo(route.dataset.route); document.body.classList.remove('menu-open'); menuToggle?.setAttribute('aria-expanded', 'false'); menuToggle?.setAttribute('aria-label', 'Abrir menu'); }
  const draw = event.target.closest('[data-open-draw]'); if (draw) { state.selectedDrawId = Number(draw.dataset.openDraw); routeTo('sorteios'); renderDrawDetail(); $('#draw-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
const perfilDialogo = $('#candidate-profile');
// Esc e o botão de fechar disparam `close`; o clique no fundo escuro chega ao
// próprio <dialog>, porque o conteúdo é um filho menor que ele.
perfilDialogo?.addEventListener('close', () => { state.perfilId = null; perfilAssinatura = ''; sincronizarUrlDoPerfil(); });
perfilDialogo?.addEventListener('click', (event) => { if (event.target === perfilDialogo) fecharPerfil(); });

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
  // O relógio da contagem regressiva anda sozinho; o resto da tela continua
  // vindo do Realtime e do polling.
  renderCountdown();
  setInterval(renderCountdown, 1000);
  await loadAll();
  // Quem chegou por um perfil compartilhado cai direto nele.
  const perfilCompartilhado = new URLSearchParams(location.search).get('candidata');
  if (perfilCompartilhado) { routeTo('rainha'); abrirPerfil(perfilCompartilhado); }
  subscribeRealtime();
  ativarModoOrganizador();
}

iniciar();
