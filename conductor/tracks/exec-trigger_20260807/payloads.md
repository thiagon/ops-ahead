# Payloads — `ui-orchestrator` e o caminho sob demanda

> **Nomes como estavam quando este documento foi escrito.** Depois desta track o serviço
> virou `ui-gateway`, `POST /trigger` virou `POST /analyses`, `GET /runs/{run_id}` virou
> `GET /analyses/{id}`, e o tópico `trigger.status` deixou de existir — o consumidor agora
> reporta status por `PATCH /analyses/{id}` com o header `X-Run-Key`. Toda análise, a
> `full_pipeline` inclusive, entra por `POST /analyses`; o CronJob diário é só mais um
> caller, autenticado pela chave do scheduler. Os payloads abaixo também são anteriores ao
> `tenant_id`, hoje obrigatório em toda análise sobre modelos.
>
> **A união aceita hoje é `apps/ui-gateway/src/services/analyses/schema.ts`**, com o JSON
> Schema em `contracts/` como schema de record. Este documento é a narrativa da decisão,
> não a lista.

Contrato completo de todas as mensagens que atravessam o sistema, do `POST /trigger` até
o `GET /runs/{run_id}`. Complementa `spec.md` (arquitetura) e
`domain/ubiquitous-language.md` (o que `analysis` significa) — este documento é a leitura
narrada, com exemplos; a fonte de verdade formal, validável, é o JSON Schema em
`contracts/`:

| Tópico | Schema |
|---|---|
| `trigger.ml` | [`contracts/trigger-ml.schema.json`](../../../contracts/trigger-ml.schema.json) |
| `trigger.data` | [`contracts/trigger-data.schema.json`](../../../contracts/trigger-data.schema.json) |
| `trigger.status` | [`contracts/trigger-status.schema.json`](../../../contracts/trigger-status.schema.json) |

`POST /trigger`/`GET /runs` não têm schema em `contracts/` — são HTTP, não Kafka, e já
são validados por `zod` direto em `apps/ui-orchestrator` (mesmo critério que
`contracts/` já usa hoje: só o que atravessa uma fronteira Kafka multi-linguagem ganha
schema formal lá).

**`analysis` é o discriminador em todo lugar — não existe um vocabulário interno
separado.** A tradução que a versão anterior deste documento descrevia
(`analysis → workload`/`step`) só fazia sentido enquanto havia um `WorkflowTemplate`
do Argo pra esconder do chamador; sem Argo Workflow nesta arquitetura, não sobrou nenhum
detalhe de infra pra esconder atrás de um nome diferente — `workload: "volume"` não era
menos "de negócio" que `analysis: "volume_forecast"`, só um apelido redundante. Kafka
carrega `analysis` com os mesmos valores do `POST /trigger`, ponto. `ui-orchestrator`
só decide **em qual tópico publicar** (`ml`/`data` — roteamento, não tradução de
vocabulário).

O CLI que já existe em `ml-trainer`/`data-runner` desde a Fase 1 (`train volume`/
`train breach`, `run transform`/`run quality`) não muda — o modo `consume` de cada app
traduz `analysis → volume`/`breach` (ou `transform`/`quality`) **localmente, dentro do
próprio app**, não mais no `ui-orchestrator`. É uma tabela pequena (2-3 entradas) que já
mora perto de quem a usa, em vez de atravessar uma fronteira de processo pra chegar lá.

---

## 1. `POST /trigger` — caller → `ui-orchestrator`

Linguagem de negócio, discriminado por `analysis`. Idêntico ao contrato original do
`trigger-service` (não muda com esta revisão).

```json
// analysis: volume_forecast
{
  "analysis": "volume_forecast",
  "train_end": "2025-09-30",
  "validation_end": "2025-10-31",
  "holdout_end": "2026-01-31"
}
```

```json
// analysis: breach_risk — mesmos campos de volume_forecast
{
  "analysis": "breach_risk",
  "train_end": "2025-02-15",
  "validation_end": "2025-03-15",
  "holdout_end": "2025-04-09"
}
```

