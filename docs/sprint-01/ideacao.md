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

A solução é composta por três camadas que trabalham juntas: ingestão e processamento dos dados, inteligência preditiva, e interface de decisão.

### Camada 1 — Pipeline de Dados

- Ingestão contínua dos registros de incidentes da plataforma ITSM.
- Processamento e enriquecimento automático: cálculo de features temporais (sazonalidade, dia da semana, turno), features de frequência por IC (contagem de incidentes recentes, intervalo entre ocorrências) e indicadores de carga por grupo designado.
- Limpeza de ruído: filtragem de falsos positivos (incidentes de duração ínfima) e classificação de incidentes automáticos vs. manuais.

### Camada 2 — Modelos Preditivos

Três modelos complementares, cada um respondendo uma pergunta diferente:

| Modelo                     | Pergunta que responde                                              | Saída                                                                                                               |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Previsão de volume**     | Quantos incidentes teremos amanhã (D+1) e na próxima semana (D+7)? | Volume projetado por prioridade e por grupo                                                                         |
| **Risco de breach de OLA** | Qual a probabilidade de estourar o prazo de resolução?             | Score de risco por incidente aberto e projeção de breaches acumulados vs. meta anual                                |
| **Detecção de rajada**     | Este IC está em trajetória de falha grave?                         | Alerta antecipado quando o padrão de incidentes automáticos ("Sem Intervenção") em um IC indica degradação iminente |

### Camada 3 — Interface de Decisão

- **Painel operacional (N1/N2):** visão em tempo real dos alertas de rajada e dos incidentes com maior risco de breach, orientando onde a equipe deve atuar primeiro.
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

**Nossos diferenciais:**

- **Previsão temporal** (D+1 e D+7): as soluções acima são reativas ou em tempo real — nenhuma projeta volume futuro de incidentes com janela de antecedência.
- **Detecção de rajada como sinal preditivo**: uso de padrões de aceleração de incidentes automáticos como indicador antecedente de falhas graves, algo que ferramentas de correlação não exploram.
- **Projeção de risco de breach de OLA**: não apenas monitorar se o OLA foi violado, mas estimar a probabilidade de violação antes que o prazo estoure — permitindo ação preventiva.
- **Explicabilidade orientada à decisão**: além de prever, o modelo explica quais fatores estão pressionando a operação, apoiando decisões concretas de alocação e priorização.
