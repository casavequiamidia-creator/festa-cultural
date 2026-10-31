-- Cronograma sem horários: a ordem é que manda.
--   * `ordem` posiciona cada item (o painel reordena arrastando);
--   * `status` passa a ser aguardando / proximo / realizado;
--   * o horário previsto deixa de ser obrigatório (a coluna fica, sem uso);
--   * o "Nº Prêmio" de cada sorteio acompanha a posição dele no cronograma.

alter table public.cronograma add column if not exists ordem integer;

-- Quem já existia mantém a sequência que o horário dava.
update public.cronograma c
   set ordem = r.pos
  from (
    select id, row_number() over (partition by evento_id order by horario_previsto, id) as pos
      from public.cronograma
  ) r
 where c.id = r.id and c.ordem is null;

alter table public.cronograma alter column ordem set not null;
alter table public.cronograma alter column horario_previsto drop not null;

alter table public.cronograma drop constraint if exists cronograma_status_check;
update public.cronograma set status = 'aguardando' where status = 'pendente';
alter table public.cronograma alter column status set default 'aguardando';
alter table public.cronograma
  add constraint cronograma_status_check check (status in ('aguardando', 'proximo', 'realizado'));

create index if not exists cronograma_evento_ordem_idx on public.cronograma (evento_id, ordem);

-- Item novo entra no fim da fila da festa.
create or replace function private.cronograma_ordem_inicial()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ordem is null then
    select coalesce(max(ordem), 0) + 1 into new.ordem
      from public.cronograma where evento_id = new.evento_id;
  end if;
  return new;
end $$;

drop trigger if exists cronograma_ordem_inicial on public.cronograma;
create trigger cronograma_ordem_inicial
  before insert on public.cronograma
  for each row execute function private.cronograma_ordem_inicial();

-- O prêmio de cada sorteio ligado ao cronograma é a posição dele entre os
-- sorteios do cronograma: mover o item muda o "Nº Prêmio" do card sozinho.
create or replace function private.renumerar_premios(p_evento bigint)
returns void language sql security definer set search_path = '' as $$
  update public.sorteios s
     set ordem_premio = r.pos
    from (
      select sorteio_id, row_number() over (order by min(ordem), min(id))::smallint as pos
        from public.cronograma
       where evento_id = p_evento and sorteio_id is not null
       group by sorteio_id
    ) r
   where s.id = r.sorteio_id and s.ordem_premio is distinct from r.pos;
$$;

create or replace function private.cronograma_renumera_premios()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform private.renumerar_premios(old.evento_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform private.renumerar_premios(new.evento_id); end if;
  return null;
end $$;

drop trigger if exists cronograma_renumera_premios on public.cronograma;
create trigger cronograma_renumera_premios
  after insert or delete or update of ordem, sorteio_id, evento_id on public.cronograma
  for each row execute function private.cronograma_renumera_premios();

revoke execute on function private.cronograma_ordem_inicial(), private.renumerar_premios(bigint),
  private.cronograma_renumera_premios() from public, anon, authenticated;

-- Reordena de uma vez só (uma ida ao banco, uma notificação em tempo real por
-- linha). Roda com os direitos de quem chama: só organizador escreve.
create or replace function public.reordenar_cronograma(p_evento bigint, p_ids bigint[])
returns void language sql security invoker set search_path = '' as $$
  update public.cronograma c
     set ordem = t.pos
    from unnest(p_ids) with ordinality as t(id, pos)
   where c.id = t.id and c.evento_id = p_evento;
$$;

revoke execute on function public.reordenar_cronograma(bigint, bigint[]) from public, anon;
grant execute on function public.reordenar_cronograma(bigint, bigint[]) to authenticated;

-- Acerta os selos dos sorteios que já estavam ligados ao cronograma.
do $$
declare e bigint;
begin
  for e in select distinct evento_id from public.cronograma loop
    perform private.renumerar_premios(e);
  end loop;
end $$;
