-- Dados iniciais da Festa Cultural.
--
-- ATENÇÃO: este script APAGA o conteúdo atual das quatro tabelas antes de
-- inserir. É o comportamento normal de um seed, mas se você já cadastrou dados
-- reais, remova o bloco de truncate abaixo antes de rodar.
--
-- Tudo aqui é EXEMPLO para você editar: troque nomes, preços e horários pelos
-- dados reais da sua escola. As candidatas estão com nomes genéricos de
-- propósito — substitua pelos nomes reais das alunas.

truncate table public.cronograma, public.candidatas, public.sorteios, public.produtos
  restart identity cascade;

-- Cardápio ---------------------------------------------------------------------
insert into public.produtos (nome, descricao, preco, categoria, status) values
  ('Canjica',             'Cremosa, com canela e leite condensado.',      6.00,  'comida',      'disponivel'),
  ('Pamonha',             'Feita na hora com milho verde.',               8.00,  'comida',      'disponivel'),
  ('Milho cozido',        'Na manteiga e com sal a gosto.',               5.00,  'comida',      'disponivel'),
  ('Caldo verde',         'Servido bem quente, com torradinha.',         10.00,  'comida',      'disponivel'),
  ('Cachorro-quente',     'Com purê, batata palha e vinagrete.',          8.00,  'comida',      'disponivel'),
  ('Arroz carreteiro',    'Porção individual.',                          12.00,  'comida',      'poucas_unidades'),

  ('Pastel de queijo',    'Massa crocante, recheio generoso.',            7.00,  'salgado',     'disponivel'),
  ('Pastel de carne',     'Temperado com azeitona.',                      7.00,  'salgado',     'disponivel'),
  ('Coxinha',             'De frango com catupiry.',                      6.00,  'salgado',     'disponivel'),
  ('Espetinho de frango', 'Acompanha farofa e vinagrete.',               12.00,  'salgado',     'disponivel'),
  ('Pipoca',              'Saquinho grande, feita na hora.',              5.00,  'salgado',     'disponivel'),

  ('Bolo de fubá',        'Fatia generosa, com erva-doce.',               5.00,  'doce',        'disponivel'),
  ('Bolo de milho',       'Receita da cantina da escola.',                5.00,  'doce',        'disponivel'),
  ('Paçoca',              'Unidade.',                                     2.00,  'doce',        'disponivel'),
  ('Pé de moleque',       'Crocante, com amendoim torrado.',              3.00,  'doce',        'disponivel'),
  ('Maçã do amor',        'Clássica da festa junina.',                    7.00,  'doce',        'poucas_unidades'),
  ('Curau',               'Servido gelado, com canela.',                  6.00,  'doce',        'disponivel'),
  ('Arroz doce',          'Com casca de limão e canela.',                 6.00,  'doce',        'disponivel'),
  ('Algodão-doce',        'Rosa ou azul.',                                6.00,  'doce',        'esgotado'),

  ('Quentão sem álcool',  'Gengibre, cravo e canela.',                    6.00,  'bebida',      'disponivel'),
  ('Refrigerante lata',   'Diversos sabores.',                            5.00,  'bebida',      'disponivel'),
  ('Suco natural',        'Laranja, maracujá ou abacaxi.',                5.00,  'bebida',      'disponivel'),
  ('Água mineral',        'Com ou sem gás.',                              3.00,  'bebida',      'disponivel'),

  ('Pescaria',            'Fisgue o peixinho e ganhe um brinde.',         5.00,  'brincadeira', 'disponivel'),
  ('Argola',              'Três tentativas por rodada.',                  5.00,  'brincadeira', 'disponivel'),
  ('Boca do palhaço',     'Acerte a bolinha e leve um doce.',             5.00,  'brincadeira', 'disponivel'),
  ('Correio elegante',    'Mande um recadinho anônimo.',                  2.00,  'brincadeira', 'disponivel'),
  ('Cadeia',              'Prenda um amigo e cobre a fiança.',            3.00,  'brincadeira', 'disponivel'),
  ('Canaleta',            'Role a moeda e acerte o alvo.',                5.00,  'brincadeira', 'disponivel'),
  ('Tomba-lata',          'Derrube todas as latas e ganhe.',              5.00,  'brincadeira', 'disponivel');

-- Sorteios ---------------------------------------------------------------------
insert into public.sorteios (identificacao, premio, tipo, valor_cartela, status) values
  ('Bingo #01',        'Cesta de café da manhã',         'bingo',   5.00, 'aguardando'),
  ('Bingo #02',        'Smart TV 32 polegadas',          'bingo',  10.00, 'aguardando'),
  ('Rifa do Leitão',   'Leitão assado inteiro',          'rifa',   10.00, 'aguardando'),
  ('Leilão da Torta',  'Torta de morango da Dona Maria', 'leilao',  0.00, 'aguardando');

-- Candidatas a Rainha Caipira ----------------------------------------------------
-- SUBSTITUA pelos nomes reais das alunas antes da festa.
insert into public.candidatas (nome, detalhes, horario_desfile) values
  ('Candidata do 6º Ano A', 'Representante do 6º Ano A', '19:45'),
  ('Candidata do 6º Ano B', 'Representante do 6º Ano B', '19:50'),
  ('Candidata do 7º Ano A', 'Representante do 7º Ano A', '19:55'),
  ('Candidata do 7º Ano B', 'Representante do 7º Ano B', '20:00'),
  ('Candidata do 8º Ano A', 'Representante do 8º Ano A', '20:05'),
  ('Candidata do 9º Ano A', 'Representante do 9º Ano A', '20:10');

-- Cronograma ---------------------------------------------------------------------
insert into public.cronograma (evento, horario_previsto, sorteio_id) values
  ('Abertura do arraial',                      '18:00', null),
  ('Apresentação das turmas do fundamental I', '18:30', null),
  ('Quadrilha dos alunos',                     '19:00', null),
  ('Desfile das candidatas a Rainha Caipira',  '19:45', null),
  ('Coroação da Rainha Caipira',               '22:30', null),
  ('Encerramento',                             '23:00', null);

-- Os eventos de sorteio buscam o id pela identificação, então você não precisa
-- saber quais ids foram gerados acima.
insert into public.cronograma (evento, horario_previsto, sorteio_id)
select v.evento, v.horario::time, s.id
from (values
  ('Bingo #01',       '20:30', 'Bingo #01'),
  ('Rifa do Leitão',  '21:00', 'Rifa do Leitão'),
  ('Leilão da Torta', '21:30', 'Leilão da Torta'),
  ('Bingo #02',       '22:00', 'Bingo #02')
) as v(evento, horario, ident)
join public.sorteios s on s.identificacao = v.ident;