```json
// analysis: kpi_projection — sem datas de split; todos os campos opcionais,
// os defaults configurados no ml-trainer valem quando omitidos. A meta do
// PPR vem do seed tenant_kpi_targets (kpi_group p1_p2/p3), não do payload
{
  "analysis": "kpi_projection",
  "n_simulations": 5000,
  "seed": 7
}
```

```json
// analysis: external_event_detection — sem datas de split; contamination
// opcional, default configurado no ml-trainer quando omitido
{
  "analysis": "external_event_detection",
  "contamination": 0.05
}
```

```json
// analysis: drift_monitoring — sem datas de split e sem parâmetros: a janela de
// referência é a do modelo em produção daquele tenant, lida do registry. Não treina
// nada, só mede PSI/KS entre aquela janela e a atual
{
  "analysis": "drift_monitoring"
}
```

```json
// analysis: data_refresh — sem datas de split
{
  "analysis": "data_refresh"
}
```

```json
// analysis: data_quality_check — mesmos campos de data_refresh
{
  "analysis": "data_quality_check"
}
```

**Sem override de origem de dado no payload.** A versão anterior deste documento tinha
um campo `data_source` (URL crua de ClickHouse, aceita do chamador) — removido: um
`POST /trigger` vindo de qualquer chamador (inclusive agente de IA) conseguiria apontar
`ml-trainer`/`data-runner` pra qualquer host alcançável pela rede do pod (SSRF/pivô), e
uma URL com credencial embutida atravessaria payload HTTP → mensagem Kafka → possíveis
logs de erro — exposição que a credencial do ClickHouse hoje nunca tem, porque só existe
via `ExternalSecret`/Vault. A origem de dado é sempre a padrão do cluster, resolvida
server-side a partir do Secret, nunca do payload. Quando multi-tenancy virar trabalho de
verdade (hoje em Out of Scope), o mecanismo certo é uma **referência** cadastrada
(ex: `"locaweb"`), nunca uma URL — desenho de uma feature própria, não desta revisão.

### Resposta — `202`

```json
{"run_id": "a1b2c3d4-5e6f-7890-abcd-ef1234567890"}
```

### Resposta — `400`/`422` (payload inválido)

```json
{
  "error": "ValidationError",
  "message": "train_end is required for analysis=volume_forecast",
  "details": [{"path": "train_end", "message": "Required"}]
}
```

---

## 2. `trigger.ml` — `ui-orchestrator` → `ml-trainer`

`ui-orchestrator` só decidiu o tópico (`ml`); `analysis` viaja intacto, mesmo valor do
`POST /trigger`.

```json
{
  "run_id": "a1b2c3d4-5e6f-7890-abcd-ef1234567890",
  "analysis": "volume_forecast",
  "train_end": "2025-09-30",
  "validation_end": "2025-10-31",
  "holdout_end": "2026-01-31"
}
```

```json
{
  "run_id": "b2c3d4e5-6f70-8901-bcde-f12345678901",
  "analysis": "breach_risk",
  "train_end": "2025-02-15",
  "validation_end": "2025-03-15",
  "holdout_end": "2025-04-09"
}
```

```json
{
  "run_id": "c1d2e3f4-5678-9012-cdef-345678901234",
  "analysis": "kpi_projection",
  "n_simulations": 5000
}
```

```json
{
  "run_id": "d1e2f3a4-6789-0123-def0-456789012345",
  "analysis": "external_event_detection",
  "contamination": 0.05
}
```

`ml-trainer` (modo `consume`) lê 1 mensagem, traduz `analysis → volume`/`breach`/
`kpi_projection`/`external_event` localmente (tabela pequena, só nesse app), chama o
mesmo `TRAINERS[...]` que o modo `train` (CLI) já chama hoje.

---

## 3. `trigger.data` — `ui-orchestrator`/`CronJob` → `data-runner`

