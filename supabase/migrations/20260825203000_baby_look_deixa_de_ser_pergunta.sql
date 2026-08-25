-- Baby look deixa de ser pergunta.
--
-- A grade feminina da confecção JÁ é a baby look — é isso que o sufixo BL de
-- PPBL..XGGBL significa. Perguntar "baby look: sim ou não" logo depois de a
-- pessoa escolher "Feminino / tamanho MBL" pedia a mesma informação três vezes
-- e permitia respostas que se contradiziam.
--
-- A coluna continua existindo, porque é ela que a confecção lê no pedido; só
-- passa a ser preenchida sozinha a partir do modelo escolhido.

create or replace function public.funcionario_salvar_farda(
  p_token uuid,
  p_nome text,
  p_gola text,
  p_corte text,
  p_tamanho text,
  p_tecido_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_evento_id bigint;
begin
  select a.funcionario_id, f.evento_id into v_id, v_evento_id
  from private.funcionario_acesso a
  join public.funcionarios f on f.id = a.funcionario_id
  where a.token = p_token;
  if v_id is null then
    raise exception 'Identifique-se de novo para salvar a sua farda.' using errcode = 'P0001';
  end if;
  if p_gola is null or p_gola not in ('polo', 't-shirt') then
    raise exception 'Escolha entre gola polo e t-shirt.' using errcode = 'P0001';
  end if;
  if p_corte is null or p_corte not in ('masculino', 'feminino') then
    raise exception 'Escolha a grade masculina ou feminina.' using errcode = 'P0001';
  end if;
  if p_tamanho is null then
    raise exception 'Escolha o tamanho da farda.' using errcode = 'P0001';
  end if;
  -- O sufixo BL é o que diz à confecção que o molde é baby look.
  if (p_corte = 'feminino') <> (p_tamanho like '%BL') then
    raise exception 'Este tamanho não pertence à grade escolhida.' using errcode = 'P0001';
  end if;
  if p_tecido_id is not null and not exists (
    select 1 from public.farda_tecidos t where t.id = p_tecido_id and t.evento_id = v_evento_id
  ) then
    raise exception 'Este tecido não está mais disponível.' using errcode = 'P0001';
  end if;

  update public.funcionarios f set
    farda_nome = nullif(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), ''),
    farda_gola = p_gola,
    farda_corte = p_corte,
    farda_tamanho = p_tamanho,
    -- Derivado, nunca perguntado: grade feminina é baby look.
    farda_baby_look = (p_corte = 'feminino'),
    farda_tecido_id = p_tecido_id,
    farda_preenchida_em = now()
  where f.id = v_id;
end;
$$;

-- A versão com p_baby_look sairia respondendo por chamada de 6 argumentos, já
-- que o tecido tem valor padrão nas duas.
drop function if exists public.funcionario_salvar_farda(uuid, text, text, text, text, boolean, bigint);

grant execute on function public.funcionario_salvar_farda(uuid, text, text, text, text, bigint) to anon, authenticated;

-- Alinha quem já respondeu antes de a pergunta sair.
update public.funcionarios
set farda_baby_look = (farda_corte = 'feminino')
where farda_corte is not null and farda_baby_look is distinct from (farda_corte = 'feminino');

comment on column public.funcionarios.farda_baby_look is
  'Derivado de farda_corte: a grade feminina é a baby look. Não é mais perguntado.';
