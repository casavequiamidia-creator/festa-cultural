/*
 * Página da equipe da escola: /<festa>/funcionarios
 *
 * Planejamento interno, não é tela de visitante: escolher o modelo da farda,
 * cada um informar tamanho e nome nas costas, e acompanhar a contribuição.
 *
 * O funcionário não tem conta. Ele se identifica pelo nome completo e recebe
 * um token opaco, guardado no localStorage deste aparelho — é esse token que
 * autoriza o voto e a farda dele, através das funções do banco. Marcar "pago"
 * continua sendo só do organizador, pelo painel.
 */
import { supabase } from './supabase-config.js';

const state = {
  evento: null,
  modelos: [],
  funcionarios: [],
  votos: [],
  eu: null,
  aba: 'fardas',
  aberto: { votacao: true, farda: false },
  exigeCodigo: false,
  canal: null,
};

const POLL = 25000;
let pollTimer = null;

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const formatMoney = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// Data montada na mão: `new Date('2026-06-24')` seria lida como UTC e viraria o dia anterior no Brasil.
const formatDate = (value) => { if (!value) return ''; const [, month, day] = String(value).slice(0, 10).split('-').map(Number); return MONTHS[month - 1] ? `${day} de ${MONTHS[month - 1]}` : ''; };
const emptyState = (message) => `<div class="empty-state"><span>✦</span><p>${escapeHtml(message)}</p></div>`;

const CARGOS = [
  ['gestao', 'Gestão'],
  ['professores', 'Professores'],
  ['aee', 'AEE'],
  ['administrativo', 'Administrativo'],
  ['transporte', 'Transporte'],
  ['apoio', 'Apoio'],
];
const cargoLabel = (valor) => (CARGOS.find(([chave]) => chave === valor) || [, 'Apoio'])[1];
const cargoOrdem = (valor) => { const posicao = CARGOS.findIndex(([chave]) => chave === valor); return posicao < 0 ? CARGOS.length : posicao; };

const TAMANHOS = ['P', 'M', 'G', 'GG'];
const GOLAS = [['polo', 'Gola polo'], ['t-shirt', 'T-shirt']];
const CORTES = [['masculino', 'Masculino'], ['feminino', 'Feminino']];
// Espelha a constraint do banco: um nome e, no máximo, uma inicial.
const NOME_COSTAS = /^[\p{L}'.-]{2,20}( \p{L}\.?)?$/u;

const TEXTO_CONTRIBUICAO_PADRAO = 'A lista abaixo é dos funcionários que atuam na escola e do valor com que cada um contribui para a realização da Festa Cultural. Pague pelo PIX e a organização confirma o recebimento aqui mesmo.';

/* ------------------------------------------------------------------ *
 * Qual festa é esta
 * ------------------------------------------------------------------ */
function slugDaUrl() {
  // `?evento=` existe para rodar em servidor local, que não tem o rewrite da
  // Vercel. Em produção quem manda é o primeiro trecho do caminho.
  const daQuery = new URLSearchParams(location.search).get('evento');
  const doCaminho = location.pathname.split('/').filter(Boolean)[0] || '';
  const escolhido = (daQuery || (doCaminho === 'funcionarios' ? '' : doCaminho)).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,40}$/.test(escolhido) ? escolhido : '';
}

const chaveLocal = () => `festa-cultural:equipe:${state.evento?.slug || slugDaUrl()}`;
function carregarEu() { try { const bruto = JSON.parse(localStorage.getItem(chaveLocal()) || 'null'); return bruto?.token ? bruto : null; } catch { return null; } }
function guardarEu(eu) { try { localStorage.setItem(chaveLocal(), JSON.stringify(eu)); } catch { /* aba anônima: vale só nesta visita */ } }

function setStatus(mensagem, tom = '') { const el = $('#equipe-status'); el.textContent = mensagem; el.className = `network-status equipe-status ${tom}`; }
function mostrarErro(mensagem) { const el = $('#equipe-erro'); el.hidden = !mensagem; el.textContent = mensagem || ''; }

