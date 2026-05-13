# Gestão Ágil — Ops Ahead

> **Método:** Scrumban (Scrum por sprint + fluxo Kanban no dia-a-dia)
> **Ferramenta:** GitHub Projects (board integrado ao repositório)
> **Sprints fixas:** seguem o cronograma da FIAP Enterprise Challenge 2026

---

## Por que Scrumban e não Scrum puro

O Challenge nos dá 4 entregas com data fixa — isso é Scrum (sprints com escopo fechado). Mas o time é de 5 pessoas e o dia-a-dia é muito mais contínuo do que ritualizado: tarefa chega fora da janela do planning, dependência aparece do nada, e travar tudo a cada duas semanas só atrapalha.

Por isso usamos **Scrumban**:

- **Do Scrum** ficamos com: as 4 sprints com escopo fechado, kickoff no início, fechamento (review + retro) na véspera da entrega.
- **Do Kanban** ficamos com: fluxo contínuo no board (quando termina uma tarefa, puxa a próxima), **WIP limits** por coluna, e o board é quem dá o status — não uma Daily.
- **O que cortamos:** Daily diária (excesso de ritual pra time pequeno), burndown chart, story points em Fibonacci, velocity tracking. Pra time de 5 pessoas em projeto de 5 meses, o trabalho extra não compensa — a gente acompanha vazão (cards/semana) e tempo de ciclo, e é o suficiente.

---

## Estrutura do Time

Somos 5 pessoas e o time toca o projeto de forma horizontal — sem PO fixo nem dono permanente de área. Quem pega o card decide a implementação, abre PR e revisa o dos outros. As discussões de prioridade e direção saem no chat do time ou nos encontros fixos da semana.

| Integrante | RM |
| :--- | :--- |
| Gustavo Neves | RM561572 |
| João Porto | RM565092 |
| Raphael Moraes | RM564098 |
| Samuel Gusman | RM562124 |
| Thiago Nunes | RM565900 |

### Scrum Master rotativo

A cada sprint um integrante assume o papel de Scrum Master — toca as cerimônias, ajuda a destravar bloqueios, mantém o board condizente com a realidade e cuida do contato com FIAP/Locaweb na janela da sprint. A rotação ficou assim:

| Sprint | Scrum Master |
| :--- | :--- |
| Sprint 1 — Ideação | João Porto |
| Sprint 2 — Arquitetura | Samuel Gusman |
| Sprint 3 — MVP | Raphael Moraes |
| Sprint 4 — Solução Final | Gustavo Neves |

---

## Como a gente se organiza

A rotina do time roda em dois encontros síncronos fixos por semana — **segunda e sexta, ~2 h cada** — apoiados pelo chat do time (canal assíncrono) e pelo board do GitHub, que é a fonte oficial de status. Os dois encontros têm propósito diferente e juntos cobrem o ciclo Plan → Build → Review da semana:

| Encontro | Quando | Duração | O que rola |
| :--- | :--- | :--- | :--- |
| **Planejamento semanal** | Segunda | ~2 h | Revisar o board, alinhar prioridades da semana, pegar os próximos cards. Bloqueios da semana anterior são tratados aqui. |
| **Review semanal** | Sexta | ~2 h | Demo do que foi entregue na semana, code review em grupo dos PRs maiores, ajuste de escopo se algo escorregou. |

Por cima dessa rotina, dois marcos por sprint:

- **Kickoff da sprint** — acontece no primeiro Planejamento depois do brief sair. Em vez das 2 h de planejamento normal, o time aloca ~3 h pra ler o brief, quebrar a entrega em stories, definir critério de aceite e fechar o refinement das primeiras stories.
- **Fechamento da sprint** — acontece no último Review antes da entrega. Roda a apresentação inteira, captura ajustes finais e termina com um Start/Stop/Continue curto pra Sprint seguinte.

Fora desses momentos, o chat do time fica aberto pra dúvida e desbloqueio — quem responder primeiro destrava. Decisão técnica relevante volta pro Review da sexta pra registro.

---

## Board no GitHub Projects

### Colunas

| Coluna | O que entra | WIP limit |
| :--- | :--- | :--- |
| **Backlog** | Tudo que ainda não foi puxado pra sprint atual | — |
| **Ready** | Stories priorizadas pra sprint corrente, prontas pra começar | — |
| **In progress** | Em execução | **2 por pessoa** |
| **In review** | Aguardando code review ou validação | **5 total** |
| **Done** | Aceito e mergeado | — |

### Convenções

