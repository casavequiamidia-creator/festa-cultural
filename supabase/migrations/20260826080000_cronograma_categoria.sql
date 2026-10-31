-- Cada item do cronograma ganha uma tag de classificação (Abertura,
-- Apresentação, Bingo, Rifa, Leilão, Encerramento ou Outro).
--   * item ligado a um sorteio herda o tipo dele (bingo, rifa, leilão) e o
--     acompanha quando o tipo do sorteio muda;
--   * a organização pode trocar a tag de qualquer item pelo editor do
--     cronograma; editar só o prêmio do sorteio não desfaz essa escolha.
-- Depende de 20260826070000_cronograma_acompanha_sorteio.sql.

alter table public.cronograma add column if not exists categoria text;
alter table public.cronograma drop constraint if exists cronograma_categoria_check;
alter table public.cronograma add constraint cronograma_categoria_check
  check (categoria is null or categoria in ('abertura','apresentacao','bingo','rifa','leilao','encerramento','outro'));

-- Item novo, ou item que passa a apontar para outro sorteio, herda o tipo dele.
create or replace function private.cronograma_categoria_do_sorteio()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.sorteio_id is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.categoria is null then
      select tipo into new.categoria from public.sorteios where id = new.sorteio_id;
    end if;
  elsif new.sorteio_id is distinct from old.sorteio_id then
    select tipo into new.categoria from public.sorteios where id = new.sorteio_id;
  end if;
  return new;
end $$;

drop trigger if exists cronograma_categoria_do_sorteio on public.cronograma;
create trigger cronograma_categoria_do_sorteio
  before insert or update of sorteio_id on public.cronograma
  for each row execute function private.cronograma_categoria_do_sorteio();

-- Trocar o tipo do sorteio troca a tag do item; prêmio e identificação só
-- refazem o título.
create or replace function private.sorteio_atualiza_cronograma()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.cronograma
     set evento = private.titulo_cronograma(new.tipo, new.premio),
         categoria = case when old.tipo is distinct from new.tipo then new.tipo else categoria end
   where sorteio_id = new.id;
  return null;
end $$;

-- O encerramento agora também é reconhecido pela tag, não só pelo nome.
create or replace function private.cronograma_incluir_sorteio(p_sorteio bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.sorteios%rowtype;
  v_pos integer;
begin
  select * into s from public.sorteios where id = p_sorteio;
  if not found then return; end if;
  if exists (select 1 from public.cronograma where sorteio_id = s.id) then return; end if;

  select min(ordem) into v_pos
    from public.cronograma
   where evento_id = s.evento_id and (categoria = 'encerramento' or evento ~* 'encerramento');

  if v_pos is null then
    select coalesce(max(ordem), 0) + 1 into v_pos
      from public.cronograma where evento_id = s.evento_id;
  else
    update public.cronograma set ordem = ordem + 1
     where evento_id = s.evento_id and ordem >= v_pos;
  end if;

  insert into public.cronograma (evento_id, evento, ordem, status, sorteio_id, categoria)
  values (s.evento_id, private.titulo_cronograma(s.tipo, s.premio), v_pos, 'aguardando', s.id, s.tipo);
end $$;

revoke execute on function private.cronograma_categoria_do_sorteio(),
  private.sorteio_atualiza_cronograma(), private.cronograma_incluir_sorteio(bigint)
  from public, anon, authenticated;

-- Itens que já existiam: ligados a sorteio pegam o tipo; os demais, um palpite
-- pelo nome (a organização ajusta depois no editor).
update public.cronograma c
   set categoria = s.tipo
  from public.sorteios s
 where c.sorteio_id = s.id and c.categoria is null;

update public.cronograma
   set categoria = case
     when evento ~* 'encerramento' then 'encerramento'
     when evento ~* 'abertura' then 'abertura'
     when evento ~* 'apresenta|quadrilha|desfile|coroa|dan[cç]a' then 'apresentacao'
     else 'outro' end
 where categoria is null;
