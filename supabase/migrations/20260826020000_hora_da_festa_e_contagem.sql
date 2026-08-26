-- Hora da festa: o que faz o relógio regressivo correr e o convite da agenda.
--
-- `eventos.data_evento` já guardava o dia, mas dia sozinho não dá contagem
-- regressiva nem evento de calendário: quem abre o site precisa saber a que
-- horas começa, e a agenda do celular precisa de um início e de um fim.
--
-- As três colunas são opcionais. Festa sem `data_evento` simplesmente não
-- mostra o bloco da contagem — a tela inicial continua igual à de hoje.

alter table public.eventos
  add column if not exists hora_evento  time,
  add column if not exists hora_fim     time,
  add column if not exists local_evento text;

comment on column public.eventos.data_evento is
  'Dia da festa. É daqui que sai a contagem regressiva da tela inicial.';
comment on column public.eventos.hora_evento is
  'Hora de início. Vazio, a contagem regressiva mira a virada do dia e o convite da agenda vira evento de dia inteiro.';
comment on column public.eventos.hora_fim is
  'Hora de término, só para o convite da agenda. Vazio, o convite dura 4 horas. Pode ser menor que a de início: arraial que vira a noite termina no dia seguinte.';
comment on column public.eventos.local_evento is
  'Endereço que vai no evento criado na agenda do celular. Vazio, cai no nome da escola.';

-- Hora de término sem hora de início não diz nada: seria um fim solto no dia.
alter table public.eventos drop constraint if exists eventos_hora_fim_precisa_inicio_check;
alter table public.eventos add constraint eventos_hora_fim_precisa_inicio_check
  check (hora_fim is null or hora_evento is not null);
