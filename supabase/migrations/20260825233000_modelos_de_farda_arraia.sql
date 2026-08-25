-- Os nove modelos de farda do Arraiá da Casavequia 2026.
--
-- Cada arte é um quadrado 1080x1080 com as quatro vistas do modelo: polo e
-- t-shirt, frente e costas, com "SEU NOME" estampado atrás. O card da votação
-- e o modal passam a ser quadrados por causa disso — recortar a arte cortaria
-- metade das camisas.
--
-- As fotos entram pelo painel: a organização envia a arte de cada modelo em
-- "Modelos de farda" → Editar. Aqui ficam só nome e descrição, para a equipe
-- já poder conversar sobre "o 03" antes das imagens subirem.

do $$
declare
  -- >>> Festa que recebe os modelos. Troque aqui se for a outra escola. <<<
  v_slug text := 'casavequia';
  v_evento_id bigint;
begin
  select e.id into v_evento_id from public.eventos e where e.slug = v_slug;
  if v_evento_id is null then
    raise exception 'Festa "%" não encontrada. Ajuste v_slug no topo deste bloco.', v_slug;
  end if;

  insert into public.farda_modelos (evento_id, nome, descricao)
  select v_evento_id, m.nome, m.descricao
  from (values
    ('Modelo 01', 'Corpo bege com mangas e gola marrom. Chapéu, balão e cerca com varal de luzes.'),
    ('Modelo 02', 'Xadrez marrom por inteiro, com barra bege e vivos amarelos na gola e nas mangas.'),
    ('Modelo 03', 'Corpo bege com mangas xadrez e faixa marrom curva na base.'),
    ('Modelo 04', 'Corpo marrom liso, gola e vivos amarelos, mangas xadrez. Cata-vento e cerca na barra.'),
    ('Modelo 05', 'Corpo marrom com barra bege em onda, varal de luzes e cerca com cactos.'),
    ('Modelo 06', 'Xadrez colorido nos ombros, fogueira, fardo de feno e bandeirinhas.'),
    ('Modelo 07', 'Marrom xadrez escuro com fogueira, capela ao fundo e bandeirinhas laranja.'),
    ('Modelo 08', 'Corpo bege com barra marrom curva, varal de luzes e cactos.'),
    ('Modelo 09', 'Bege e marrom na diagonal, com bandeirinhas, balão e roda de carroça.')
  ) as m(nome, descricao)
  -- Reaplicar o script não duplica nem apaga a foto que já foi enviada.
  where not exists (
    select 1 from public.farda_modelos existente
    where existente.evento_id = v_evento_id and lower(existente.nome) = lower(m.nome)
  );
end;
$$;

comment on column public.farda_modelos.imagem_url is
  'Arte do modelo, quadrada (1080x1080). A tela reserva um espaço 1:1 para ela.';