// O PostgREST devolve a mensagem do `raise exception` em `message`.
const mensagemDeErro = (error) => error?.message || 'Não foi possível concluir. Tente de novo.';

/* ------------------------------------------------------------------ *
 * Prazos
 *
 * A data é o ÚLTIMO dia válido — o prazo só vence quando o dia seguinte
 * começa. O banco usa o mesmo corte no horário de Brasília; aqui vale o
 * relógio do aparelho, que é o que a pessoa vê na tela.
 * ------------------------------------------------------------------ */
function hojeISO() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
}
const prazoEncerrado = (data) => Boolean(data) && hojeISO() > String(data).slice(0, 10);

function selo(pago) {
  return pago
    ? '<span class="pgto-selo is-pago">Pago</span>'
    : '<span class="pgto-selo is-devendo">A pagar</span>';
}

/* ------------------------------------------------------------------ *
 * Modelo da farda: votos e vencedor
 * ------------------------------------------------------------------ */
const votantesDoModelo = (modeloId) => state.votos
  .filter((voto) => Number(voto.modelo_id) === Number(modeloId))
  .map((voto) => state.funcionarios.find((pessoa) => Number(pessoa.id) === Number(voto.funcionario_id)))
  .filter(Boolean)
  .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

const meuVoto = () => (state.eu ? state.votos.find((voto) => Number(voto.funcionario_id) === Number(state.eu.id)) : null);

// Vale a escolha manual da organização; sem ela, o mais votado depois do prazo.
// Empate fica com o modelo cadastrado primeiro.
function modeloEscolhido() {
  const definido = state.modelos.find((modelo) => Number(modelo.id) === Number(state.evento?.farda_modelo_id));
  if (definido) return definido;
  if (!prazoEncerrado(state.evento?.farda_votacao_ate)) return null;
  const ranking = state.modelos
    .map((modelo) => ({ modelo, votos: votantesDoModelo(modelo.id).length }))
    .sort((a, b) => b.votos - a.votos || a.modelo.id - b.modelo.id);
  return ranking[0]?.votos > 0 ? ranking[0].modelo : null;
}

function renderImagem(url, alt, classe) {
  return url
    ? `<img class="${classe}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`
    : `<div class="${classe} image-placeholder" role="img" aria-label="Sem foto de ${escapeHtml(alt)}"></div>`;
}

/* ------------------------------------------------------------------ *
 * Tela inicial: o modelo já escolhido
 * ------------------------------------------------------------------ */
function renderDestaque() {
  const bloco = $('#equipe-destaque');
  const modelo = modeloEscolhido();
  if (!modelo) { bloco.hidden = true; bloco.innerHTML = ''; return; }
  const eu = meuCadastro();
  // Tem tamanho, tem farda definida — não importa se quem preencheu foi a
  // pessoa, no celular, ou a organização, pelo painel.
  const jaPreencheu = Boolean(eu?.farda_tamanho);
  bloco.hidden = false;
  bloco.innerHTML = `<p class="section-label">Modelo escolhido</p>
    <h2>${escapeHtml(modelo.nome)}</h2>
    ${renderImagem(modelo.imagem_url, modelo.nome, 'destaque-foto')}
    ${modelo.descricao ? `<p class="destaque-nota">${escapeHtml(modelo.descricao)}</p>` : ''}
    <button class="primary-button" type="button" data-abrir-farda>${jaPreencheu ? 'Revisar seus dados' : 'Preencha seus dados'} <span aria-hidden="true">→</span></button>`;
}

/* ------------------------------------------------------------------ *
 * Aba Fardas
 * ------------------------------------------------------------------ */
function blocoTitulo(chave, titulo, subtitulo) {
  const aberto = state.aberto[chave];
  return `<button class="equipe-bloco-topo" type="button" data-bloco="${chave}" aria-expanded="${aberto}">
    <span><strong>${titulo}</strong>${subtitulo ? `<small>${subtitulo}</small>` : ''}</span>
    <span class="equipe-bloco-seta" aria-hidden="true">${aberto ? '−' : '+'}</span>
  </button>`;
}

