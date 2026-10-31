-- O item do cronograma acompanha o sorteio ao qual está ligado: trocar o tipo
-- (bingo, rifa, leilão), o prêmio ou a identificação no cadastro do sorteio
-- atualiza o título do item na hora, sem mexer na ordem nem na situação.
-- Só essas três colunas disparam a troca: as chamadas de números do bingo, que
-- mudam o sorteio o tempo todo, não encostam no cronograma.
-- Depende de 20260826060000_sorteios_no_cronograma.sql.

create or replace function private.titulo_cronograma(p_tipo text, p_premio text)
returns text language sql immutable set search_path = '' as $$
  select left(
    case p_tipo when 'bingo' then 'Bingo' when 'rifa' then 'Rifa' when 'leilao' then 'Leilão' else 'Sorteio' end
    || ' - ' || p_premio, 120)
$$;

-- Sorteio novo passa a entrar com o mesmo título que a edição produz.
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
  values (s.evento_id, private.titulo_cronograma(s.tipo, s.premio), v_pos, 'aguardando', s.id);
end $$;

create or replace function private.sorteio_atualiza_cronograma()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.cronograma
     set evento = private.titulo_cronograma(new.tipo, new.premio)
   where sorteio_id = new.id;
  return null;
end $$;

drop trigger if exists sorteio_atualiza_cronograma on public.sorteios;
create trigger sorteio_atualiza_cronograma
  after update of tipo, premio, identificacao on public.sorteios
  for each row
  when (old.tipo is distinct from new.tipo
     or old.premio is distinct from new.premio
     or old.identificacao is distinct from new.identificacao)
  execute function private.sorteio_atualiza_cronograma();

revoke execute on function private.titulo_cronograma(text, text),
  private.cronograma_incluir_sorteio(bigint),
  private.sorteio_atualiza_cronograma()
  from public, anon, authenticated;
