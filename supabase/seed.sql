-- ============================================================================
-- Festa Cultural — dados FICTÍCIOS de demonstração
-- ============================================================================
-- Objetivo: deixar o site completo, como se a festa estivesse acontecendo,
-- para que a organização possa testar todas as telas e o painel /admin.html
-- antes do evento real.
--
-- NADA aqui é real: nomes, preços, prêmios e candidatas são inventados.
-- Substitua tudo pelos dados verdadeiros da escola antes da festa.
--
-- ATENÇÃO: este script APAGA o conteúdo atual das quatro tabelas antes de
-- inserir. Se você já cadastrou dados reais, remova o truncate abaixo.
--
-- Como aplicar: rode antes as migrations (inclusive
-- 20260824120000_campos_de_apresentacao.sql, que cria as colunas de alérgenos,
-- regras, ordem do prêmio, promoção de cartelas e idade), depois cole este
-- arquivo inteiro no SQL Editor do Supabase e execute.
-- ============================================================================

truncate table public.cronograma, public.candidatas, public.sorteios, public.produtos
  restart identity cascade;

-- ============================================================================
-- CARDÁPIO — 4 itens em cada filtro (Comidas, Salgados, Doces, Bebidas)
-- Os três status aparecem pelo menos uma vez, para você testar o selo
-- "Restam poucas unidades!" e o carimbo "ESGOTADO".
-- ============================================================================
insert into public.produtos (nome, descricao, preco, categoria, status, alergenos) values
  -- Comidas ------------------------------------------------------------------
  ('Canjica',             'Canjica cremosa com leite de coco e amendoim.',    6.00,  'comida',  'disponivel',      'Contém amendoim e leite'),
  ('Milho Verde',         'Milho cozido na manteiga com sal a gosto.',        4.00,  'comida',  'disponivel',      'Contém leite'),
  ('Pamonha',             'Feita na hora com milho verde e queijo.',          8.00,  'comida',  'disponivel',      'Contém leite'),
  ('Caldo Verde',         'Servido bem quente, com torradinha.',             10.00,  'comida',  'poucas_unidades', 'Contém glúten'),

  -- Salgados -----------------------------------------------------------------
  ('Pastel de Queijo',    'Massa crocante com recheio generoso.',             7.00,  'salgado', 'disponivel',      'Contém glúten e leite'),
  ('Coxinha de Frango',   'Com catupiry, fritinha na hora.',                  6.00,  'salgado', 'disponivel',      'Contém glúten, leite e ovos'),
  ('Espetinho de Frango', 'Acompanha farofa e vinagrete.',                   12.00,  'salgado', 'disponivel',      null),
  ('Cachorro-Quente',     'Com purê, batata palha e vinagrete.',              8.00,  'salgado', 'poucas_unidades', 'Contém glúten'),

  -- Doces --------------------------------------------------------------------
  ('Bolo de Chocolate',   'Bolo fofinho de chocolate com cobertura.',         7.00,  'doce',    'disponivel',      'Contém glúten, leite e ovos'),
  ('Bolo de Fubá',        'Fatia generosa, com erva-doce.',                   5.00,  'doce',    'disponivel',      'Contém glúten, leite e ovos'),
  ('Maçã do Amor',        'A clássica da festa junina, bem vermelhinha.',     7.00,  'doce',    'poucas_unidades', null),
  ('Pé de Moleque',       'Crocante, com amendoim torrado.',                  3.00,  'doce',    'esgotado',        'Contém amendoim'),

  -- Bebidas ------------------------------------------------------------------
  ('Chocolate Quente',    'Chocolate quente cremoso, perfeito para a noite.', 5.00,  'bebida',  'disponivel',      'Contém leite'),
  ('Suco Natural',        'Sabores: acerola, cupuaçu ou maracujá.',           4.00,  'bebida',  'disponivel',      null),
  ('Quentão sem Álcool',  'Gengibre, cravo e canela, servido quentinho.',     6.00,  'bebida',  'disponivel',      null),
  ('Refrigerante Lata',   'Diversos sabores, sempre bem gelado.',             5.00,  'bebida',  'disponivel',      null);

