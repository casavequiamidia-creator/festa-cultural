# Especificação Técnica do Projeto: Festa Cultural (Arraial Digital)

## 📝 1. Visão Geral do Projeto
Este projeto consiste em um cardápio e painel logístico digital em tempo real para a Festa Junina/Arraial de uma escola. O objetivo principal é centralizar informações sobre comidas, brincadeiras, cronogramas, candidatas à Rainha Caipira e o acompanhamento ao vivo de bingos, rifas e leilões.

O sistema visa reduzir filas nas barracas (alertando os usuários para prepararem o PIX) e engajar o público permitindo que acompanhem os sorteios direto do celular, sem necessidade de atualizar a página.

### Stack Tecnológica Utilizada
- **Front-end:** HTML5 puro, CSS3 (responsivo com foco em Mobile-First) e JavaScript (ES6+).
- **Backend & Banco de Dados:** Supabase (PostgreSQL) com recursos de **Realtime Subscriptions** e **Supabase Auth** para a área administrativa.
- **Hospedagem:** Vercel.
- **Ferramentas de Desenvolvimento:** VS Code, Git/GitHub e assistentes de IA de código.

---

## 🗄️ 2. Arquitetura do Banco de Dados (Supabase)

Para garantir o funcionamento em tempo real, as seguintes tabelas precisam ser criadas no banco de dados.

### Tabela: `produtos` (Cardápio e Brincadeiras)
- `id`: int8 (Primary Key, Auto-increment)
- `created_at`: timestamptz
- `nome`: text
- `descricao`: text
- `preco`: numeric(10,2)
- `imagem_url`: text
- `categoria`: text (Valores: 'comida', 'salgado', 'doce', 'bebida', 'brincadeira')
- `status`: text (Valores: 'disponivel', 'poucas_unidades', 'esgotado')
- `limite_alerta`: int4 (Ex: se estoque chegar a X, muda automaticamente ou via admin)

### Tabela: `sorteios` (Bingo, Rifas e Leilões)
- `id`: int8 (Primary Key, Auto-increment)
- `identificacao`: text (Ex: "Sorteio #01", "Rifa do Leitão")
- `premio`: text
- `tipo`: text (Valores: 'bingo', 'rifa', 'leilao')
- `valor_cartela`: numeric(10,2)
- `status`: text (Valores: 'aguardando', 'em_andamento', 'realizado')
- `numeros_sorteados`: jsonb / int4[] (Array para guardar os números já chamados no bingo)
- `ultimo_numero`: int4 (Último número sorteado para destaque na tela)

### Tabela: `cronograma`
- `id`: int8 (Primary Key, Auto-increment)
- `evento`: text
- `horario_previsto`: time (HH:MM:SS)
- `status`: text (Valores: 'pendente', 'realizado')
- `sorteio_id`: int8 (Foreign Key opcional apontando para a tabela `sorteios`)

### Tabela: `candidatas` (Rainha Caipira)
- `id`: int8 (Primary Key, Auto-increment)
- `nome`: text
- `detalhes`: text (Ex: "Representante do 6º Ano A")
- `foto_url`: text
- `horario_desfile`: time
- `idade`: int2 (opcional, exibida no card)
- `biografia`: text (a candidata falando dela mesma; vira a aba Biografia do perfil)
- `whatsapp` / `instagram` / `facebook` / `tiktok`: text (endereço https completo; o painel converte `@usuario` ou número de telefone em link)
- `rifa_titulo`, `rifa_descricao`, `rifa_url`: text (rifa online da candidata, exibida na aba Rifa online do perfil)

---

## 📱 3. Estrutura do Front-end (Visão do Visitante)

O site será uma Single Page Application (SPA) simples ou um conjunto de páginas interligadas por uma **Sidebar Lateral** (que se transforma em uma barra de navegação inferior em dispositivos móveis).

### Menu de Navegação (Sidebar)
1. 🏠 Início
2. 🍔 Cardápio
3. 📱 PIX
4. 🎟️ Sorteios & Bingo
5. 👑 Rainha Caipira
6. 🎯 Barracas & Brincadeiras
7. 📅 Cronograma

