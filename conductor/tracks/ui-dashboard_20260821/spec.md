# Specification: Dashboard — a camada gold vira tela

**Track ID:** ui-dashboard_20260821
**Type:** Feature
**Created:** 2026-08-21
**Status:** Draft

## Summary

Construir a interface que fecha o produto: um app que lê a camada gold do ClickHouse e mostra o que
ela significa — a projeção de fechamento do KPI para quem gerencia, a fila de incidentes vivos
ordenada por prazo para quem opera.

Dá também destino consultável às duas análises que hoje calculam e não gravam em lugar nenhum
legível — projeção de KPI e previsão de volume — porque sem elas metade da tela do gestor não tem
número.

## Context

A `incident-flow_20260819` deixou a interface explicitamente fora, como track própria a ser criada
"quando os nomes e os campos publicados aqui estiverem definidos". Estão: `contracts/` tem os cinco
schemas, `apps/data-runner/models/gold/` tem dez modelos materializados, `domain/` tem o vocabulário.

O sistema hoje calcula tudo e não mostra nada. O valor do produto — antecipar a violação enquanto o
incidente ainda está aberto — só existe se alguém vir o aviso dentro da janela em que ele muda o
desfecho.

### A gold é o read model

Não há banco de leitura separado, e nada copia dado de um armazenamento para outro. A camada gold já
é o formato que a tela consome: `+materialized: table`, `MergeTree`, `order_by` escolhido pela
consulta que cada uma serve — `gold_alert_kpi_achievement` está ordenada por
`(tenant_id, kpi_group, year, month)`, que é a chave da tela do gestor. São tabelas pequenas,
pré-agregadas, prontas.

### O `ui-gateway` é entrada, e continua só isso

Uma rota por credencial, HMAC por par `(tenant, source)`, corpo opaco que ele nunca parseia. Ele
existe para não interpretar nada, e está no caminho crítico do webhook. Leitura é o oposto disso:
conhecer schema de gold, montar query, paginar, autenticar usuário — outro modelo de auth, outra
cadência de deploy.

Quem cumpre a regra de que **a tela nunca fala com armazenamento direto** é o servidor do próprio
front.

### Fonte da verdade

`contracts/` (schemas publicados), `apps/data-runner/models/` (o que está materializado e com que
chave), `domain/` (vocabulário) e o spec da `incident-flow_20260819`.

## User Story

Como operador, quero ver os incidentes abertos ordenados pelo prazo que ainda resta, com o marco já
consumido e o risco de estouro, para agir enquanto ainda dá.

Como gestor, quero ver a projeção de fechamento dos KPIs do mês contra a meta anual em uma tela, em
vez de esperar a apuração para saber se a meta foi atingida.

## Acceptance Criteria

- [ ] Um app único serve a tela e consulta o ClickHouse; o navegador nunca recebe credencial de banco
- [ ] A fila de incidentes vivos é lida de `silver_alert_open`, ordenada por `due_at`, com o marco
      consumido visível
- [ ] O painel do gestor lê `gold_alert_kpi_achievement` — a leitura contra a meta anual cumulativa,
      não o mês isolado de `kpi_monthly_state`
- [ ] A projeção de fechamento e a previsão de volume D+1/D+7 vêm de tabela consultável, não de
      métrica de execução no MLflow
- [ ] Tendência por categoria e produto é lida de `gold_alert_category_trends`, com P2 e P3 nunca
      colapsadas
- [ ] Nenhuma tela conhece vocabulário de origem — tudo que chega nela já passou pela tradução
- [ ] O app sobe no cluster por GitOps, como os demais, e responde no ingress

## Dependencies

- `incident-flow_20260819` em `main` — atendido
- Camada gold materializada (`apps/data-runner/models/gold/`, dez modelos) — atendido
- `ml-model-serving` no ar, para o score de risco por incidente — atendido
- Chart `infra/charts/ui-frontend` existe como stub nginx e será substituído
- Track `mvp-closeout_20260817` cobre copiloto e painel N1/N2; o que estiver aqui não se sobrepõe

## Out of Scope

- **Autenticação de usuário.** O dashboard é interno, protegido por ingress e NetworkPolicy, mesmo
  padrão do Prometheus em dev. Authentik SSO já está previsto para Sprint 3/4 e resolve isso para
  todos os serviços de uma vez; login próprio aqui seria duplicação com prazo de validade.
- **Multi-tenant na tela.** O app filtra por um `tenant_id` de configuração. Seletor de tenant sem
  auth deixaria qualquer um ver qualquer cliente — a decisão depende de saber quem é o usuário.
- **Copiloto e recomendação por LLM** — Sprint 4, track `mvp-closeout_20260817`.
- **Escrever de volta na origem** — ack real, anotação no chamado. Mesma razão da `incident-flow`:
  ação com efeito em sistema de terceiro, exige credencial de escrita e decisão explícita sobre o que
  o sistema pode fazer sozinho.
- **Read model em Postgres e app materializador** — descartados; ver §Context.
- **Alterar o `ui-gateway`** — ele segue só ingest.
- **Alertar por canal externo** (Slack, e-mail) — a track `mvp-closeout_20260817` trata do canal.

## Technical Notes

### O desenho

