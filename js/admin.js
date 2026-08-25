import { supabase } from './supabase-config.js';
import { createEditor, describeError, souOrganizador, SEM_PERMISSAO } from './editor.js';

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const formatMoney = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const shortTime = (value) => value ? String(value).slice(0, 5) : '';
const statusLabel = { disponivel: 'Disponível', poucas_unidades: 'Poucas unidades', esgotado: 'Esgotado', aguardando: 'Aguardando', em_andamento: 'Em andamento', realizado: 'Realizado', pendente: 'Pendente' };
const EVENTO_KEY = 'festa-cultural:admin-evento';
// `organizador` guarda o resultado de public.sou_organizador(): true, false, ou
// null quando a função ainda não existe no banco (migration não aplicada).
const state = { eventos: [], eventoId: null, produtos: [], sorteios: [], cronograma: [], candidatas: [], farda_modelos: [], farda_tecidos: [], funcionarios: [], organizador: null };

function feedback(selector, message, isError = false) { const element = $(selector); if (!element) return; element.textContent = message; element.classList.toggle('error', isError); }
function refreshIcons() { window.lucide?.createIcons(); }

const editor = createEditor({
  getEventoId: () => state.eventoId,
  getRecord: (table, id) => (state[table] || []).find((entry) => String(entry.id) === String(id)),
  getSorteios: () => state.sorteios,
  getModelos: () => state.farda_modelos,
  getTecidos: () => state.farda_tecidos,
  getOrganizador: () => state.organizador,
  onSaved: async (table, id, gravado) => {
    if (table === 'eventos') {
      // Uma festa recém-criada já entra selecionada, senão o organizador
      // cadastraria o cardápio dela dentro da festa anterior.
      if (gravado?.[0]?.id && !id) state.eventoId = gravado[0].id;
      else if (!gravado) state.eventoId = null;
      await loadEventos();
    }
    await loadData();
  },
});

function renderPermissionWarning() {
  const banner = $('#permission-warning');
  if (!banner) return;
  banner.hidden = state.organizador !== false;
  if (state.organizador === false) banner.textContent = `Atenção: esta conta entrou, mas não pode gravar nada. ${SEM_PERMISSAO}`;
}

async function checkOrganizer() { state.organizador = await souOrganizador(); renderPermissionWarning(); }

// Erros de carregamento iam para #login-feedback, que fica dentro do painel de
// login escondido — depois de entrar, ninguem via. Agora usam a tarja do topo.
function mostrarProblema(mensagem) {
  const banner = $('#permission-warning');
  if (!banner) return;
  banner.hidden = false;
  banner.textContent = mensagem;
}
function limparProblema() { if (state.organizador !== false) renderPermissionWarning(); }

/* ------------------------------------------------------------------ *
 * Listas do painel
 * ------------------------------------------------------------------ */
function thumb(url) { return url ? `<img class="row-thumb" src="${escapeHtml(url)}" alt="" loading="lazy" />` : '<span class="row-thumb row-thumb-empty" aria-hidden="true"></span>'; }
function editButton(table, id) { return `<button class="small-button" type="button" data-edit="${table}|${id}">Editar</button>`; }
function productControls(product) { return `<div class="status-controls"><button data-product-status="${product.id}|disponivel" class="${product.status === 'disponivel' ? 'selected' : ''}" type="button">Disponível</button><button data-product-status="${product.id}|poucas_unidades" class="${product.status === 'poucas_unidades' ? 'selected' : ''}" type="button">Poucas</button><button data-product-status="${product.id}|esgotado" class="${product.status === 'esgotado' ? 'selected' : ''}" type="button">Esgotado</button></div>`; }

function renderProducts() {
  $('#product-count').textContent = `${state.produtos.length} ${state.produtos.length === 1 ? 'item' : 'itens'}`;
  $('#admin-products').innerHTML = state.produtos.length
    ? state.produtos.map((product) => `<article class="admin-row">${thumb(product.imagem_url)}<div class="row-main"><h3>${escapeHtml(product.nome)}</h3><p>${formatMoney(product.preco)} · ${escapeHtml(product.categoria)}</p></div><div class="row-actions">${productControls(product)}${editButton('produtos', product.id)}</div></article>`).join('')
    : '<p class="muted">Nenhum item cadastrado. Toque em "+ Novo item" para começar.</p>';
}

