import { supabase } from './supabase-config.js';

const BUCKET = 'festa';
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const formatMoney = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const shortTime = (value) => value ? String(value).slice(0, 5) : '';
const statusLabel = { disponivel: 'Disponível', poucas_unidades: 'Poucas unidades', esgotado: 'Esgotado', aguardando: 'Aguardando', em_andamento: 'Em andamento', realizado: 'Realizado', pendente: 'Pendente' };
const state = { produtos: [], sorteios: [], cronograma: [], candidatas: [], alertChannel: null, alertStatus: 'CONECTANDO', editor: null };

function feedback(selector, message, isError = false) { const element = $(selector); if (!element) return; element.textContent = message; element.classList.toggle('error', isError); }
function refreshIcons() { window.lucide?.createIcons(); }

/* ------------------------------------------------------------------ *
 * Formulários: uma descrição por tabela gera a tela de edição inteira.
 * ------------------------------------------------------------------ */
const FORMS = {
  produtos: {
    titulo: 'item do cardápio / barraca',
    padrao: { categoria: 'comida', status: 'disponivel', preco: 0 },
    campos: [
      { name: 'nome', label: 'Nome', type: 'text', required: true, maxlength: 80 },
      { name: 'categoria', label: 'Categoria', type: 'select', required: true, options: [['comida', 'Comida'], ['salgado', 'Salgado'], ['doce', 'Doce'], ['bebida', 'Bebida'], ['brincadeira', 'Brincadeira (aparece na aba Barracas)']] },
      { name: 'preco', label: 'Preço (R$)', type: 'number', step: '0.01', min: '0', required: true, emptyAs: 0, hint: 'Nas barracas, é o valor da ficha.' },
      { name: 'status', label: 'Disponibilidade', type: 'select', options: [['disponivel', 'Disponível'], ['poucas_unidades', 'Restam poucas unidades'], ['esgotado', 'Esgotado']] },
      { name: 'descricao', label: 'Descrição', type: 'textarea', maxlength: 240, hint: 'Frase curta que aparece embaixo do nome.' },
      { name: 'imagem_url', label: 'Foto do item', type: 'image' },
      { name: 'alergenos', label: 'Aviso de alérgenos', type: 'text', maxlength: 80, hint: 'Ex.: Contém amendoim. Vazio = sem selo.' },
      { name: 'destaque', label: 'Selo de destaque', type: 'text', maxlength: 60, hint: 'Só para barracas. Ex.: Prêmio de R$ 200,00' },
      { name: 'regras', label: 'Regras da brincadeira', type: 'textarea', rows: 5, hint: 'Só para barracas. Uma regra por linha.' },
      { name: 'limite_alerta', label: 'Avisar quando o estoque chegar a', type: 'number', min: '0', step: '1', hint: 'Opcional, para controle interno da organização.' },
    ],
  },
  sorteios: {
    titulo: 'sorteio',
    padrao: { tipo: 'bingo', status: 'aguardando', valor_cartela: 0 },
    campos: [
      { name: 'identificacao', label: 'Identificação', type: 'text', required: true, maxlength: 60, hint: 'Nome curto de controle. Ex.: Bingo #01' },
      { name: 'premio', label: 'Prêmio', type: 'text', required: true, maxlength: 140, hint: 'É o título que o visitante lê no card.' },
      { name: 'tipo', label: 'Tipo', type: 'select', required: true, options: [['bingo', 'Bingo'], ['rifa', 'Rifa'], ['leilao', 'Leilão']] },
      { name: 'status', label: 'Situação', type: 'select', options: [['aguardando', 'Aguardando'], ['em_andamento', 'Em andamento'], ['realizado', 'Realizado']] },
      { name: 'ordem_premio', label: 'Ordem do prêmio', type: 'number', min: '1', step: '1', hint: 'Vira o selo "1º Prêmio". Vazio = sem selo.' },
      { name: 'imagem_url', label: 'Foto do prêmio', type: 'image' },
      { name: 'valor_cartela', label: 'Valor de 1 cartela (R$)', type: 'number', step: '0.01', min: '0', required: true, emptyAs: 0, hint: 'Use 0 no leilão.' },
      { name: 'cartelas_promo_qtd', label: 'Promoção: quantidade', type: 'number', min: '2', step: '1', hint: 'Ex.: 3, para "3 por R$ 10,00".' },
      { name: 'cartelas_promo_valor', label: 'Promoção: valor total (R$)', type: 'number', step: '0.01', min: '0', hint: 'Preencha junto com a quantidade, ou deixe os dois vazios.' },
      { name: 'horario_sorteio', label: 'Horário do sorteio', type: 'time' },
      { name: 'data_sorteio', label: 'Data do sorteio', type: 'date' },
    ],
  },
  candidatas: {
    titulo: 'candidata',
    padrao: {},
    campos: [
      { name: 'nome', label: 'Nome', type: 'text', required: true, maxlength: 80 },
      { name: 'idade', label: 'Idade', type: 'number', min: '10', max: '30', step: '1' },
      { name: 'detalhes', label: 'Turma / detalhes', type: 'text', maxlength: 120, hint: 'Ex.: Representante do 9º Ano A' },
      { name: 'foto_url', label: 'Foto da candidata', type: 'image' },
      { name: 'horario_desfile', label: 'Horário do desfile', type: 'time' },
    ],
  },
  cronograma: {
    titulo: 'evento do cronograma',
    padrao: { status: 'pendente' },
    campos: [
      { name: 'evento', label: 'Evento', type: 'text', required: true, maxlength: 120 },
      { name: 'horario_previsto', label: 'Horário previsto', type: 'time', required: true },
      { name: 'status', label: 'Situação', type: 'select', options: [['pendente', 'Pendente'], ['realizado', 'Realizado']] },
      { name: 'sorteio_id', label: 'Sorteio ligado a este evento', type: 'select', options: () => [['', 'Nenhum'], ...state.sorteios.map((draw) => [String(draw.id), `${draw.identificacao} — ${draw.premio}`])], hint: 'Se preenchido, o card ganha um atalho para acompanhar o sorteio.' },
    ],
  },
};

