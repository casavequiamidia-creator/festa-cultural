-- O WhatsApp que atende quem quer patrocinar a festa.
--
-- A vitrine de apoiadores na tela inicial manda a pessoa tocar no botão
-- flutuante do WhatsApp, e esse botão sai de `eventos.whatsapp`. Sem número
-- cadastrado o site cai no reserva de js/supabase-config.js — que agora também
-- é este mesmo — mas deixar gravado no banco é o que faz o painel mostrar o
-- número certo para a organização conferir.
--
-- Só a festa nomeada abaixo é tocada: outra escola tem o WhatsApp dela.

do $$
declare
  -- >>> Festa que recebe o número. Troque aqui se for a outra escola. <<<
  v_slug text := 'casavequia';
  v_whatsapp text := '5568974003616'; -- (68) 97400-3616
begin
  if not exists (select 1 from public.eventos where slug = v_slug) then
    raise exception 'Festa "%" não encontrada. Ajuste v_slug no topo deste bloco.', v_slug;
  end if;

  update public.eventos
  set whatsapp = v_whatsapp
  where slug = v_slug;
end;
$$;