function renderDrawList() {
  $('#draw-count').textContent = `${state.sorteios.length} ${state.sorteios.length === 1 ? 'sorteio' : 'sorteios'}`;
  $('#admin-draws').innerHTML = state.sorteios.length
    ? state.sorteios.map((draw) => `<article class="admin-row">${thumb(draw.imagem_url)}<div class="row-main"><h3>${escapeHtml(draw.premio)}</h3><p>${escapeHtml(draw.identificacao)} · ${escapeHtml(draw.tipo)} · ${statusLabel[draw.status]}${draw.horario_sorteio ? ` · ${shortTime(draw.horario_sorteio)}` : ''}</p></div><div class="row-actions">${editButton('sorteios', draw.id)}</div></article>`).join('')
    : '<p class="muted">Nenhum sorteio cadastrado.</p>';
}

// O que o perfil público já tem preenchido. Sem isso o organizador só
// descobriria a biografia faltando abrindo candidata por candidata.
const REDES_DA_CANDIDATA = ['whatsapp', 'instagram', 'facebook', 'tiktok'];
function perfilResumo(candidate) {
  const redes = REDES_DA_CANDIDATA.filter((campo) => candidate[campo]).length;
  const partes = [
    candidate.biografia ? 'biografia ✓' : 'sem biografia',
    redes ? `${redes} ${redes === 1 ? 'rede' : 'redes'}` : 'sem redes',
    candidate.rifa_url ? 'rifa online ✓' : 'sem rifa online',
  ];
  return `<p class="row-perfil">Perfil: ${escapeHtml(partes.join(' · '))}</p>`;
}

function renderCandidates() {
  $('#candidate-count').textContent = `${state.candidatas.length} ${state.candidatas.length === 1 ? 'candidata' : 'candidatas'}`;
  $('#admin-candidates').innerHTML = state.candidatas.length
    ? state.candidatas.map((candidate) => `<article class="admin-row">${thumb(candidate.foto_url)}<div class="row-main"><h3>${escapeHtml(candidate.nome)}</h3><p>${candidate.idade ? `${candidate.idade} anos · ` : ''}${escapeHtml(candidate.detalhes || 'Sem detalhes')}${candidate.horario_desfile ? ` · ${shortTime(candidate.horario_desfile)}` : ''}</p>${perfilResumo(candidate)}</div><div class="row-actions">${editButton('candidatas', candidate.id)}</div></article>`).join('')
    : '<p class="muted">Nenhuma candidata cadastrada.</p>';
}

const CARGOS = { gestao: 'Gestão', professores: 'Professores', aee: 'AEE', administrativo: 'Administrativo', transporte: 'Transporte', apoio: 'Apoio' };
const GOLAS = { polo: 'Gola polo', 't-shirt': 'T-shirt' };
const CORTES = { masculino: 'Masculino', feminino: 'Feminino' };

function renderModelos() {
  $('#modelo-count').textContent = `${state.farda_modelos.length} ${state.farda_modelos.length === 1 ? 'modelo' : 'modelos'}`;
  const escolhido = eventoAtual()?.farda_modelo_id;
  $('#admin-modelos').innerHTML = state.farda_modelos.length
    ? state.farda_modelos.map((modelo) => `<article class="admin-row">${thumb(modelo.imagem_url)}<div class="row-main"><h3>${escapeHtml(modelo.nome)}${String(modelo.id) === String(escolhido) ? ' <span class="count-chip">definido</span>' : ''}</h3><p>${escapeHtml(modelo.descricao || 'Sem descrição')}</p></div><div class="row-actions">${editButton('farda_modelos', modelo.id)}</div></article>`).join('')
    : '<p class="muted">Nenhum modelo cadastrado. Toque em "+ Novo modelo" e envie a foto de cada um.</p>';
}

function renderTecidos() {
  $('#tecido-count').textContent = `${state.farda_tecidos.length} ${state.farda_tecidos.length === 1 ? 'tecido' : 'tecidos'}`;
  $('#admin-tecidos').innerHTML = state.farda_tecidos.length
    ? state.farda_tecidos.map((tecido) => `<article class="admin-row">${thumb(tecido.imagem_url)}<div class="row-main"><h3>${escapeHtml(tecido.nome)}</h3><p>${formatMoney(tecido.preco)}${tecido.resumo ? ` · ${escapeHtml(tecido.resumo)}` : ''}</p>${tecido.imagem_url ? '' : '<p class="row-perfil">Sem foto: a equipe vê um espaço vazio no card.</p>'}</div><div class="row-actions">${editButton('farda_tecidos', tecido.id)}</div></article>`).join('')
    : '<p class="muted">Nenhum tecido cadastrado.</p>';
}