```
origens ──HMAC──▶ ui-gateway ──▶ Kafka ──▶ [pipeline] ──▶ ClickHouse
                  (Node, só ingest)                          │ gold + silver
                                                             │
                                     ui-frontend ────────────┘
                                     (loader server-side)
                                          │
                                       browser
```

Um app, um container, um deployment. O loader roda no servidor do próprio front — é ele que consulta
o ClickHouse. Nenhuma credencial de banco alcança o navegador.

### Stack

**React Router 7 em framework mode.** Vite nativo, loader server-side que devolve dado tipado ao
componente, um app só. A escolha é sobre estabilidade de API: Next.js — oficial ou reimplementado
pelo `vinext` — carrega churn de convenção a cada release, e o `vinext` herda esse churn perseguindo
a superfície do Next 16.x. Fora da Vercel não há contrapartida que pague isso.

Node 24, `npm` (nunca `pnpm`), Biome e vitest — mesmo padrão de `apps/ui-gateway` e
`apps/ui-orchestrator`. `workload: deployment`, `namespace: ui`.

### Identidade visual

A do material de apresentação (`docs/presentations/`), extraída de lá como tokens do app — a tela é
a mesma marca que a banca já viu nos decks.

| Papel | Token |
|-------|-------|
| Fundo, superfície, superfície elevada | `#0B0F19`, `#161F33`, `#1E2A47` |
| Borda | `#2A3B5C` |
| Texto: claro, atenuado, apagado | `#F8FAFC`, `#94A3B8`, `#64748B` |
| Acento da marca | `#F9203E` |
| Sinal | verde `#10B981`, âmbar `#F59E0B`, azul `#3B82F6`, roxo `#8B5CF6` |

Poppins para título, Inter para texto, JetBrains Mono para número e identificador.

As cores de sinal já carregam sentido no deck — verde é o que está dentro do esperado, âmbar o que
está em risco, vermelho o que estourou. A tela usa esse mesmo mapa. Uma escala de risco contínua
(o consumo de prazo) não vira cor nova: percorre verde → âmbar → vermelho conforme o prazo é
consumido.

### As duas análises sem destino consultável

Projeção de fechamento do KPI (Monte Carlo) e previsão de volume D+1/D+7 calculam e gravam apenas
métrica de execução no MLflow. Métrica de execução é registro de treino, não dado consultável: não
tem chave, não tem grão, não se junta com nada.

A correção é a análise gravar uma tabela no ClickHouse, no mesmo grão que a tela lê — não um
projetor copiando resultado. As duas tabelas seguem a convenção das demais gold: `MergeTree`,
`order_by` pela chave de leitura. O `ml-trainer` já usa `clickhouse_driver` para ler; escrever é
aditivo, sem dependência nem infraestrutura nova.

### A projeção de KPI ficou para trás da meta anual

`apps/ml-trainer/src/kpi_projection/` projeta contra alvo de `settings`
(`kpi_target_breaches_p2`/`_p3`) e lê `kpi_monthly_state` por `severity`. A `incident-flow` moveu a
meta para o seed `tenant_kpi_targets`, indexado por `kpi_group` — `p1_p2` (severidades 1 e 2 somadas)
e `p3` — porque a meta de P1+P2 é combinada, e é anual cumulativa, não teto mensal.

Projetar contra um alvo de configuração enquanto a meta real vive em seed produz dois números
diferentes para a mesma pergunta. A projeção passa a ler `gold_alert_kpi_achievement` e
`tenant_kpi_targets`, no grão `kpi_group`, e a probabilidade que ela responde é "atingir qual faixa
da banda ao fim do ano", não "ficar abaixo de um teto do mês".

### Por que `gold_alert_kpi_achievement` e não `kpi_monthly_state`

A meta real é anual, cumulativa, avaliada mês a mês contra o total do ano até ali, em banda de
percentual de atingimento (`tenant_kpi_targets`, `kpi_group` `p1_p2` e `p3`). `kpi_monthly_state`
conta o mês isolado e não avalia meta — a projeção de fechamento só faz sentido contra a banda anual.
A `incident-flow` é explícita nisso.

### A fila do operador

`silver_alert_open` já existe exatamente para isso: só as ocorrências vivas, ordenadas por `due_at`,
separadas porque `due_at` é reescrito a cada recategorização e não serve como chave primária da
tabela cheia. A tela lê essa view, não `silver_alert`.

O `consumed_ratio` da linha é o que a `incident-flow` mediu como preditor forte sozinho: severidade 3
acima de 75% do prazo estoura em 87% dos casos. O score do `ml-model-serving` soma a isso, não
substitui.

### Recategorização muda o prazo

Uma ocorrência que muda de severidade tem os marcos recalculados, não continuados — pode nascer
estourada no instante da mudança. A tela mostra o prazo vigente, não o original.

### A fila só existe com ocorrência viva

Nada no ambiente publica incidente que ainda esteja aberto: o que trafega chega já fechado, com
duração preenchida. Sem "continua aberto" não há linha em `silver_alert_open`, e a tela do operador
não tem o que mostrar.

A track publica os eventos de ciclo de vida que faltam — abertura sem fechamento, transição de
severidade, ocorrência em cada faixa de consumo de prazo — pelo contrato `incident-alert`, entrando
pelo caminho normal de ingestão. É material de teste da tela, não produto.

---

_Generated by Conductor. Review and edit as needed._
