-- Perfil público da candidata a Rainha Caipira.
--
-- Até aqui a aba Rainha era uma galeria: foto, nome, turma e horário do
-- desfile. A candidata não tinha onde se apresentar nem como puxar o público
-- para as próprias redes — e a rifa dela, que é como ela levanta voto e
-- dinheiro, circulava por print de link no WhatsApp.
--
-- Todas as colunas são opcionais e o front-end só desenha o bloco quando o
-- valor existe: candidata já cadastrada continua aparecendo igual, e a
-- organização preenche o perfil no ritmo dela.

alter table public.candidatas
  add column if not exists biografia text,
  add column if not exists whatsapp text,
  add column if not exists instagram text,
  add column if not exists facebook text,
  add column if not exists tiktok text,
  add column if not exists rifa_titulo text,
  add column if not exists rifa_descricao text,
  add column if not exists rifa_url text;

comment on column public.candidatas.biografia is
  'Texto em que a própria candidata se apresenta. Aparece na aba Biografia do perfil.';
comment on column public.candidatas.whatsapp is
  'Endereço completo do WhatsApp da candidata (https://wa.me/55...). O painel converte número solto em link.';
comment on column public.candidatas.instagram is
  'Endereço completo do perfil no Instagram. O painel converte @usuario em link.';
comment on column public.candidatas.facebook is
  'Endereço completo do perfil no Facebook. O painel converte @usuario em link.';
comment on column public.candidatas.tiktok is
  'Endereço completo do perfil no TikTok. O painel converte @usuario em link.';
comment on column public.candidatas.rifa_titulo is
  'Nome da rifa online da candidata. Ex.: "Rifa da cesta de café da manhã".';
comment on column public.candidatas.rifa_descricao is
  'Prêmio, valor do número e data do sorteio da rifa online. Texto curto.';
comment on column public.candidatas.rifa_url is
  'Link onde o visitante compra o número da rifa online da candidata.';

-- Os campos viram `href` na tela do visitante. Um `javascript:` gravado aqui
-- seria XSS servido pela própria escola, então o banco só aceita http/https —
-- o front-end filtra de novo na hora de desenhar, mas a barreira começa aqui.
do $$
declare
  campo text;
begin
  foreach campo in array array['whatsapp', 'instagram', 'facebook', 'tiktok', 'rifa_url']
  loop
    execute format('alter table public.candidatas drop constraint if exists candidatas_%s_http_check', campo);
    execute format(
      'alter table public.candidatas add constraint candidatas_%s_http_check check (%I is null or %I ~* ''^https?://[^[:space:]]+$'')',
      campo, campo, campo
    );
  end loop;
end;
$$;

-- Biografia é texto de apresentação, não artigo: o limite evita que um card
-- vire uma parede de texto no celular.
alter table public.candidatas drop constraint if exists candidatas_biografia_tamanho_check;
alter table public.candidatas add constraint candidatas_biografia_tamanho_check
  check (biografia is null or length(biografia) <= 1500);