function cardDoModelo(modelo, encerrada) {
  const votantes = votantesDoModelo(modelo.id);
  const meu = meuVoto();
  const eMeuVoto = meu && Number(meu.modelo_id) === Number(modelo.id);
  const nomes = votantes.length
    ? `<ul class="voto-nomes">${votantes.map((pessoa) => `<li${state.eu && Number(pessoa.id) === Number(state.eu.id) ? ' class="sou-eu"' : ''}>${escapeHtml(pessoa.nome)}</li>`).join('')}</ul>`
    : '<p class="voto-vazio">Ninguém votou neste modelo ainda.</p>';
  return `<article class="modelo-card${eMeuVoto ? ' is-meu' : ''}">
    <div class="modelo-media">
      ${renderImagem(modelo.imagem_url, modelo.nome, 'modelo-foto')}
      <span class="modelo-votos" title="${votantes.length} ${votantes.length === 1 ? 'voto' : 'votos'}">${votantes.length} ${votantes.length === 1 ? 'voto' : 'votos'}</span>
    </div>
    <div class="modelo-corpo">
      <h3>${escapeHtml(modelo.nome)}</h3>
      ${modelo.descricao ? `<p>${escapeHtml(modelo.descricao)}</p>` : ''}
      ${encerrada
        ? ''
        : `<button class="${eMeuVoto ? 'secondary-button is-votado' : 'primary-button'}" type="button" data-votar="${modelo.id}">${eMeuVoto ? '✓ Seu voto está aqui' : 'Votar neste modelo'}</button>`}
      ${nomes}
    </div>
  </article>`;
}

function renderVotacao() {
  const alvo = $('#fardas-votacao');
  const encerrada = prazoEncerrado(state.evento?.farda_votacao_ate);
  const prazo = state.evento?.farda_votacao_ate;
  const subtitulo = encerrada
    ? 'Votação encerrada'
    : (prazo ? `Vote até ${escapeHtml(formatDate(prazo))}` : 'Sem prazo definido');
  const vencedor = modeloEscolhido();
  const corpo = state.modelos.length
    ? `${encerrada && vencedor ? `<p class="equipe-aviso">Votação encerrada. O modelo escolhido foi <b>${escapeHtml(vencedor.nome)}</b>.</p>` : ''}
       ${encerrada && !vencedor ? '<p class="equipe-aviso">A votação encerrou sem nenhum voto registrado. A organização vai definir o modelo.</p>' : ''}
       <div class="modelo-grade">${state.modelos.map((modelo) => cardDoModelo(modelo, encerrada)).join('')}</div>`
    : emptyState('A organização ainda não cadastrou os modelos de farda.');
  alvo.innerHTML = `<section class="equipe-bloco">
    ${blocoTitulo('votacao', 'Votar no modelo', subtitulo)}
    <div class="equipe-bloco-corpo"${state.aberto.votacao ? '' : ' hidden'}>
      <p id="voto-feedback" class="feedback" role="status" aria-live="polite"></p>
      ${corpo}
    </div>
  </section>`;
}

// "P | 50 | 70" por linha. Sem tabela publicada a página diz isso, em vez de
// exibir medida inventada — é por ela que a pessoa escolhe o tamanho.
function medidas() {
  return String(state.evento?.farda_medidas || '')
    .split('\n')
    .map((linha) => linha.split('|').map((parte) => parte.trim()))
    .filter((partes) => partes.length >= 3 && partes[0])
    .map(([tamanho, largura, altura]) => ({ tamanho, largura, altura }));
}

function tabelaDeMedidas() {
  const linhas = medidas();
  if (!linhas.length) return '<p class="medidas-vazia">A organização ainda não publicou a tabela de medidas. Confirme o tamanho com a coordenação antes de escolher.</p>';
  return `<div class="medidas-caixa">
    <span class="cartela-label">Medidas da camisa</span>
    <table class="medidas-tabela">
      <thead><tr><th>Tamanho</th><th>Largura</th><th>Altura</th></tr></thead>
      <tbody>${linhas.map((linha) => `<tr><th scope="row">${escapeHtml(linha.tamanho)}</th><td>${escapeHtml(linha.largura)} cm</td><td>${escapeHtml(linha.altura)} cm</td></tr>`).join('')}</tbody>
    </table>
  </div>`;
}

