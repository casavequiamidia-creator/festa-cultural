-- Bucket de imagens da festa, usado pelo painel da organização.
--
-- Contexto: o painel passou a editar todos os campos dos itens, inclusive a
-- imagem. Em vez de pedir uma URL colada de outro site (que pode sair do ar no
-- meio da festa), o organizador envia a foto direto do celular e o arquivo fica
-- hospedado aqui.
--
-- Leitura é pública, porque as imagens aparecem para visitantes anônimos.
-- Escrita segue exatamente a mesma allowlist das tabelas: private.is_organizador().

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('festa', 'festa', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Idempotente: permite reaplicar o script.
drop policy if exists "Imagens da festa: leitura pública" on storage.objects;
drop policy if exists "Imagens da festa: organizadores enviam" on storage.objects;
drop policy if exists "Imagens da festa: organizadores substituem" on storage.objects;
drop policy if exists "Imagens da festa: organizadores apagam" on storage.objects;

create policy "Imagens da festa: leitura pública"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'festa');

create policy "Imagens da festa: organizadores enviam"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'festa' and (select private.is_organizador()));

create policy "Imagens da festa: organizadores substituem"
  on storage.objects for update to authenticated
  using (bucket_id = 'festa' and (select private.is_organizador()))
  with check (bucket_id = 'festa' and (select private.is_organizador()));

create policy "Imagens da festa: organizadores apagam"
  on storage.objects for delete to authenticated
  using (bucket_id = 'festa' and (select private.is_organizador()));