// Mesma conta da página da equipe: tecido + gola polo + tamanho maior.
const TAMANHOS_COM_ADICIONAL = new Set(['GG', 'XG', 'XGG', 'GGBL', 'XGBL', 'XGGBL']);
function totalDaFarda(pessoa) {
  const evento = eventoAtual() || {};
  const tecido = state.farda_tecidos.find((item) => String(item.id) === String(pessoa.farda_tecido_id));
  if (!tecido) return 0;
  return Number(tecido.preco || 0)
    + (pessoa.farda_gola === 'polo' ? Number(evento.farda_adicional_polo || 0) : 0)
    + (TAMANHOS_COM_ADICIONAL.has(pessoa.farda_tamanho) ? Number(evento.farda_adicional_tamanho || 0) : 0);
}

// Resumo do que a pessoa escolheu, para conferir o pedido com a confecção.
function resumoFarda(pessoa) {
  const tecido = state.farda_tecidos.find((item) => String(item.id) === String(pessoa.farda_tecido_id));
  const total = totalDaFarda(pessoa);
  const partes = [tecido ? tecido.nome : null, GOLAS[pessoa.farda_gola], CORTES[pessoa.farda_corte], pessoa.farda_tamanho ? `Tamanho ${pessoa.farda_tamanho}` : null, pessoa.farda_baby_look ? 'Baby look' : null, pessoa.farda_nome ? `Costas: ${pessoa.farda_nome}` : null].filter(Boolean);
  if (total > 0) partes.push(`Total ${formatMoney(total)}`);
  return partes.length ? partes.join(' · ') : 'Farda não informada';
}

function pagamentoControles(pessoa) {
  const botao = (campo, rotulo, pago) => `<button class="selected ${pago ? 'is-pago' : 'is-devendo'}" type="button" data-func-pago="${pessoa.id}|${campo}|${pago ? 'false' : 'true'}">${rotulo}: ${pago ? 'pago' : 'a pagar'}</button>`;
  return `<div class="status-controls pgto-controles">${botao('contribuicao_paga', 'Contribuição', pessoa.contribuicao_paga)}${pessoa.farda_tamanho ? botao('farda_paga', 'Farda', pessoa.farda_paga) : ''}</div>`;
}

function renderFuncionarios() {
  const total = state.funcionarios.length;
  $('#funcionario-count').textContent = `${total} ${total === 1 ? 'pessoa' : 'pessoas'}`;
  $('#admin-funcionarios').innerHTML = total
    ? state.funcionarios.map((pessoa) => `<article class="admin-row"><div class="row-main"><h3>${escapeHtml(pessoa.nome)}</h3><p><span class="cargo-chip">${escapeHtml(CARGOS[pessoa.cargo] || pessoa.cargo)}</span>${pessoa.contribuicao_valor != null ? formatMoney(pessoa.contribuicao_valor) : 'Contribuição a definir'}</p><p>${escapeHtml(resumoFarda(pessoa))}</p></div><div class="row-actions">${pagamentoControles(pessoa)}${editButton('funcionarios', pessoa.id)}</div></article>`).join('')
    : '<p class="muted">Ninguém entrou na página da equipe ainda. Os nomes aparecem aqui sozinhos conforme cada um se identifica.</p>';
}

function renderSchedule() {
  $('#schedule-count').textContent = `${state.cronograma.length} ${state.cronograma.length === 1 ? 'evento' : 'eventos'}`;
  $('#admin-schedule').innerHTML = state.cronograma.length
    ? state.cronograma.map((event) => `<article class="admin-row"><div class="row-main"><h3>${escapeHtml(event.evento)}</h3><p>${shortTime(event.horario_previsto)} · ${statusLabel[event.status]}</p></div><div class="row-actions"><button data-schedule-toggle="${event.id}|${event.status === 'realizado' ? 'pendente' : 'realizado'}" class="small-button" type="button">${event.status === 'realizado' ? 'Reverter' : 'Marcar realizado'}</button>${editButton('cronograma', event.id)}</div></article>`).join('')
    : '<p class="muted">Nenhum evento cadastrado.</p>';
}