const meuCadastro = () => (state.eu ? state.funcionarios.find((pessoa) => Number(pessoa.id) === Number(state.eu.id)) || null : null);

function escolhas(nome, opcoes, atual) {
  return `<div class="escolha-linha" role="group" aria-label="${escapeHtml(nome)}">${opcoes.map(([valor, rotulo]) => `<button class="escolha${String(atual) === String(valor) ? ' is-ativa' : ''}" type="button" data-campo="${nome}" data-valor="${escapeHtml(valor)}" aria-pressed="${String(atual) === String(valor)}">${escapeHtml(rotulo)}</button>`).join('')}</div>`;
}

// Rascunho do formulário: o que a pessoa clicou antes de salvar. Começa no que
// já está gravado, para "revisar" não apagar o que ela escolheu semana passada.
let rascunho = null;
function iniciarRascunho() {
  const eu = meuCadastro();
  rascunho = {
    farda_nome: eu?.farda_nome || '',
    farda_gola: eu?.farda_gola || '',
    farda_corte: eu?.farda_corte || '',
    farda_tamanho: eu?.farda_tamanho || '',
    farda_baby_look: eu?.farda_baby_look === true,
  };
}

function renderMinhaFarda() {
  const alvo = $('#fardas-minha');
  if (!rascunho) iniciarRascunho();
  const eu = meuCadastro();
  const subtitulo = eu?.farda_tamanho
    ? escapeHtml(resumoFarda(eu))
    : 'Você ainda não informou os seus dados';
  alvo.innerHTML = `<section class="equipe-bloco">
    ${blocoTitulo('farda', 'Informações da sua farda', subtitulo)}
    <div class="equipe-bloco-corpo" id="farda-form"${state.aberto.farda ? '' : ' hidden'}>
      <label class="campo" for="farda-nome">Nome nas costas
        <input id="farda-nome" type="text" maxlength="24" value="${escapeHtml(rascunho.farda_nome)}" placeholder="Ex.: Maria S." />
        <small class="field-hint">Só um nome e, se quiser, uma inicial. Deixe vazio para a camisa sair sem nome.</small>
      </label>
      <div class="campo"><span class="field-label">Gola</span>${escolhas('farda_gola', GOLAS, rascunho.farda_gola)}</div>
      <div class="campo"><span class="field-label">Modelo</span>${escolhas('farda_corte', CORTES, rascunho.farda_corte)}</div>
      <div class="campo">
        <span class="field-label">Tamanho</span>
        ${escolhas('farda_tamanho', TAMANHOS.map((tamanho) => [tamanho, tamanho]), rascunho.farda_tamanho)}
        ${tabelaDeMedidas()}
      </div>
      <div class="campo"><span class="field-label">Baby look</span>${escolhas('farda_baby_look', [['sim', 'Sim'], ['nao', 'Não']], rascunho.farda_baby_look ? 'sim' : 'nao')}</div>
      <button class="primary-button" type="button" id="salvar-farda">Salvar minha farda</button>
      <p id="farda-feedback" class="feedback" role="status" aria-live="polite"></p>
    </div>
  </section>`;
}

function resumoFarda(pessoa) {
  const partes = [];
  if (pessoa.farda_gola) partes.push((GOLAS.find(([valor]) => valor === pessoa.farda_gola) || [, pessoa.farda_gola])[1]);
  if (pessoa.farda_corte) partes.push((CORTES.find(([valor]) => valor === pessoa.farda_corte) || [, pessoa.farda_corte])[1]);
  if (pessoa.farda_tamanho) partes.push(`Tamanho ${pessoa.farda_tamanho}`);
  if (pessoa.farda_baby_look) partes.push('Baby look');
  if (pessoa.farda_nome) partes.push(`Costas: ${pessoa.farda_nome}`);
  return partes.join(' · ') || 'Sem dados';
}