- **Issue do GitHub** = **story**; **tasklist dentro da issue** = **tasks**.
- **Sprint** = **Milestone** do repo. Cada issue é atribuída ao Milestone da sprint correspondente (Sprint 1, Sprint 2, Sprint 3 ou Sprint 4), com a data-FIAP como due date.
- **Labels obrigatórias:** `type:research`/`type:design`/`type:dev`/`type:docs` (em inglês pra ficar consistente com a UI do GitHub).
- **Camada da arquitetura** (Data/ML/Agent/UI/Infra/Docs) vai no campo **Layer** do project, não em label.
- **Nome de branch:** `feat/<slug-curto-da-story>` (ex.: `feat/camada-dados`, `docs/arquitetura-md`).
- **PR linkado:** toda story que mexe em código tem PR ligado à issue (fecha sozinha no merge).

### Definition of Done (geral)

- **Story de código:** PR aprovado por pelo menos 1 revisor, sem teste vermelho, sem regressão no lint.
- **Story de documentação:** texto revisado por outro membro do time e linkado no `README.md` ou no índice da sprint.
- **Story de design:** wireframe/protótipo subido em `docs/sprint-XX/` ou link do Figma colado na issue.

---

## Sprint 1 — Ideação `[Concluída — 27/04/2026]`

**Objetivo da sprint:** entregar a ideação do projeto — nome, problema, público-alvo, proposta de solução, comparativo de mercado e roteiro da apresentação.

**Entregável:** documento de ideação + roteiro da apresentação + slides em HTML + PPTX final pro portal da FIAP.

### Stories

#### Ler o brief do Challenge e a ata de kickoff
**Responsável:** Thiago Nunes
**Descrição:** ler o material da FIAP e da Locaweb pra entender o problema antes de mexer nos dados.
**Tasks:**
- [x] Ler o brief da FIAP (contexto geral + escopo da Sprint 1)
- [x] Ler a ata do kickoff com a Locaweb
- [x] Resumir em 5–7 bullets o que importa (escala da Locaweb, BOPE, regras de OLA, peso do bônus)
- [x] Mandar o resumo no chat do time

#### Análise exploratória do dataset de incidentes
**Responsável:** Thiago Nunes
**Descrição:** entender como os 122k incidentes se distribuem pra basear a ideação em número, não em chute.
**Tasks:**
- [x] Configurar `uv` e dependências (`pandas`, `matplotlib`)
- [x] Carregar `assets/incidents.csv` e conferir contagem de linhas
- [x] Olhar distribuição de prioridade, status e origem (monitoramento vs manual)
- [x] Calcular % de "Sem Intervenção" (65,6%) e ver que Team14 concentra 75,7%
- [x] Calcular violações de OLA e a taxa (1% — 248/25.600)
- [x] Achar os incidentes < 60s (18% — sinal de ruído)
- [x] Escrever o relatório da EDA com os achados e gráficos

#### Cruzar kickoff × dataset
**Responsável:** Gustavo Neves
**Descrição:** ver se o que a Locaweb falou na ata bate com o que aparece nos dados.
**Tasks:**
- [x] Cruzar números da ata (3,4M caixas, 500k sites) com o que o dataset cobre
- [x] Conferir regra do OLA P1+P2 (máx 3 violações/mês) contra os 248 breaches anuais
- [x] Confirmar que Team14 é N1 humano (e não bot)
- [x] Escrever um doc curto cruzando ata × dados pra circular no time

#### Definir nome e identidade do projeto
**Responsável:** Raphael Moraes
**Descrição:** o nome vai aparecer em toda apresentação — tem que ser fácil de lembrar e combinar com a ideia.
**Tasks:**
- [x] Brainstorm em grupo (30 min) — sair com 10–15 candidatos
- [x] Filtrar por: domínio disponível, sem conflito com marca existente e encaixe com "antecipação"
- [x] Fechar em **Ops Ahead** ("operação à frente, visão antecipada")
- [x] Decidir o slogan: "Veja o incidente antes que ele aconteça"
- [x] Rascunhar a arte (seta sobre uma timeline) pro Slide 2

#### Levantar os problemas centrais a resolver
**Responsável:** João Porto
**Descrição:** tirar dos achados da EDA quais são os problemas operacionais reais que a solução tem que atacar. Mira em uns 4 problemas — menos que isso fica raso, mais que isso a apresentação não fecha.
**Tasks:**
- [x] Listar os buracos da operação atual (a partir dos dados, sem chutar)
- [x] Fechar em 4 problemas: picos não antecipados, sinais preditivos desperdiçados, OLA invisível, concentração sem resposta
- [x] Cada problema com 1 dado do dataset que sustenta o argumento
- [x] Revisar em grupo pra ver se cobre o brief