```json
{
  "run_id": "c3d4e5f6-7081-9012-cdef-123456789012",
  "analysis": "data_refresh"
}
```

```json
{
  "run_id": "d4e5f607-8192-0123-def0-234567890123",
  "analysis": "data_quality_check"
}
```

```json
// disparo do CronJob (02:00 UTC) — não passa por ui-orchestrator, o CronJob nativo
// publica direto. `full_pipeline` nunca aparece no POST /trigger — é vocabulário
// interno só desse disparo, o único caso em que analysis não veio de um caller.
// run_id é determinístico (data), não um UUID — dá pra consultar
// GET /runs/daily-2026-08-16 sem precisar descobrir o id em log nenhum
{
  "run_id": "daily-2026-08-16",
  "analysis": "full_pipeline"
}
```

`data-runner` (modo `consume`) lê 1 mensagem: `analysis: data_refresh`/
`data_quality_check` traduz localmente pra `transform`/`quality` e despacha pro mesmo
`STEPS[...]` que o modo `run` (CLI) já usa; `analysis: full_pipeline` roda os 3 passos em
sequência (`dbt run` → suite `critical` → `register-snapshot`).

---

## 4. `trigger.status` — `ml-trainer`/`data-runner` → `ui-orchestrator`

Tópico compactado, `key = run_id`. **Duas mensagens por run**: uma ao começar
(`Running`), uma ao terminar (resultado final) — sem a primeira, `GET /runs/{run_id}`
nunca mostraria `Running` de verdade, só `queued` até o resultado sair do nada.

```json
// publicada assim que o Job começa a processar a mensagem
{
  "run_id": "a1b2c3d4-5e6f-7890-abcd-ef1234567890",
  "status": "Running",
  "started_at": "2026-08-15T12:30:00Z"
}
```

```json
// sucesso — detail é específico do workload; aqui, treino registrado no MLflow
{
  "run_id": "a1b2c3d4-5e6f-7890-abcd-ef1234567890",
  "status": "Succeeded",
  "detail": {"mlflow_run_id": "8f2a1c...", "model_version": "1"},
  "started_at": "2026-08-15T12:30:00Z",
  "finished_at": "2026-08-15T12:34:12Z"
}
```

```json
// falha — detail carrega o suficiente pra debugar sem precisar de kubectl logs
{
  "run_id": "b2c3d4e5-6f70-8901-bcde-f12345678901",
  "status": "Failed",
  "detail": {"error": "ValueError: empty validation partition after temporal_split"},
  "started_at": "2026-08-15T12:35:00Z",
  "finished_at": "2026-08-15T12:35:08Z"
}
```

`detail` muda de forma por `status` e por app — não é um contrato rígido tipado, é um
saco de contexto pra quem for olhar `GET /runs/{run_id}` depurar sem sair do
`ui-orchestrator`. `status` é o único campo garantido.

---

## 5. `GET /runs/{run_id}` — `ui-orchestrator` → caller

Lookup no mapa em memória (`run_id → última mensagem de `trigger.status``), sem tocar
K8s.

```json
// nenhuma mensagem de status ainda chegou (POST /trigger aconteceu, Job ainda não
// começou a processar, ou está na fila do KEDA)
{"run_id": "a1b2c3d4-...", "status": "queued"}
```

```json
// Job pegou a mensagem e começou
{"run_id": "a1b2c3d4-...", "status": "Running", "started_at": "2026-08-15T12:30:00Z"}
```

```json
// terminou — mesmo shape da mensagem de trigger.status, repassado
{
  "run_id": "a1b2c3d4-...",
  "status": "Succeeded",
  "detail": {"mlflow_run_id": "8f2a1c...", "model_version": "1"},
  "started_at": "2026-08-15T12:30:00Z",
  "finished_at": "2026-08-15T12:34:12Z"
}
```

---

_Referenciado por `spec.md` (Technical Notes) e por
`apps/ui-orchestrator/README.md` quando o app existir._