-- ============================================================================
-- BARRACAS & BRINCADEIRAS — 4 atrações (categoria 'brincadeira').
-- Aparecem na aba Barracas, e não no Cardápio.
-- O campo `regras` alimenta o botão "Regras" de cada card: uma regra por linha.
-- ============================================================================
insert into public.produtos (nome, descricao, preco, categoria, status, destaque, regras) values
  ('Pula Pula',
   'Diversão garantida para as crianças e toda a família!',
   5.00, 'brincadeira', 'disponivel', null,
   E'Uma ficha dá direito a 10 minutos de pulo.\nAltura máxima permitida: 1,50 m.\nObrigatório entrar sem sapatos e sem objetos no bolso.\nCrianças de até 4 anos só entram acompanhadas de um responsável.'),

  ('Pescaria',
   'Pesque o prêmio certo e ganhe brindes incríveis!',
   3.00, 'brincadeira', 'disponivel', null,
   E'Uma ficha dá direito a 3 tentativas.\nCada peixinho tem um número que corresponde a um brinde.\nÉ proibido colocar a mão na piscina.\nOs brindes são retirados na própria barraca, na hora.'),

  ('Pau de Sebo',
   'Suba, vença o desafio e conquiste esse prêmio!',
   5.00, 'brincadeira', 'disponivel', 'Prêmio de R$ 200,00',
   E'Uma ficha dá direito a 1 tentativa.\nParticipação permitida a partir de 12 anos.\nQuem alcançar o topo leva o prêmio de R$ 200,00.\nO prêmio é entregue no palco e sai uma única vez por noite.'),

  ('Argola',
   'Acerte o alvo com a argola e garanta seu prêmio!',
   3.00, 'brincadeira', 'disponivel', null,
   E'Uma ficha dá direito a 3 argolas.\nVale o alvo em que a argola ficar presa por completo.\nÉ preciso lançar de trás da linha marcada no chão.\nCada acerto vale um prêmio da prateleira, à escolha do ganhador.');

-- ============================================================================
-- SORTEIOS — 4 prêmios cobrindo os três tipos (bingo, rifa e leilão).
-- O Bingo #01 já entra "em_andamento" com números chamados, para você testar
-- o banner AO VIVO da tela Início e o painel B-I-N-G-O em tempo real.
-- `ordem_premio` vira o selo "1º Prêmio"; a promoção de cartelas só aparece
-- quando qtd e valor estão preenchidos.
-- ============================================================================
insert into public.sorteios
  (identificacao, premio, tipo, valor_cartela, status, numeros_sorteados, ultimo_numero,
   ordem_premio, horario_sorteio, data_sorteio, cartelas_promo_qtd, cartelas_promo_valor) values
  ('Bingo #01', 'Smart TV 55 polegadas 4K com Wi-Fi e comandos de voz', 'bingo',  5.00, 'em_andamento',
   '[5, 11, 14, 18, 22, 29, 33, 37, 44, 46, 52, 57, 63, 69, 72]'::jsonb, 5,
   1, '18:00', '2026-06-24', 3, 10.00),

  ('Rifa da Bicicleta', 'Bicicleta aro 29, 21 marchas, freio a disco', 'rifa', 10.00, 'aguardando',
   '[]'::jsonb, null,
   2, '19:00', '2026-06-24', 3, 25.00),

  ('Bingo #02', 'Air Fryer digital 5L com diversas funções', 'bingo', 5.00, 'aguardando',
   '[]'::jsonb, null,
   3, '20:00', '2026-06-24', 3, 10.00),

  ('Leilão da Cesta Junina', 'Cesta junina gourmet com delícias típicas', 'leilao', 0.00, 'aguardando',
   '[]'::jsonb, null,
   4, '23:00', '2026-06-24', null, null);

-- ============================================================================
-- RAINHA CAIPIRA — 4 candidatas fictícias.
-- SUBSTITUA pelos nomes reais das alunas antes da festa.
-- ============================================================================
insert into public.candidatas (nome, idade, detalhes, horario_desfile) values
  ('Ana Clara Ribeiro',    17, 'Representante do 9º Ano A',              '21:00'),
  ('Júlia Vitória Nunes',  16, 'Representante do 8º Ano B',              '21:05'),
  ('Maria Eduarda Farias', 18, 'Representante do 3º Ano do Ensino Médio','21:10'),
  ('Beatriz Lima Souza',   17, 'Representante do 9º Ano B',              '21:15');

-- ============================================================================
-- CRONOGRAMA — noite completa, das 17h às 23h.
-- A abertura já entra como "realizado" para você ver a tag no card.
-- ============================================================================
insert into public.cronograma (evento, horario_previsto, status, sorteio_id) values
  ('Abertura da festa',                             '17:00', 'realizado', null),
  ('Apresentação das candidatas a Rainha Caipira',  '21:00', 'pendente',  null),
  ('Apresentação de quadrilhas',                    '22:00', 'pendente',  null),
  ('Coroação da Rainha Caipira',                    '22:30', 'pendente',  null);

-- Os eventos ligados a um sorteio buscam o id pela identificação, então você
-- não precisa saber quais ids foram gerados acima.
insert into public.cronograma (evento, horario_previsto, sorteio_id)
select v.evento, v.horario::time, s.id
from (values
  ('1º Bingo - Smart TV 55"',               '18:00', 'Bingo #01'),
  ('Sorteio da Rifa da Bicicleta',          '19:00', 'Rifa da Bicicleta'),
  ('2º Bingo - Air Fryer',                  '20:00', 'Bingo #02'),
  ('Encerramento + Leilão da Cesta Junina', '23:00', 'Leilão da Cesta Junina')
) as v(evento, horario, ident)
join public.sorteios s on s.identificacao = v.ident;