#### Definir o público-alvo
**Responsável:** João Porto
**Descrição:** o brief pede pelo menos 3 níveis (primário, secundário e indireto) — deixar claro quem ganha o quê.
**Tasks:**
- [x] Mapear as personas: BOPE (N1/N2/N3), gestores operacionais, clientes Locaweb
- [x] Pra cada nível, escrever "como se beneficia" em 1 frase
- [x] Montar a tabela pro `ideacao.md`

#### Desenhar a proposta de solução
**Responsável:** Time inteiro
**Descrição:** desenhar a arquitetura conceitual em camadas (a ideia é fechar em ~4: dados → modelos → agente LLM → interfaces) **sem** fechar tecnologia — isso fica pra Sprint 2.
**Tasks:**
- [x] Reunião de 2h pra alinhar o conceito
- [x] Camada 1 (Pipeline de Dados) — features temporais, filtros de ruído
- [x] Camada 2 (Modelos Preditivos) — 3 modelos: volume, breach, rajada
- [x] Camada 3 (Agente LLM) — function calling + RAG + structured output
- [x] Camada 4 (Interface de Decisão) — painel operacional e tático
- [x] Cada camada com 1 parágrafo descrevendo

#### Escolher a técnica de cada modelo
**Responsável:** Samuel Gusman
**Descrição:** ideação não é só dizer "vamos usar ML" — é dizer **qual** algoritmo pra **qual** pergunta e **por quê**. Temos 3 perguntas pra responder (volume, breach, rajada), então 3 modelos.
**Tasks:**
- [x] Volume: SARIMA/Prophet de baseline + LightGBM principal (features de lag, sazonalidade)
- [x] Breach: LightGBM/XGBoost + calibração isotônica + SHAP
- [x] Rajada: z-score robusto + CUSUM por IC (sem treino)
- [x] Definir a métrica de avaliação de cada modelo (MAPE, AUC-PR, lead-time)
- [x] Deixar escrito o split temporal sem leakage

#### Detalhar a camada de Agente LLM
**Responsável:** Thiago Nunes
**Descrição:** o agente é o que mais nos diferencia — precisa ficar concreto: ferramentas, fluxo e guardrails.
**Tasks:**
- [x] Listar as 4 ferramentas iniciais (`get_recent_incidents`, `get_group_load`, `find_similar_resolved`, `get_ola_window`)
- [x] Descrever o fluxo: recebe sinal → busca contexto → reavalia → emite TL;DR
- [x] Rascunhar o schema JSON da saída (criticidade, acao, atua, janela_minutos, similares)
- [x] Definir os guardrails (validação Pydantic, fallback, auditoria)

#### Mapear concorrência
**Responsável:** Raphael Moraes
**Descrição:** mostrar onde o Ops Ahead se encaixa em relação aos AIOps que já existem — senão a banca pergunta o que tem de diferente. Listar pelo menos 4 concorrentes (PagerDuty, Moogsoft, BigPanda e Dynatrace são bons candidatos).
**Tasks:**
- [x] Pesquisar PagerDuty AIOps, Moogsoft, BigPanda, Dynatrace Davis AI
- [x] Pra cada um, escrever "o que faz" e "limitação"
- [x] Montar a matriz de funcionalidades (Ops Ahead × concorrentes)
- [x] Listar 5 diferenciais que são reais (não papo de marketing)

#### Listar impactos e benefícios esperados
**Responsável:** Gustavo Neves
**Descrição:** o brief separa impactos de benefícios — então é separar "o que muda" de "o que a gente ganha".
**Tasks:**
- [x] Impactos em 4 frentes: operacional, financeiro, cliente, gestão
- [x] Benefícios operacionais (menos breach, alívio do N1, filtragem de ruído)
- [x] Benefícios estratégicos (turnover, capacidade, conhecimento, evolução do auto-healing)

#### Escrever o documento de ideação
**Responsável:** Thiago Nunes
**Descrição:** juntar o que saiu das stories anteriores em um doc único e coerente.
**Tasks:**
- [x] Organizar nas seções pedidas pelo brief (nome, problema, público, proposta, impacto, benefícios, comparativo)
- [x] Espalhar os números da EDA como evidência ao longo do texto
- [x] Revisão cruzada (cada um revisa pelo menos uma seção)
- [x] Fechar a versão final e subir no repo

