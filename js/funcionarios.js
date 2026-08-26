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
  tecidos: [],
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
const cargoLabel = (valor) => (CARGOS.find(([chave]) => chave === valor) || [, 'Setor a definir'])[1];
// Zero é isenção declarada pela organização; nulo é valor que ninguém definiu.
const isento = (pessoa) => pessoa.contribuicao_valor !== null && Number(pessoa.contribuicao_valor) === 0;

const GOLAS = [['polo', 'Gola polo'], ['t-shirt', 'T-shirt']];
const CORTES = [['feminino', 'Feminino'], ['masculino', 'Masculino']];

// Grade da confecção, igual em toda escola — por isso mora aqui, e não num
// campo por festa. O sufixo BL da grade feminina é o que diz à confecção que
// o molde é baby look; por isso os dois conjuntos não se misturam.
const GRADES = {
  feminino: {
    rotulo: 'Grade feminina',
    // Caminho absoluto: a página mora em /<festa>/funcionarios, e um caminho
    // relativo procuraria a imagem dentro da pasta da festa.
    desenho: { url: '/assets/tecidos/medidas-femininas.png', largura: 560, altura: 597 },
    linhas: [['PPBL', 43, 52], ['PBL', 45, 57], ['MBL', 48, 62], ['GBL', 52, 69], ['GGBL', 54, 75], ['XGBL', 60, 80], ['XGGBL', 64, 85]],
  },
  masculino: {
    rotulo: 'Grade masculina',
    desenho: { url: '/assets/tecidos/medidas-masculinas.png', largura: 560, altura: 587 },
    linhas: [['PP', 45, 64], ['P', 47, 66], ['M', 52, 71], ['G', 55, 74], ['GG', 59, 76], ['XG', 61, 80], ['XGG', 65, 83]],
  },
};
const NOTA_GRADE = 'Os tamanhos podem variar até 1 cm. As medidas são de peças sublimadas — malha sem sublimar pode variar até 2 cm.';
// Os três maiores de cada grade custam mais tecido, e por isso pagam adicional.
const TAMANHOS_COM_ADICIONAL = new Set(['GG', 'XG', 'XGG', 'GGBL', 'XGBL', 'XGGBL']);
const naGrade = (corte, tamanho) => Boolean(GRADES[corte]?.linhas.some(([valor]) => valor === tamanho));

const adicionalPolo = () => Number(state.evento?.farda_adicional_polo ?? 0);
const adicionalTamanho = () => Number(state.evento?.farda_adicional_tamanho ?? 0);

// Serve tanto para o rascunho em edição quanto para uma farda já gravada: os
// dois carregam os mesmos campos. O valor é sempre recalculado, nunca guardado
// — se o preço do tecido mudar, a conta acompanha.
function valorDaFarda(escolha) {
  const tecido = tecidoPor(escolha?.farda_tecido_id);
  const itens = [];
  if (tecido) itens.push({ rotulo: tecido.nome, valor: Number(tecido.preco || 0) });
  if (escolha?.farda_gola === 'polo' && adicionalPolo() > 0) itens.push({ rotulo: 'Adicional gola polo', valor: adicionalPolo() });
  if (TAMANHOS_COM_ADICIONAL.has(escolha?.farda_tamanho) && adicionalTamanho() > 0) itens.push({ rotulo: `Adicional tamanho ${escolha.farda_tamanho}`, valor: adicionalTamanho() });
  return { itens, total: itens.reduce((soma, item) => soma + item.valor, 0) };
}
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

// Sem mensagem o indicador some. Repetir "está tudo certo" o tempo todo é
// ruído: ele só aparece enquanto carrega e quando algo dá errado.
function setStatus(mensagem, tom = '') {
  const el = $('#equipe-status');
  el.hidden = !mensagem;
  el.textContent = mensagem;
  el.className = `network-status equipe-status ${tom}`;
}
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

