/*
 * Editor compartilhado pelo painel e pelo modo "ver como visitante".
 *
 * A tela pública e a tela da organização precisam do mesmo formulário. Em vez
 * de duplicar os campos nos dois arquivos — onde eles fatalmente sairiam do
 * ritmo um do outro — o formulário mora aqui e recebe do chamador só o que
 * varia: qual festa está selecionada, onde achar o registro e o que fazer
 * depois de salvar.
 *
 * O site público carrega este módulo sob demanda (import dinâmico), então
 * quem só quer ver o cardápio não baixa nada disto.
 */
import { supabase } from './supabase-config.js';

const BUCKET = 'festa';
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const shortTime = (value) => value ? String(value).slice(0, 5) : '';

// Tabelas cujo conteúdo pertence a uma festa específica.
export const ESCOPADAS = new Set(['produtos', 'sorteios', 'cronograma', 'candidatas', 'avisos']);
export const SEM_PERMISSAO = 'Nada foi gravado. Sua conta está fora da allowlist de organizadores — peça para incluírem seu usuário na tabela private.organizadores pelo SQL Editor.';
const SEM_LINHA = 'Nada foi gravado: este registro não existe mais. Alguém pode tê-lo excluído. Atualize a página.';

// Traduz os erros mais comuns do PostgREST para algo acionável no meio da festa.
export function describeError(error) {
  const code = error?.code || '';
  if (code === 'PGRST204' || code === '42703') return `${error.message} — o banco está sem as migrations mais recentes. Rode os arquivos de supabase/migrations no SQL Editor.`;
  if (code === '42P01' || code === 'PGRST205') return `${error.message} — tabela ausente. Rode as migrations no SQL Editor.`;
  if (code === '42501' || code === 'PGRST301') return SEM_PERMISSAO;
  return error?.message || 'Erro desconhecido.';
}

export async function souOrganizador() {
  const { data, error } = await supabase.rpc('sou_organizador');
  // Função ausente = banco desatualizado. Devolve null: quem chamou decide.
  return error ? null : data === true;
}

function montarForms(ctx) {
  return {
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
    eventos: {
      titulo: 'festa',
      padrao: { ativo: 'true' },
      campos: [
        { name: 'slug', label: 'Endereço da festa', type: 'text', required: true, maxlength: 40, hint: 'Vira a URL pública: /casavequia. Só minúsculas, números e hífen.' },
        { name: 'nome', label: 'Nome da festa', type: 'text', required: true, maxlength: 80, hint: 'Ex.: Festa Cultural 2026' },
        { name: 'escola', label: 'Escola', type: 'text', maxlength: 120, hint: 'Aparece embaixo do logo, para não confundir as festas.' },
        { name: 'data_evento', label: 'Data da festa', type: 'date' },
        { name: 'logo_url', label: 'Logo desta festa', type: 'image' },
        { name: 'pix_chave', label: 'Chave PIX', type: 'text', maxlength: 140 },
        { name: 'pix_favorecido', label: 'Favorecido do PIX', type: 'text', maxlength: 140 },
        { name: 'pix_banco', label: 'Instituição', type: 'text', maxlength: 120 },
        { name: 'pix_qr_url', label: 'QR Code do PIX', type: 'image' },
        { name: 'whatsapp', label: 'WhatsApp da organização', type: 'text', maxlength: 20, hint: 'Só números, com DDI e DDD. Ex.: 5568999999999' },
        { name: 'ativo', label: 'Aparece na lista de festas', type: 'boolean' },
      ],
    },
    cronograma: {
      titulo: 'evento do cronograma',
      padrao: { status: 'pendente' },
      campos: [
        { name: 'evento', label: 'Evento', type: 'text', required: true, maxlength: 120 },
        { name: 'horario_previsto', label: 'Horário previsto', type: 'time', required: true },
        { name: 'status', label: 'Situação', type: 'select', options: [['pendente', 'Pendente'], ['realizado', 'Realizado']] },
        { name: 'sorteio_id', label: 'Sorteio ligado a este evento', type: 'select', options: () => [['', 'Nenhum'], ...ctx.getSorteios().map((draw) => [String(draw.id), `${draw.identificacao} — ${draw.premio}`])], hint: 'Se preenchido, o card ganha um atalho para acompanhar o sorteio.' },
      ],
    },
  };
}