---

### Detalhamento das Telas (Visitante)

#### 🏠 3.1. Tela: Início
- **Destaque Realtime (Banner Hero):** Se a tabela `sorteios` tiver algum item com status `em_andamento`, um card de destaque gigante aparece no topo: *"🔥 SORTEIO EM ANDAMENTO: [Nome do Prêmio]! Clique aqui para acompanhar ao vivo!"*. Ao clicar, redireciona o usuário para a aba de Sorteios.
- **Mural de Patrocinadores:** Seção no rodapé exibindo a logo das empresas parceiras e apoiadoras da escola.
- **Botão de Ajuda Rápida:** Botão para abrir o WhatsApp de suporte ou dos vendedores ambulantes de cartela.

#### 🍔 3.2. Tela: Cardápio Digital
- **Aviso Estratégico no Topo (Fixo):** *"💡 Vai pagar no PIX? Copie a chave na aba PIX e abra o app do seu banco antes de entrar na fila!"*
- **Botões de Filtro Rápido:** `[Todos]` `[Comidas]` `[Salgados]` `[Doces]` `[Bebidas]`. A filtragem deve ocorrer instantaneamente via JavaScript.
- **Exibição dos Itens:** Cards com imagem, título, preço e badge de status.
  - Se `status == 'poucas_unidades'`: Exibir tag amarela *"Restam poucas unidades!"*.
  - Se `status == 'esgotado'`: Aplicar opacidade no card, desabilitar interações e exibir carimbo visual *"ESGOTADO"*.

#### 📱 3.3. Tela: PIX
- **QR Code:** Imagem ampliada do QR Code estático da conta da escola.
- **Botão Copiar Chave (Copia e Cola):** Botão destacado que executa `navigator.clipboard.writeText()` para copiar a chave Pix. Ao clicar, exibe um feedback visual temporário: *"Chave copiada! Abra o app do seu banco."*
- **Dados de Conferência:** Exibição clara do Nome do Favorecido e Instituição Financeira abaixo do código para validação do usuário.

#### 🎟️ 3.4. Tela: Sorteios & Bingo (Mecanismo Realtime)
- Exibe a lista de prêmios dividida por abas ou cards com tags: `Aguardando` (Cinza), `Em andamento` (Verde piscante) e `Realizado` (Vermelho).
- Cada card exibe a identificação do sorteio, imagem do prêmio e valor da cartela.
- **Botão "Acompanhar Sorteio":** Ao clicar no prêmio em andamento, abre a interface interna de sorteio:
  - **Se for Bingo:** Renderiza um painel visual baseado no padrão **B-I-N-G-O**. Os números do array `numeros_sorteados` preenchem suas respectivas colunas em uma tabela organizada abaixo de cada letra. O `ultimo_numero` ganha tamanho gigante e animação de destaque na tela.
  - **Se for Rifa/Leilão:** Mostra em tamanho gigante o último número da rifa chamado ou o último lance do leilão, seguido por uma lista histórica menor dos lances/números anteriores.
  - **Tecnologia:** Usa `supabase.channel()` para escutar mudanças em tempo real na tabela de sorteios sem precisar atualizar o navegador.

#### 👑 3.5. Tela: Rainha Caipira
- Apresentação em formato de galeria com os cards das candidatas.
- Cada card contém Foto, Nome, Série/Turma representada, detalhes e o horário marcado para o desfile e entrega da faixa.
- **Perfil da candidata:** o botão "Ver perfil" abre uma janela sobre a tela com a foto em destaque, os dados da candidata e:
  - **Redes sociais:** logos de WhatsApp, Instagram, Facebook e TikTok, cada uma ancorada ao endereço cadastrado pela organização. Só aparece a logo da rede preenchida.
  - **Aba Biografia:** o texto em que a própria candidata se apresenta.
  - **Aba Rifa online:** título, detalhes e o botão que leva ao link onde a candidata vende os números da rifa dela.
  - **Compartilhar perfil:** usa o menu nativo do celular (`navigator.share`) e, onde ele não existe, copia o link. O endereço compartilhado é `/<festa>?candidata=<id>`, que abre o site já com o perfil na tela.
