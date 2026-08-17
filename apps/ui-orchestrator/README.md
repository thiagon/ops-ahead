# ui-orchestrator

Ponto de entrada único que recebe um pedido de execução em linguagem de negócio (REST ou
MCP) e faz uma análise rodar — publicando em Kafka. Quem chama nunca precisa saber que
existe Kubernetes, Kafka ou KEDA por trás — ver
`conductor/tracks/exec-trigger_20260807/spec.md` para a arquitetura completa.

## `POST /trigger`

Corpo discriminado pelo campo `analysis`. Responde `202 {"run_id": "<uuid>"}` na hora —
o pod ainda não subiu nesse momento (publicado em Kafka; KEDA escala o consumer de 0 pra
1 assim que detecta a mensagem na fila).

| `analysis` | Campos obrigatórios | O que roda |
|---|---|---|
| `volume_forecast` | `train_end`, `validation_end`, `holdout_end` (datas `YYYY-MM-DD`) | Treino do modelo de previsão de volume (`ml-trainer`, `ns: ml`) |
| `breach_risk` | `train_end`, `validation_end`, `holdout_end` | Treino do modelo de risco de breach de OLA (`ml-trainer`, `ns: ml`) |
| `data_refresh` | — | `dbt run` — materializa os marts (`data-runner`, `ns: data`) |
| `data_quality_check` | — | Suite Great Expectations `critical` (`data-runner`, `ns: data`) |

Sem override de origem de dado no payload — a origem é sempre a padrão do cluster,
resolvida server-side a partir de um `Secret`, nunca do payload (risco de SSRF/vazamento
de credencial; ver `conductor/tracks/exec-trigger_20260807/payloads.md`). Nenhum outro
campo de infraestrutura (namespace, tópico, nome do consumer) é aceito ou exposto — esse
roteamento é interno (`src/modules/trigger/service.ts`).

### Exemplos

```bash
curl -X POST https://orchestrator.ops-ahead.localtest.me/trigger \
  -H 'content-type: application/json' \
  -d '{
    "analysis": "volume_forecast",
    "train_end": "2025-09-30",
    "validation_end": "2025-10-31",
    "holdout_end": "2026-01-31"
  }'

curl -X POST https://orchestrator.ops-ahead.localtest.me/trigger \
  -H 'content-type: application/json' \
  -d '{"analysis": "data_quality_check"}'
```

## `GET /runs/{run_id}`

```bash
curl https://orchestrator.ops-ahead.localtest.me/runs/<run_id>
# {"run_id": "...", "status": "queued" | "Running" | "Succeeded" | "Failed", ...}
```

`queued` significa que o pedido foi validado e publicado, mas nenhuma mensagem de status
chegou ainda de `trigger.status` — não é erro, é o estado normal logo após o `202`. A
resposta nunca consulta o Kubernetes: reflete o mapa em memória, rehidratado do tópico
compactado `trigger.status` a cada restart.

## `GET /health`

Liveness/readiness — não requer autenticação nem parâmetros. Só responde depois que o
backlog de `trigger.status` termina de ser replayado no startup (ver
`src/plugins/kafka.ts`).

## MCP

O mesmo contrato acima é exposto como tools MCP (`trigger_analysis`, `get_run_status`)
no transporte HTTP em `/mcp` (streamable HTTP, modo stateless), montado sobre o mesmo
processo/porta — hand-wired sobre `@modelcontextprotocol/sdk` (não existe equivalente
Node do `fastapi-mcp`), chamando as mesmas funções de `service.ts` que as rotas REST
usam — nenhuma lógica de validação ou despacho duplicada (ver `src/modules/mcp/`).

## Desenvolvimento

```bash
npm install
npm run dev          # node --watch, porta 3000
npm test             # unit + e2e (kafka fake, nenhum broker necessário)
npm run lint
```

Ver `.env.example` para a config completa (tópicos Kafka, bootstrap servers, porta).
