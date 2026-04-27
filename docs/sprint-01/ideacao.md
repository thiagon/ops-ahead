# Sprint 1 — Ideação do Projeto

## Nome do Projeto

**Ops Ahead** — operação à frente, visão antecipada.

---

## Contextualização do Problema

A Locaweb opera infraestrutura crítica — 3.4 milhões de caixas de e-mail, 500 mil sites hospedados — onde cerca de 1/3 do tráfego da internet brasileira depende de estabilidade contínua.

A equipe BOPE (Baseline Operation) opera 24x7 em três níveis (N1, N2 e N3), com metas de OLA que impactam diretamente o bônus anual dos colaboradores. A margem de erro é mínima: apenas ~36–39 breaches anuais de P2 para atingir 100% da meta.

### O que os dados nos mostram

Nossa análise preliminar dos 122.543 incidentes registrados revela um cenário com oportunidades claras de melhoria:

- **65.6% dos incidentes são encerrados como "Sem Intervenção"** — o auto-healing resolve a maioria, mas esses eventos não são aproveitados como sinais preditivos de falhas maiores.
- **85% dos incidentes vêm do monitoramento automático** — apenas 15% são abertos manualmente, o que significa que a maioria dos eventos já nasce com dados estruturados prontos para modelagem.
- **O Team14 (N1) concentra 75.7% de todo o volume** — um gargalo operacional claro que qualquer solução precisa endereçar.
- **Apenas 1% dos incidentes KPI resultam em violação** (248 de 25.600) — o problema não é volume de falhas, é a imprevisibilidade das poucas que realmente importam.
- **18% dos incidentes duram menos de 60 segundos** — ruído que hoje compete por atenção com incidentes reais.

---

## Problema a ser Resolvido

A operação hoje é **reativa**: age depois que o incidente já ocorreu. Com base nos dados, identificamos quatro problemas centrais:

1. **Picos não antecipados** — o volume varia ~30% entre dias úteis e fins de semana, com concentração entre 9h e 16h, mas essa sazonalidade não alimenta nenhuma previsão de escala.
2. **Sinais preditivos desperdiçados** — as 80 mil ocorrências anuais de "Sem Intervenção" são descartadas do KPI, mas rajadas desses eventos em um mesmo IC são o principal indicador de falha P2 iminente. Hoje ninguém monitora isso.
3. **Risco de OLA invisível** — os 248 breaches anuais representam apenas 1% do volume KPI, mas cada um pressiona diretamente as metas de atingimento. A equipe só descobre a violação depois que o prazo estourou.
4. **Concentração de carga sem resposta** — o Team14 absorve 75.7% dos incidentes e apenas 3 servidores de monitoramento de aplicações concentram ~11% do volume total. Não existe mecanismo para redistribuir carga antes da sobrecarga.

---

## Público-alvo

| Nível          | Quem                                      | Como se beneficia                                              |
| -------------- | ----------------------------------------- | -------------------------------------------------------------- |
| **Primário**   | Equipe BOPE (N1/N2/N3) — especialmente N1 | Antecipação de picos, priorização proativa                     |
| **Secundário** | Gestores operacionais e diretoria         | Decisões de alocação de equipe e priorização baseadas em dados |
| **Indireto**   | Clientes Locaweb                          | Redução do tempo de indisponibilidade dos serviços             |

---

## Proposta de Solução

A solução é composta por quatro camadas que trabalham juntas: ingestão e processamento dos dados, inteligência preditiva clássica, agente LLM de triagem e interface de decisão. ML clássico entrega o sinal estatístico (rápido, barato, calibrado); o agente LLM enriquece o alerta com contexto e produz uma recomendação de ação. Cada camada faz o que faz melhor.

### Camada 1 — Pipeline de Dados

- Ingestão contínua dos registros de incidentes da plataforma ITSM.
- Processamento e enriquecimento automático: cálculo de features temporais (sazonalidade, dia da semana, turno), features de frequência por IC (contagem de incidentes recentes, intervalo entre ocorrências) e indicadores de carga por grupo designado.
- Limpeza de ruído: filtragem de falsos positivos (incidentes de duração ínfima) e classificação de incidentes automáticos vs. manuais.

### Camada 2 — Modelos Preditivos

Três modelos complementares, cada um com técnica escolhida em função da pergunta que responde:

| Modelo                     | Pergunta                          | Técnica                                                                                                                                                                                                                                                                                                                                            | Saída                                                                                       |
| -------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Previsão de volume**     | Quantos incidentes em D+1 e D+7?  | **Baseline:** SARIMA / Prophet com regressores de calendário (feriado, dia útil, turno). **Modelo principal:** gradient boosting (LightGBM) com features de lag (1, 7, 14 dias), médias móveis, indicadores de sazonalidade e codificação de prioridade/grupo. Avaliação separada por prioridade para evitar que P3 mascare o sinal de P1/P2.       | Volume previsto por prioridade e grupo, com intervalo de confiança                          |
| **Risco de breach de OLA** | Qual a probabilidade de estourar? | Classificação binária com **LightGBM/XGBoost**, treinada apenas em incidentes elegíveis ao KPI (P1–P3, sem incidente pai, sem "Sem Intervenção"). **Calibração** via isotonic regression para que a probabilidade tenha leitura direta. **Explicabilidade** com SHAP por incidente. Treino com class weighting para o desbalanceamento (1% breach). | Score 0–1 por incidente aberto + top features que pressionam o risco                        |
| **Detecção de rajada**     | Este IC está em trajetória ruim?  | Detecção de anomalia **por IC** em janela móvel: contagem de "Sem Intervenção" em janelas de 15min / 1h / 6h, comparada via **z-score robusto** sobre baseline histórico + **CUSUM** para detectar mudança de regime. Limiar dinâmico por IC (não global), evitando alarmes em ICs naturalmente ruidosos.                                          | Alerta antecipado quando o padrão excede o limiar — com lead-time medido em minutos antes do P2 |

### Metodologia

A entrega ML é avaliada com o mesmo rigor que a operação avaliaria em produção:

- **Split temporal sem leakage:** treino em meses anteriores, validação em janela recente, teste em hold-out final. Nada de validação cruzada aleatória — em série temporal isso vaza informação do futuro.
- **Métricas por modelo:**
  - Volume: MAPE, MAE e cobertura do intervalo de previsão.
  - Risco de breach: AUC-ROC, AUC-PR, Brier score (calibração) e **recall@top-k** (dos k incidentes mais arriscados que o modelo aponta, quantos breachariam de fato).
  - Rajada: **precision** dos alertas e **lead-time** médio (quantos minutos antes do P2 o alerta dispara, com qual taxa de falso positivo).
- **Re-treino e monitoramento:** retreino periódico, monitoramento de _drift_ via PSI nas features mais relevantes; alarme se a calibração do modelo de breach degradar.
- **Avaliação do agente LLM:** _blind review_ por analista N2 sênior em conjunto histórico de alertas — métricas de **concordância** com ação real, **tempo médio de triagem** (com vs. sem agente) e **taxa de alucinação** (saídas que referenciam ICs/grupos inexistentes, monitorada continuamente).
- **Princípio de implementação:** abordagem open-source e cloud-agnostic, sem dependência de serviço proprietário. Detalhes de stack, orquestração e infraestrutura ficam para a **Sprint 2 (Arquitetura)** — esta sprint trata da ideação da solução e das técnicas escolhidas.

### Camada 3 — Agente LLM de Triagem e Decisão

ML clássico responde "qual o risco?" com um número. Mas o operador não age a partir de um número — age a partir de **contexto**. Esta camada usa um agente LLM com _tool calling_ para transformar cada alerta em uma recomendação acionável.

**Como funciona:**

Para cada alerta gerado pela Camada 2 (rajada ou breach iminente), o agente:

1. **Recebe o sinal cru** — score de risco, features SHAP, IC envolvido, grupo designado.
2. **Busca contexto via ferramentas** que o próprio agente decide invocar:
   - `get_recent_incidents(IC, janela)` — incidentes recentes no mesmo IC.
   - `get_group_load(grupo)` — carga atual e capacidade restante do grupo.
   - `find_similar_resolved(IC, prioridade)` — RAG sobre base histórica para encontrar incidentes parecidos já resolvidos e _como_ foram resolvidos.
   - `get_ola_window(prioridade, aberto_em)` — quanto tempo resta até o breach.
3. **Reavalia criticidade** combinando o score estatístico com o contexto recuperado (ex.: alerta de rajada perde criticidade se o grupo está ocioso e o IC já tem histórico de auto-recuperação em 5min — ganha criticidade se é horário de pico e o grupo está saturado).
4. **Gera um TL;DR de decisão** — saída estruturada (JSON) com schema fixo:
   - Criticidade reavaliada (1–5) e justificativa em uma frase.
   - **Ação recomendada** ("escalar para N2 agora", "monitorar próximos 15min", "abrir change preventivo no IC X").
   - **Quem deve atuar** (qual grupo / nível).
   - **Janela de ação** (em minutos, baseada no OLA restante).
   - Links para os 2–3 incidentes similares que mais informaram a recomendação.

**Técnicas e guardrails:**

- **LLM com function calling** (modelo de fronteira — Claude ou GPT — escolhido por confiabilidade em saída estruturada).
- **RAG** sobre o histórico de incidentes resolvidos, com _embeddings_ por descrição + filtros estruturados (IC, prioridade, grupo).
- **Structured outputs** com JSON Schema validado — se o LLM produzir saída inválida, fallback para o alerta cru.
- **Guardrails operacionais:** o agente _recomenda_, não age. Toda saída é auditada, registrada e mostrada com a fonte do contexto que usou — o N1/N2 mantém a decisão final.
- **Avaliação:** _blind review_ por analista N2 sênior comparando recomendação do agente vs. ação real tomada em incidentes históricos; métrica de concordância e tempo economizado de triagem.

### Camada 4 — Interface de Decisão