#### Roteiro da apresentação
**Responsável:** João Porto
**Descrição:** transformar o doc de ideação em roteiro pros slides (uns 10 slides, slide a slide, com dica de design pra cada um).
**Tasks:**
- [x] Decidir a estrutura geral dos slides
- [x] Slide a slide: o que mostrar, dica visual e texto
- [x] Incluir um slide resumo com os verbos da solução (prever, detectar, priorizar, recomendar, aprender)
- [x] Fechar o roteiro num doc próprio pra alimentar os slides

#### Slides HTML estilizados (template visual)
**Responsável:** Raphael Moraes
**Descrição:** os slides ficam em HTML (template padrão do time), 1280×720, paleta `#0B0F19 / #F9203E`.
**Tasks:**
- [x] Adaptar o template visual ao tema da Locaweb (paleta + fontes Poppins/Inter/JetBrains Mono)
- [x] Passar o roteiro pra HTML — 1 slide por seção
- [x] Colocar o logo da equipe e o footer "FIAP + locaweb"
- [x] Subir o HTML final no repo

#### Gerar o PPTX final pra entrega
**Responsável:** Samuel Gusman
**Descrição:** a FIAP pede entrega em PPTX seguindo o template `01Template_IDEACAO_Challenge_2026_01_locaweb_v1` — gerar a partir do HTML sem perder o visual.
**Tasks:**
- [x] Converter HTML → PPTX sem quebrar layout
- [x] Conferir fonte, cor e alinhamento abrindo o PPTX de verdade
- [x] Colar foto dos membros no slide de equipe (RMs e nomes em ordem alfabética, como o brief exige)
- [x] Renomear o arquivo no padrão `EC_Sprint_1_2TSCOA_ideacaoprojeto_OpsAhead_SuperDatados.pptx`
- [x] Subir no portal FIAP ON até 27/04

#### Fechamento da Sprint 1
**Responsável:** João Porto (Scrum Master)
**Descrição:** rodar a apresentação inteira pra alinhar últimos ajustes e fazer um Start/Stop/Continue curto antes da Sprint 2 começar.
**Tasks:**
- [x] Rodar a apresentação inteira em chamada
- [x] Coletar ajustes finais antes da entrega
- [x] Start/Stop/Continue rápido
- [x] Anotar 3 ações pra Sprint 2 (o que evitar)

---

## Sprint 2 — Arquitetura e Desenho `[Em curso — entrega 24/05/2026]`

**Objetivo da sprint:** tirar a ideação do papel — arquitetura completa, tecnologia escolhida e justificada, wireframes da UI e plano de implantação K8s.

**Entregável:** documento de arquitetura + roteiro da apresentação + slides em HTML + PPTX + este documento de gestão ágil.

### Stories

#### Análise exploratória da Sprint 2 — status page × dataset
**Responsável:** Thiago Nunes
**Status:** Done
**Descrição:** o brief da Sprint 2 cita "análise exploratória dos dados" como item obrigatório — a gente já tinha feito a EDA base na Sprint 1, então a contribuição dessa sprint é o cruzamento com a status page pública da Locaweb (sinal externo) pra mostrar o que o monitoramento interno enxerga e o externo não.
**Tasks:**
- [x] Scraping da status page pública da Locaweb (dezembro/2025)
- [x] Cruzar com picos de P2 no dataset (dias 01 e 22 de dezembro)
- [x] Constatar: 2 dos maiores picos **não** apareceram publicamente
- [x] Documentar o insight: rajada multi-protocolo (ICMP+HTTPS+DNS+SMTP) = falha de backbone
- [x] Escrever o relatório do cruzamento e compartilhar com o time no chat
- [x] Consolidar EDA Sprint 1 + cruzamento como o "achado de análise exploratória" pro slide da Sprint 2

#### Atualizar problema, público e proposta (revisão da Sprint 1)
**Responsável:** João Porto
**Status:** Done
**Descrição:** o brief da Sprint 2 pede pra reafirmar ou atualizar o que foi proposto na Sprint 1.
**Tasks:**
- [x] Confirmar que o escopo da Sprint 1 segue válido (sem mudança de direção)
- [x] Adicionar um 4º perfil de público: time de SRE/Plataforma (quem vai operar o pipeline em prod)
- [x] Trazer o insight do backbone como feature de 1ª classe no detector de rajada
- [x] Tabela comparativa "Sprint 1 (ideação) × Sprint 2 (refinamento)"

