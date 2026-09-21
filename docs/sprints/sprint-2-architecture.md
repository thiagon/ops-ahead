# Sprint 2 — Arquitetura, Desenho e Protótipos Iniciais

## Nome do Projeto

**Ops Ahead** — operação à frente, visão antecipada.

---

## 1. Atualização da Sprint 1 (Problema, Público e Proposta)

A ideação da Sprint 1 segue válida — nenhuma mudança de escopo. Os ajustes desta sprint são de **profundidade técnica**, não de direção:

| Tema | Sprint 1 (ideação) | Sprint 2 (refinamento) |
|------|--------------------|------------------------|
| **Problema** | Operação reativa, picos não antecipados, sinais preditivos descartados, OLA invisível | Mantido — confirmado pelo cruzamento status page × dataset (ver `docs/insights/statuspage_vs_dataset.md`): 2 dos maiores picos de P2 de dez/2025 (dias 01 e 22) **não** foram reportados publicamente, reforçando que monitoramento interno opera às cegas em relação a tendências. |
| **Público-alvo** | BOPE (N1/N2/N3), gestores, clientes Locaweb | Mantido. Adicionamos um quarto perfil: **time de SRE/plataforma** que vai operar o pipeline de ML e o copiloto em produção. |
| **Solução** | 4 camadas: dados → modelos → copiloto IA → interfaces | Mantido. Esta sprint **materializa cada camada** em ferramentas concretas, contratos de dados e fluxos de implantação. Nesta sprint a Camada 3 passa a ser apresentada como **"Copiloto IA"** (mais alinhado com o que o operador percebe). O nome técnico do serviço no código segue `agent`. |
| **Princípio de stack** | Open-source, cloud-agnostic | **Reafirmado e detalhado**: toda a arquitetura roda em containers (Docker/Kubernetes) e usa apenas componentes open-source ou de licença permissiva. Nenhuma dependência de serviço gerenciado proprietário (sem SageMaker, sem Vertex AI, sem Bedrock — a única chamada externa é a API do LLM). |

**Insight novo (não estava na Sprint 1):** o cruzamento com a status page pública mostrou que **rajadas multi-protocolo (ICMP + HTTPS + DNS + SMTP simultâneos)** indicam falha de backbone, não de serviço. Esse padrão entra agora como uma **feature de primeira classe** no detector de rajada (Camada 2) e como uma **ferramenta dedicada** do copiloto (`detect_backbone_pattern`).

**Dado novo do EDA:** apenas **3 servidores concentram ~11% do volume** total de incidentes — confirma o vetor de redistribuição como ganho operacional imediato.

---

## 2. Visão Geral da Arquitetura

A solução é um **sistema modular em quatro camadas**, conectadas por um barramento de eventos e um data lake compartilhado. Cada camada tem responsabilidade única, contrato de entrada/saída explícito e pode ser substituída sem reescrever as demais.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           CAMADA 4 — DECISÃO (UI)                              │
│   Painel Interativo (Next.js) · Painel Tático (Grafana) · Motor de Integração │
└────────────────────────────────────────────────────────────────────────────────┘
                ▲                          ▲                       ▲
                │ recomendações            │ métricas              │ scores
                │                          │                       │
┌───────────────┴──────────────────────────┴───────────────────────┴────────────┐
│                       CAMADA 3 — COPILOTO IA (Triagem)                        │
│   LangGraph orquestra:  function calling  ·  RAG (pgvector)  ·  guardrails    │
│   Saída: JSON validado por schema  →  fila de recomendações                    │
└───────────────────────────────────────────────────────────────────────────────┘
                ▲                          ▲                       ▲
                │ alerta cru               │ contexto              │ similares
                │                          │                       │
┌───────────────┴──────────────────────────┴───────────────────────┴────────────┐
│                    CAMADA 2 — INTELIGÊNCIA (Modelos ML)                       │
│  Volume (LightGBM + Prophet)  ·  Breach (LightGBM + isotonic + SHAP)          │
│  Rajada (z-score + CUSUM)  ·  Projeção KPI mensal (Monte Carlo)               │
│  Detector de evento externo (Isolation Forest)                                │
│  Servidos via FastAPI · versionados em MLflow · features online via Feast     │
└───────────────────────────────────────────────────────────────────────────────┘
                ▲                          ▲                       ▲
                │ features                 │ snapshots             │ histórico
                │                          │                       │
┌───────────────┴──────────────────────────┴───────────────────────┴────────────┐
│                     CAMADA 1 — DADOS (Pipeline)                               │
│  Ingestão (Airbyte/cron)  →  Lake (MinIO + Parquet)  →  dbt (DuckDB)          │
│  Orquestração: Prefect  ·  Qualidade: Great Expectations  ·  Catálogo: dbt    │
└───────────────────────────────────────────────────────────────────────────────┘
                                       ▲
                                       │
                        Fontes: ITSM (CSV/API), status page,
                        métricas de monitoramento (Prometheus)
