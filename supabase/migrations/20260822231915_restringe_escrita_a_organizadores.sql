-- Restringe a escrita das tabelas do evento a uma allowlist de organizadores.
--
-- Contexto: a migration inicial liberava escrita para QUALQUER usuário com o
-- papel `authenticated` (`using (true)`). Como o cadastro público estava aberto
-- e a chave anon é pública no front-end, qualquer pessoa podia criar uma conta
-- e alterar cardápio, sorteios e cronograma. Esta migration fecha esse furo.
--
-- A leitura pública (anon) permanece inalterada: os visitantes continuam lendo
-- as quatro tabelas normalmente.

-- 1. Schema fora da API -------------------------------------------------------
-- O PostgREST só expõe `public`, então nada aqui vira endpoint REST.
create schema if not exists private;

create table if not exists private.organizadores (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nome text,
  criado_em timestamptz not null default now()
);

comment on table private.organizadores is
  'Allowlist de quem pode escrever nas tabelas do evento. Administrada apenas pelo SQL Editor / service_role.';

alter table private.organizadores enable row level security;
-- Sem policies de propósito: nenhum papel da API alcança esta tabela.

-- 2. Função de verificação ----------------------------------------------------
-- SECURITY DEFINER para conseguir ler a allowlist sem expô-la, e sem recursão
-- de RLS. Não recebe parâmetro: só responde sobre quem está chamando, portanto
-- não é sondável por um usuário autenticado comum.
create or replace function private.is_organizador()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.organizadores
    where user_id = (select auth.uid())
  );
$$;

revoke execute on function private.is_organizador() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_organizador() to authenticated;

-- 3. Troca das policies de escrita -------------------------------------------
drop policy if exists "Organizadores autenticados: produtos" on public.produtos;
drop policy if exists "Organizadores autenticados: sorteios" on public.sorteios;
drop policy if exists "Organizadores autenticados: cronograma" on public.cronograma;
drop policy if exists "Organizadores autenticados: candidatas" on public.candidatas;

-- Também derruba os nomes novos, para o script poder ser reaplicado sem erro.
drop policy if exists "Escrita restrita a organizadores: produtos" on public.produtos;
drop policy if exists "Escrita restrita a organizadores: sorteios" on public.sorteios;
drop policy if exists "Escrita restrita a organizadores: cronograma" on public.cronograma;
drop policy if exists "Escrita restrita a organizadores: candidatas" on public.candidatas;

-- `(select ...)` faz o Postgres avaliar a função uma vez por query, não por linha.
create policy "Escrita restrita a organizadores: produtos"
  on public.produtos for all to authenticated
  using ((select private.is_organizador()))
  with check ((select private.is_organizador()));

create policy "Escrita restrita a organizadores: sorteios"
  on public.sorteios for all to authenticated
  using ((select private.is_organizador()))
  with check ((select private.is_organizador()));

create policy "Escrita restrita a organizadores: cronograma"
  on public.cronograma for all to authenticated
  using ((select private.is_organizador()))
  with check ((select private.is_organizador()));

create policy "Escrita restrita a organizadores: candidatas"
  on public.candidatas for all to authenticated
  using ((select private.is_organizador()))
  with check ((select private.is_organizador()));