#### Princípios da arquitetura
**Responsável:** Samuel Gusman
**Status:** Done
**Descrição:** antes de escolher tecnologia, fechar os **princípios** que vão guiar cada escolha — senão a stack vira colcha de retalhos. Mira em uns 6 a 8 princípios.
**Tasks:**
- [x] Princípio 1: Contratos antes de componentes
- [x] Princípio 2: K8s-nativo (4 primitivas)
- [x] Princípio 3: Estado fora dos serviços
- [x] Princípio 4: Projetado para volume de produção, não de protótipo
- [x] Princípio 5: Observabilidade dia 1
- [x] Princípio 6: Cloud-agnostic
- [x] Princípio 7: Stack poliglota por fronteira (TS na borda, Python no core)

#### Camada 1 — Dados: escolher a stack
**Responsável:** Samuel Gusman
**Status:** Done
**Descrição:** desenhar a camada de dados inteira — barramento, lake, warehouse, transformação, orquestração, qualidade, catálogo.
**Tasks:**
- [x] Escolher Kafka (Strimzi) como barramento — explicar por que não fila simples
- [x] Escolher MinIO + Iceberg como lake — explicar por que não gravar direto no warehouse
- [x] Escolher ClickHouse (Altinity) como warehouse — explicar por que não Postgres/DuckDB
- [x] Escolher dbt-core pras transformações
- [x] Escolher Argo Workflows como orquestrador — explicar por que não Airflow/Prefect
- [x] Escolher Great Expectations pra qualidade
- [x] Montar a tabela `Componente · Tecnologia · Primitiva K8s · Papel`
- [x] Anotar o roadmap pós-MVP (Trino como engine federada)

#### Camada 2 — Inteligência: aprofundar as técnicas dos modelos
**Responsável:** Gustavo Neves
**Status:** Done
**Descrição:** ir mais fundo nas escolhas técnicas da Sprint 1 — versão de produção dos algoritmos. Lembrar de cobrir os 3 modelos (volume, breach, rajada).
**Tasks:**
- [x] Volume D+1/D+7: LightGBM + Prophet de baseline (ensemble), features (lags, Fourier)
- [x] Breach: LightGBM binário + isotonic + SHAP — explicar por que calibrar depois do treino
- [x] Rajada: z-score robusto (mediana+MAD) + CUSUM por IC, limiar adaptativo
- [x] Definir a métrica de cada modelo (MAPE, AUC-PR + Brier + recall@top-k, precision + lead-time)
- [x] Operação dos modelos: MLflow (tracking), Feast (feature store), `model-serving` (FastAPI+BentoML), `burst-detector` (worker Kafka), Evidently AI (drift)

#### Camada 3 — Agente LLM: fechar orquestração, RAG e guardrails
**Responsável:** Thiago Nunes
**Status:** Done
**Descrição:** tirar o agente do conceito e definir os componentes; com LiteLLM ele fica LLM-agnostic.
**Tasks:**
- [x] Definir LangGraph como orquestrador do agente
- [x] Definir LiteLLM como gateway (proxy LLM-agnostic) — permite trocar de modelo via ConfigMap
- [x] Definir Claude Sonnet 4.6 como default e GPT-4.1 como fallback
- [x] Definir pgvector + sentence-transformers pro RAG (sem StatefulSet extra)
- [x] Definir Pydantic + JSON Schema pra validação
- [x] Definir Langfuse pra auditoria das calls
- [x] Listar as 6 ferramentas (somar `detect_backbone_pattern` e `get_breach_score` às 4 da Sprint 1)
- [x] Anotar a política de cache de prompt (cache nativo da Anthropic)

#### Camada 4 — Interfaces: princípio webhook-first
**Responsável:** Raphael Moraes
**Status:** Done
**Descrição:** deixar claro que o operador age **onde já vive** (Slack/OpsGenie); o painel é só auditoria e panorama.
**Tasks:**
- [x] Definir `gateway` (TS+Fastify) como I/O com o mundo externo (webhook in, fan-out out)
- [x] Definir `ui` (Next.js) como o painel agregado do N1/N2
- [x] Definir Grafana pro painel tático dos gestores (read-only)
- [x] Definir Keycloak pro SSO contra AD/LDAP da Locaweb
- [x] Escrever o princípio: "Slack/OpsGenie é a interface principal, painel é auditoria"