- Todos esses campos são editados pela conta da organização — no painel ou pelo modo "ver como visitante", tocando em **Editar** no card da candidata.

#### 🎯 3.6. Tela: Barracas & Brincadeiras
- Lista das atividades disponíveis (Pescaria, Canaleta, Cadeia, Correio Elegante).
- Exibe o preço de cada brincadeira e informações úteis inseridas pela administração (ex: localização ou estado da fila).

#### 📅 3.7. Tela: Cronograma Dinâmico
- Linha do tempo ou lista de cards com as atrações ordenadas por horário.
- **Contagem Regressiva:** Cada card possui um script JavaScript que calcula a diferença entre o horário atual do celular do visitante e o `horario_previsto`, exibindo um cronômetro regressivo: *"Faltam XX minutos"*.
- **Interatividade:** Se o evento for concluído, o admin altera o status para `realizado` e o card exibe a tag *"Realizado"*. Se o evento for associado a um `sorteio_id`, o card ganha um link direto para a aba de sorteios.

---

## 🛡️ 4. Painel Administrativo (`/admin.html`)

Página de acesso restrito, protegida por autenticação simples (Supabase Auth). Deve ser otimizada para uso mobile rápido pelos organizadores durante o evento.

### Recursos do Painel Administrativo

#### 🛠️ 4.1. Gerenciamento do Cardápio / Barracas
- Lista compacta de todos os itens com seletores rápidos de estado:
  - Botão `[Disponível]` -> Atualiza status para 'disponivel'.
  - Botão `[Poucas Unidades]` -> Atualiza status para 'poucas_unidades'.
  - Botão `[Esgotado]` -> Atualiza status para 'esgotado'.
- Alteração reflete instantaneamente para os visitantes através do Supabase Realtime.

#### 🎲 4.2. Console de Controle do Bingo / Sorteio
- Seletor para definir qual prêmio está ativo no momento.
- Botões de controle de estado do sorteio: `[Iniciar Sorteio]`, `[Pausar/Suspender]`, `[Encerrar Sorteio]`.
- **Input de Números:** Campo numérico com botão grande `[Chamar Número / Confirmar Lance]`. 
  - Ao ser clicado, insere o número digitado no array `numeros_sorteados` e atualiza o campo `ultimo_numero` no banco de dados.
- Botão de segurança: `[Limpar / Resetar Sorteio Atual]`.

#### 📅 4.3. Controle do Cronograma
- Lista de eventos do cronograma com um botão alternador de estado `[Marcar como Realizado]` / `[Reverter para Pendente]`.

#### 📢 4.4. Sistema de Avisos Globais (Banner de Notificação)
- Um campo de texto livre no topo do painel admin com o botão `[Disparar Alerta Público]`.
- Quando enviado, exibe uma tarja de notificação fixa em tempo real no topo de todas as páginas de todos os visitantes (Ex: *"Atenção: Dono do veículo placa ABC-1234, favor retirá-lo do portão principal"*).

---

## 🚀 5. Instruções para a IA de Código

Ao gerar os arquivos deste projeto, siga as diretrizes abaixo:
1. **Código Limpo e Modular:** Separe a lógica do Supabase em um arquivo `supabase-config.js` e as interações de UI em arquivos específicos de cada módulo se necessário, ou organize-os claramente em um script central bem documentado.
2. **Design Responsivo:** Priorize o CSS focado em celulares (telas de 360px a 450px), pois os usuários acessarão via QR Code impresso no local do evento. Use variáveis CSS para cores temáticas juninas (laranja, amarelo, amadeirado, retalhos coloridos).
3. **Gerenciamento do Realtime:** Certifique-se de ativar os recursos de *Realtime* nas tabelas do Supabase via código SQL fornecido na inicialização. Sempre trate reconexões de rede de forma amigável no front-end, já que redes móveis em eventos costumam oscilar.
