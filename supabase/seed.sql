-- ============================================================================
-- Festa Cultural — dados FICTÍCIOS de demonstração
-- ============================================================================
-- Preenche a festa de slug 'casavequia' (a que a migration de múltiplos eventos
-- cria) para a organização testar todas as telas e o painel antes do evento.
--
-- NADA aqui é real: nomes, preços, prêmios e candidatas são inventados.
--
-- ATENÇÃO: apaga o conteúdo ATUAL DESSA FESTA antes de inserir. As outras
-- festas do banco não são tocadas.
--
-- Como aplicar: rode antes todas as migrations de supabase/migrations, depois
-- cole este arquivo inteiro no SQL Editor do Supabase e execute.
--
-- Para semear outra festa, troque 'casavequia' pelo slug dela (substituir tudo).
-- ============================================================================

-- Limpeza só do que pertence a esta festa ---------------------------------------
delete from public.cronograma where evento_id = (select id from public.eventos where slug = 'casavequia');
delete from public.candidatas where evento_id = (select id from public.eventos where slug = 'casavequia');
delete from public.sorteios   where evento_id = (select id from public.eventos where slug = 'casavequia');
delete from public.produtos   where evento_id = (select id from public.eventos where slug = 'casavequia');

-- ============================================================================
-- CARDÁPIO — 4 itens em cada filtro (Comidas, Salgados, Doces, Bebidas)
-- Os três status aparecem pelo menos uma vez, para testar o selo
-- "Restam poucas unidades!" e o carimbo "ESGOTADO".
-- ============================================================================
insert into public.produtos (evento_id, nome, descricao, preco, categoria, status, alergenos)
select (select id from public.eventos where slug = 'casavequia'),
       v.nome, v.descricao, v.preco::numeric, v.categoria, v.status, v.alergenos
from (values
  -- Comidas
  ('Canjica',             'Canjica cremosa com leite de coco e amendoim.',    '6',  'comida',  'disponivel',      'Contém amendoim e leite'),
  ('Milho Verde',         'Milho cozido na manteiga com sal a gosto.',        '4',  'comida',  'disponivel',      'Contém leite'),
  ('Pamonha',             'Feita na hora com milho verde e queijo.',          '8',  'comida',  'disponivel',      'Contém leite'),
  ('Caldo Verde',         'Servido bem quente, com torradinha.',             '10',  'comida',  'poucas_unidades', 'Contém glúten'),
  -- Salgados
  ('Pastel de Queijo',    'Massa crocante com recheio generoso.',             '7',  'salgado', 'disponivel',      'Contém glúten e leite'),
  ('Coxinha de Frango',   'Com catupiry, fritinha na hora.',                  '6',  'salgado', 'disponivel',      'Contém glúten, leite e ovos'),
  ('Espetinho de Frango', 'Acompanha farofa e vinagrete.',                   '12',  'salgado', 'disponivel',      null),
  ('Cachorro-Quente',     'Com purê, batata palha e vinagrete.',              '8',  'salgado', 'poucas_unidades', 'Contém glúten'),
  -- Doces
  ('Bolo de Chocolate',   'Bolo fofinho de chocolate com cobertura.',         '7',  'doce',    'disponivel',      'Contém glúten, leite e ovos'),
  ('Bolo de Fubá',        'Fatia generosa, com erva-doce.',                   '5',  'doce',    'disponivel',      'Contém glúten, leite e ovos'),
  ('Maçã do Amor',        'A clássica da festa junina, bem vermelhinha.',     '7',  'doce',    'poucas_unidades', null),
  ('Pé de Moleque',       'Crocante, com amendoim torrado.',                  '3',  'doce',    'esgotado',        'Contém amendoim'),
  -- Bebidas
  ('Chocolate Quente',    'Chocolate quente cremoso, perfeito para a noite.', '5',  'bebida',  'disponivel',      'Contém leite'),
  ('Suco Natural',        'Sabores: acerola, cupuaçu ou maracujá.',           '4',  'bebida',  'disponivel',      null),
  ('Quentão sem Álcool',  'Gengibre, cravo e canela, servido quentinho.',     '6',  'bebida',  'disponivel',      null),
  ('Refrigerante Lata',   'Diversos sabores, sempre bem gelado.',             '5',  'bebida',  'disponivel',      null)
) as v(nome, descricao, preco, categoria, status, alergenos);

-- ============================================================================
-- BARRACAS & BRINCADEIRAS — 4 atrações (categoria 'brincadeira').
-- O campo `regras` alimenta o botão "Regras": uma regra por linha.
-- ============================================================================
insert into public.produtos (evento_id, nome, descricao, preco, categoria, status, destaque, regras)
select (select id from public.eventos where slug = 'casavequia'),
       v.nome, v.descricao, v.preco::numeric, 'brincadeira', 'disponivel', v.destaque, v.regras