const fieldOptions = (field) => (typeof field.options === 'function' ? field.options() : field.options || []);
function fieldValue(field, item) {
  const raw = item?.[field.name];
  if (raw === null || raw === undefined) return '';
  if (field.type === 'time') return shortTime(raw);
  if (field.type === 'date') return String(raw).slice(0, 10);
  return String(raw);
}

function fieldHtml(field, item) {
  const id = `f-${field.name}`;
  const value = fieldValue(field, item);
  const hint = field.hint ? `<small class="field-hint">${escapeHtml(field.hint)}</small>` : '';
  const required = field.required ? ' required' : '';
  if (field.type === 'image') {
    return `<div class="field-image">
      <span class="field-label">${escapeHtml(field.label)}</span>
      <div class="image-preview" data-preview="${field.name}">${value ? `<img src="${escapeHtml(value)}" alt="Pré-visualização" />` : '<span>Sem foto</span>'}</div>
      <div class="image-actions">
        <label class="file-button">Enviar foto<input type="file" accept="image/*" data-upload="${field.name}" hidden /></label>
        <button type="button" class="small-button" data-clear-image="${field.name}">Remover foto</button>
      </div>
      <label class="image-url" for="${id}">Ou cole o endereço de uma imagem<input id="${id}" name="${field.name}" type="url" value="${escapeHtml(value)}" placeholder="https://..." /></label>
      <p class="upload-feedback" data-upload-feedback="${field.name}" role="status"></p>
    </div>`;
  }
  if (field.type === 'select') {
    const options = fieldOptions(field).map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}"${String(optionValue) === value ? ' selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('');
    return `<label for="${id}">${escapeHtml(field.label)}<select id="${id}" name="${field.name}"${required}>${options}</select>${hint}</label>`;
  }
  if (field.type === 'textarea') {
    return `<label for="${id}">${escapeHtml(field.label)}<textarea id="${id}" name="${field.name}" rows="${field.rows || 3}"${field.maxlength ? ` maxlength="${field.maxlength}"` : ''}${required}>${escapeHtml(value)}</textarea>${hint}</label>`;
  }
  const extra = ['step', 'min', 'max', 'maxlength'].filter((attribute) => field[attribute] !== undefined).map((attribute) => ` ${attribute}="${field[attribute]}"`).join('');
  return `<label for="${id}">${escapeHtml(field.label)}<input id="${id}" name="${field.name}" type="${field.type}" value="${escapeHtml(value)}"${extra}${required} />${hint}</label>`;
}

