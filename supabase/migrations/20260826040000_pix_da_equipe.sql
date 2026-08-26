-- O PIX que a equipe paga não é o PIX da festa.
--
-- `eventos.pix_chave` é a conta da escola, que atende o visitante na barraca.
-- Farda e contribuição são cobrança interna, e quem recebe é a pessoa da
-- coordenação — outra chave, outro favorecido. Até aqui a página da equipe
-- reaproveitava o PIX da festa por não ter o seu.
--
-- As três colunas são opcionais: festa sem PIX próprio da equipe continua
-- caindo no da festa, exatamente como antes.

alter table public.eventos
  add column if not exists equipe_pix_chave      text,
  add column if not exists equipe_pix_favorecido text,
  add column if not exists equipe_pix_cargo      text;

comment on column public.eventos.equipe_pix_chave is
  'Chave PIX que recebe farda e contribuição da equipe. Vazia, a página da equipe cai no PIX da festa.';
comment on column public.eventos.equipe_pix_favorecido is
  'Nome de quem recebe. A página mostra junto da chave, para ninguém pagar no escuro.';
comment on column public.eventos.equipe_pix_cargo is
  'Cargo de quem recebe. Ex.: Coordenador Administrativo.';

do $$
declare
  -- >>> Festa que recebe estes dados. Troque aqui se for a outra escola. <<<
  v_slug text := 'casavequia';
begin
  if not exists (select 1 from public.eventos where slug = v_slug) then
    raise exception 'Festa "%" não encontrada. Ajuste v_slug no topo deste bloco.', v_slug;
  end if;

  update public.eventos
  set equipe_pix_chave      = '68981180060',
      equipe_pix_favorecido = 'Jayson Nascimento Lima',
      equipe_pix_cargo      = 'Coordenador Administrativo'
  where slug = v_slug;
end;
$$;