- **Painel operacional (N1/N2):** fila priorizada onde cada item é o **TL;DR do agente** — criticidade, ação recomendada, janela e contexto. Score estatístico e features SHAP ficam disponíveis em _drill-down_, mas a leitura primária é o resumo executivo.
- **Painel tático (gestores):** projeção de volume D+1 e D+7, acompanhamento de breaches acumulados vs. meta anual, e indicadores de carga por equipe para apoiar decisões de escala e alocação.
- **Relatórios de tendência:** análise de padrões por IC, categoria e prioridade ao longo do tempo — identificando componentes em degradação e sazonalidades recorrentes.

A solução é cloud-agnostic, aplicável independentemente do provedor de infraestrutura.

---

## Impacto da Solução

- **Operacional:** transição de postura reativa para proativa; alocação inteligente de equipe antes dos picos.
- **Financeiro:** proteção do bônus anual dos colaboradores, que está diretamente ligado às metas de OLA.
- **Cliente:** menor tempo de indisponibilidade e melhor experiência com os serviços Locaweb.
- **Gestão:** visibilidade sobre tendências e riscos para tomada de decisão baseada em dados, não em intuição.

---

## Benefícios Esperados

### Operacionais
- Redução de breaches de OLA por meio de ação preventiva.
- Melhor distribuição de carga entre equipes, especialmente para desafogar o N1.
- Identificação precoce de Itens de Configuração problemáticos antes do impacto ao cliente.
- Base quantitativa para decisões operacionais que hoje dependem de experiência individual.

### Estratégicos
- **Redução de turnover na equipe BOPE:** a pressão constante de metas de OLA gera estresse; com previsibilidade, a equipe trabalha com mais controle e menos urgência.
- **Planejamento de capacidade fundamentado:** projeções de volume permitem justificar contratações, escalas de plantão e alocação de orçamento com dados concretos em vez de estimativas.
- **Manutenção preventiva de infraestrutura:** ao identificar ICs em degradação antes da falha, a equipe pode agendar manutenções em janelas planejadas em vez de reagir a emergências.
- **Aprendizado organizacional:** os padrões descobertos pelo modelo documentam conhecimento que hoje existe apenas na cabeça de operadores experientes — protegendo a operação contra perda de know-how por rotatividade.
- **Melhoria contínua do monitoramento:** ao revelar quais tipos de incidentes são consistentemente precedidos por sinais detectáveis, a solução aponta onde investir em automação e auto-healing mais eficazes.

---

## Comparativo com a Concorrência

| Solução                | O que faz                         | Limitação                                                      |
| ---------------------- | --------------------------------- | -------------------------------------------------------------- |
| **PagerDuty AIOps**    | Correlação e supressão de alertas | Atua sobre alertas já disparados — não prevê volume futuro     |
| **Moogsoft**           | Redução de ruído via clustering   | Foco em agrupar incidentes existentes, sem projeção temporal   |
| **BigPanda**           | Correlação cross-domain           | Correlaciona eventos em tempo real, mas não projeta tendências |
| **Dynatrace Davis AI** | Root cause analysis automático    | Explica o que aconteceu, não antecipa o que vai acontecer      |

**Nossos diferenciais — ancorados nas técnicas escolhidas:**

- **"Sem Intervenção" como sinal, não como ruído.** As ferramentas concorrentes filtram ou agrupam esses eventos. Nós usamos a _aceleração_ deles em janela móvel por IC como variável de entrada para o modelo de breach **e** como gatilho do detector de rajada (z-score robusto + CUSUM). É o uso ativo dos 80 mil eventos anuais que hoje são descartados.
- **Horizonte multi-janela (D+1 + D+7).** Previsão curta para escala diária e média para planejamento semanal — entregues no mesmo painel, com intervalos de confiança. Concorrentes operam em tempo real; nós operamos com antecedência.
- **Score calibrado por incidente aberto, não só agregado.** O modelo de breach retorna probabilidade calibrada (isotonic) **para cada chamado em aberto**, com SHAP indicando o porquê (idade vs. limite OLA, carga atual do grupo, frequência recente do IC). Permite ação concreta: "quais 10 chamados eu olho primeiro?".
- **Validação temporal honesta.** Split por tempo, sem vazamento — métricas reportadas (MAPE, recall@top-k, lead-time) refletem o que o modelo entrega em produção, não otimismo de validação aleatória. É o que diferencia um POC de uma solução operável.
- **Explicabilidade no vocabulário do operador.** Features são desenhadas para serem lidas pelo N1/N2 (idade do chamado, carga do grupo, frequência do IC) — não black-box. O analista entende _por que_ aquele incidente subiu no ranking de risco.
- **Híbrido ML + Agente LLM, não LLM puro nem ML puro.** A maioria dos concorrentes para no score estatístico ou no dashboard. Nós entregamos **recomendação acionável**: o LLM com _tool calling_ busca contexto (incidentes similares via RAG, carga do grupo, OLA restante) e gera um TL;DR estruturado — "ação X, em Y minutos, por causa de Z". Não é chatbot decorativo: é triagem assistida com saída JSON validada e guardrails. ML clássico não faz isso; LLM sozinho não tem o sinal calibrado para começar.