const DIALOGO = `
  <form id="editor-form">
    <header class="editor-head">
      <h2 id="editor-title">Editar</h2>
      <button id="editor-close" class="text-button" type="button">Fechar</button>
    </header>
    <div id="editor-fields" class="editor-fields"></div>
    <p id="editor-feedback" class="feedback" role="alert"></p>
    <footer class="editor-actions">
      <button id="editor-delete" class="danger-button" type="button">Excluir</button>
      <button id="editor-save" class="primary-button" type="submit">Salvar alterações</button>
    </footer>
  </form>`;

/**
 * ctx = {
 *   getEventoId()  -> id da festa selecionada, ou null
 *   getRecord(table, id) -> o registro a editar
 *   getSorteios()  -> lista de sorteios da festa (para o select do cronograma)
 *   getOrganizador() -> true | false | null (resultado de sou_organizador)
 *   onSaved(table, id, gravado) -> chamado depois de salvar ou excluir
 * }
 */
export function createEditor(ctx) {
  const FORMS = montarForms(ctx);
  let atual = null;

  let dialogo = document.getElementById('editor');
  if (!dialogo) {
    dialogo = document.createElement('dialog');
    dialogo.id = 'editor';
    dialogo.className = 'editor-dialog';
    dialogo.setAttribute('aria-labelledby', 'editor-title');
    dialogo.innerHTML = DIALOGO;
    document.body.appendChild(dialogo);
  }

  const $d = (selector) => dialogo.querySelector(selector);
  const aviso = (mensagem, erro = false) => { const el = $d('#editor-feedback'); el.textContent = mensagem; el.classList.toggle('error', erro); };

  /*
   * Toda escrita passa por aqui.
   *
   * Um UPDATE ou DELETE barrado pelo RLS casa ZERO linhas e o PostgREST
   * responde 204 sem erro nenhum — foi por isso que o painel já disse "salvo"
   * com o banco intacto. Pedindo `.select('id')` de volta, uma escrita que não
   * gravou nada volta com lista vazia e vira erro de verdade na tela.
   */
  async function write(operation, table, { values, id } = {}) {
    // Sem isso um item novo nasceria órfão e não apareceria em festa nenhuma.
    if (operation === 'insert' && ESCOPADAS.has(table)) {
      const evento = ctx.getEventoId();
      if (!evento) throw new Error('Selecione uma festa antes de cadastrar. Se ainda não existe nenhuma, use "+ Nova festa".');
      values = { ...values, evento_id: evento };
    }
    const base = supabase.from(table);
    const query = operation === 'insert' ? base.insert(values)
      : operation === 'delete' ? base.delete().eq('id', id)
        : base.update(values).eq('id', id);
    const { data, error } = await query.select('id');
    if (error) throw new Error(describeError(error));
    if (!data?.length) throw new Error(ctx.getOrganizador() === false ? SEM_PERMISSAO : SEM_LINHA);
    return data;
  }

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
    if (field.type === 'boolean') {
      const marcado = value === 'false' ? 'false' : 'true';
      return `<label for="${id}">${escapeHtml(field.label)}<select id="${id}" name="${field.name}"><option value="true"${marcado === 'true' ? ' selected' : ''}>Sim</option><option value="false"${marcado === 'false' ? ' selected' : ''}>Não</option></select>${hint}</label>`;
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

  function open(table, id = null) {
    const form = FORMS[table];
    if (!form) return;
    const item = id ? ctx.getRecord(table, id) : { ...form.padrao };
    if (id && !item) return;
    atual = { table, id };
    $d('#editor-title').textContent = id ? `Editar ${form.titulo}` : `Novo ${form.titulo}`;
    $d('#editor-fields').innerHTML = form.campos.map((field) => fieldHtml(field, item)).join('');
    $d('#editor-delete').hidden = !id;
    aviso('');
    dialogo.showModal();
  }

  function close() { atual = null; dialogo.close(); }

  function collectValues(table) {
    const values = {};
    FORMS[table].campos.forEach((field) => {
      const element = $d(`#f-${field.name}`);
      if (!element) return;
      const raw = String(element.value ?? '').trim();
      if (raw === '') { values[field.name] = field.type === 'boolean' ? true : (field.emptyAs !== undefined ? field.emptyAs : null); return; }
      if (field.type === 'boolean') { values[field.name] = raw === 'true'; return; }
      if (field.type === 'number') { const parsed = Number(raw); values[field.name] = Number.isFinite(parsed) ? parsed : null; return; }
      // sorteio_id é um select de texto, mas a coluna é numérica.
      values[field.name] = field.name === 'sorteio_id' ? Number(raw) : raw;
    });
    return values;
  }

  async function submit(event) {
    event.preventDefault();
    if (!atual) return;
    const { table, id } = atual;
    const values = collectValues(table);
    // O banco recusa a promoção pela metade; avisamos antes de gastar a viagem.
    if (table === 'sorteios' && (values.cartelas_promo_qtd === null) !== (values.cartelas_promo_valor === null)) {
      aviso('Preencha a quantidade e o valor da promoção juntos, ou deixe os dois vazios.', true);
      return;
    }
    const salvar = $d('#editor-save');
    salvar.disabled = true;
    aviso('Salvando...');
    let gravado;
    try {
      gravado = await write(id ? 'update' : 'insert', table, { values, id });
    } catch (error) {
      aviso(error.message, true);
      return;
    } finally {
      salvar.disabled = false;
    }
    close();
    await ctx.onSaved(table, id, gravado);
  }

  async function remove() {
    if (!atual?.id) return;
    const { table, id } = atual;
    if (!window.confirm('Excluir este registro? Essa ação não pode ser desfeita.')) return;
    try {
      await write('delete', table, { id });
    } catch (error) {
      aviso(error.message, true);
      return;
    }
    close();
    await ctx.onSaved(table, null, null, 'delete');
  }

  /* --- imagens (bucket `festa`, leitura pública) --------------------- */
  function setImage(fieldName, url) {
    const input = $d(`#f-${fieldName}`);
    if (input) input.value = url;
    const preview = $d(`[data-preview="${fieldName}"]`);
    if (preview) preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="Pré-visualização" />` : '<span>Sem foto</span>';
  }

  async function uploadImage(input) {
    const fieldName = input.dataset.upload;
    const file = input.files?.[0];
    const note = $d(`[data-upload-feedback="${fieldName}"]`);
    if (!file) return;
    const setNote = (message, isError = false) => { if (note) { note.textContent = message; note.classList.toggle('error', isError); } };
    if (!file.type.startsWith('image/')) { setNote('Escolha um arquivo de imagem.', true); input.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { setNote('A foto tem mais de 5 MB. Reduza antes de enviar.', true); input.value = ''; return; }
    setNote('Enviando foto...');
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${atual?.table || 'geral'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '3600' });
    input.value = '';
    if (error) { setNote(`Não foi possível enviar: ${error.message}`, true); return; }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    setImage(fieldName, data.publicUrl);
    setNote('Foto enviada e já aplicada. Salve para publicar.');
  }

  /* --- ligações, todas presas ao diálogo ----------------------------- */
  $d('#editor-form').addEventListener('submit', submit);
  $d('#editor-close').addEventListener('click', close);
  $d('#editor-delete').addEventListener('click', remove);
  dialogo.addEventListener('close', () => { atual = null; });
  // Clique no fundo escuro fecha: o <dialog> recebe o clique quando é fora do formulário.
  dialogo.addEventListener('click', (event) => { if (event.target === dialogo) close(); });
  dialogo.addEventListener('change', (event) => { if (event.target.dataset?.upload) uploadImage(event.target); });
  dialogo.addEventListener('click', (event) => {
    const limpar = event.target.closest('[data-clear-image]');
    if (limpar) setImage(limpar.dataset.clearImage, '');
  });

  return { open, close, write, forms: FORMS };
}
