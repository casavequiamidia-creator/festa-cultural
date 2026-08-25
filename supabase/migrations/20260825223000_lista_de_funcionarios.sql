-- Lista de funcionários da escola, com o valor da contribuição de cada um.
--
-- Três decisões que a lista de origem obrigou:
--
-- 1. SETOR. A lista não trazia o setor de ninguém. Em vez de carimbar todo
--    mundo como "apoio" — o que poria "Apoio" ao lado do nome de um professor
--    na tela — a coluna passa a aceitar nulo e a página mostra "Setor a
--    definir". Ele se corrige sozinho: ao entrar em /<festa>/funcionarios a
--    pessoa escolhe o próprio setor, e `funcionario_entrar` grava por cima.
--
-- 2. ISENTAS. Três pessoas vieram como "ISENTA", que não é número. Ficam com
--    contribuicao_valor = 0, e o zero é o que a página lê como "sem cobrança"
--    — diferente de nulo, que é "valor ainda a definir".
--
-- 3. NOME REPETIDO. LAILA MAIA DA SILVA aparecia duas vezes, com o mesmo
--    valor. Entra uma vez só: o nome é único por festa, senão a mesma pessoa
--    votaria duas vezes e apareceria duas vezes na cobrança.

-- 1. Setor deixa de ser obrigatório --------------------------------------------
alter table public.funcionarios alter column cargo drop not null;
alter table public.funcionarios alter column cargo drop default;

comment on column public.funcionarios.cargo is
  'Setor na escola. Nulo = ainda não informado; a própria pessoa preenche ao entrar na página da equipe.';