function renderSelect() {
  const select = $('#active-draw');
  const selected = select.value;
  select.innerHTML = state.sorteios.length ? state.sorteios.map((draw) => `<option value="${draw.id}">${escapeHtml(draw.identificacao)} — ${escapeHtml(draw.premio)}</option>`).join('') : '<option value="">Nenhum sorteio cadastrado</option>';
  if (state.sorteios.some((draw) => String(draw.id) === selected)) select.value = selected;
  else { const active = state.sorteios.find((draw) => draw.status === 'em_andamento'); select.value = active?.id || state.sorteios[0]?.id || ''; }
  renderDrawConsole();
}

function renderDrawConsole() {
  const draw = state.sorteios.find((item) => String(item.id) === $('#active-draw').value);
  const consoleElement = $('#draw-console');
  if (!draw) { consoleElement.innerHTML = '<p class="muted">Cadastre um sorteio para controlá-lo aqui.</p>'; return; }
  const history = Array.isArray(draw.numeros_sorteados) ? draw.numeros_sorteados : [];
  consoleElement.innerHTML = `<div class="console-status"><span class="status status-${draw.status}">${statusLabel[draw.status]}</span><strong>${escapeHtml(draw.premio)}</strong><small>Último: ${draw.ultimo_numero ?? '—'} · Histórico: ${history.length}</small></div><div class="console-buttons"><button data-draw-status="em_andamento" type="button">Iniciar</button><button data-draw-status="aguardando" type="button">Pausar</button><button data-draw-status="realizado" type="button">Encerrar</button></div><form id="number-form" class="number-form"><label>Número chamado / lance<input id="called-number" inputmode="numeric" min="0" step="1" type="number" required /></label><button class="primary-button" type="submit">Confirmar</button></form><button id="reset-draw" class="danger-button" type="button">Limpar sorteio atual</button><p id="draw-feedback" class="feedback" role="status"></p>`;
}

function renderAll() { renderProducts(); renderSelect(); renderDrawList(); renderCandidates(); renderModelos(); renderTecidos(); renderFuncionarios(); renderSchedule(); refreshIcons(); }

/* ------------------------------------------------------------------ *
 * Festas
 * ------------------------------------------------------------------ */
async function loadEventos() {
  const { data, error } = await supabase.from('eventos').select('*').order('nome');
  if (error) { mostrarProblema(`Não foi possível carregar as festas. ${describeError(error)}`); return; }
  limparProblema();
  state.eventos = data || [];
  let guardado = null;
  try { guardado = localStorage.getItem(EVENTO_KEY); } catch { /* sem localStorage */ }
  const valido = state.eventos.some((evento) => String(evento.id) === String(state.eventoId));
  if (!valido) {
    const salvo = state.eventos.find((evento) => String(evento.id) === String(guardado));
    state.eventoId = (salvo || state.eventos[0])?.id ?? null;
  }
  renderEventos();
}

function selecionarEvento(id) {
  state.eventoId = id ? Number(id) : null;
  try { localStorage.setItem(EVENTO_KEY, String(state.eventoId ?? '')); } catch { /* sem localStorage */ }
  renderEventos();
  loadData();
}

function eventoAtual() { return state.eventos.find((evento) => String(evento.id) === String(state.eventoId)) || null; }

function renderEventos() {
  const select = $('#active-event');
  select.innerHTML = state.eventos.length
    ? state.eventos.map((evento) => `<option value="${evento.id}"${String(evento.id) === String(state.eventoId) ? ' selected' : ''}>${escapeHtml(evento.escola || evento.nome)} — /${escapeHtml(evento.slug)}${evento.ativo ? '' : ' (oculta)'}</option>`).join('')
    : '<option value="">Nenhuma festa cadastrada</option>';
  const atual = eventoAtual();
  const link = $('#event-link');
  $('#edit-event').hidden = !atual;
  $('#preview-event').hidden = !atual;
  if (!atual) { link.textContent = 'Crie a primeira festa em "+ Nova festa".'; return; }
  const url = `${location.origin}/${atual.slug}`;
  $('#preview-event').href = `/${atual.slug}`;
  link.innerHTML = `Endereço do visitante: <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`;
  renderEquipeLink(atual);
}

