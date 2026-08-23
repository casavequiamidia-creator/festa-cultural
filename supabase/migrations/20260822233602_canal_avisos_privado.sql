-- Torna o canal de avisos globais um canal privado (Realtime Authorization).
--
-- Contexto: `avisos-globais` era um canal público. Qualquer visitante com o
-- DevTools aberto podia enviar um broadcast e exibir a tarja de aviso falsa
-- para todo mundo conectado. Verificado na prática: um cliente anônimo
-- conseguia dar join e enviar.
--
-- A partir daqui o canal exige `private: true` no cliente, e o Realtime passa
-- a consultar as policies abaixo em realtime.messages:
--   SELECT  = permissão para RECEBER mensagens do tópico
--   INSERT  = permissão para ENVIAR mensagens no tópico

-- Idempotente: permite reaplicar o script.
drop policy if exists "Avisos: visitantes recebem" on realtime.messages;
drop policy if exists "Avisos: apenas organizadores enviam" on realtime.messages;

-- Quem RECEBE: qualquer visitante, logado ou não, mas só no tópico de avisos.
create policy "Avisos: visitantes recebem"
  on realtime.messages
  for select
  to anon, authenticated
  using (
    (select realtime.topic()) = 'avisos-globais'
    and realtime.messages.extension = 'broadcast'
  );

-- Quem ENVIA: apenas organizadores da allowlist criada na migration anterior.
create policy "Avisos: apenas organizadores enviam"
  on realtime.messages
  for insert
  to authenticated
  with check (
    (select realtime.topic()) = 'avisos-globais'
    and realtime.messages.extension = 'broadcast'
    and (select private.is_organizador())
  );