// Sem foto o espaço reservado diz por que está vazio. Um retângulo mudo
// parecia imagem quebrada, e quem abria a página achava que era erro.
// A arte pode ser arquivo do próprio site (/assets/...) ou um endereço do
// bucket. Qualquer outro esquema não vira link.
const linkDeImagem = (valor) => {
  const bruto = String(valor || '').trim();
  if (/^https?:\/\//i.test(bruto)) return bruto;
  return bruto.startsWith('/') && !bruto.startsWith('//') ? bruto : '';
};

function renderImagem(url, alt, classe, vazio = 'Foto ainda não enviada') {
  return url
    ? `<img class="${classe}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`
    : `<div class="${classe} image-placeholder" role="img" aria-label="Sem foto de ${escapeHtml(alt)}"><span>${escapeHtml(vazio)}</span></div>`;
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
    <button class="foto-quadro" type="button" data-modelo-foto="${modelo.id}" aria-label="Maximizar a arte de ${escapeHtml(modelo.nome)}">
      ${renderImagem(modelo.imagem_url, modelo.nome, 'destaque-foto')}
      <span class="modelo-ampliar" aria-hidden="true">Maximizar</span>
    </button>
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
      <button class="foto-quadro" type="button" data-modelo-foto="${modelo.id}" aria-label="Maximizar a arte de ${escapeHtml(modelo.nome)}">
        ${renderImagem(modelo.imagem_url, modelo.nome, 'modelo-foto')}
        <span class="modelo-ampliar" aria-hidden="true">Maximizar</span>
      </button>
    </div>
    <div class="modelo-corpo">
      <div class="modelo-titulo">
        <h3>${escapeHtml(modelo.nome)}</h3>
        <span class="modelo-votos${votantes.length ? ' tem-voto' : ''}">${votantes.length} ${votantes.length === 1 ? 'voto' : 'votos'}</span>
      </div>
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

// A tabela diz "48 cm de largura", mas largura medida de onde? O desenho da
// grade responde isso: a camisa deitada, com as duas setas nos lugares certos.
function desenhoDaMedicao(grade) {
  if (!grade.desenho) return '';
  const { url, largura, altura } = grade.desenho;
  return `<figure class="medidas-desenho">
        <img src="${escapeHtml(url)}" width="${largura}" height="${altura}" alt="Camisa deitada de frente: a seta da altura desce pela lateral esquerda e a da largura atravessa a barra." loading="lazy" />
        <figcaption>É assim que a confecção mede, com a camisa deitada: a <b>largura</b> atravessa a peça de uma lateral à outra, e a <b>altura</b> vai do ombro até a barra.</figcaption>
      </figure>`;
}

// Os tamanhos só aparecem depois do gênero: cada grade tem os seus, e a
// tabela ao lado é o que faz a pessoa acertar o tamanho sem provar a camisa.
function blocoDeTamanhos() {
  const grade = GRADES[rascunho.farda_corte];
  if (!grade) return '<p class="medidas-vazia">Escolha primeiro o modelo — feminino ou masculino — para ver os tamanhos e as medidas.</p>';
  return `${escolhas('farda_tamanho', grade.linhas.map(([tamanho]) => tamanhoComAdicional(tamanho)), rascunho.farda_tamanho)}
      <div class="medidas-caixa">
        <span class="cartela-label">${escapeHtml(grade.rotulo)}</span>
        ${desenhoDaMedicao(grade)}
        <table class="medidas-tabela">
          <thead><tr><th>Tamanho</th><th>Largura</th><th>Altura</th><th>Adicional</th></tr></thead>
          <tbody>${grade.linhas.map(([tamanho, largura, altura]) => `<tr${rascunho.farda_tamanho === tamanho ? ' class="is-escolhida"' : ''}><th scope="row">${tamanho}</th><td>${largura} cm</td><td>${altura} cm</td><td>${TAMANHOS_COM_ADICIONAL.has(tamanho) && adicionalTamanho() > 0 ? `+ ${formatMoney(adicionalTamanho())}` : '—'}</td></tr>`).join('')}</tbody>
        </table>
        <p class="medidas-nota">${NOTA_GRADE}</p>
      </div>`;
}

/* --- Tecidos ------------------------------------------------------- */
const tecidoPor = (id) => state.tecidos.find((tecido) => Number(tecido.id) === Number(id)) || null;

function blocoDeTecidos() {
  if (!state.tecidos.length) return '<p class="medidas-vazia">A organização ainda não cadastrou os tecidos.</p>';
  return `<div class="tecido-grade">${state.tecidos.map((tecido) => {
    const escolhido = Number(rascunho.farda_tecido_id) === Number(tecido.id);
    return `<article class="tecido-card${escolhido ? ' is-escolhido' : ''}">
      <button class="tecido-escolher" type="button" data-tecido="${tecido.id}" aria-pressed="${escolhido}">
        <span class="foto-quadro">${renderImagem(tecido.imagem_url, `tecido ${tecido.nome}`, 'tecido-foto')}</span>
        <span class="tecido-nome">${escapeHtml(tecido.nome)}</span>
        <span class="tecido-preco">${formatMoney(tecido.preco)}</span>
        ${tecido.resumo ? `<span class="tecido-resumo">${escapeHtml(tecido.resumo)}</span>` : ''}
      </button>
      <button class="tecido-detalhe" type="button" data-tecido-detalhe="${tecido.id}">Ver detalhes</button>
    </article>`;
  }).join('')}</div>`;
}

/* --- Visualizador com zoom ----------------------------------------- *
 * A arte é um 1080x1080 com as quatro vistas do modelo. No card ela não passa
 * de miniatura, e é por ela que a pessoa decide o voto — então precisa abrir
 * grande e deixar aproximar para conferir gola, manga e estampa.
 *
 * A pinça é tratada aqui, e não pelo navegador: dentro de um <dialog> o zoom
 * nativo amplia a página inteira e leva a pessoa para fora da imagem.
 * ------------------------------------------------------------------ */
const ESCALA_MAXIMA = 5;

function criarZoom(palco, foto) {
  let escala = 1;
  let x = 0;
  let y = 0;
  const ponteiros = new Map();
  let pinca = null;
  let ultimoToque = 0;

  const distanciaEntre = () => {
    const [a, b] = [...ponteiros.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function aplicar() {
    // Sem limite a imagem escaparia da moldura e a pessoa perderia a arte.
    const caixa = palco.getBoundingClientRect();
    const folgaX = Math.max(0, (caixa.width * escala - caixa.width) / 2);
    const folgaY = Math.max(0, (caixa.height * escala - caixa.height) / 2);
    x = Math.min(folgaX, Math.max(-folgaX, x));
    y = Math.min(folgaY, Math.max(-folgaY, y));
    foto.style.transform = `translate(${x}px, ${y}px) scale(${escala})`;
    palco.classList.toggle('is-ampliado', escala > 1.01);
    const rotulo = palco.parentElement?.querySelector('[data-zoom-nivel]');
    if (rotulo) rotulo.textContent = `${Math.round(escala * 100)}%`;
  }

  function definirEscala(nova) {
    escala = Math.min(ESCALA_MAXIMA, Math.max(1, nova));
    if (escala <= 1.001) { escala = 1; x = 0; y = 0; }
    aplicar();
  }

  palco.addEventListener('pointerdown', (evento) => {
    palco.setPointerCapture(evento.pointerId);
    ponteiros.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    palco.classList.add('is-arrastando');
    if (ponteiros.size === 2) pinca = { distancia: distanciaEntre(), escala };
  });

  palco.addEventListener('pointermove', (evento) => {
    const anterior = ponteiros.get(evento.pointerId);
    if (!anterior) return;
    ponteiros.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    if (ponteiros.size >= 2 && pinca) {
      definirEscala(pinca.escala * (distanciaEntre() / pinca.distancia));
      return;
    }
    // Um dedo só arrasta quando há o que arrastar.
    if (escala > 1) {
      x += evento.clientX - anterior.x;
      y += evento.clientY - anterior.y;
      aplicar();
    }
  });

  const soltar = (evento) => {
    ponteiros.delete(evento.pointerId);
    if (ponteiros.size < 2) pinca = null;
    if (!ponteiros.size) palco.classList.remove('is-arrastando');
  };
  palco.addEventListener('pointerup', (evento) => {
    // Dois toques seguidos alternam entre a arte inteira e 2,5x.
    const agora = Date.now();
    if (!ponteiros.size || ponteiros.size === 1) {
      if (agora - ultimoToque < 320) definirEscala(escala > 1 ? 1 : 2.5);
      ultimoToque = agora;
    }
    soltar(evento);
  });
  palco.addEventListener('pointercancel', soltar);

  // No computador, a roda do mouse faz o papel da pinça.
  palco.addEventListener('wheel', (evento) => {
    evento.preventDefault();
    definirEscala(escala * (evento.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });

  aplicar();
  return { definirEscala, get escala() { return escala; } };
}

let zoomAtual = null;

function abrirModelo(id) {
  const modelo = state.modelos.find((item) => Number(item.id) === Number(id));
  const dialogo = $('#modelo-modal');
  if (!modelo || !dialogo) return;
  const arte = linkDeImagem(modelo.imagem_url);
  dialogo.innerHTML = `<button class="profile-close" type="button" data-fechar-modelo aria-label="Fechar a arte do modelo">×</button>
    <figure class="modelo-lightbox">
      <div class="zoom-palco" id="zoom-palco">
        ${renderImagem(modelo.imagem_url, `arte do ${modelo.nome}`, 'zoom-foto')}
      </div>
      <figcaption>
        <strong id="modelo-nome">${escapeHtml(modelo.nome)}</strong>
        ${modelo.descricao ? `<span>${escapeHtml(modelo.descricao)}</span>` : ''}
        <div class="zoom-controles">
          <button type="button" data-zoom="menos" aria-label="Diminuir">−</button>
          <button type="button" data-zoom="reset" data-zoom-nivel>100%</button>
          <button type="button" data-zoom="mais" aria-label="Aumentar">+</button>
          ${arte ? `<a href="${escapeHtml(arte)}" target="_blank" rel="noopener">Abrir a imagem</a>` : ''}
        </div>
        <p class="zoom-dica">Aproxime com dois dedos, ou toque duas vezes na arte. Arraste para andar pela imagem.</p>
      </figcaption>
    </figure>`;
  if (!dialogo.open) dialogo.showModal();
  const palco = $('#zoom-palco');
  const foto = palco?.querySelector('img');
  zoomAtual = foto ? criarZoom(palco, foto) : null;
}

function abrirTecido(id) {
  const tecido = tecidoPor(id);
  const dialogo = $('#tecido-modal');
  if (!tecido || !dialogo) return;
  const itens = String(tecido.caracteristicas || '').split('\n').map((linha) => linha.trim()).filter(Boolean);
  dialogo.innerHTML = `<button class="profile-close" type="button" data-fechar-tecido aria-label="Fechar detalhes do tecido">×</button>
    <article class="tecido-modal-card">
      <div class="foto-quadro tecido-modal-quadro">${renderImagem(tecido.imagem_url, `tecido ${tecido.nome}`, 'tecido-modal-foto')}</div>
      <div class="tecido-modal-corpo">
        <p class="section-label">${escapeHtml(tecido.resumo || 'Tecido')}</p>
        <h2 id="tecido-nome">${escapeHtml(tecido.nome)}</h2>
        <p class="tecido-modal-preco">A partir de <strong>${formatMoney(tecido.preco)}</strong></p>
        ${tecido.descricao ? `<p class="tecido-modal-texto">${escapeHtml(tecido.descricao)}</p>` : ''}
        ${itens.length ? `<ul class="tecido-lista">${itens.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
        <button class="primary-button" type="button" data-tecido="${tecido.id}">Escolher este tecido</button>
      </div>
    </article>`;
  if (!dialogo.open) dialogo.showModal();
}

const meuCadastro = () => (state.eu ? state.funcionarios.find((pessoa) => Number(pessoa.id) === Number(state.eu.id)) || null : null);

function escolhas(nome, opcoes, atual) {
  return `<div class="escolha-linha" role="group" aria-label="${escapeHtml(nome)}">${opcoes.map(([valor, rotulo, extra]) => `<button class="escolha${String(atual) === String(valor) ? ' is-ativa' : ''}" type="button" data-campo="${nome}" data-valor="${escapeHtml(valor)}" aria-pressed="${String(atual) === String(valor)}">${escapeHtml(rotulo)}${extra ? `<small class="escolha-extra">${escapeHtml(extra)}</small>` : ''}</button>`).join('')}</div>`;
}

// O adicional aparece na própria opção: ninguém deveria descobrir os R$ 10,00
// da gola polo só depois de salvar.
const golasComAdicional = () => GOLAS.map(([valor, rotulo]) => [valor, rotulo, valor === 'polo' && adicionalPolo() > 0 ? `+ ${formatMoney(adicionalPolo())}` : '']);
const tamanhoComAdicional = (tamanho) => [tamanho, tamanho, TAMANHOS_COM_ADICIONAL.has(tamanho) && adicionalTamanho() > 0 ? `+ ${formatMoney(adicionalTamanho())}` : ''];

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
    farda_tecido_id: eu?.farda_tecido_id || '',
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
      <label class="campo campo-nome-costas" for="farda-nome">Nome nas costas
        <input id="farda-nome" type="text" maxlength="24" value="${escapeHtml(rascunho.farda_nome)}" placeholder="Ex.: Maria S." />
        <small class="field-hint">Só um nome e, se quiser, uma inicial. Deixe vazio para a camisa sair sem nome.</small>
      </label>
      <div class="campo">
        <span class="field-label">Tecido</span>
        <small class="field-hint">Toque em <b>Ver detalhes</b> para a foto ampliada e as características de cada malha.</small>
        ${blocoDeTecidos()}
      </div>
      <div class="campo"><span class="field-label">Gola</span>${escolhas('farda_gola', golasComAdicional(), rascunho.farda_gola)}</div>
      <div class="campo">
        <span class="field-label">Modelo</span>
        <small class="field-hint">A grade de tamanhos muda conforme a escolha.</small>
        ${escolhas('farda_corte', CORTES, rascunho.farda_corte)}
      </div>
      <div class="campo">
        <span class="field-label">Tamanho</span>
        ${blocoDeTamanhos()}
      </div>
      ${blocoDoValor()}
      <button class="primary-button" type="button" id="salvar-farda">Salvar minha farda</button>
      <p id="farda-feedback" class="feedback" role="status" aria-live="polite"></p>
    </div>
  </section>`;
}

// Quanto sai a farda com tudo somado, e o que compõe o valor.
function blocoDoValor() {
  const { itens, total } = valorDaFarda(rascunho);
  if (!itens.length) return '<p class="medidas-vazia">Escolha o tecido, a gola e o tamanho para ver quanto fica a sua farda.</p>';
  const completo = rascunho.farda_tecido_id && rascunho.farda_gola && rascunho.farda_corte && rascunho.farda_tamanho;
  return `<div class="valor-caixa">
        <span class="cartela-label">Valor da sua farda</span>
        <ul class="valor-linhas">${itens.map((item) => `<li><span>${escapeHtml(item.rotulo)}</span><strong>${formatMoney(item.valor)}</strong></li>`).join('')}</ul>
        <div class="valor-total"><span>Total</span><strong>${formatMoney(total)}</strong></div>
        ${completo ? '' : '<p class="valor-nota">Faltam escolhas: o total ainda pode mudar.</p>'}
      </div>`;
}

function resumoFarda(pessoa) {
  const partes = [];
  const tecido = tecidoPor(pessoa.farda_tecido_id);
  if (tecido) partes.push(tecido.nome);
  if (pessoa.farda_gola) partes.push((GOLAS.find(([valor]) => valor === pessoa.farda_gola) || [, pessoa.farda_gola])[1]);
  if (pessoa.farda_corte) partes.push((CORTES.find(([valor]) => valor === pessoa.farda_corte) || [, pessoa.farda_corte])[1]);
  if (pessoa.farda_tamanho) partes.push(`Tamanho ${pessoa.farda_tamanho}`);
  if (pessoa.farda_nome) partes.push(`Costas: ${pessoa.farda_nome}`);
  const { total } = valorDaFarda(pessoa);
  if (total > 0) partes.push(`Total ${formatMoney(total)}`);
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
        ? `<button class="primary-button" type="button" data-copiar-pix="#pix-feedback">Copiar a chave PIX <span aria-hidden="true">⧉</span></button>`
        : '<p class="medidas-vazia">A organização ainda não cadastrou a chave PIX desta festa.</p>'}
      <p id="pix-feedback" class="feedback" role="status" aria-live="polite"></p>
    </div>
  </section>`;
}

function renderContribuicaoLista() {
  const pessoas = [...state.funcionarios].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const cobrados = pessoas.filter((pessoa) => !isento(pessoa));
  const pagas = cobrados.filter((pessoa) => pessoa.contribuicao_paga).length;
  const resumo = `${pessoas.length} ${pessoas.length === 1 ? 'pessoa' : 'pessoas'}${cobrados.length ? ` · ${pagas} de ${cobrados.length} ${pagas === 1 ? 'pagou' : 'pagaram'}` : ''}`;
  $('#contribuicao-lista').innerHTML = `<section class="equipe-bloco is-aberto">
    <div class="equipe-bloco-topo is-fixo">
      <span><strong>Funcionários da escola</strong><small>${resumo}</small></span>
    </div>
    <div class="equipe-bloco-corpo">
      ${pessoas.length
        ? `<ul class="equipe-lista">${pessoas.map((pessoa) => `<li class="equipe-linha${state.eu && Number(pessoa.id) === Number(state.eu.id) ? ' sou-eu' : ''}">
            <div><strong>${escapeHtml(pessoa.nome)}</strong><small><span class="cargo-chip">${escapeHtml(cargoLabel(pessoa.cargo))}</span>${isento(pessoa) ? '' : (pessoa.contribuicao_valor != null ? ` ${formatMoney(pessoa.contribuicao_valor)}` : ' Valor a definir')}</small></div>
            ${isento(pessoa) ? '<span class="pgto-selo is-isento">Sem cobrança</span>' : selo(pessoa.contribuicao_paga)}
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
  const [modelos, tecidos, funcionarios, votos, atualizado] = await Promise.all([
    supabase.from('farda_modelos').select('*').eq('evento_id', evento).order('id'),
    supabase.from('farda_tecidos').select('*').eq('evento_id', evento).order('ordem').order('id'),
    supabase.from('funcionarios').select('*').eq('evento_id', evento).order('nome'),
    supabase.from('farda_votos').select('*').eq('evento_id', evento),
    supabase.from('eventos').select('*').eq('id', evento).maybeSingle(),
  ]);
  const erro = [modelos, tecidos, funcionarios, votos, atualizado].find((resposta) => resposta.error)?.error;
  if (erro) {
    setStatus('Não foi possível atualizar agora. Tentando de novo...', 'offline');
    mostrarErro(`${mensagemDeErro(erro)} — se a mensagem falar em tabela ou coluna ausente, rode as migrations de supabase/migrations no SQL Editor.`);
    return;
  }
  mostrarErro('');
  state.modelos = modelos.data || [];
  state.tecidos = tecidos.data || [];
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
  setStatus('');
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
  ['farda_modelos', 'farda_tecidos', 'funcionarios', 'farda_votos'].forEach((tabela) => {
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
  if (state.tecidos.length && !rascunho.farda_tecido_id) {
    avisar('Escolha o tecido da sua farda antes de salvar.', true);
    return;
  }
  if (!rascunho.farda_gola || !rascunho.farda_corte || !rascunho.farda_tamanho) {
    avisar('Escolha o tecido, a gola, o modelo e o tamanho antes de salvar.', true);
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
    p_tecido_id: rascunho.farda_tecido_id ? Number(rascunho.farda_tecido_id) : null,
  });
  botao.disabled = false;
  if (error) { avisar(mensagemDeErro(error), true); return; }
  await carregarTudo();
  const { total } = valorDaFarda(meuCadastro() || rascunho);
  mostrarValorAPagar(total);
}

// O fecho do fluxo: a pessoa acabou de escolher e precisa saber quanto mandar.
function mostrarValorAPagar(total) {
  const alvo = $('#farda-pago');
  if (!alvo) { avisarEm('#farda-feedback', 'Pronto! Os seus dados entraram na lista.'); return; }
  const evento = state.evento || {};
  alvo.hidden = false;
  alvo.innerHTML = `<p class="section-label">Farda salva</p>
    <h3>Envie <strong>${formatMoney(total)}</strong> no PIX</h3>
    ${evento.pix_chave
      ? `<button class="primary-button" type="button" data-copiar-pix="#farda-pix-feedback">Copiar a chave PIX <span aria-hidden="true">⧉</span></button>
         <p id="farda-pix-feedback" class="feedback" role="status" aria-live="polite"></p>`
      : '<p class="valor-nota">A organização ainda não cadastrou a chave PIX desta festa.</p>'}
    ${state.evento?.farda_pagamento_ate ? `<p class="valor-nota">Prazo para pagar: ${escapeHtml(formatDate(state.evento.farda_pagamento_ate))}.</p>` : ''}
    <p class="valor-nota">A organização confirma o recebimento e o seu selo vira <b>Pago</b> na lista abaixo.</p>`;
}

async function copiarPix(seletorDaNota = '#pix-feedback') {
  const nota = $(seletorDaNota);
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

  const verModelo = event.target.closest('[data-modelo-foto]');
  if (verModelo) { abrirModelo(verModelo.dataset.modeloFoto); return; }
  if (event.target.closest('[data-fechar-modelo]')) { $('#modelo-modal')?.close(); return; }
  const zoom = event.target.closest('[data-zoom]');
  if (zoom && zoomAtual) {
    const passo = { mais: zoomAtual.escala * 1.4, menos: zoomAtual.escala / 1.4, reset: 1 };
    zoomAtual.definirEscala(passo[zoom.dataset.zoom] ?? 1);
    return;
  }

  const verTecido = event.target.closest('[data-tecido-detalhe]');
  if (verTecido) { abrirTecido(verTecido.dataset.tecidoDetalhe); return; }

  const escolherTecido = event.target.closest('[data-tecido]');
  if (escolherTecido) {
    rascunho.farda_tecido_id = escolherTecido.dataset.tecido;
    // O botão de escolher também existe dentro do modal.
    const modal = $('#tecido-modal');
    if (modal?.open) modal.close();
    renderMinhaFarda();
    return;
  }

  if (event.target.closest('[data-fechar-tecido]')) { $('#tecido-modal')?.close(); return; }

  const escolha = event.target.closest('.escolha');
  if (escolha) {
    const { campo, valor } = escolha.dataset;
    rascunho[campo] = valor;
    // Trocar de grade invalida o tamanho anterior: "feminino tamanho M"
    // mandaria o molde errado para a confecção.
    if (campo === 'farda_corte' && !naGrade(valor, rascunho.farda_tamanho)) rascunho.farda_tamanho = '';
    // Só o formulário muda: redesenhar tudo tiraria o foco de quem está digitando.
    renderMinhaFarda();
    $(`.escolha[data-campo="${campo}"][data-valor="${valor}"]`)?.focus();
    return;
  }

  if (event.target.closest('#salvar-farda')) { salvarFarda(event.target.closest('#salvar-farda')); return; }
  const pix = event.target.closest('[data-copiar-pix]');
  if (pix) { copiarPix(pix.dataset.copiarPix); }
});

// O nome das costas é digitado; guarda a cada tecla para não se perder quando
// um clique em "Tamanho G" redesenha o formulário.
document.addEventListener('input', (event) => {
  if (event.target.id === 'farda-nome' && rascunho) rascunho.farda_nome = event.target.value;
});

// Clique no fundo escuro fecha o modal do tecido: o <dialog> recebe o evento
// quando o alvo é ele mesmo, e não o conteúdo.
$('#tecido-modal')?.addEventListener('click', (event) => { if (event.target.id === 'tecido-modal') event.target.close(); });
$('#modelo-modal')?.addEventListener('click', (event) => { if (event.target.id === 'modelo-modal') event.target.close(); });

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