function renderEquipeLink(atual) {
  const link = $('#equipe-link');
  const botao = $('#preview-equipe');
  if (!link) return;
  if (!atual) { link.textContent = ''; if (botao) botao.hidden = true; return; }
  const url = `${location.origin}/${atual.slug}/funcionarios`;
  if (botao) { botao.hidden = false; botao.href = `/${atual.slug}/funcionarios`; }
  link.innerHTML = `Endereço da equipe: <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`;
}

// A senha da equipe mora em `equipe_acesso`, fora de `eventos` — se fosse
// coluna da festa, o site público a devolveria junto no `select *`.
async function loadCodigoDaEquipe() {
  const campo = $('#equipe-codigo-admin');
  if (!campo || !state.eventoId) return;
  const { data, error } = await supabase.from('equipe_acesso').select('codigo').eq('evento_id', state.eventoId).maybeSingle();
  if (error) { feedback('#codigo-feedback', describeError(error), true); return; }
  campo.value = data?.codigo || '';
}

async function salvarCodigoDaEquipe(event) {
  event.preventDefault();
  if (!state.eventoId) { feedback('#codigo-feedback', 'Escolha uma festa antes.', true); return; }
  const codigo = $('#equipe-codigo-admin').value.trim();
  feedback('#codigo-feedback', 'Salvando...');
  const { data, error } = await supabase
    .from('equipe_acesso')
    .upsert({ evento_id: state.eventoId, codigo: codigo || null, atualizado_em: new Date().toISOString() }, { onConflict: 'evento_id' })
    .select('evento_id');
  // Escrita barrada pelo RLS casa zero linhas e volta sem erro: o painel não
  // pode dizer "salvo" com o banco intacto.
  if (error) { feedback('#codigo-feedback', describeError(error), true); return; }
  if (!data?.length) { feedback('#codigo-feedback', SEM_PERMISSAO, true); return; }
  feedback('#codigo-feedback', codigo ? 'Código salvo. A equipe vai precisar dele para entrar.' : 'Código removido: qualquer pessoa com o endereço entra.');
}

async function loadData() {
  if (!state.eventoId) { state.produtos = []; state.sorteios = []; state.cronograma = []; state.candidatas = []; state.farda_modelos = []; state.farda_tecidos = []; state.funcionarios = []; renderAll(); return; }
  const evento = state.eventoId;
  const [produtos, sorteios, cronograma, candidatas, modelos, tecidos, funcionarios] = await Promise.all([
    supabase.from('produtos').select('*').eq('evento_id', evento).order('nome'),
    supabase.from('sorteios').select('*').eq('evento_id', evento).order('id', { ascending: false }),
    supabase.from('cronograma').select('*').eq('evento_id', evento).order('horario_previsto'),
    supabase.from('candidatas').select('*').eq('evento_id', evento).order('nome'),
    supabase.from('farda_modelos').select('*').eq('evento_id', evento).order('id'),
    supabase.from('farda_tecidos').select('*').eq('evento_id', evento).order('ordem').order('id'),
    supabase.from('funcionarios').select('*').eq('evento_id', evento).order('nome'),
  ]);
  const error = [produtos, sorteios, cronograma, candidatas, modelos, tecidos, funcionarios].find((result) => result.error)?.error;
  if (error) { mostrarProblema(`Não foi possível carregar os dados desta festa. ${describeError(error)}`); return; }
  limparProblema();
  state.produtos = produtos.data || []; state.sorteios = sorteios.data || []; state.cronograma = cronograma.data || []; state.candidatas = candidatas.data || [];
  state.farda_modelos = modelos.data || []; state.farda_tecidos = tecidos.data || []; state.funcionarios = funcionarios.data || [];
  await loadCodigoDaEquipe();
  renderAll();
}

async function updateTable(table, values, id) { await editor.write('update', table, { values, id }); }