function renderListaDeFardas() {
  const alvo = $('#fardas-lista');
  const preenchidas = state.funcionarios
    .filter((pessoa) => pessoa.farda_tamanho)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const prazo = state.evento?.farda_pagamento_ate;
  const pagas = preenchidas.filter((pessoa) => pessoa.farda_paga).length;
  alvo.innerHTML = `<section class="equipe-bloco is-aberto">
    <div class="equipe-bloco-topo is-fixo">
      <span><strong>Quem já preencheu</strong><small>${preenchidas.length} ${preenchidas.length === 1 ? 'pessoa' : 'pessoas'}${preenchidas.length ? ` · ${pagas} ${pagas === 1 ? 'pago' : 'pagos'}` : ''}</small></span>
    </div>
    <div class="equipe-bloco-corpo">
      ${prazo ? `<p class="equipe-aviso">Pagamento da farda até <b>${escapeHtml(formatDate(prazo))}</b>.${prazoEncerrado(prazo) ? ' <b>Prazo vencido.</b>' : ''}</p>` : ''}
      ${preenchidas.length
        ? `<ul class="equipe-lista">${preenchidas.map((pessoa) => `<li class="equipe-linha${state.eu && Number(pessoa.id) === Number(state.eu.id) ? ' sou-eu' : ''}">
            <div><strong>${escapeHtml(pessoa.nome)}</strong><small>${escapeHtml(resumoFarda(pessoa))}</small></div>
            ${selo(pessoa.farda_paga)}
          </li>`).join('')}</ul>`
        : emptyState('Ninguém preencheu os dados da farda ainda. Seja a primeira pessoa.')}
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ *
 * Aba Contribuição
 * ------------------------------------------------------------------ */
function renderContribuicaoTopo() {
  const evento = state.evento || {};
  const prazo = evento.contribuicao_ate;
  const temPix = Boolean(evento.pix_chave);
  $('#contribuicao-topo').innerHTML = `<section class="equipe-bloco is-aberto">
    <div class="equipe-bloco-corpo">
      <p class="equipe-texto">${escapeHtml(evento.contribuicao_texto || TEXTO_CONTRIBUICAO_PADRAO)}</p>
      ${prazo ? `<p class="equipe-aviso">Prazo para pagar: <b>${escapeHtml(formatDate(prazo))}</b>.${prazoEncerrado(prazo) ? ' <b>Prazo vencido.</b>' : ''}</p>` : ''}
      ${temPix
        ? `<button class="primary-button" type="button" id="copiar-pix">Copiar a chave PIX <span aria-hidden="true">⧉</span></button>`
        : '<p class="medidas-vazia">A organização ainda não cadastrou a chave PIX desta festa.</p>'}
      <p id="pix-feedback" class="feedback" role="status" aria-live="polite"></p>
    </div>
  </section>`;
}

function renderContribuicaoLista() {
  const pessoas = [...state.funcionarios].sort((a, b) => cargoOrdem(a.cargo) - cargoOrdem(b.cargo) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const pagas = pessoas.filter((pessoa) => pessoa.contribuicao_paga).length;
  $('#contribuicao-lista').innerHTML = `<section class="equipe-bloco is-aberto">
    <div class="equipe-bloco-topo is-fixo">
      <span><strong>Funcionários da escola</strong><small>${pessoas.length} ${pessoas.length === 1 ? 'pessoa' : 'pessoas'}${pessoas.length ? ` · ${pagas} ${pagas === 1 ? 'pagou' : 'pagaram'}` : ''}</small></span>
    </div>
    <div class="equipe-bloco-corpo">
      ${pessoas.length
        ? `<ul class="equipe-lista">${pessoas.map((pessoa) => `<li class="equipe-linha${state.eu && Number(pessoa.id) === Number(state.eu.id) ? ' sou-eu' : ''}">
            <div><strong>${escapeHtml(pessoa.nome)}</strong><small><span class="cargo-chip">${escapeHtml(cargoLabel(pessoa.cargo))}</span>${pessoa.contribuicao_valor != null ? ` ${formatMoney(pessoa.contribuicao_valor)}` : ' Valor a definir'}</small></div>
            ${selo(pessoa.contribuicao_paga)}
          </li>`).join('')}</ul>`
        : emptyState('Ninguém se cadastrou ainda. Assim que a equipe entrar, os nomes aparecem aqui.')}
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ *
 * Render geral
 * ------------------------------------------------------------------ */
function renderTudo() {
  if (!state.eu) return;
  renderDestaque();
  renderVotacao();
  // Não redesenha o formulário enquanto a pessoa está mexendo nele: o voto de
  // um colega chegando pelo Realtime tiraria o foco no meio da digitação.
  if (!$('#farda-form')?.contains(document.activeElement)) renderMinhaFarda();
  renderListaDeFardas();
  renderContribuicaoTopo();
  renderContribuicaoLista();
}

function trocarAba(aba) {
  state.aba = aba;
  document.querySelectorAll('[data-equipe-tab]').forEach((botao) => {
    const ativa = botao.dataset.equipeTab === aba;
    botao.classList.toggle('is-active', ativa);
    botao.setAttribute('aria-selected', String(ativa));
  });
  $('#painel-fardas').hidden = aba !== 'fardas';
  $('#painel-contribuicao').hidden = aba !== 'contribuicao';
}

/* ------------------------------------------------------------------ *
 * Dados
 * ------------------------------------------------------------------ */
async function carregarTudo() {
  const evento = state.evento.id;
  const [modelos, funcionarios, votos, atualizado] = await Promise.all([
    supabase.from('farda_modelos').select('*').eq('evento_id', evento).order('id'),
    supabase.from('funcionarios').select('*').eq('evento_id', evento).order('nome'),
    supabase.from('farda_votos').select('*').eq('evento_id', evento),
    supabase.from('eventos').select('*').eq('id', evento).maybeSingle(),
  ]);
  const erro = [modelos, funcionarios, votos, atualizado].find((resposta) => resposta.error)?.error;
  if (erro) {
    setStatus('Não foi possível atualizar agora. Tentando de novo...', 'offline');
    mostrarErro(`${mensagemDeErro(erro)} — se a mensagem falar em tabela ou coluna ausente, rode as migrations de supabase/migrations no SQL Editor.`);
    return;
  }
  mostrarErro('');
  state.modelos = modelos.data || [];
  state.funcionarios = funcionarios.data || [];
  state.votos = votos.data || [];
  if (atualizado.data) state.evento = atualizado.data;

  // Cadastro apagado pela organização: o token no celular não vale mais.
  if (state.eu && !meuCadastro()) {
    state.eu = null;
    try { localStorage.removeItem(chaveLocal()); } catch { /* segue */ }
    abrirPortao('O seu cadastro não está mais na lista. Identifique-se de novo.');
    return;
  }
  setStatus('Informações ao vivo', 'online');
  renderTudo();
}

function agendarPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(carregarTudo, POLL);
}

