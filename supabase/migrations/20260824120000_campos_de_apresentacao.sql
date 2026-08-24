-- Campos de apresentação usados pelas telas públicas.
--
-- Contexto: o layout aprovado da festa mostra informações que o schema inicial
-- não guardava — aviso de alérgenos no cardápio, regras das brincadeiras,
-- ordem e horário dos prêmios, promoção de cartelas e a idade das candidatas.
-- Todas as colunas são opcionais: registros antigos continuam válidos e o
-- front-end simplesmente não renderiza o bloco quando o valor é nulo.

-- Cardápio e barracas ---------------------------------------------------------
alter table public.produtos
  add column if not exists alergenos text,
  add column if not exists regras text,
  add column if not exists destaque text;

comment on column public.produtos.alergenos is
  'Aviso curto de alérgenos exibido como selo no card. Ex.: "Contém amendoim".';
comment on column public.produtos.regras is
  'Regras da brincadeira, exibidas no botão "Regras" da aba Barracas. Uma regra por linha.';
comment on column public.produtos.destaque is
  'Selo de destaque no card da barraca. Ex.: "Prêmio de R$ 200,00".';

-- Sorteios --------------------------------------------------------------------
alter table public.sorteios
  add column if not exists ordem_premio smallint check (ordem_premio is null or ordem_premio > 0),
  add column if not exists imagem_url text,
  add column if not exists horario_sorteio time,
  add column if not exists data_sorteio date,
  add column if not exists cartelas_promo_qtd smallint check (cartelas_promo_qtd is null or cartelas_promo_qtd > 1),
  add column if not exists cartelas_promo_valor numeric(10, 2) check (cartelas_promo_valor is null or cartelas_promo_valor >= 0);

comment on column public.sorteios.ordem_premio is
  'Posição do prêmio na noite (1 = 1º Prêmio). Exibida como selo no canto do card.';
comment on column public.sorteios.cartelas_promo_qtd is
  'Quantidade da promoção de cartelas. Ex.: 3, para "3 por R$ 10,00".';
comment on column public.sorteios.cartelas_promo_valor is
  'Valor total da promoção de cartelas. Só é exibida quando qtd e valor estão preenchidos.';

-- A promoção só faz sentido com os dois campos preenchidos.
alter table public.sorteios
  drop constraint if exists sorteios_promo_completa_check;
alter table public.sorteios
  add constraint sorteios_promo_completa_check
  check ((cartelas_promo_qtd is null) = (cartelas_promo_valor is null));

-- Candidatas ------------------------------------------------------------------
alter table public.candidatas
  add column if not exists idade smallint check (idade is null or (idade between 10 and 30));

comment on column public.candidatas.idade is
  'Idade da candidata, exibida no card da galeria. Opcional.';