#### Infraestrutura — K8s, GitOps, observabilidade, secrets
**Responsável:** Samuel Gusman
**Status:** Done
**Descrição:** mapear cada serviço da arquitetura pra sua primitiva K8s e fechar os componentes de infraestrutura compartilhados.
**Tasks:**
- [x] Tabela "tipo de carga → primitiva K8s → exemplos"
- [x] Escolher Helm + Kustomize pra empacotar
- [x] Escolher ArgoCD pro GitOps
- [x] Escolher Linkerd como service mesh — explicar por que não Istio
- [x] Escolher NGINX Ingress + cert-manager
- [x] Stack de observabilidade: Prometheus + Loki + Tempo + Grafana + Langfuse
- [x] Escolher External Secrets + Vault pros segredos
- [x] Escolher Velero pro backup (RTO < 4h, RPO < 24h)
- [x] Definir `Namespace` + `NetworkPolicy` por camada
- [x] Desenhar o diagrama de implantação dentro do cluster

#### Fluxo end-to-end de um alerta
**Responsável:** Gustavo Neves
**Status:** Done
**Descrição:** descrever o caminho completo de um evento — do webhook (T+0) até o operador agir — pra ver se a arquitetura "fecha". Marcar os tempos intermediários (T+5s, T+10s, etc.) ajuda a discutir SLI depois.
**Tasks:**
- [x] T+0s: webhook chega no `gateway`
- [x] T+5s: stream processa (Argo + GE + lake + warehouse)
- [x] T+10s: `burst-detector` avalia
- [x] T+46s: modelo de breach pontua
- [x] T+47s: agente é chamado
- [x] T+50s: agente devolve JSON validado
- [x] T+51s: operador é notificado
- [x] T+?: operador age → callback
- [x] Definir o SLI alvo (< 60s) e o monitoramento no Grafana

#### Wireframes lo-fi dos protótipos
**Responsável:** Raphael Moraes
**Status:** Done
**Descrição:** o brief pede protótipos que digam alguma coisa — cada wireframe responde a uma pergunta concreta do usuário. Cobrir pelo menos as 4 telas-chave (alerta no Slack/OpsGenie, painel N1/N2, painel tático e drill-down).
**Tasks:**
- [x] 5.1 — Recomendação no Slack/OpsGenie (interface principal)
- [x] 5.2 — Painel agregado N1/N2 (`ui` Next.js)
- [x] 5.3 — Painel tático Grafana (gestores)
- [x] 5.4 — Drill-down "por que o agente disse isso?" (auditabilidade)
- [x] Cada wireframe com um bloco "Significado" explicando a pergunta que ele responde
- [ ] Passar pra Figma pra apresentação final _(antes de 24/05)_

#### Escrever o documento de arquitetura
**Responsável:** Thiago Nunes
**Status:** Done
**Descrição:** juntar todas as decisões técnicas em um doc único com diagramas e tabelas. Vai ficar longo (~500 linhas) — não tem como ser curto cobrindo 4 camadas + infra.
**Tasks:**
- [x] Organizar em 7 seções (atualização da Sprint 1, visão geral, descrição detalhada, fluxo E2E, protótipos, gestão ágil, finalização)
- [x] Diagramas ASCII (arquitetura em 4 camadas + diagrama de implantação K8s)
- [x] Caixinhas "Por que essa stack e não outra" pra cada camada
- [x] Revisão cruzada por todo o time
- [x] Fechar a versão final e subir no repo

#### Roteiro da apresentação Sprint 2
**Responsável:** João Porto
**Status:** Done
**Descrição:** transformar o `arquitetura.md` em roteiro de slides cobrindo o que o brief pede. Pra fechar todas as exigências (problema, público, proposta, arquitetura, descrição, protótipos, gestão ágil, finalização) vão sair uns 15–16 slides.
**Tasks:**
- [x] Slide 1–2: Capa + equipe
- [x] Slide 3–4: Cenário + problema operacional
- [x] Slide 5–6: Público + proposta em 4 camadas
- [x] Slide 7: Arquitetura + 7 princípios
- [x] Slide 8–11: Detalhamento camada a camada (1 slide por camada)
- [x] Slide 12: Infraestrutura K8s
- [x] Slide 13: Fluxo end-to-end
- [x] Slide 14: Protótipos da solução
- [x] Slide 15: Gerenciamento Scrum
- [x] Slide 16: Finalização
- [x] Fechar o roteiro num doc próprio pra alimentar os slides

#### Slides HTML da Sprint 2
**Responsável:** Raphael Moraes
**Status:** In Progress
**Descrição:** transformar o roteiro em HTML 1280×720. Manter o mesmo padrão visual da Sprint 1 (paleta, fontes e template) pra dar continuidade na entrega.
**Tasks:**
- [x] Reaproveitar o template visual usado na Sprint 1 (paleta + grid + tipografia)
- [x] Slides 1–10 estilizados
- [x] Slides 11–16 estilizados
- [ ] QA visual (alinhamento, contraste, transições) _(antes de 24/05)_