async function assinarRealtime() {
  if (state.canal) { await supabase.removeChannel(state.canal); state.canal = null; }
  const filtro = `evento_id=eq.${state.evento.id}`;
  const canal = supabase.channel(`equipe-${state.evento.slug}`);
  ['farda_modelos', 'funcionarios', 'farda_votos'].forEach((tabela) => {
    canal.on('postgres_changes', { event: '*', schema: 'public', table: tabela, filter: filtro }, carregarTudo);
  });
  canal.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'eventos', filter: `id=eq.${state.evento.id}` }, carregarTudo);
  canal.subscribe((status) => { if (status === 'SUBSCRIBED') carregarTudo(); });
  state.canal = canal;
  agendarPolling();
}

/* ------------------------------------------------------------------ *
 * Identificação
 * ------------------------------------------------------------------ */
function abrirPortao(mensagem = '') {
  $('#equipe-gate').hidden = false;
  $('#equipe-app').hidden = true;
  $('#equipe-codigo-campo').hidden = !state.exigeCodigo;
  const nota = $('#equipe-feedback');
  nota.textContent = mensagem;
  nota.classList.toggle('error', Boolean(mensagem));
  const eu = meuCadastro();
  if (eu) { $('#equipe-nome').value = eu.nome; $('#equipe-cargo').value = eu.cargo; }
}