from (values
  ('Pula Pula', 'Diversão garantida para as crianças e toda a família!', '5', null,
   E'Uma ficha dá direito a 10 minutos de pulo.\nAltura máxima permitida: 1,50 m.\nObrigatório entrar sem sapatos e sem objetos no bolso.\nCrianças de até 4 anos só entram acompanhadas de um responsável.'),
  ('Pescaria', 'Pesque o prêmio certo e ganhe brindes incríveis!', '3', null,
   E'Uma ficha dá direito a 3 tentativas.\nCada peixinho tem um número que corresponde a um brinde.\nÉ proibido colocar a mão na piscina.\nOs brindes são retirados na própria barraca, na hora.'),
  ('Pau de Sebo', 'Suba, vença o desafio e conquiste esse prêmio!', '5', 'Prêmio de R$ 200,00',
   E'Uma ficha dá direito a 1 tentativa.\nParticipação permitida a partir de 12 anos.\nQuem alcançar o topo leva o prêmio de R$ 200,00.\nO prêmio é entregue no palco e sai uma única vez por noite.'),
  ('Argola', 'Acerte o alvo com a argola e garanta seu prêmio!', '3', null,
   E'Uma ficha dá direito a 3 argolas.\nVale o alvo em que a argola ficar presa por completo.\nÉ preciso lançar de trás da linha marcada no chão.\nCada acerto vale um prêmio da prateleira, à escolha do ganhador.')
) as v(nome, descricao, preco, destaque, regras);

-- ============================================================================
-- SORTEIOS — 4 prêmios cobrindo os três tipos (bingo, rifa e leilão).
-- O Bingo #01 já entra "em_andamento" com números chamados, para testar o
-- destaque AO VIVO na home e o painel B-I-N-G-O em tempo real.
-- ============================================================================
insert into public.sorteios (evento_id, identificacao, premio, tipo, valor_cartela, status,
                             numeros_sorteados, ultimo_numero, ordem_premio,
                             horario_sorteio, data_sorteio, cartelas_promo_qtd, cartelas_promo_valor)
select (select id from public.eventos where slug = 'casavequia'),
       v.identificacao, v.premio, v.tipo, v.valor_cartela::numeric, v.status,
       v.numeros::jsonb, v.ultimo::int, v.ordem::smallint,
       v.horario::time, v.data::date, v.promo_qtd::smallint, v.promo_valor::numeric
from (values
  ('Bingo #01', 'Smart TV 55 polegadas 4K com Wi-Fi e comandos de voz', 'bingo', '5', 'em_andamento',
   '[5, 11, 14, 18, 22, 29, 33, 37, 44, 46, 52, 57, 63, 69, 72]', '5', '1', '18:00', '2026-06-24', '3', '10'),
  ('Rifa da Bicicleta', 'Bicicleta aro 29, 21 marchas, freio a disco', 'rifa', '10', 'aguardando',
   '[]', null, '2', '19:00', '2026-06-24', '3', '25'),
  ('Bingo #02', 'Air Fryer digital 5L com diversas funções', 'bingo', '5', 'aguardando',
   '[]', null, '3', '20:00', '2026-06-24', '3', '10'),
  ('Leilão da Cesta Junina', 'Cesta junina gourmet com delícias típicas', 'leilao', '0', 'aguardando',
   '[]', null, '4', '23:00', '2026-06-24', null, null)
) as v(identificacao, premio, tipo, valor_cartela, status, numeros, ultimo, ordem, horario, data, promo_qtd, promo_valor);

-- ============================================================================
-- RAINHA CAIPIRA — 4 candidatas fictícias.
-- SUBSTITUA pelos nomes reais das alunas antes da festa.
-- ============================================================================
insert into public.candidatas (evento_id, nome, idade, detalhes, horario_desfile)
select (select id from public.eventos where slug = 'casavequia'),
       v.nome, v.idade::smallint, v.detalhes, v.horario::time
from (values
  ('Ana Clara Ribeiro',    '17', 'Representante do 9º Ano A',               '21:00'),
  ('Júlia Vitória Nunes',  '16', 'Representante do 8º Ano B',               '21:05'),
  ('Maria Eduarda Farias', '18', 'Representante do 3º Ano do Ensino Médio', '21:10'),
  ('Beatriz Lima Souza',   '17', 'Representante do 9º Ano B',               '21:15')
) as v(nome, idade, detalhes, horario);

-- ============================================================================
-- CRONOGRAMA — noite completa, das 17h às 23h.
-- A abertura já entra como "realizado" para ver a tag no card.
-- ============================================================================
insert into public.cronograma (evento_id, evento, horario_previsto, status)
select (select id from public.eventos where slug = 'casavequia'),
       v.evento, v.horario::time, v.status
from (values
  ('Abertura da festa',                            '17:00', 'realizado'),
  ('Apresentação das candidatas a Rainha Caipira', '21:00', 'pendente'),
  ('Apresentação de quadrilhas',                   '22:00', 'pendente'),
  ('Coroação da Rainha Caipira',                   '22:30', 'pendente')
) as v(evento, horario, status);

-- Os eventos ligados a um sorteio buscam o id pela identificação, dentro da
-- mesma festa — duas festas podem ter um "Bingo #01" cada uma.
insert into public.cronograma (evento_id, evento, horario_previsto, sorteio_id)
select s.evento_id, v.evento, v.horario::time, s.id
from (values
  ('1º Bingo - Smart TV 55"',               '18:00', 'Bingo #01'),
  ('Sorteio da Rifa da Bicicleta',          '19:00', 'Rifa da Bicicleta'),
  ('2º Bingo - Air Fryer',                  '20:00', 'Bingo #02'),
  ('Encerramento + Leilão da Cesta Junina', '23:00', 'Leilão da Cesta Junina')
) as v(evento, horario, ident)
join public.sorteios s
  on s.identificacao = v.ident
 and s.evento_id = (select id from public.eventos where slug = 'casavequia');