async function subscribe() {
  // setAuth ANTES de assinar: o Realtime precisa do token da sessão já aplicado
  // no socket quando o canal entra, senão ele avalia as policies como anônimo.
  await supabase.realtime.setAuth();
  supabase.channel('admin-tabelas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'eventos' }, loadEventos)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sorteios' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cronograma' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'candidatas' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'farda_modelos' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'farda_tecidos' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'funcionarios' }, loadData)
    .subscribe();
}

async function showAdmin(session) { $('#login-panel').hidden = true; $('#admin-panel').hidden = false; $('#sign-out').hidden = false; $('#admin-email').textContent = session.user.email; await checkOrganizer(); await loadEventos(); await loadData(); await subscribe(); }

$('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); feedback('#login-feedback', 'Entrando...'); const { data, error } = await supabase.auth.signInWithPassword({ email: $('#email').value, password: $('#password').value }); if (error) { feedback('#login-feedback', error.message, true); return; } showAdmin(data.session); });
$('#sign-out').addEventListener('click', async () => { await supabase.auth.signOut(); window.location.reload(); });
$('#active-draw').addEventListener('change', renderDrawConsole);
$('#active-event').addEventListener('change', (event) => selecionarEvento(event.target.value));
$('#edit-event').addEventListener('click', () => { if (state.eventoId) editor.open('eventos', state.eventoId); });
$('#codigo-form').addEventListener('submit', salvarCodigoDaEquipe);

document.addEventListener('click', async (event) => {
  const create = event.target.closest('[data-new]');
  if (create) { editor.open(create.dataset.new); return; }
  const edit = event.target.closest('[data-edit]');
  if (edit) { const [table, id] = edit.dataset.edit.split('|'); editor.open(table, id); return; }
  const product = event.target.closest('[data-product-status]');
  const drawStatus = event.target.closest('[data-draw-status]');
  const schedule = event.target.closest('[data-schedule-toggle]');
  const pagamento = event.target.closest('[data-func-pago]');
  // Erro de pagamento tem de aparecer no card dos funcionários, não no do
  // sorteio — onde ninguém estaria olhando.
  if (pagamento) {
    const [id, campo, valor] = pagamento.dataset.funcPago.split('|');
    try { await updateTable('funcionarios', { [campo]: valor === 'true' }, id); feedback('#funcionario-feedback', ''); }
    catch (error) { feedback('#funcionario-feedback', error.message, true); }
    return;
  }
  try {
    if (product) { const [id, status] = product.dataset.productStatus.split('|'); await updateTable('produtos', { status }, id); }
    if (drawStatus) { await updateTable('sorteios', { status: drawStatus.dataset.drawStatus }, $('#active-draw').value); feedback('#draw-feedback', 'Estado atualizado.'); }
    if (schedule) { const [id, status] = schedule.dataset.scheduleToggle.split('|'); await updateTable('cronograma', { status }, id); }
  } catch (error) { feedback('#draw-feedback', error.message, true); }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'number-form') { event.preventDefault(); const draw = state.sorteios.find((item) => String(item.id) === $('#active-draw').value); const number = Number($('#called-number').value); if (!Number.isInteger(number)) return; const numbers = Array.isArray(draw.numeros_sorteados) ? draw.numeros_sorteados.map(Number) : []; if (!numbers.includes(number)) numbers.push(number); try { await updateTable('sorteios', { numeros_sorteados: numbers, ultimo_numero: number, status: draw.status === 'aguardando' ? 'em_andamento' : draw.status }, draw.id); $('#called-number').value = ''; feedback('#draw-feedback', 'Número atualizado ao vivo.'); } catch (error) { feedback('#draw-feedback', error.message, true); } }
  // O aviso é uma linha em public.avisos. Broadcast em canal privado não servia:
  // o send() respondia 'ok' mesmo quando o servidor descartava a mensagem, e
  // quem abrisse o site depois do disparo nunca via o recado.
  if (event.target.id === 'alert-form') {
    event.preventDefault();
    const message = $('#alert-message').value.trim();
    if (!message) return;
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    feedback('#alert-feedback', 'Publicando aviso...');
    try {
      await editor.write('insert', 'avisos', { values: { mensagem: message } });
      feedback('#alert-feedback', 'Aviso publicado. Aparece na hora para quem está no site, e também para quem entrar nos próximos minutos.');
      $('#alert-message').value = '';
    } catch (error) {
      feedback('#alert-feedback', error.message, true);
    } finally {
      button.disabled = false;
    }
  }
});

document.addEventListener('click', async (event) => { if (event.target.id === 'reset-draw') { const draw = state.sorteios.find((item) => String(item.id) === $('#active-draw').value); if (!draw || !window.confirm('Limpar todos os números deste sorteio?')) return; try { await updateTable('sorteios', { numeros_sorteados: [], ultimo_numero: null, status: 'aguardando' }, draw.id); feedback('#draw-feedback', 'Sorteio resetado.'); } catch (error) { feedback('#draw-feedback', error.message, true); } } });

const { data: { session } } = await supabase.auth.getSession(); if (session) showAdmin(session);