function fecharPortao() {
  $('#equipe-gate').hidden = true;
  $('#equipe-app').hidden = false;
  $('#equipe-eu-nome').textContent = state.eu.nome;
}

async function entrar(event) {
  event.preventDefault();
  const botao = event.target.querySelector('button[type="submit"]');
  const nota = $('#equipe-feedback');
  nota.classList.remove('error');
  nota.textContent = 'Entrando...';
  botao.disabled = true;
  const { data, error } = await supabase.rpc('funcionario_entrar', {
    p_slug: state.evento.slug,
    p_nome: $('#equipe-nome').value,
    p_cargo: $('#equipe-cargo').value,
    p_codigo: $('#equipe-codigo').value || null,
    p_token: state.eu?.token || null,
  });
  botao.disabled = false;
  const registro = Array.isArray(data) ? data[0] : data;
  if (error || !registro) { nota.textContent = mensagemDeErro(error); nota.classList.add('error'); return; }
  nota.textContent = '';
  state.eu = { id: registro.id, token: registro.token, nome: registro.nome, cargo: registro.cargo };
  guardarEu(state.eu);
  rascunho = null;
  fecharPortao();
  await carregarTudo();
}

/* ------------------------------------------------------------------ *
 * Ações
 * ------------------------------------------------------------------ */
// A nota é buscada de novo depois do recarregamento: o bloco inteiro é
// redesenhado, e o elemento de antes já não está mais na tela.
function avisarEm(seletor, mensagem, erro = false) {
  const nota = $(seletor);
  if (!nota) return;
  nota.textContent = mensagem;
  nota.classList.toggle('error', erro);
}

async function votar(modeloId, botao) {
  botao.disabled = true;
  avisarEm('#voto-feedback', 'Registrando o seu voto...');
  const { error } = await supabase.rpc('funcionario_votar', { p_token: state.eu.token, p_modelo_id: Number(modeloId) });
  botao.disabled = false;
  if (error) { avisarEm('#voto-feedback', mensagemDeErro(error), true); return; }
  await carregarTudo();
  avisarEm('#voto-feedback', 'Voto registrado!');
}

async function salvarFarda(botao) {
  const avisar = (mensagem, erro = false) => avisarEm('#farda-feedback', mensagem, erro);
  rascunho.farda_nome = $('#farda-nome').value.trim().replace(/\s+/g, ' ');
  if (rascunho.farda_nome && !NOME_COSTAS.test(rascunho.farda_nome)) {
    avisar('No nome das costas cabe um nome e, no máximo, uma inicial. Ex.: Maria S.', true);
    return;
  }
  if (!rascunho.farda_gola || !rascunho.farda_corte || !rascunho.farda_tamanho) {
    avisar('Escolha a gola, o modelo e o tamanho antes de salvar.', true);
    return;
  }
  botao.disabled = true;
  avisar('Salvando...');
  const { error } = await supabase.rpc('funcionario_salvar_farda', {
    p_token: state.eu.token,
    p_nome: rascunho.farda_nome || null,
    p_gola: rascunho.farda_gola,
    p_corte: rascunho.farda_corte,
    p_tamanho: rascunho.farda_tamanho,
    p_baby_look: rascunho.farda_baby_look,
  });
  botao.disabled = false;
  if (error) { avisar(mensagemDeErro(error), true); return; }
  await carregarTudo();
  avisarEm('#farda-feedback', 'Pronto! Os seus dados entraram na lista.');
}

