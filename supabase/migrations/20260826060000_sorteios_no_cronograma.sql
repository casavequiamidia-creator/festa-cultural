-- Todo sorteio (bingo, rifa ou leilão) tem o seu lugar no cronograma:
--   * sorteio novo entra sozinho, logo antes do item de encerramento da festa
--     (ou no fim da fila, se a festa não tiver um item de encerramento);
--   * sorteio apagado leva o item dele junto;
--   * os sorteios que já existiam sem item no cronograma entram agora.
-- Depende de 20260826050000_cronograma_por_ordem.sql (coluna `ordem` e os
-- gatilhos que renumeram o "Nº Prêmio").

create or replace function private.cronograma_incluir_sorteio(p_sorteio bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.sorteios%rowtype;
  v_pos integer;
begin
  select * into s from public.sorteios where id = p_sorteio;
  if not found then return; end if;
  if exists (select 1 from public.cronograma where sorteio_id = s.id) then return; end if;

  -- O encerramento é o item que fecha a noite: o sorteio entra na frente dele.
  select min(ordem) into v_pos
    from public.cronograma
   where evento_id = s.evento_id and evento ~* 'encerramento';

  if v_pos is null then
    select coalesce(max(ordem), 0) + 1 into v_pos
      from public.cronograma where evento_id = s.evento_id;
  else
    update public.cronograma set ordem = ordem + 1
     where evento_id = s.evento_id and ordem >= v_pos;
  end if;

  insert into public.cronograma (evento_id, evento, ordem, status, sorteio_id)
  values (s.evento_id, left(s.identificacao || ' · ' || s.premio, 120), v_pos, 'aguardando', s.id);
end $$;

create or replace function private.sorteio_entra_no_cronograma()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.cronograma_incluir_sorteio(new.id);
  return null;
end $$;

drop trigger if exists sorteio_entra_no_cronograma on public.sorteios;
create trigger sorteio_entra_no_cronograma
  after insert on public.sorteios
  for each row execute function private.sorteio_entra_no_cronograma();

create or replace function private.sorteio_sai_do_cronograma()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.cronograma where sorteio_id = old.id;
  return old;
end $$;

drop trigger if exists sorteio_sai_do_cronograma on public.sorteios;
create trigger sorteio_sai_do_cronograma
  before delete on public.sorteios
  for each row execute function private.sorteio_sai_do_cronograma();

revoke execute on function private.cronograma_incluir_sorteio(bigint),
  private.sorteio_entra_no_cronograma(), private.sorteio_sai_do_cronograma()
  from public, anon, authenticated;

-- Quem já existia e ainda não tinha item entra agora, na ordem dos prêmios.
do $$
declare r record;
begin
  for r in select id from public.sorteios order by evento_id, ordem_premio nulls last, id loop
    perform private.cronograma_incluir_sorteio(r.id);
  end loop;
end $$;