```

**Princípios arquiteturais que guiaram cada escolha:**

1. **Contratos antes de componentes.** Cada camada expõe um contrato (schema dbt, OpenAPI, JSON Schema). Trocar Prophet por NeuralProphet, ou Claude por GPT, não quebra nada além daquele componente.
2. **K8s-nativo.** Toda a solução se descreve com **quatro primitivas do Kubernetes**: `Deployment` (APIs e workers de longa duração), `StatefulSet` (Postgres + pgvector, MinIO, ClickHouse, Kafka), `CronJob` (batches agendados — ingestão diária, retreino, snapshots de feature) e `Job` (execuções pontuais — `dbt run` de uma DAG, _backfill_ de um modelo).
3. **Estado fora dos serviços de aplicação.** Modelos versionados em MLflow, features em Feast (Postgres), embeddings em Postgres (pgvector), eventos em Kafka, dados em MinIO. As `Deployments` da camada de aplicação são _stateless_ — escalam horizontalmente via HPA sem coordenação.
4. **Projetado para volume de produção, não de protótipo.** As 122 mil linhas do dataset atual são **amostra exploratória**, não regime operacional. Em produção, a Locaweb processa centenas de milhares de eventos por dia, 24x7 — a arquitetura assume esse volume desde o desenho (ClickHouse como warehouse analítico, Kafka como barramento de eventos, Argo Workflows paralelizando inferência por partição). O que vai para produção é o que vai operar diariamente.
5. **Observabilidade desde o dia 1.** Prometheus + Grafana + Loki para logs. Toda chamada do copiloto é registrada com prompt, ferramentas chamadas e resposta — auditoria nativa.
6. **Cloud-agnostic.** A stack roda em qualquer distribuição K8s — on-prem da Locaweb (OpenShift, Rancher, vanilla), gerenciado (EKS/GKE/AKS) ou híbrido. A decisão de _onde_ rodar é de negócio/infra da Locaweb, não da arquitetura.
7. **Stack poliglota por fronteira.** A camada externa (gateway, UI, API pública) é **TypeScript** — pool grande de contribuidores externos para um produto open-source, tipos end-to-end com Zod no servidor e cliente Next gerado do mesmo schema. O core de ML (`model-serving`, `agent`, `burst-detector`) é **Python** — onde o ecossistema (LightGBM, LangGraph, Pydantic) é nativo. Cada audiência contribui na linguagem que conhece.

---

## 3. Descrição Detalhada dos Componentes

### 3.1 Camada 1 — Dados

| Componente | Tecnologia | Primitiva K8s | Papel |
|------------|------------|---------------|-------|
| **Barramento de eventos** | **Apache Kafka** via **Strimzi Operator** | `StatefulSet` (brokers) gerenciado pelo operator | Stream de incidentes em near-real-time para a Camada 2 (detector de rajada) e Camada 3 (copiloto). Tópicos: `incidents.received`, `incidents.scored`, `alerts.burst`, `recommendations`, `actions.taken`. Replicação 3x, retenção configurável por tópico (curto pra `incidents.received`, longo pra `actions.taken` que alimenta a avaliação do copiloto). |
| **Ingestão batch (bootstrap + fallback)** | **Airbyte** + scripts Python (e.g., `scripts/scrape_statuspage.py`) | `CronJob` + `Deployment` (Airbyte server) | Cobre dois casos: (1) **bootstrap histórico** — carga inicial dos meses anteriores quando subimos a stack pela primeira vez, ou quando treinamos um modelo novo; (2) **fontes que não têm webhook** — status page pública, snapshots de Prometheus. Resultado vai pro lake (MinIO/Iceberg), não pro Kafka. |
| **Simulador de stream (apenas para protótipo/demo)** | Producer Python que relê o `incidents.csv` em ordem cronológica de `aberto_em` e publica em `incidents.received` respeitando os intervalos reais (acelerados N×) | `Job` ou `Deployment` em `ns: data` com flag `--demo` | Permite demonstrar o fluxo end-to-end < 60s na Sprint 3/4 sem depender de webhook real da Locaweb. Em produção, esse `Job` é desligado e o `gateway` assume. |
| **Armazenamento bruto (lake)** | **MinIO** (S3-compatible) + tabelas **Apache Iceberg** | `StatefulSet` (MinIO multi-node, modo distribuído) | Lake em Parquet particionado por data, com metadados Iceberg para schema evolution, _time travel_ (auditável "como o dado estava na hora da inferência X") e compactação gerenciada. Mesma API do S3 — portável para qualquer cloud. |
| **Warehouse analítico** | **ClickHouse** via **Altinity Operator** | `StatefulSet` (cluster com shards e réplicas) | Modela e serve marts em escala de produção. Time-series nativo, ingestão de centenas de milhares de eventos/segundo, queries analíticas em segundos sobre bilhões de linhas. dbt suportado via `dbt-clickhouse`. |
| **Transformação** | **dbt-core** com adaptadores `dbt-clickhouse` (warehouse) e `dbt-trino` (queries federadas sobre o lake) | `Job` por execução de DAG, disparado por Argo Workflows | Camadas `staging` → `intermediate` → `marts`. SQL versionado em Git, testes nativos (`unique`, `not_null`, custom), `dbt docs` auto-gerada, lineage por coluna. |
| **Orquestração** | **Argo Workflows** | CRDs nativos do K8s — cada passo é um `Pod` | DAGs declarados como YAML versionado em Git, paralelização nativa por partição (ex.: inferência de breach em paralelo por grupo designado), retries com backoff, UI integrada. |
| **Qualidade de dados** | **Great Expectations** | `Job` chamado pelo Argo após cada ingestão | Suite de validações: distribuição de prioridades, faixa de duração, completude de campos críticos. Falha do GE pausa a DAG antes de contaminar o warehouse. |
| **Catálogo / governança** | **dbt docs** + **OpenMetadata** (opcional) | `Deployment` | Lineage automático de cada coluna até a fonte. OpenMetadata roda em K8s e centraliza descoberta. |

**Por que essa stack e não outra:**

- **Por que ClickHouse e não Postgres/DuckDB?** O dataset atual (122k linhas) é exploratório. Em produção, a Locaweb gera **centenas de milhares de eventos/dia**, 24x7 — Postgres serve transação, não analítica em escala; DuckDB é single-node e não tem operator K8s sério. ClickHouse foi desenhado exatamente para o nosso caso (séries temporais densas, agregações por janela, queries em segundos sobre bilhões de linhas) e tem operator maduro (Altinity) que escala via `StatefulSet` com shards e réplicas.
- **Por que Argo Workflows e não Airflow/Prefect?** Airflow e Prefect resolvem orquestração com um sistema de runtime próprio que precisa ser deployado e operado em paralelo ao K8s. Argo Workflows **é** uma extensão do K8s — DAGs são CRDs, cada step é um `Pod`. A operação se reduz à mesma operação que o time já fará para o resto da stack (kubectl, GitOps, Prometheus). Menos peças, mais alinhamento.
- **Por que Kafka e não fila simples?** O fluxo end-to-end (ingestão → scoring → copiloto → UI) é **streaming por natureza** em produção: o operador precisa ver a recomendação em < 60s. Kafka oferece desacoplamento (cada camada produz/consome independentemente), replay (reprocessar uma janela em caso de bug do modelo) e retenção configurável. Strimzi cuida do ciclo de vida no K8s.
- **Por que MinIO + Iceberg e não escrever direto no warehouse?** Lake separado preserva o dado bruto para reprocessamento e treino futuro de novos modelos sem onerar o warehouse. Iceberg adiciona _time travel_ — crítico para auditoria de inferência ("qual dado o modelo viu naquele instante?").

**Marts essenciais (modelados em dbt sobre ClickHouse):**

| Mart | Conteúdo | Consumido por |
|------|----------|---------------|
| `marts/incidents_by_ic` | Agregado por IC e janela (1h/6h/24h) — contagem, mediana de duração, share de "Sem Intervenção" | Copiloto (`get_recent_incidents`), modelo de Breach |
| `marts/p4_sequences_by_ci` | Window function sobre `prioridade_codigo=4` por IC — sequências crescentes de threshold (precursor de P2) | Modelo de Volume/Breach, copiloto (`detect_p4_escalation`) |
| `marts/first_touch_duration` | `aberto_em` × `grupo_designado` inicial × OLA da prioridade — calcula "tempo cozinhado" no primeiro grupo | Modelo de Breach |
| `marts/priority_changes_log` | Histórico de transições em `prioridade_codigo` extraído do stream — flag, prioridade anterior, timestamp da mudança | Modelo de Breach, copiloto (contexto), gateway (gatilho de re-inferência) |
| `marts/daily_anomaly_features` | Features diárias agregadas — volume total, share P1, % abertura manual, dispersão de ICs, taxa de "Sem Intervenção" | Detector de evento externo |
| `marts/kpi_monthly_state` | Estado corrente do mês — breaches consumidos por (prioridade × dimensão), volume acumulado, dias restantes | Projeção KPI mensal |

Marts executados em sequência pela DAG do Argo após cada ingestão, com Great Expectations validando cada um antes de promover para a Camada 2.

**Roadmap (não entra na Sprint 3 / MVP):**

- **Trino** como engine de query federada sobre o lake e fontes externas. Faz sentido se a Locaweb quiser integrar bases adicionais (CMDB, monitoramento de infra, base de mudanças) sem ETL para o ClickHouse. Fica anotado como evolução natural — a stack atual já produz Parquet/Iceberg compatível, então adicionar Trino depois é só subir um `Deployment`.

### 3.2 Camada 2 — Inteligência (Modelos ML)

| Componente | Tecnologia | Papel |
|------------|------------|-------|
| **Treino e tracking** | **MLflow** | Cada experimento (params, métricas, artefatos do modelo, código, versão dos dados) fica registrado. Promoção `staging → production` é uma chamada de API. |
| **Frameworks de modelo** | **LightGBM** (volume e breach), **Prophet** (baseline de volume), **scikit-learn** (calibração isotônica + Isolation Forest para evento externo), **SciPy** (Monte Carlo para projeção KPI), **SHAP** (explicabilidade) | Justificativa por modelo na tabela abaixo. |
| **Feature store** | **Feast** | Define features uma vez — incluindo as **features de domínio** (sequência P4, tempo no primeiro grupo, abertura manual, histórico de recategorização) materializadas pelos marts da Camada 1 — e serve em batch (treino) e online (inferência) com a mesma definição. Backend offline: Parquet no MinIO. Backend online: Redis. |
| **Servir modelos** (`model-serving`) | **FastAPI** + **BentoML** (empacotamento) | API HTTP única com endpoints `/predict/volume` e `/predict/breach` (Pydantic). Carrega artefatos do MLflow no startup; A/B entre versões via header. |
| **Detecção de rajada** (`burst-detector`) | Serviço Python custom (worker, não é API) | Consumer Kafka — lê `incidents.received`, mantém estado por IC em Redis, calcula z-score robusto + CUSUM e publica em `alerts.burst` quando o limiar é cruzado. |
| **Monitoramento de drift** | **Evidently AI** | Calcula PSI/KS entre janela de treino e janela atual em cada feature. Resultado vira métrica Prometheus → alerta no Grafana. |

**Tabela de modelos (refinamento das técnicas da Sprint 1):**

| Modelo | Algoritmo final | Por que essa escolha técnica | Métrica de produção |
|--------|----------------|------------------------------|---------------------|
| **Volume D+1 / D+7** | LightGBM com features de lag (1, 7, 14d), médias móveis, Fourier para sazonalidade semanal/diária. Prophet roda em paralelo como _baseline_ e _sanity check_. | LightGBM lida bem com features heterogêneas (calendário + carga + meta-dados de IC) e treina em segundos. Prophet sozinho não captura efeitos de carga; LightGBM sozinho perde sazonalidade explícita — rodar os dois e fazer _ensemble_ por média ponderada melhora calibração do intervalo. | MAPE por prioridade, cobertura do IC 80%, MAE absoluto. |
| **Risco de breach** | LightGBM binário com `class_weight='balanced'` (1% de breach), calibração isotônica pós-treino, SHAP por inferência. | Boosting captura interações não-lineares (idade × prioridade × carga do grupo) que regressão logística perde. Calibração isotônica corrige a distorção que `class_weight` introduz na probabilidade. | AUC-PR, Brier, recall@top-10 e top-50 por hora. |
| **Detecção de rajada** | z-score robusto (mediana + MAD) sobre contagem de "Sem Intervenção" em janelas de 15min/1h/6h por IC, combinado com CUSUM bidirecional para detectar mudança de regime. | Sem treino — só estatística. Vantagem: zero risco de overfitting, atualiza online com cada novo evento, limiar adaptativo por IC evita falso positivo em ICs naturalmente ruidosos (Team14 dispara muito por natureza, então o limiar dele é alto). | Precision dos alertas, **lead-time** mediano antes do P2 (em minutos), taxa de falso positivo por IC. |
| **Projeção KPI mensal** | Monte Carlo: para cada dia restante do mês, sortear (volume ~ distribuição preditiva do LightGBM) × (taxa de breach ~ Beta posterior por prioridade) → distribuição agregada do total mensal de volume e de breaches por prioridade. | A pergunta do gestor é probabilística, não pontual: "vou fechar o mês em 100%?". Os outros modelos respondem por incidente. Monte Carlo propaga a incerteza do volume previsto + a incerteza da taxa de breach até o agregado mensal, gerando as 4 projeções independentes do PPR (volume P2, volume P3, OLA P2, OLA P3). | Cobertura do IC 80% da projeção mensal, erro absoluto no fim do mês, calibração da `P(fechar mês)`. |
| **Detector de evento externo** | Isolation Forest sobre features diárias agregadas (volume total, share de P1, % abertura manual, dispersão de ICs afetados, taxa de "Sem Intervenção") + correlação opcional com sinais externos quando disponíveis (status AWS, registro.br). | Eventos externos (AWS down, CrowdStrike, registro.br) aparecem como anomalias inexplicáveis no dataset — se entram no treino, contaminam o modelo. O detector marca o dia/janela como outlier para (a) exclusão automática do treino e (b) sinalização ao operador investigar causa fora da Locaweb. | Recall em outliers conhecidos do histórico, precisão (% de outliers reais entre os marcados), taxa de falso positivo em dias normais. |

**Features de domínio cross-modelo** — extraídas da mentoria com Douglas, entram nos modelos de Volume, Breach e Projeção KPI:

| Feature | Sinal capturado | Fonte |
|---------|-----------------|-------|
| Sequência crescente de P4 no mesmo IC | Precursor de P2 — thresholds de monitoramento escalonando (disco 70% → 80% → 90% → impacto ao cliente) | Stream `incidents.received` filtrado por `prioridade_codigo=4` |
| Tempo no grupo de primeiro toque vs. OLA | Proxy de "cozimento" do N1 — limite operacional ≤ 25% do OLA (~15min em P2 de 4h); acima disso o incidente já deveria ter escalado | Cálculo determinístico em `aberto_em` + `grupo_designado` |
| Flag de abertura manual | Suporte abriu porque o monitoramento não pegou — sinal de gap de observabilidade, presente em ~14-15% dos chamados | Campo do ITSM |
| Histórico de recategorização | Prioridade anterior antes do escalonamento (P3 que virou P2, etc.) — contexto para o modelo de breach reavaliar o score | Histórico de `prioridade_codigo` no stream |

**Tratamento de recategorização:** mudança em `prioridade_codigo` (P3→P2, P2→P1) é evento de primeira classe — o `gateway` detecta a transição em `incidents.received`, dispara re-inferência do score de breach no `model-serving` e republica em `incidents.scored` com a nova prioridade. O copiloto recebe a recomendação atualizada e o histórico de prioridades fica disponível como feature contextual. Incidentes recategorizados permanecem no KPI sem dupla contagem.

### 3.3 Camada 3 — Copiloto IA

Tecnicamente o serviço se chama `agent` (nome no código, namespace `ns: agent`, serviço de orquestração de LLM). Para o operador e para a apresentação ele é o **Copiloto IA** — quem reformata o sinal estatístico em ação. Os dois termos aparecem trocadamente neste documento: "copiloto" no falar do produto, `agent` quando estamos falando de código/infra.

| Componente | Tecnologia | Papel |
|------------|------------|-------|
| **Serviço do copiloto** (`agent`) | API HTTP em **FastAPI** que orquestra o copiloto com **LangGraph** | Define o copiloto como grafo de estados (recebe alerta → planeja ferramentas → executa → reavalia → emite JSON). Mais previsível que ReAct livre, mais flexível que pipeline rígido. |
| **Gateway LLM (LLM-agnostic)** | **LiteLLM** rodando como `Deployment` proxy | **Camada única de acesso a LLM** — o copiloto nunca chama Anthropic/OpenAI/Bedrock/vLLM diretamente, sempre via LiteLLM. Modelo escolhido por configuração (`ConfigMap`), trocável sem deploy. Cobre prompt cache, retry, fallback entre providers, contabilização de tokens/custo unificada. Decisão estratégica: a Locaweb pode rodar com Claude, GPT, Gemini, modelo open-source self-hosted — a arquitetura não muda. |
| **Modelos suportados** | Qualquer provedor compatível com LiteLLM — Anthropic Claude, OpenAI GPT, Google Gemini, AWS Bedrock, Azure OpenAI, ou modelo self-hosted via vLLM/Ollama no próprio cluster | Default sugerido para o MVP: **Claude Sonnet 4.6** (melhor function calling + prompt cache nativo de 5min). Fallback configurável: GPT-4.1. Substituir é uma linha no `ConfigMap`. |
| **Function calling** | Schema OpenAI/Anthropic nativo, gerado a partir de funções Python anotadas com Pydantic | Cada ferramenta é uma função Python; o schema do LLM é derivado automaticamente — sem duplicação. |
| **RAG (incidentes similares)** | **pgvector no Postgres existente** + **sentence-transformers** (`all-MiniLM-L6-v2` para PT-BR via fine-tuning leve) | Embeddings de descrição + filtros estruturados (IC, prioridade, status) **na mesma query SQL** — tudo em Postgres. Sem StatefulSet adicional, índice HNSW suporta milhões de embeddings com latência abaixo de 50ms. |
| **Validação de saída** | **Pydantic** + JSON Schema | Toda saída do copiloto passa por validação. Saída inválida → retry com mensagem de correção; segundo erro → fallback para alerta cru com flag `agent_failed=true`. |
| **Cache de prompt** | Cache nativo da API Anthropic (`cache_control`) | Prompt do sistema + descrições das ferramentas (~6k tokens) ficam em cache de 5min. Reduz custo em ~70% para alertas em rajada (mesmo prompt, alvos diferentes). |
| **Auditoria** | Tabela `agent_calls` em Postgres + traços em **Langfuse** | Cada chamada registra: input, ferramentas chamadas (com argumentos e resultados), output, latência, custo. Permite blind review por N2 e detecção de regressão entre versões do prompt. |

**Ferramentas disponíveis para o copiloto:**

| Ferramenta | O que faz | Fonte de dados |
|------------|-----------|----------------|
| `get_recent_incidents(ic, janela_horas)` | Lista incidentes do IC nas últimas N horas | dbt mart `incidents_by_ic` |
| `get_group_load(grupo)` | Carga atual e capacidade restante do grupo designado | Redis (atualizado pelo pipeline em near-real-time) |
| `find_similar_resolved(ic, prioridade, descricao)` | RAG: top-3 incidentes similares já resolvidos com como foram resolvidos | Postgres (pgvector + filtros estruturados) |
| `get_ola_window(prioridade, aberto_em)` | Minutos restantes até estourar o OLA | Cálculo determinístico |
| `detect_backbone_pattern(janela_min)` | Verifica se há rajada multi-protocolo (ICMP+HTTPS+DNS+SMTP) — sinal de falha de rede | Stream Prometheus |
| `get_breach_score(incidente_id)` | Score atual do modelo de breach + features SHAP top-5 | Endpoint FastAPI da Camada 2 |
| `detect_p4_escalation(ic, janela_horas)` | Verifica sequência crescente de P4 no IC nas últimas N horas — sinal de threshold de monitoramento escalonando rumo a P2 | Stream `incidents.received` filtrado por `prioridade_codigo=4` |
| `detect_external_event(timestamp)` | Consulta o detector de outlier — retorna se a janela atual tem assinatura de evento externo (anomalia em volume agregado, share de P1, abertura manual, dispersão de ICs) e qual feature dominou | Endpoint FastAPI da Camada 2 |
| `get_kpi_projection(prioridade, dimensao)` | Projeção Monte Carlo de fechamento mensal para um dos 4 KPIs do PPR (volume P2, volume P3, OLA P2, OLA P3) — retorna mediana, IC 80% e `P(fechar dentro da meta)` | Endpoint FastAPI da Camada 2 |

### 3.4 Camada 4 — Decisão (Interfaces)

**Princípio desta camada:** o operador não vai abandonar Slack, OpsGenie ou ServiceNow para "viver" no painel do Ops Ahead. A interação real acontece **nos canais que o time já usa**. Por isso a camada se organiza em três frentes:

- **Onde o operador age — Slack / OpsGenie.** Block Kit interativo com `Ack & Aplicar`, `Ignorar (motivo)`, `Escalar`, `Ver no painel`. _Fan-out_ feito pelo **Motor de Integração** — o mesmo conteúdo cai no OpsGenie como alert estruturado. Nenhum operador precisa abrir o painel para agir.
- **Onde consulta o panorama — Painel Interativo (`ui`).** Fila completa priorizada, drill-down (SHAP, ferramentas chamadas pelo copiloto, similares), chat com o copiloto, histórico de decisões. Cada decisão fica auditável de ponta a ponta.
- **Onde o gestor vê tendência — Grafana.** Read-only. Projeção D+1/D+7, breaches vs. meta, carga por equipe. O time já usa Grafana em infra — adoção zero-fricção.

| Componente | Tecnologia | Primitiva K8s | Papel |
|------------|------------|---------------|-------|
| **Motor de Integração** (`gateway`) | **TypeScript + Fastify** | `Deployment` + HPA + `Ingress` (TLS + HMAC) | Toda a fronteira HTTP externa em um serviço: (1) **entrada** — `POST /webhook/incidents` recebe webhook do ITSM Locaweb, valida HMAC, normaliza e publica em `incidents.received` no Kafka; (2) **saída** — assina `recommendations` no Kafka e faz _fan-out_ para destinos configurados (webhook genérico para qualquer URL, plugin Slack via Block Kit como demo da Sprint 4 — adicionar OpsGenie/Teams/PagerDuty/SNow é uma classe TS `Notifier` com ~50 linhas); (3) **callbacks** — `/actions/callback` (genérico) e `/slack/actions` (demo) recebem clique do operador, validam HMAC, gravam em Postgres e publicam em `actions.taken`; (4) **API pública** — `/api/v1/*` com OpenAPI gerado a partir de schemas Zod, para integração com ServiceNow/Jira ou ferramentas internas da Locaweb. |
| **Painel Interativo** (`ui`) | **Next.js** | `Deployment` + `Ingress` | Painel agregado N1/N2 — fila priorizada, drill-down (SHAP, ferramentas chamadas, similares), histórico, filtros por turno/grupo/criticidade, chat com o copiloto. API routes do Next proxiam para serviços internos (`model-serving`, `agent`) — o browser nunca fala direto com serviço interno, mantendo o boundary de segurança limpo. |
| **Painel tático (gestores)** | **Grafana** com datasource ClickHouse + Postgres | `Deployment` | Projeção D+1/D+7, breaches acumulados vs. meta anual, carga por equipe, ICs em degradação. Read-only, sem botões. |
| **Autenticação** | **Keycloak** (open-source, on-prem) | `Deployment` + Postgres `StatefulSet` | SSO contra AD/LDAP da Locaweb para o Painel Interativo; assinatura HMAC para webhooks de entrada/callback no Motor de Integração. |

O diferencial do produto não é UI — é o conteúdo do alerta (TL;DR estruturado do copiloto). Entregar esse conteúdo nos canais que o operador já usa, com mobile/push/on-call/audit log nativos, é o caminho de menor fricção e a abordagem que os concorrentes (PagerDuty, OpsGenie, BigPanda) seguem.

**Schema da recomendação** (compartilhado entre `agent` → `gateway` → UI): Pydantic no `agent`, Zod no `gateway`, ambos gerados de um único JSON Schema versionado em Git. Campos obrigatórios: `incidente_id`, `acao_recomendada`, `criticidade`, `score_breach`, `justificativa`, `similares`. Campos opcionais — preenchidos quando o copiloto chama as ferramentas correspondentes: `external_event_flag` (resultado de `detect_external_event`), `p4_escalation_signal` (resultado de `detect_p4_escalation`), `kpi_at_risk` (lista de KPIs do PPR em risco quando o copiloto consulta `get_kpi_projection`), `recategorized_from` (prioridade anterior se houve recategorização). Manter os flags como opcionais preserva compatibilidade entre consumidores (Slack, OpsGenie, painel) — quem não trata o campo simplesmente ignora.

### 3.5 Infraestrutura e Operação

**A solução roda em Kubernetes.** Manifests versionados em Git, deploy declarativo via Helm + Kustomize, reconciliação contínua por ArgoCD.

**A stack inteira se descreve com três grupos de primitivas K8s.** Esta é a forma que vai pro deck — quem implanta vê três cards, não cinco linhas:

| Grupo | Primitivas | O que opera | Exemplos no Ops Ahead |
|-------|-----------|-------------|------------------------|
| **Aplicações & APIs** | `Deployment` + `Service` + `Ingress` (+HPA) | Serviços de longa duração que recebem tráfego e escalam horizontalmente conforme a carga | Motor de Integração (`gateway`), Painel Interativo (`ui`), `model-serving`, copiloto (`agent`), Grafana, MLflow, LiteLLM, Langfuse, Airbyte server |
| **Estado Persistente** | `StatefulSet` + `PersistentVolumeClaim` | Volumes persistentes que crescem com a operação. Base que sustenta dados, modelos, eventos e embeddings | Postgres (Feast, MLflow, recomendações, pgvector), MinIO, ClickHouse (Altinity), Kafka (Strimzi), Redis |
| **Tarefas & Processamento** | `CronJob` (agendado) + `Job` (disparado pelo Argo) | Pipelines assíncronos — agendados ou pontuais — orquestrados em DAGs | Ingestão diária do ITSM, retreino semanal, snapshot Feast, backup pg_dump → MinIO, `dbt run`/`dbt test`, inferência batch, backfill |

`DaemonSet` (Promtail, node-exporter) é primitiva de plataforma, não da aplicação — vai junto com a observabilidade.

**Componentes de infraestrutura:**

| Componente | Tecnologia | Primitiva | Papel |
|------------|------------|-----------|-------|
| **Plataforma** | Qualquer distribuição K8s — vanilla, OpenShift, Rancher, k3s, EKS/GKE/AKS — versão 1.28+ | — | Único pré-requisito. Nada além disso. |
| **Pacote/Deploy** | **Helm** (charts versionados) + **Kustomize** (overlays por ambiente) | — | Um chart por componente; overlays `dev`/`staging`/`prod` parametrizam recursos, réplicas e endpoints. |
| **GitOps** | **ArgoCD** | `Deployment` (controlador) + CRDs `Application` | Repositório `ops-ahead-deploy` é a fonte da verdade. Merge na `main` → ArgoCD reconcilia o cluster. Rollback é um `git revert`. |
| **CI** | **GitHub Actions** (ou GitLab CI) | Roda fora do cluster | PR: lint, testes unitários, _build_ de imagens, _push_ para registry, atualização do tag em `ops-ahead-deploy`. |
| **Service Mesh** | **Linkerd** | `DaemonSet` (proxy por nó) + sidecars (injetados via annotation) | mTLS automático ponta-a-ponta entre todos os Pods, _retries_ e _timeouts_ declarativos sem tocar código de aplicação, métricas L7 (latência por rota, taxa de erro) automaticamente exportadas para Prometheus. Linkerd escolhido sobre Istio por ser leve, ter operação mínima e cobrir 100% dos nossos requisitos sem o peso operacional do Istio. |
| **Ingress / TLS** | **NGINX Ingress** + **cert-manager** (Let's Encrypt ou CA interna da Locaweb) | `Deployment` + CRDs | Roteamento por host/path, certificados gerenciados automaticamente. |
| **Observabilidade — métricas** | **Prometheus** + **kube-prometheus-stack** | `StatefulSet` + `DaemonSet` | Cada serviço expõe `/metrics`. Alertas via **Alertmanager**. |
| **Observabilidade — logs** | **Loki** + **Promtail** | `StatefulSet` + `DaemonSet` | Logs estruturados (JSON), correlacionados com traces e métricas. |
| **Observabilidade — traces** | **Tempo** + **OpenTelemetry SDK** | `StatefulSet` | Trace distribuído de um alerta atravessando ingestão → modelo → copiloto → UI. |
| **Visualização unificada** | **Grafana** | `Deployment` | Dashboards técnicos (latência, throughput, drift) e de negócio (volume previsto, breaches acumulados, lead-time). |
| **Auditoria de LLM** | **Langfuse** | `Deployment` + `StatefulSet` (Postgres dedicado) | Trace completo de cada chamada do copiloto: prompts, tools, latência, custo. |
| **Secrets** | **External Secrets Operator** integrado a **HashiCorp Vault** | `Deployment` + CRD `ExternalSecret` | Vault é a fonte; `ExternalSecret` materializa em `Secret` do K8s. Nada sensível em Git. |
| **Autoscaling** | **HPA** (CPU/memory/custom metrics via Prometheus Adapter) + **VPA** (recomendações) | Built-in K8s | APIs escalam por throughput; workers do Argo escalam por profundidade da fila. |
| **Backup** | **Velero** (snapshots de PVs e manifests) + replicação MinIO multi-site | `Deployment` + `CronJob` | RTO < 4h, RPO < 24h para bancos críticos. |
| **Multi-tenancy / segregação** | `Namespace` por camada (`data`, `ml`, `agent`, `ui`, `infra`) + **NetworkPolicy** | Built-in K8s | Restringe quem fala com quem na camada de rede — defesa em profundidade. |

**Diagrama de implantação (lógico) — tudo dentro de um cluster K8s:**

```
┌─────────────────────── Cluster Kubernetes (qualquer distribuição) ────────────────────┐
│                                                                                       │
│  ns: data                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────────────┐     │
│  │ Airbyte          │  │ Argo Workflows   │  │ Great Expectations               │     │
│  │ Deployment +     │  │ Controller (CRD) │  │ Job (disparado pelo Argo)        │     │
│  │ CronJob conector │  │ + Workflows      │  │                                  │     │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────────────────────┘     │
│           │                     │                     │                                │
│           ▼                     ▼                     ▼                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────────────┐     │
│  │ MinIO + Iceberg  │  │ ClickHouse       │  │ Kafka (Strimzi)                  │     │
│  │ StatefulSet      │  │ StatefulSet      │  │ StatefulSet                      │     │
│  │ (lake)           │  │ (warehouse)      │  │ (event bus)                      │     │
│  └──────────────────┘  └──────────────────┘  └────────────┬─────────────────────┘     │
│                                                            │                           │
│  ns: ml                                                    │                           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────▼────────────────────┐     │
│  │ model-serving    │  │ MLflow           │  │ burst-detector (consumer Kafka)  │     │
│  │ Deployment + HPA │  │ Deployment       │  │ Deployment + HPA                 │     │
│  │ /predict/*       │  │ + Postgres SS    │  │ (worker, sem HTTP)               │     │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────────────┘     │
│  ┌──────────────────┐  ┌──────────────────┐                                            │
│  │ Feast            │  │ Retreino         │                                            │
│  │ Deployment +     │  │ CronJob (semanal)│                                            │
│  │ Postgres + Redis │  │ → Argo Workflow  │                                            │
│  └──────────────────┘  └──────────────────┘                                            │
│                                                                                       │
│  ns: agent  (Copiloto IA)                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────────────┐     │
│  │ agent            │  │ LiteLLM proxy    │  │ Langfuse                         │     │
│  │ (FastAPI +       │  │ Deployment       │  │ Deployment + Postgres SS         │     │
│  │  LangGraph)      │  │ (LLM-agnostic)   │  │ (auditoria de calls)             │     │
│  │ Deployment + HPA │  │                  │  │                                  │     │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────────────────────────────┘     │
│           │                     │                                                      │
│           │  pgvector (embeddings + filtros) lê do Postgres no ns: data                │
│           │                                                                            │
│           │                                                                            │
│           │  HTTPS (única chamada externa autorizada)                                  │
│           ▼                                                                            │
│  ┌──────────────────────┐                                                              │
│  │   API LLM            │                                                              │
│  │   (Anthropic/OpenAI) │                                                              │
│  └──────────────────────┘                                                              │
│                                                                                       │
│  ns: ui                                                                               │
│  ┌──────────────────┐  ┌──────────────────────────────┐  ┌──────────────────────┐    │
│  │ Motor de         │  │ Painel Interativo (ui)       │  │ Grafana              │    │
│  │ Integração       │  │ Next.js                      │  │ Deployment           │    │
│  │ (gateway)        │  │ Deployment + HPA             │  │ (painel tático       │    │
│  │ TS + Fastify     │  │ Fila priorizada, drill-down, │  │  gestores)           │    │
│  │ Deployment + HPA │  │ chat com o copiloto          │  │                      │    │
│  │ ↕ ITSM/Slack/etc │  │ API routes → internos        │  │                      │    │
│  │ + API pública    │  │                              │  │                      │    │
│  └──────────────────┘  └──────────────────────────────┘  └──────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐    │
│  │ NGINX Ingress + cert-manager + Keycloak (SSO AD/LDAP) — Deployment + CRDs    │    │
│  └──────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                       │
│  ns: infra                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────────────┐    │
│  │  ArgoCD · Prometheus · Loki · Tempo · Promtail (DaemonSet) · Vault · Velero  │    │
│  │  External Secrets · Keycloak · NetworkPolicy entre todos os namespaces       │    │
│  └──────────────────────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Cada caixa do diagrama tem uma primitiva K8s explícita (`Deployment`, `StatefulSet`, `CronJob`, `Job`). A separação por `Namespace` (`data`, `ml`, `agent`, `ui`, `infra`) habilita `NetworkPolicy` granular — o `ns: ui`, por exemplo, só pode falar com o `ns: ml` na porta da API, e nunca direto com o ClickHouse.

---

## 4. Fluxo End-to-End (Sequência de um Alerta)

Para concretizar a arquitetura, eis a jornada de um alerta de rajada — do raw event ao operador agindo:

1. **T+0s — Evento chega via webhook.** O ITSM/monitoramento da Locaweb emite POST para `https://ops-ahead.locaweb.local/webhook/incidents`. O **Motor de Integração** (`gateway`) valida assinatura HMAC, normaliza schema e publica em `incidents.received` no Kafka.
2. **T+5s — Stream processa.** Argo Workflows dispara mart incremental no ClickHouse (consumindo de `incidents.received`); Great Expectations valida o evento; o registro também é arquivado no lake (MinIO/Iceberg) para reprocessamento futuro.
3. **T+10s — Detector de rajada avalia.** O `burst-detector` (consumer Kafka) lê o evento, atualiza estado por IC em Redis, calcula z-score robusto + CUSUM. Cruzou limiar → publica em `alerts.burst`.
4. **T+46s — Modelo de breach calcula score.** Endpoint `/predict/breach` do `model-serving` retorna `prob=0.78` e features SHAP top-5.
5. **T+47s — Copiloto é invocado.** O `agent` recebe alerta + score + SHAP. Decide chamar `find_similar_resolved`, `get_group_load`, `get_ola_window`. Combina contexto.
6. **T+50s — Copiloto emite JSON.** Pydantic valida. Salvo em `recommendations` (Postgres) e publicado em fila.
7. **T+51s — Operador é notificado.** O Motor de Integração consome `recommendations` e faz fan-out: Slack/OpsGenie recebem ping (criticidade ≥ 4); o Painel Interativo atualiza a fila.
8. **T+? — Operador age.** Clique no Slack/OpsGenie ou no painel chama `/actions/callback` no Motor de Integração, que registra a ação e publica em `actions.taken` — alimenta o conjunto de avaliação para blind review futuro.

**Ramificações do fluxo:**

- **Recategorização (P3→P2, P2→P1).** Quando o ITSM emite o mesmo `incidente_id` com `prioridade_codigo` diferente, o `gateway` publica em `incidents.received` como qualquer outro evento — não há lógica especial na borda. O `model-serving` (consumer Kafka) compara a prioridade do evento com a última prioridade conhecida do incidente em Redis; detectada a transição, dispara re-inferência com a prioridade nova e republica em `incidents.scored` com o campo `recategorized_from` preenchido. O copiloto reavalia e emite recomendação atualizada — o operador vê apenas a versão mais recente (badge "↑ recategorizado P3→P2" na UI). O mart `priority_changes_log` é construído em paralelo pelo dbt (incremental, off-line) e serve treino e auditoria — não está no caminho de inferência.
- **Evento externo detectado.** Se `detect_external_event` retorna positivo no passo 5, o copiloto altera a ação recomendada: em vez de "ESCALAR para N2", emite "INVESTIGAR causa externa — verificar AWS/registro.br/SSL". O fluxo segue normalmente para Slack/OpsGenie, mas o alerta carrega `external_event_flag=true` e os botões de ação mudam (`Investigar externo` / `Tratar como normal`).
- **Sinal de precursor (P4 escalonando).** Se `detect_p4_escalation` retorna sequência crescente, o sinal entra como linha adicional no alerta (campo `p4_escalation_signal`) — não muda a ação, mas dá contexto ao operador sobre a origem do problema.

Tempo total entre **incidente aberto** e **recomendação na tela**: alvo de **< 60s** para alertas críticos. SLI monitorado em Grafana.

---

## 5. Protótipos da Solução

Os protótipos abaixo são **wireframes lo-fi** (a serem materializados em Figma para a apresentação). Cada um responde a uma pergunta concreta do usuário-alvo.

### 5.1 Interface primária — Recomendação no Slack/OpsGenie

```
┌─ #ops-ahead-alertas ────────────────────────────────────────────────────────┐
│                                                                             │
│  🤖 Ops Ahead   ·  agora                                                    │
│  ──────────────────────────────────────────────────────────────────────     │
│  🔴 CRÍTICO  ·  INC0048221  ·  Janela: 18 min  ·  Score: 0.91               │
│                                                                             │
│  IC: srv-mail-prod-07 · Grupo: Team02 (N2)                                  │
│  Ação recomendada: ESCALAR para N2                                          │
│  Por quê: 12 "Sem Intervenção" nos últimos 30min, padrão idêntico ao        │
│           INC0042131 (resolvido em 22min). OLA P2 expira em 1h15.           │
│  Sinais: 4 P4 escalonando em 2h (disco 70%→85%→92% no mesmo IC)             │
│                                                                             │
│  [ ✅ Ack & Aplicar ]  [ ⏭ Ignorar (motivo) ]  [ ⬆ Escalar N3 ]            │
│  [ 🔍 Ver no painel ]                                                       │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────      │
│  ⚠ EVENTO EXTERNO PROVÁVEL  ·  INC0048224  ·  Score: 0.83                   │
│                                                                             │
│  Detector flagou anomalia: volume 3.2σ acima da sazonalidade,               │
│  18 ICs distintos afetados simultaneamente, share P1 incomum.               │
│  Verifique status AWS / registro.br / SSL antes da ação padrão.             │
│                                                                             │
│  [ 🔎 Investigar externo ]  [ ⏭ Tratar como normal (motivo) ]               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Significado:** o operador interage **onde já vive**. O clique no botão (Block Kit do Slack ou Adaptive Card no Teams) chama `/slack/actions` no Motor de Integração, que registra a ação e publica em `actions.taken` no Kafka. O mesmo conteúdo vai para OpsGenie como _alert_ com payload estruturado — quem usa OpsGenie reconhece o formato e aciona via mobile/escalation policy. Nenhum operador precisa abrir o painel para agir.

### 5.2 Painel Interativo (N1/N2) — "Quero ver a fila inteira e auditar"

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Ops Ahead — Fila de Decisão                            [N1] [N2] [N3]     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  🔴 CRÍTICO  ·  Janela: 18 min  ·  Score: 0.91                             │
│  ──────────────────────────────────────────────────────────────────────    │
│  IC: srv-mail-prod-07  ·  Grupo: Team02 (N2)                               │
│  Ação: ESCALAR para N2 — 12 "Sem Intervenção" nos últimos 30min,           │
│        padrão idêntico ao INC0042131 (resolvido em 22min).                 │
│  Por quê: idade 2h45 · OLA P2 expira em 1h15 · grupo a 80% de carga        │
│  Similares: INC0042131  ·  INC0039877  ·  INC0038411                       │
│  [ Aplicar ]  [ Mais contexto ▼ ]  [ Ignorar (auditado) ]                  │
│                                                                            │
│  🟠 ALTO  ·  Janela: 47 min  ·  Score: 0.74                                │
│  ──────────────────────────────────────────────────────────────────────    │
│  IC: srv-app-mon-03  ·  Grupo: Team14 (N1)                                 │
│  Ação: MONITORAR próximos 15min — IC com histórico de auto-resolução       │
│        em 8min, grupo ocioso (32% de carga).                               │
│  ...                                                                        │
│                                                                            │
│  🟡 MÉDIO  ·  Janela: 2h10  ·  Score: 0.41                                 │
│  ──────────────────────────────────────────────────────────────────────    │
│  ...                                                                        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Significado:** O operador vê **uma fila ordenada por urgência reavaliada pelo copiloto**, não pelo score puro. Cada item é o TL;DR — a leitura primária leva 5 segundos. Drill-down (SHAP, gráfico de janela móvel, log de chamadas do copiloto) está a um clique.

### 5.3 Painel Tático (Gestores) — "Estamos no caminho de bater a meta?"

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Ops Ahead — Visão Tática                              Mês: Mai/2026       │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  KPIs do PPR — projeção mensal (Monte Carlo, IC 80%)                       │
│  ┌─ Volume P2 ─────────────────┐  ┌─ Volume P3 ─────────────────┐          │
│  │ 487 / 514 meta    95%       │  │ 1.218 / 1.290 meta   94%    │          │
│  │ Proj: 521  ⚠ acima da meta  │  │ Proj: 1.245  ✓ dentro       │          │
│  └─────────────────────────────┘  └─────────────────────────────┘          │
│  ┌─ OLA P2 ────────────────────┐  ┌─ OLA P3 ────────────────────┐          │
│  │ 8 / 13 breaches   62%       │  │ 14 / 17 breaches   82%      │          │
│  │ Proj: 11  ✓ dentro          │  │ Proj: 19  ⚠ acima da meta   │          │
│  └─────────────────────────────┘  └─────────────────────────────┘          │
│  P(fechar mês com os 4 KPIs ≥ 100%): 47%   ⚠ ação recomendada hoje         │
│                                                                            │
│  ┌────── Volume previsto (próximos 7 dias) ──────┐                         │
│  │       ▁▂▄▅█▇▅▃                                │  P1+P2 acumulado: 1.247 │
│  │   ▂▃▅█████████▇▅                              │  Tendência: ↑ 8%        │
│  └─────────────────────────────────────────────┘                           │
│                                                                            │
│  ┌────── Carga por equipe (agora) ──────┐                                  │
│  │  Team14 (N1)  ▓▓▓▓▓▓▓▓▓░  87%        │   ⚠ saturação                   │
│  │  Team02 (N2)  ▓▓▓▓▓▓░░░░  61%        │                                  │
│  │  Team07 (N2)  ▓▓▓░░░░░░░  28%        │   ← capacidade ociosa            │
│  └──────────────────────────────────────┘                                  │
│                                                                            │
│  ICs com tendência de degradação (últimos 7d):                             │
│   1. srv-mail-prod-07     ↑ 240% incidentes vs. baseline                   │
│   2. srv-app-mon-03       ↑ 180%                                           │
│   3. srv-db-replica-12    ↑ 95%                                            │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Significado:** Decisão de escala da próxima semana, identificação de ICs candidatos a manutenção preventiva, justificativa quantitativa de pedidos de capacidade. Os 4 KPIs aparecem separados porque o PPR não compensa entre dimensões — falhar em um zera a fatia correspondente, então cada projeção é tratada como evento independente. A probabilidade conjunta `P(fechar mês com 4 KPIs ≥ 100%)` é o sinal de ação para o gestor: abaixo de 50%, o time já tem que agir esta semana.

### 5.4 Drill-down de uma Recomendação — "Por que o copiloto disse isso?"

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ◄ Voltar    INC0048221 — Recomendação do copiloto                         │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  Score do modelo de breach: 0.91                                           │
│                                                                            │
│  Top features (SHAP):                                                      │
│   ▓▓▓▓▓▓▓▓▓  +0.34  idade do chamado (2h45 / OLA 4h)                       │
│   ▓▓▓▓▓▓     +0.21  carga do grupo (Team02 a 80%)                          │
│   ▓▓▓▓▓      +0.18  rajada de "Sem Intervenção" no IC (12 em 30min)        │
│   ▓▓▓        +0.11  hora do dia (15h — pico)                               │
│   ▓▓         +0.07  prioridade (P2)                                        │
│                                                                            │
│  Ferramentas chamadas pelo copiloto:                                       │
│   ✓ get_recent_incidents(srv-mail-prod-07, 6h)  → 19 incidentes            │
│   ✓ get_group_load(Team02)                       → 80% (alta)               │
│   ✓ find_similar_resolved(srv-mail-prod-07, P2)  → 3 candidatos             │
│   ✓ get_ola_window(P2, 13:30)                    → 75 min restantes         │
│   ✓ detect_p4_escalation(srv-mail-prod-07, 6h)   → 4 P4 (70→92% disco)     │
│   ✓ detect_external_event(15:30)                 → não · ambiente normal    │
│   ✓ get_kpi_projection(P2, OLA)                  → 9/13 · P(meta)=68%       │
│                                                                            │
│  Janela móvel — "Sem Intervenção" no IC (últimas 6h):                      │
│       ▁▁▂▁▁▁▁▁▂▁▁▂▃▅█████  ◄─ rajada nos últimos 30min                     │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Significado:** Auditabilidade total — N2 sênior pode contestar a recomendação ou confirmar; o feedback alimenta a avaliação do copiloto.

---

## 6. Gerenciamento do Projeto (Framework Ágil — Scrumban)

### Por que Scrumban

Unimos as **entregas fixas do Scrum** (sprints alinhadas aos marcos do challenge: ideação, arquitetura, MVP, final) com o **fluxo contínuo do Kanban** (board com WIP limits, sem dailies, sem story points). O peso ritualístico do Scrum não cabe num time pequeno trabalhando em paralelo com graduação — Scrumban preserva a cadência de entrega e tira o overhead.

### Time Horizontal

Não temos Product Owner fixo — todos revisam PRs e participam das decisões de escopo. O papel de **Scrum Master é rotativo a cada sprint**, com a função de ser o contato oficial e desbloquear o time:

| Sprint | Scrum Master |
|--------|--------------|
| Sprint 1 — Ideação | João Porto |
| Sprint 2 — Arquitetura | Samuel Gusman |
| Sprint 3 — MVP | Raphael Moraes |
| Sprint 4 — Final | Gustavo Neves |

**Dev Team:** Gustavo Neves · João Porto · Raphael Moraes · Samuel Gusman · Thiago Nunes (todos contribuem em código, design e documentação).

### Cadência

| Sincronia | Quando | Duração | Objetivo |
|-----------|--------|---------|----------|
| **Sprint Planning** | Segunda — início da sprint | 1h | Quebrar entregáveis em tarefas, definir WIP limits da semana |
| **Sprint Review** | Sexta — fim da sprint | 1h | Demo + retrospectiva curta |

Sem dailies — o board no GitHub Projects e a thread no WhatsApp dão visibilidade contínua. Sem story points — priorizamos por **vazão e tempo de ciclo** (lead time entre `In Progress` e `Done`).

### Ferramentas de Gestão

- **Board:** GitHub Projects (kanban: `Backlog → To Do → In Progress → Review → Done`) com WIP limits explícitos por coluna
- **Repositório:** GitHub — branches `feat/*` por tarefa, PR review obrigatório
- **Documentação:** `docs/sprints/sprint-N-*.md` por sprint
- **Comunicação:** WhatsApp (sync curtas) + GitHub Issues (assíncrono e rastreável)

### Cronograma Macro (Sprints do Challenge)

| Sprint | Período | Entregável | Status |
|--------|---------|------------|--------|
| **Sprint 1 — Ideação** | até 27/04/2026 | `sprint-1-ideation.md` + `sprint-1.html` + PPTX | ✅ Concluída |
| **Sprint 2 — Arquitetura** | até 24/05/2026 | `sprint-2-architecture.md` + `sprint-2.html` + PPTX | 🟡 Em curso |
| **Sprint 3 — MVP** | até 23/08/2026 | Pipeline funcional + 1º modelo + UI mínima | ⬜ Planejada |
| **Sprint 4 — Final** | até 21/09/2026 | Solução completa + apresentação final | 🔄 Em curso |

### Plano Detalhado da Sprint 2

| Semana | Foco | Responsável principal |
|--------|------|----------------------|
| **Sem 1 (28/04 – 04/05)** | EDA aprofundada · cruzamento status page (✅ feito) | Thiago |
| **Sem 2 (05/05 – 11/05)** | Desenho da arquitetura · escolha definitiva da stack | Time inteiro |
| **Sem 3 (12/05 – 18/05)** | Wireframes em Figma · POC inicial da stack: manifests de MinIO + ClickHouse + dbt rodando como `Job` orquestrado por Argo Workflows | Raphael (UI), Samuel (infra) |
| **Sem 4 (19/05 – 24/05)** | Apresentação (HTML + PPTX) · revisão final · ensaio | Time inteiro |

### Plano Macro Sprint 3 (preparação)

- **Mês 1 (jun):** Pipeline de dados completo · marts essenciais em dbt (`incidents_by_ic`, `p4_sequences_by_ci`, `first_touch_duration`, `priority_changes_log`, `daily_anomaly_features`, `kpi_monthly_state`) · Great Expectations validando cada mart · modelo de volume em MLflow.
- **Mês 2 (jul):** Modelo de breach (com features de domínio) + detector de rajada + **projeção KPI mensal Monte Carlo** + **detector de evento externo (Isolation Forest)** · `ui` (Next.js) MVP.
- **Mês 3 (ago):** Copiloto IA com as 9 ferramentas (incluindo `detect_p4_escalation`, `detect_external_event`, `get_kpi_projection`) · gateway com schema da recomendação versionado · ramificações de recategorização e evento externo no fluxo · avaliação inicial com analista N2.

### Gestão de Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Acesso a LLM com custo controlado | Média | Médio | Cache de prompt + fallback para modelo menor (Haiku) em alertas baixos |
| Dataset estático (sem stream real) | Alta | Médio | Simular stream relendo o CSV em ordem cronológica para a demo |
| Curva de aprendizado (LangGraph, Feast) | Média | Baixo | Spike técnico de 2 dias antes de cada componente novo |
| Avaliação do copiloto sem N2 real | Alta | Alto | _Self-review_ entre membros do time + comparação contra ação registrada no dataset |

---

## 7. Finalização

A Sprint 2 transforma a ideação em um **projeto executável**: cada caixa do diagrama tem uma tecnologia escolhida, uma justificativa, um contrato e um lugar no cronograma.

**O que defendemos com essa arquitetura:**

- **Sem dívida de fornecedor.** Toda peça é open-source ou tem alternativa equivalente. A Locaweb pode rodar isso no data center de São Paulo, em qualquer cloud, ou nos dois. A decisão é de negócio, não de arquitetura.
- **Modular por design.** Trocar Prophet, trocar Claude, trocar a tecnologia da UI — cada uma dessas trocas é local, sem replanejar a solução.
- **Observável desde o primeiro deploy.** Cada serviço expõe métricas, cada chamada do copiloto é auditável. Em produção, o time não opera às cegas — opera o sistema com o mesmo rigor que o sistema opera a Locaweb.
- **Pronta para a Sprint 3.** O MVP que vamos construir já cabe nesse desenho. Não há "vamos refazer depois".

**Próximos passos imediatos (entrada da Sprint 3):**

1. Helm charts da stack mínima — MinIO, ClickHouse, MLflow, FastAPI, Argo Workflows — instaláveis com um único `helm install` por namespace.
2. Primeira DAG Argo Workflows: ingestão do dataset → dbt run construindo os marts essenciais em ClickHouse (`incidents_by_ic`, `p4_sequences_by_ci`, `priority_changes_log`, `daily_anomaly_features`, `kpi_monthly_state`) → Great Expectations validando cada mart → treino do modelo de volume → registro em MLflow.
3. Wireframes do painel N1/N2 promovidos a protótipos navegáveis em Figma.
4. JSON Schema da recomendação versionado em `schemas/recommendation.json` — gera Pydantic (`agent`) e Zod (`gateway`) automaticamente; ponto de contrato único entre Camada 3 e Camada 4.

---

**Equipe Super Datados — FIAP Enterprise Challenge 2026 · Locaweb**

Gustavo Rodrigues Neves · João Gabriel Rodrigues Porto · Raphael Carlos da Silva Moraes · Samuel Calebe Gusman · Thiago Nunes Pereira