#### Gerar o PPTX e fazer a entrega Sprint 2
**Responsável:** Samuel Gusman
**Status:** Ready
**Descrição:** o brief obriga uso do template `02Template_Arquitetura_Challenge_2026_01_locaweb_v1` e o nome do arquivo no padrão FIAP. Entrega só no portal FIAP ON (sem link externo).
**Tasks:**
- [ ] Exportar PPTX a partir do HTML mantendo layout _(antes de 24/05)_
- [ ] Abrir o PPTX e conferir fonte/cor/alinhamento de verdade
- [ ] Renomear o arquivo no padrão `EC_Sprint_2_2TSCOA_arqsolucao_OpsAhead_SuperDatados.pptx`
- [ ] Subir no portal FIAP ON até 24/05

#### Documentar a gestão ágil do projeto
**Responsável:** Samuel Gusman (Scrum Master)
**Status:** Done
**Descrição:** o brief da Sprint 2 pede "gerenciamento ágil" como item — deixar Scrumban, board, cerimônias, papéis e backlog escritos num doc dedicado.
**Tasks:**
- [x] Explicar por que Scrumban (e não Scrum puro)
- [x] Estrutura do time + rotação do Scrum Master
- [x] Cerimônias + cadência
- [x] Configuração do board no GitHub Projects (colunas, WIP, labels, DoD)
- [x] Backlog histórico das Sprints 1 e 2 com stories e tasks
- [x] Backlog macro das Sprints 3 e 4
- [x] Plano de riscos
- [x] Fechar a versão final e subir no repo

#### Fechamento da Sprint 2
**Responsável:** Samuel Gusman (Scrum Master)
**Status:** Ready
**Descrição:** rodar a apresentação inteira na véspera da entrega, capturar últimos ajustes e fazer um Start/Stop/Continue curto pra Sprint 3 começar redonda.
**Tasks:**
- [ ] Rodar a apresentação inteira em chamada (arquitetura + slides + wireframes)
- [ ] Coletar ajustes finais antes da entrega de 24/05
- [ ] Start/Stop/Continue rápido
- [ ] Priorizar o backlog inicial da Sprint 3
- [ ] Agendar spike de 2 dias em LangGraph antes da Sprint 3 começar

---

## Sprint 3 — MVP `[Planejada — entrega 23/08/2026]`

**Objetivo macro:** entregar o pipeline rodando, o 1º modelo treinado e a UI mínima end-to-end usando o `incidents.csv` real.

**O brief pede explicitamente:** contextualização/problema/proposta atualizados, documentação de gerenciamento atualizada (este doc + backlog Sprints 1–2 executados), arquitetura atualizada, evidências do MVP em código-fonte. Entrega no padrão `EC_Sprint_3_2TSCOA_Evidencias_Construcao_OpsAhead_SuperDatados.pptx`, template `03Template_MVP_Preliminar_Challenge_2026_01_locaweb`.

**Distribuição mensal:**

| Mês | Foco | Stories candidatas |
| :--- | :--- | :--- |
| **Junho/2026** | Stack mínima + pipeline de dados | Helm charts da stack mínima (MinIO, ClickHouse, MLflow, FastAPI, Argo) · Primeira DAG Argo: ingestão + dbt run em ClickHouse · Simulador de stream para demo (relê CSV em ordem cronológica) · Suite Great Expectations sobre `incidents.csv` |
| **Julho/2026** | Modelos + painel N1/N2 | Modelo de volume D+1/D+7 (LightGBM + Prophet) registrado em MLflow · Modelo de breach (LightGBM + isotonic + SHAP) · `burst-detector` (worker Kafka + Redis) · `model-serving` com endpoints `/predict/*` · Painel N1/N2 (Next.js MVP) com fila e drill-down |
| **Agosto/2026** | Agente + integração + revisão + entrega | `agent` (FastAPI + LangGraph) com 3 das 6 ferramentas · Integração LiteLLM + Claude · RAG em pgvector com 10k incidentes históricos · Block Kit do Slack via `gateway` · Blind review do agente em 50 alertas históricos · Atualizar contextualização/arquitetura/gestão ágil nos slides · Slides + PPTX no padrão FIAP e entrega no portal FIAP ON até 23/08 |

---

## Sprint 4 — Solução Final `[Planejada — entrega 08/09/2026]`

**Objetivo macro:** tampar os buracos do MVP, polir a UX, gerar evidência quantitativa pra apresentação e finalizar a documentação.