-- 2. Nome sem acento e sem caixa ------------------------------------------------
-- "CLEISON DE MATOS GONCALVES" na lista e "Cleison de Matos Gonçalves" digitado
-- pela pessoa são a MESMA pessoa. Comparando por `lower()` puro, ela viraria uma
-- segunda linha na cobrança e um segundo voto na farda.
create or replace function private.nome_chave(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    lower(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'))),
    'áàâãäéèêëíìîïóòôõöúùûüçñ',
    'aaaaaeeeeiiiiooooouuuucn'
  );
$$;

comment on function private.nome_chave(text) is
  'Nome reduzido a minúsculas, sem acento e sem espaço duplicado. É por ele que a pessoa reencontra o próprio cadastro.';

drop index if exists public.funcionarios_nome_unico;
create unique index if not exists funcionarios_nome_chave_unico
  on public.funcionarios (evento_id, private.nome_chave(nome));

-- Entrar passa a reconhecer o nome mesmo digitado sem acento.
create or replace function public.funcionario_entrar(
  p_slug text,
  p_nome text,
  p_cargo text,
  p_codigo text default null,
  p_token uuid default null
)
returns table (id bigint, token uuid, nome text, cargo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento_id bigint;
  v_codigo text;
  v_nome text;
  v_id bigint;
  v_token uuid;
begin
  select e.id into v_evento_id from public.eventos e where e.slug = lower(btrim(coalesce(p_slug, '')));
  if v_evento_id is null then
    raise exception 'Esta festa não existe.' using errcode = 'P0001';
  end if;

  select btrim(coalesce(a.codigo, '')) into v_codigo
  from public.equipe_acesso a where a.evento_id = v_evento_id;

  if coalesce(v_codigo, '') <> '' and lower(btrim(coalesce(p_codigo, ''))) <> lower(v_codigo) then
    raise exception 'Código de acesso incorreto. Peça o código à organização.' using errcode = 'P0001';
  end if;

  v_nome := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  if length(v_nome) < 5 or position(' ' in v_nome) = 0 then
    raise exception 'Escreva o seu nome completo, com sobrenome.' using errcode = 'P0001';
  end if;

  if p_cargo is null or p_cargo not in ('gestao', 'professores', 'aee', 'administrativo', 'transporte', 'apoio') then
    raise exception 'Escolha o seu setor na escola.' using errcode = 'P0001';
  end if;

  if p_token is not null then
    select a.funcionario_id into v_id
    from private.funcionario_acesso a
    join public.funcionarios f on f.id = a.funcionario_id
    where a.token = p_token and f.evento_id = v_evento_id;
  end if;

  if v_id is null then
    select f.id into v_id from public.funcionarios f
    where f.evento_id = v_evento_id
      and private.nome_chave(f.nome) = private.nome_chave(v_nome);
  end if;

  if v_id is null then
    insert into public.funcionarios (evento_id, nome, cargo)
    values (v_evento_id, v_nome, p_cargo)
    returning public.funcionarios.id into v_id;
  else
    -- A lista da organização foi digitada em caixa alta; quem entra assina do
    -- jeito dela. Vale a grafia de quem se apresentou.
    update public.funcionarios f set nome = v_nome, cargo = p_cargo where f.id = v_id;
  end if;

  insert into private.funcionario_acesso (funcionario_id) values (v_id)
  on conflict (funcionario_id) do nothing;

  select a.token into v_token from private.funcionario_acesso a where a.funcionario_id = v_id;
  return query
    select f.id, v_token, f.nome, f.cargo from public.funcionarios f where f.id = v_id;
end;
$$;

grant execute on function public.funcionario_entrar(text, text, text, text, uuid) to anon, authenticated;

-- 3. A lista --------------------------------------------------------------------
do $$
declare
  -- >>> Festa que recebe a lista. Troque aqui se for a outra escola. <<<
  v_slug text := 'casavequia';
  v_evento_id bigint;
begin
  select e.id into v_evento_id from public.eventos e where e.slug = v_slug;
  if v_evento_id is null then
    raise exception 'Festa "%" não encontrada. Ajuste v_slug no topo deste bloco.', v_slug;
  end if;

  insert into public.funcionarios (evento_id, nome, cargo, contribuicao_valor)
  select v_evento_id, l.nome, l.cargo, l.valor
  from (values
    ('ALAN (MOTORISTA)',                          'transporte', 150.00),
    ('ANTONIO FERREIRA DA COSTA',                 null,         150.00),
    ('ARLIANE LIMA DE HOLANDA',                   null,         200.00),
    ('CELSO NASCIMENTO',                          null,         150.00),
    ('CLÉIA DA SILVA TEIXEIRA',                   null,         250.00),
    ('CLEISON DE MATOS GONCALVES',                null,         200.00),
    ('CLEITON DE SOUZA SAMPAIO',                  null,         150.00),
    ('EDEBERCIO GOMES ARAÚJO',                    null,         150.00),
    ('FELIPE (MOTORISTA)',                        'transporte', 150.00),
    ('FRANCISCO DA SILVA ABREU',                  null,         200.00),
    ('GABRIELA COSTA DE SOUZA',                   null,         150.00),
    ('GEILSON MACIEL BARROS',                     null,         200.00),
    ('JAYSON NASCIMENTO LIMA',                    null,         200.00),
    ('JOÃO PAULO',                                null,         150.00),
    ('JOSE FRANCISCO DE SOUZA NASCIMENTO',        null,         200.00),
    ('JOSE LUIZ BITHS DE LIMA',                   null,         150.00),
    ('LAILA MAIA DA SILVA',                       null,         200.00),
    ('MANOEL CALIXTO DE SOUZA FILHO',             null,         200.00),
    ('MARIA ANGELITA FERREIRA DA COSTA OLIVEIRA', null,         200.00),
    ('MARIA CELESTE DA SILVA DOS SANTOS',         null,         150.00),
    ('MARIA LETICIA OLIVEIRA DA SILVA',           null,         250.00),
    ('MARIA SELCILENE DO NASCIMENTO LIMA',        null,         200.00),
    -- Isentas: zero é "sem cobrança"; nulo seria "valor a definir".
    ('NAZARÉ ADRIÃO BANDEIRA',                    null,           0.00),
    ('PATRÍCIA FERREIRA RODRIGUES',               null,         200.00),
    ('PAULO ROBERTO RAMALHO MAGALHÃES',           null,         200.00),
    ('REBECA CAROLAYNE DE SOUZA GOUVEIA',         null,         150.00),
    ('ROBSON',                                    null,         200.00),
    ('SILMARA ALMEIDA',                           null,         200.00),
    ('SIRLÂNDIA OLIVEIRA DE SOUZA',               null,           0.00),
    ('SUZETE DA CONCEIÇÃO BARROSO',               null,           0.00),
    ('VALÉRIA NASCIMENTO',                        null,         200.00),
    ('VIVIANI TEIXEIRA DOS SANTOS',               null,         200.00)
  ) as l(nome, cargo, valor)
  -- Reaplicar o script não duplica ninguém, e não atropela quem já entrou
  -- sozinho na página antes de a lista ser carregada.
  where not exists (
    select 1 from public.funcionarios f
    where f.evento_id = v_evento_id
      and private.nome_chave(f.nome) = private.nome_chave(l.nome)
  );
end;
$$;