async function copiarPix() {
  const nota = $('#pix-feedback');
  const evento = state.evento || {};
  const confira = `Confira — Banco: ${evento.pix_banco || 'não informado'} · Beneficiário: ${evento.pix_favorecido || 'não informado'}.`;
  try {
    await navigator.clipboard.writeText(evento.pix_chave);
    nota.classList.remove('error');
    nota.textContent = `Chave PIX copiada. ${confira}`;
  } catch {
    nota.classList.add('error');
    nota.textContent = `Não deu para copiar sozinho. A chave é ${evento.pix_chave}. ${confira}`;
  }
}

/* ------------------------------------------------------------------ *
 * Ligações
 * ------------------------------------------------------------------ */
$('#equipe-form').addEventListener('submit', entrar);
$('#equipe-trocar').addEventListener('click', () => abrirPortao());

document.addEventListener('click', (event) => {
  const aba = event.target.closest('[data-equipe-tab]');
  if (aba) { trocarAba(aba.dataset.equipeTab); return; }

  const bloco = event.target.closest('[data-bloco]');
  if (bloco) { const chave = bloco.dataset.bloco; state.aberto[chave] = !state.aberto[chave]; renderTudo(); return; }

  const votarEm = event.target.closest('[data-votar]');
  if (votarEm) { votar(votarEm.dataset.votar, votarEm); return; }

  if (event.target.closest('[data-abrir-farda]')) {
    trocarAba('fardas');
    state.aberto.farda = true;
    renderTudo();
    $('#fardas-minha').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const escolha = event.target.closest('.escolha');
  if (escolha) {
    const { campo, valor } = escolha.dataset;
    rascunho[campo] = campo === 'farda_baby_look' ? valor === 'sim' : valor;
    // Só o formulário muda: redesenhar tudo tiraria o foco de quem está digitando.
    renderMinhaFarda();
    $(`.escolha[data-campo="${campo}"][data-valor="${valor}"]`)?.focus();
    return;
  }

  if (event.target.closest('#salvar-farda')) { salvarFarda(event.target.closest('#salvar-farda')); return; }
  if (event.target.closest('#copiar-pix')) { copiarPix(); }
});

// O nome das costas é digitado; guarda a cada tecla para não se perder quando
// um clique em "Tamanho G" redesenha o formulário.
document.addEventListener('input', (event) => {
  if (event.target.id === 'farda-nome' && rascunho) rascunho.farda_nome = event.target.value;
});

document.addEventListener('visibilitychange', () => { if (!document.hidden && state.evento) carregarTudo(); });
window.addEventListener('online', () => { if (state.evento) carregarTudo(); });

/* ------------------------------------------------------------------ *
 * Início
 * ------------------------------------------------------------------ */
async function iniciar() {
  const slug = slugDaUrl();
  if (!slug) {
    setStatus('Endereço incompleto', 'offline');
    mostrarErro('Abra esta página pelo endereço da sua festa, no formato /nome-da-festa/funcionarios.');
    return;
  }
  const { data: evento, error } = await supabase.from('eventos').select('*').eq('slug', slug).maybeSingle();
  if (error || !evento) {
    setStatus('Festa não encontrada', 'offline');
    mostrarErro(`Não existe festa no endereço /${slug}. Confira o endereço com a organização.`);
    return;
  }
  state.evento = evento;
  document.title = `Equipe | ${evento.nome}${evento.escola ? ` — ${evento.escola}` : ''}`;
  if (evento.logo_url) $('#brand-picture').outerHTML = `<img class="brand-logo" src="${escapeHtml(evento.logo_url)}" alt="${escapeHtml(evento.nome)}" />`;
  if (evento.escola) $('#equipe-escola').textContent = evento.escola;
  $('#brand-link').href = `/${evento.slug}`;
  $('#equipe-voltar').href = `/${evento.slug}`;

  const { data: exige } = await supabase.rpc('equipe_exige_codigo', { p_slug: evento.slug });
  state.exigeCodigo = exige === true;
  $('#equipe-codigo').required = state.exigeCodigo;

  state.eu = carregarEu();
  setStatus('Carregando...', 'loading');
  await carregarTudo();
  if (state.eu) fecharPortao(); else abrirPortao();
  assinarRealtime();
}

iniciar();