function openEditor(table, id = null) {
  const form = FORMS[table];
  if (!form) return;
  const item = id ? state[table].find((entry) => String(entry.id) === String(id)) : { ...form.padrao };
  if (id && !item) return;
  state.editor = { table, id };
  $('#editor-title').textContent = id ? `Editar ${form.titulo}` : `Novo ${form.titulo}`;
  $('#editor-fields').innerHTML = form.campos.map((field) => fieldHtml(field, item)).join('');
  $('#editor-delete').hidden = !id;
  feedback('#editor-feedback', '');
  $('#editor').showModal();
}

function closeEditor() { state.editor = null; $('#editor').close(); }

function collectValues(table) {
  const values = {};
  FORMS[table].campos.forEach((field) => {
    const element = document.getElementById(`f-${field.name}`);
    if (!element) return;
    const raw = String(element.value ?? '').trim();
    if (raw === '') { values[field.name] = field.emptyAs !== undefined ? field.emptyAs : null; return; }
    if (field.type === 'number') { const parsed = Number(raw); values[field.name] = Number.isFinite(parsed) ? parsed : null; return; }
    // sorteio_id é um select de texto, mas a coluna é numérica.
    values[field.name] = field.name === 'sorteio_id' ? Number(raw) : raw;
  });
  return values;
}

async function submitEditor(event) {
  event.preventDefault();
  if (!state.editor) return;
  const { table, id } = state.editor;
  const values = collectValues(table);
  // O banco recusa a promoção pela metade; avisamos antes de gastar a viagem.
  if (table === 'sorteios' && (values.cartelas_promo_qtd === null) !== (values.cartelas_promo_valor === null)) {
    feedback('#editor-feedback', 'Preencha a quantidade e o valor da promoção juntos, ou deixe os dois vazios.', true);
    return;
  }
  const save = $('#editor-save');
  save.disabled = true;
  feedback('#editor-feedback', 'Salvando...');
  const { error } = id ? await supabase.from(table).update(values).eq('id', id) : await supabase.from(table).insert(values);
  save.disabled = false;
  if (error) { feedback('#editor-feedback', error.message, true); return; }
  closeEditor();
  await loadData();
}

async function deleteCurrent() {
  if (!state.editor?.id) return;
  const { table, id } = state.editor;
  if (!window.confirm('Excluir este registro? Essa ação não pode ser desfeita.')) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) { feedback('#editor-feedback', error.message, true); return; }
  closeEditor();
  await loadData();
}

/* ------------------------------------------------------------------ *
 * Upload de imagens (bucket `festa`, leitura pública)
 * ------------------------------------------------------------------ */
