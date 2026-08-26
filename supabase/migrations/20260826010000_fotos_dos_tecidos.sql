-- Liga cada tecido à sua foto.
--
-- Mesmo caminho das artes de farda: arquivo do próprio site, e não upload no
-- bucket. São fotos do catálogo do fornecedor, iguais em toda escola, então
-- acompanham o deploy em vez de precisarem ser reenviadas a cada banco novo.
--
-- Só preenche o que está vazio: uma foto que a organização já tenha enviado
-- pelo painel continua valendo.

do $$
declare
  -- >>> Festa que recebe as fotos. Troque aqui se for a outra escola. <<<
  v_slug text := 'casavequia';
  v_evento_id bigint;
begin
  select e.id into v_evento_id from public.eventos e where e.slug = v_slug;
  if v_evento_id is null then
    raise exception 'Festa "%" não encontrada. Ajuste v_slug no topo deste bloco.', v_slug;
  end if;

  update public.farda_tecidos t
  set imagem_url = f.url
  from (values
    ('KX Premium',   '/assets/tecidos/kx-premium.jpg'),
    ('KX Sport',     '/assets/tecidos/kx-sport.jpg'),
    ('DRY Jackad',   '/assets/tecidos/dry-jackad.jpg'),
    ('PP-Poliéster', '/assets/tecidos/pp-poliester.jpg')
  ) as f(nome, url)
  where t.evento_id = v_evento_id
    and lower(t.nome) = lower(f.nome)
    and coalesce(btrim(t.imagem_url), '') = '';
end;
$$;

comment on column public.farda_tecidos.imagem_url is
  'Foto da malha, quadrada (1080x1080). A tela reserva um espaço 1:1 para ela.';
