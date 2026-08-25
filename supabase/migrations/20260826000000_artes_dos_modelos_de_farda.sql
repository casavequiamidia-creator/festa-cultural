-- Liga cada modelo de farda à sua arte.
--
-- As nove artes passam a ser arquivo do próprio site (`assets/modelos-de-farda`)
-- em vez de upload no bucket. É arte fixa da festa, que combina com o resto do
-- deploy: sai pelo CDN da Vercel, entra no histórico junto com o código, e
-- ninguém precisa reenviar nove imagens a cada banco novo.
--
-- Só preenche o que está vazio: se a organização já tiver enviado uma arte
-- diferente pelo painel, ela continua valendo.

do $$
declare
  -- >>> Festa que recebe as artes. Troque aqui se for a outra escola. <<<
  v_slug text := 'casavequia';
  v_evento_id bigint;
begin
  select e.id into v_evento_id from public.eventos e where e.slug = v_slug;
  if v_evento_id is null then
    raise exception 'Festa "%" não encontrada. Ajuste v_slug no topo deste bloco.', v_slug;
  end if;

  update public.farda_modelos m
  set imagem_url = a.url
  from (values
    ('Modelo 01', '/assets/modelos-de-farda/01.jpg'),
    ('Modelo 02', '/assets/modelos-de-farda/02.jpg'),
    ('Modelo 03', '/assets/modelos-de-farda/03.jpg'),
    ('Modelo 04', '/assets/modelos-de-farda/04.jpg'),
    ('Modelo 05', '/assets/modelos-de-farda/05.jpg'),
    ('Modelo 06', '/assets/modelos-de-farda/06.jpg'),
    ('Modelo 07', '/assets/modelos-de-farda/07.jpg'),
    ('Modelo 08', '/assets/modelos-de-farda/08.jpg'),
    ('Modelo 09', '/assets/modelos-de-farda/09.jpg')
  ) as a(nome, url)
  where m.evento_id = v_evento_id
    and lower(m.nome) = lower(a.nome)
    and coalesce(btrim(m.imagem_url), '') = '';
end;
$$;