function setImage(fieldName, url) {
  const input = document.getElementById(`f-${fieldName}`);
  if (input) input.value = url;
  const preview = document.querySelector(`[data-preview="${fieldName}"]`);
  if (preview) preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="Pré-visualização" />` : '<span>Sem foto</span>';
}

async function uploadImage(input) {
  const fieldName = input.dataset.upload;
  const file = input.files?.[0];
  const note = document.querySelector(`[data-upload-feedback="${fieldName}"]`);
  if (!file) return;
  const setNote = (message, isError = false) => { if (note) { note.textContent = message; note.classList.toggle('error', isError); } };
  if (!file.type.startsWith('image/')) { setNote('Escolha um arquivo de imagem.', true); input.value = ''; return; }
  if (file.size > 5 * 1024 * 1024) { setNote('A foto tem mais de 5 MB. Reduza antes de enviar.', true); input.value = ''; return; }
  setNote('Enviando foto...');
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${state.editor?.table || 'geral'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '3600' });
  input.value = '';
  if (error) { setNote(`Não foi possível enviar: ${error.message}`, true); return; }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  setImage(fieldName, data.publicUrl);
  setNote('Foto enviada e já aplicada. Salve para publicar.');
}

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

function renderCandidates() {
  $('#candidate-count').textContent = `${state.candidatas.length} ${state.candidatas.length === 1 ? 'candidata' : 'candidatas'}`;
  $('#admin-candidates').innerHTML = state.candidatas.length
    ? state.candidatas.map((candidate) => `<article class="admin-row">${thumb(candidate.foto_url)}<div class="row-main"><h3>${escapeHtml(candidate.nome)}</h3><p>${candidate.idade ? `${candidate.idade} anos · ` : ''}${escapeHtml(candidate.detalhes || 'Sem detalhes')}${candidate.horario_desfile ? ` · ${shortTime(candidate.horario_desfile)}` : ''}</p></div><div class="row-actions">${editButton('candidatas', candidate.id)}</div></article>`).join('')
    : '<p class="muted">Nenhuma candidata cadastrada.</p>';
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

function renderAll() { renderProducts(); renderSelect(); renderDrawList(); renderCandidates(); renderSchedule(); refreshIcons(); }

async function loadData() {
  const [produtos, sorteios, cronograma, candidatas] = await Promise.all([
    supabase.from('produtos').select('*').order('nome'),
    supabase.from('sorteios').select('*').order('id', { ascending: false }),
    supabase.from('cronograma').select('*').order('horario_previsto'),
    supabase.from('candidatas').select('*').order('nome'),
  ]);
  const error = [produtos, sorteios, cronograma, candidatas].find((result) => result.error)?.error;
  if (error) { feedback('#login-feedback', error.message, true); return; }
  state.produtos = produtos.data || []; state.sorteios = sorteios.data || []; state.cronograma = cronograma.data || []; state.candidatas = candidatas.data || [];
  renderAll();
}

async function updateTable(table, values, id) { const { error } = await supabase.from(table).update(values).eq('id', id); if (error) throw error; }

async function subscribe() {
  ['produtos', 'sorteios', 'cronograma', 'candidatas'].forEach((table) => supabase.channel(`admin-${table}`).on('postgres_changes', { event: '*', schema: 'public', table }, loadData).subscribe());
  // Canal privado: o Realtime valida as policies com o token da sessao do organizador.
  await supabase.realtime.setAuth();
  state.alertChannel = supabase.channel('avisos-globais', { config: { private: true } });
  state.alertStatus = 'CONECTANDO';
  state.alertChannel.subscribe((status, error) => { state.alertStatus = status; if (error) console.error('Canal de avisos:', error.message); });
}

async function showAdmin(session) { $('#login-panel').hidden = true; $('#admin-panel').hidden = false; $('#sign-out').hidden = false; $('#admin-email').textContent = session.user.email; await loadData(); await subscribe(); }

$('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); feedback('#login-feedback', 'Entrando...'); const { data, error } = await supabase.auth.signInWithPassword({ email: $('#email').value, password: $('#password').value }); if (error) { feedback('#login-feedback', error.message, true); return; } showAdmin(data.session); });
$('#sign-out').addEventListener('click', async () => { await supabase.auth.signOut(); window.location.reload(); });
$('#active-draw').addEventListener('change', renderDrawConsole);
$('#editor-form').addEventListener('submit', submitEditor);
$('#editor-close').addEventListener('click', closeEditor);
$('#editor-delete').addEventListener('click', deleteCurrent);
$('#editor').addEventListener('close', () => { state.editor = null; });
// Clique no fundo escuro fecha: o <dialog> recebe o clique quando é fora do formulário.
$('#editor').addEventListener('click', (event) => { if (event.target.id === 'editor') closeEditor(); });
document.addEventListener('change', (event) => { if (event.target.dataset?.upload) uploadImage(event.target); });

document.addEventListener('click', async (event) => {
  const create = event.target.closest('[data-new]');
  if (create) { openEditor(create.dataset.new); return; }
  const edit = event.target.closest('[data-edit]');
  if (edit) { const [table, id] = edit.dataset.edit.split('|'); openEditor(table, id); return; }
  const clearImage = event.target.closest('[data-clear-image]');
  if (clearImage) { setImage(clearImage.dataset.clearImage, ''); return; }
  const product = event.target.closest('[data-product-status]');
  const drawStatus = event.target.closest('[data-draw-status]');
  const schedule = event.target.closest('[data-schedule-toggle]');
  try {
    if (product) { const [id, status] = product.dataset.productStatus.split('|'); await updateTable('produtos', { status }, id); }
    if (drawStatus) { await updateTable('sorteios', { status: drawStatus.dataset.drawStatus }, $('#active-draw').value); feedback('#draw-feedback', 'Estado atualizado.'); }
    if (schedule) { const [id, status] = schedule.dataset.scheduleToggle.split('|'); await updateTable('cronograma', { status }, id); }
  } catch (error) { feedback('#draw-feedback', error.message, true); }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'number-form') { event.preventDefault(); const draw = state.sorteios.find((item) => String(item.id) === $('#active-draw').value); const number = Number($('#called-number').value); if (!Number.isInteger(number)) return; const numbers = Array.isArray(draw.numeros_sorteados) ? draw.numeros_sorteados.map(Number) : []; if (!numbers.includes(number)) numbers.push(number); try { await updateTable('sorteios', { numeros_sorteados: numbers, ultimo_numero: number, status: draw.status === 'aguardando' ? 'em_andamento' : draw.status }, draw.id); $('#called-number').value = ''; feedback('#draw-feedback', 'Número atualizado ao vivo.'); } catch (error) { feedback('#draw-feedback', error.message, true); } }
  if (event.target.id === 'alert-form') { event.preventDefault(); const message = $('#alert-message').value.trim(); if (!message) return; if (state.alertStatus !== 'SUBSCRIBED') { feedback('#alert-feedback', 'Canal de avisos ainda conectando. Aguarde alguns segundos e tente de novo.', true); return; } const result = await state.alertChannel.send({ type: 'broadcast', event: 'alerta', payload: { mensagem: message } }); if (result === 'ok') { feedback('#alert-feedback', 'Alerta enviado para os visitantes conectados.'); $('#alert-message').value = ''; } else feedback('#alert-feedback', 'Não foi possível enviar o alerta. Tente novamente.', true); }
});

document.addEventListener('click', async (event) => { if (event.target.id === 'reset-draw') { const draw = state.sorteios.find((item) => String(item.id) === $('#active-draw').value); if (!draw || !window.confirm('Limpar todos os números deste sorteio?')) return; try { await updateTable('sorteios', { numeros_sorteados: [], ultimo_numero: null, status: 'aguardando' }, draw.id); feedback('#draw-feedback', 'Sorteio resetado.'); } catch (error) { feedback('#draw-feedback', error.message, true); } } });

const { data: { session } } = await supabase.auth.getSession(); if (session) showAdmin(session);