**O brief pede 4 entregáveis no portal FIAP ON:**
1. Planilha `Informacoes_Finais_Projeto_Integrantes_v1.xlsx` preenchida
2. Apresentação `EC_Sprint_4_2TSCOA_solucaofinal_OpsAhead_SuperDatados.pptx` (template `04Template_SolucaoFinal_Challenge_2026_01_locaweb_v1`)
3. Vídeo pitch ≤ 5 min subido no YouTube + arquivo `.TXT` com nome da equipe, RMs e nomes em ordem alfabética
4. ZIP final `EC_Sprint_4_2TSCOA_solucaofinal_OpsAhead_SuperDatados.zip` com **todos** os códigos-fonte, scripts, dashboards e dados tratados

**Critérios técnicos avaliados pela Locaweb:** Alinhamento com o objetivo · Inovação · Usabilidade · MVP em funcionamento · Condução da apresentação.

**Atenção:** troca de membros **proibida** nesta sprint. Se ficarmos entre os Top 6, tem apresentação ao vivo no Teams pra banca da Locaweb em **16/09/2026 (19h30) — presença obrigatória de todos**.

**Stories candidatas:**

- Subir em produção as 3 ferramentas restantes do agente (`detect_backbone_pattern`, `get_breach_score`, `get_group_load`)
- Painel tático (Grafana) — projeção D+1/D+7, breaches vs meta, carga por equipe
- Auditoria completa via Langfuse + tabela `agent_calls`
- Monitoramento de drift (Evidently AI + Prometheus + alertas no Grafana)
- Rodar os números finais: MAPE do volume, AUC-PR do breach, precision+lead-time da rajada (em hold-out)
- Avaliar o agente: concordância com o N2, tempo de triagem, taxa de alucinação
- Gravar vídeo pitch de **5 min no máximo** (abertura · objetivo · proposta · demo · benefícios · conclusão) e subir no YouTube
- Salvar o link do YouTube em `.TXT` separado com nome da equipe, RMs e nomes em ordem alfabética
- Preencher a planilha `Informacoes_Finais_Projeto_Integrantes_v1.xlsx`
- `README.md` final com passo a passo de deploy (Helm install)
- Montar o ZIP final com todo o código-fonte, scripts, dashboards e amostras de dados tratados
- Slides e apresentação final da Sprint 4 (PPTX no padrão FIAP)
- Entrega dos 4 artefatos no portal FIAP ON até 08/09
- Ensaio pra apresentação ao vivo da banca (caso entremos no Top 6)

---

## Gestão de Riscos (vivo, atualizado a cada sprint)

| Risco | Probabilidade | Impacto | Mitigação | Responsável |
| :--- | :--- | :--- | :--- | :--- |
| **Custo da API do LLM** | Média | Médio | Cache de prompt (nativo da Anthropic, ~70% de redução) + cair pro Haiku em alerta de baixa criticidade | Thiago |
| **Dataset estático (sem stream real)** | Alta | Médio | Simular stream relendo o CSV em ordem cronológica (entra na Sprint 3) | Samuel |
| **Curva de aprendizado de LangGraph + Feast** | Média | Baixo | Spike técnico de 2 dias antes da Sprint 3 começar | Thiago |
| **Avaliar o agente sem ter N2 real disponível** | Alta | Alto | _Self-review_ entre membros do time + comparar com a ação que ficou registrada no dataset | Time |
| **Helm charts maduros pra Strimzi/Altinity** | Baixa | Médio | Conferir no mês 1 da Sprint 3; cair pra versão community se precisar | Samuel |
| **Membro fora em momento crítico** | Média | Médio | Pair programming + decisão obrigatoriamente registrada na issue | Scrum Master |

---

## Métricas do time (Kanban)

A gente não usa velocity. Usa:

| Métrica | Como a gente mede | Meta |
| :--- | :--- | :--- |
| **Vazão (throughput)** | Cards que vão pra Done por semana | ≥ 8 cards/semana fora do aperto de fim de sprint |
| **Tempo de ciclo** | Mediana de dias entre In Progress → Done | < 5 dias |
| **WIP médio** | Cards em In Progress + Review por dia | ≤ 8 (1,6 por pessoa) |
| **Idade do card** | Maior tempo de um card numa mesma coluna | Alerta se passar 7 dias sem mover |

Acompanhamento no GitHub Insights + um relatório curto por semana feito pelo Scrum Master da sprint.

---

**Equipe Super Datados — FIAP Enterprise Challenge 2026 · Locaweb**
