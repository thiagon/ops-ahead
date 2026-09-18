# Configuração da ingestão — tela, persistência e propagação

**Criado:** 2026-09-17
**Estado:** front construído sobre dados falsos; backend não existe
**Escopo:** `ui-frontend` (telas), `ui-orchestrator` (API), `data-ingest` /
`data-runner` / `data-deadline-tracker` / `ml-*` (leitura), `contracts/`

---

## 1. O problema

Configurar uma origem de eventos hoje exige editar arquivos e fazer deploy:

| Configuração | Onde vive hoje | Quem lê |
|---|---|---|
| Credencial e rota da origem | `apps/ui-gateway/src/modules/events/sources/registry.ts`, hardcoded | `ui-gateway` |
| De onde vem cada campo no payload | `apps/data-ingest/src/sources/itsm.py`, hardcoded | `data-ingest` |
| Tradução de valores | `apps/data-ingest/dictionaries/<tenant>/<source>.<v>.json`, montado read-only | `data-ingest` |
| Prazos de OLA | `apps/data-runner/seeds/tenant_deadlines.csv`, dbt seed | `data-runner`, `data-deadline-tracker` |
| Metas de KPI | `apps/data-runner/seeds/tenant_kpi_targets.csv`, dbt seed | `data-runner` |

Consequência: **só existe uma origem no sistema**, e adicionar a segunda é trabalho
de engenharia, não de configuração. O cliente não consegue integrar sozinho.

## 2. O que muda

O cliente cadastra a integração pela tela. O pipeline lê essa configuração pelos
mesmos canais que já usa para tudo.

```
ui-frontend ──► ui-orchestrator ──► Postgres (ns: ui)
   telas            API REST          cadastro, histórico, rollback
                        │
                        └──publica──► config.origin      (compactado)
                                      config.dictionary  (compactado)
                                      config.deadline    (compactado)
                                      config.kpi-target  (compactado)
                                            │
            ┌───────────────────┬───────────┴────────┬──────────────┐
            ▼                   ▼                    ▼              ▼
       ui-gateway          data-ingest      data-deadline-tracker  data-runner
```

**Postgres é o cadastro.** Guarda quem alterou, quando, e a versão anterior —
é o que sustenta o histórico e o rollback. Só o `ui-orchestrator` fala com ele.

**Kafka é o que os serviços leem.** Todos já falam Kafka; configuração vira mais
um tópico, não uma dependência nova. Cada consumidor rehidrata o estado corrente
lendo o log compactado no boot.

Consequência desejada: se o Postgres cair, a operação continua — os serviços já
têm o estado. O que para é a edição.

### Por que compactado

Mesmo mecanismo de `trigger.status`, já em uso
(`infra/charts/data-kafka/values.yaml`). Compactação retém a última versão de
cada chave, então um consumidor que sobe do zero reconstrói o estado completo
lendo o log inteiro, sem chamar ninguém.

Chave: `<tenant_id>:<source>` para `config.origin` e `config.dictionary`;
`<tenant_id>` para `config.deadline` e `config.kpi-target`.
`cleanup.policy: compact` puro, sem `delete` — configuração não expira.

**Consumer group único por boot.** Cada réplica precisa do log inteiro, não de
uma fatia. É a regra que o `ui-orchestrator` já segue em `trigger.status`, e o
oposto do group fixo de `data-runner`/`ml-trainer` em `trigger.data`/`trigger.ml`.
Errar isso faz réplicas rodarem com configurações diferentes.

### Sem configuração, não roda

Um serviço que sobe e não encontra a configuração de que depende não fica pronto
— o readiness probe falha. Não há arquivo-semente embutido na imagem: falha
visível em vez de degradação silenciosa.

O seed inicial nasce no Postgres (migration) e um script publica nos tópicos.

---

## 3. As telas

Três rotas, todas sob o grupo "Ajustes" da sidebar.

| Rota | Conteúdo |
|---|---|
| `/integracoes` | Lista as integrações do tenant, cada uma com o que falta |
| `/integracoes/:source` | Envio, campos e valores de uma integração |
| `/metas-e-prazos` | Prazos de OLA, faixas de meta, histórico |

### O tenant nunca aparece como escolha

A tela é a do cliente: ele *é* um tenant, não escolhe entre vários, e não cria
outros. O tenant vem de `getConfig().TENANT_ID` — como em todas as queries de
`clickhouse.server.ts`. Por isso não está na URL nem em campo de formulário.

Criar tenant é ato de quem administra a plataforma, e não pertence a estas telas.

### Vocabulário

A tela fala a língua de quem integra, não a nossa:

| Domínio | Tela |
|---|---|
| `intake: alert` | Chamados |
| `intake: monitor` | Sinais de monitoração |
| `source` | Sistema de origem, nomeado pelo cliente (`service_now`, `zabbix`) |

A palavra "intake" não aparece. A tela também não explica o modelo: nada de
blocos de texto ensinando o que é um dicionário — se a tela precisa de manual,
o problema é a tela.

### Detalhe da integração

**Envio** — o que o cliente configura do lado dele:
- URL completa, copiável: `{PUBLIC_GATEWAY_URL}/webhook/{v}/{tenant}/{source}`
- Chave de assinatura: gerada por nós, exibida uma única vez, com botão de
  rotacionar. Nome de variável de ambiente é detalhe do nosso deploy e não
  aparece; o valor vive no Vault.

**Campos** — uma linha por campo do contrato traduzido, com o caminho no payload
da origem (`external_id ← number`). Caminho aninhado com ponto
(`fields.status.name`). 17 campos em `incident-alert`, 10 em `condition-monitor`.

Campos com vocabulário fixo **expandem** e mostram a tradução de valores ali
mesmo — não há seção separada. Cada um exibe sua cobertura (`2/6`).

**A tradução é dirigida pelo nosso lado.** A tela lista todos os valores que o
domínio conhece, mapeados ou não, e o cliente informa o que a origem envia para
cada um. Vários valores da origem podem cair no mesmo valor nosso
(`Encerrado`, `Encerrado Automaticamente` e `Sem Intervenção` são todos `closed`),
nunca o contrário. Um valor nosso sem entrada é uma lacuna visível, em vez de
virar `unknown` em produção.

---

## 4. O que já está construído

Em `apps/ui-frontend/`:

```
app/features/config/
  types.ts        vocabulário do domínio, MAPPED_FIELDS, DOMAIN_VALUES
  api.server.ts   o service que os loaders chamam
  api.mock.ts     backend falso — responde Request com Response
  fixtures.json   dados
app/routes/
  integrations.tsx · integration-detail.tsx · targets.tsx
app/components/form.tsx
```

Os loaders chamam apenas `api.server.ts`. A chamada monta um `Request`
(`new URL(path, CONFIG_API_URL)`, `accept`, timeout), recebe um `Response`, checa
status e parseia — e lança `ConfigApiError` com o status. Um `/integracoes/x`
inexistente responde 404 de verdade.

**A troca para o backend real é uma linha**, em `send()`:

```ts
return await handleConfigRequest(request);   // hoje
return await fetch(request);                 // quando a API existir
```

`api.mock.ts` e `fixtures.json` são apagados. Nenhum loader muda.

### Rotas que a API precisa expor

| Método | Rota | Devolve |
|---|---|---|
| GET | `/tenants/:tenant/integrations` | `{ items: Integration[] }` |
| GET | `/tenants/:tenant/integrations/:source` | `Integration` (404 se não existe) |
| GET | `/tenants/:tenant/deadlines` | `{ items: { severity, deadlineSeconds }[] }` |
| GET | `/tenants/:tenant/kpi-targets` | `{ items: { kpiGroup, maxBreaches, achievementPct }[] }` |
| GET | `/tenants/:tenant/revisions` | `{ items: ConfigRevision[] }` |

`Integration` traz `bindings` e `mappings` embutidos — a tela não faz duas
chamadas para montar uma linha.

---

## 5. O que falta

### 5.1 Front

- **Formulários não submetem.** Os campos são `<input defaultValue>` soltos. Em
  framework mode isso se faz com `<Form method="post">` + `action()` no servidor,
  e `useFetcher` para o que salva sem navegar (adicionar mapeamento, remover
  chip). É o ponto onde a escrita entra.
- Fluxo de criar integração (`+ Nova integração` não faz nada).
- Exibir a chave gerada uma única vez, com confirmação de rotação.
- Rollback a partir do histórico.

### 5.2 API (`ui-orchestrator`)

Módulo `config` ao lado de `trigger` e `runs`, mesmo padrão
(`routes.ts` / `schema.ts` / `service.ts`). Além dos GETs acima:

- Escrita com validação contra os JSON Schemas de `contracts/`
- Gravação no Postgres com versionamento — correção cria versão nova, nunca
  edita em lugar
- Publicação nos tópicos `config.*` após gravar
- Geração e rotação do segredo HMAC, gravando no Vault (1 app = 1 path)

### 5.3 Persistência

Chart `ui-postgres` (`ns: ui`), espelhado de `infra/charts/ml-postgres`.
Guarda configuração, histórico e — quando houver login — usuários.

Fica em `ns: ui` porque é o banco da aplicação que o frontend serve, não dado de
pipeline.

### 5.4 Consumo

| App | O que passa a ler | Observação |
|---|---|---|
| `ui-gateway` | `config.origin` | Substitui `registry.ts` hardcoded; valida HMAC no request path |
| `data-ingest` | `config.origin`, `config.dictionary` | Substitui `dictionaries/` e `sources/itsm.py` |
| `data-deadline-tracker` | `config.deadline` | Hoje lê do ClickHouse via seed |
| `data-runner` | `config.deadline`, `config.kpi-target` | Ver 6.3 |

### 5.5 Tópicos

Quatro entradas em `infra/charts/data-kafka/values.yaml`, todas com
`cleanup.policy: compact`.

---

## 6. Pendências encontradas

### 6.1 `severity` não está no contrato do dicionário

`domain/acl/itsm.md` é explícito: "Prioridade como rótulo textual, na escala do
ITSM" → "`severity`, escala normalizada do domínio". Ou seja, `severity`
**precisa** de tradução de valores — o ServiceNow manda `1 - Crítica`, o Zabbix
manda `Disaster`, ambos viram a escala 1–5.

Mas `contracts/translation-dictionary.schema.json` tem quatro chaves de
mapeamento (`status`, `condition`, `reported_by`, `resolution_code`) e nenhuma é
`severity`. A tela já trata como quinto campo traduzido; **o contrato precisa
acompanhar**.

### 6.2 Lacunas no dicionário atual

A tela expôs que `status` de `service_now` está **2/6 coberto**:
`open`, `in_progress`, `resolved` e `canceled` não têm nenhum valor mapeado em
`apps/data-ingest/dictionaries/locaweb/itsm.v1.json`.

### 6.3 Os dbt seeds

`data-runner` lê prazos e metas como seed do dbt, não como stream — não há
consumidor Kafka dentro do dbt. Caminho: um consumidor materializa o tópico numa
tabela ClickHouse e os modelos passam a ler dessa tabela. Os CSV somem.

É o domínio mais invasivo dos quatro; provavelmente merece fase própria.

### 6.4 HMAC não serve para toda origem

O gateway só sabe HMAC hoje. O Jira é o contraexemplo: webhooks clássicos não
assinam com segredo compartilhado — autenticam por token na URL ou OAuth, e
produtos Atlassian mais novos usam JWT.

Quando entrar uma origem que não assina com HMAC, o **método de autenticação**
também vira configuração por integração.

### 6.5 Autenticação

O `ui-frontend` não tem login — a sidebar mostra "Sessão anônima". Uma tela que
edita configuração de produção precisa saber quem edita, e o histórico precisa
de um autor real.

Authentik SSO já está previsto como pendência de Sprint 3/4. Decidir se a tela
nasce com login local no Postgres ou espera o IdP.

### 6.6 `source` nomeado pelo cliente

`itsm` é categoria de sistema, não produto — o produto é ServiceNow. Com o
cadastro pela tela, isso deixa de ser trabalho de código: o cliente escreve
`service_now` ao criar a integração.

O conceito ACL/ITSM (`domain/acl/itsm.md`) permanece: ele descreve a categoria,
que continua correta.

### 6.7 Resíduo no histórico

`ConfigRevision` ainda carrega `tenantId` e textos como "Integração service_now
criada". Se a tela é sempre de um tenant, o campo é redundante — como o `tenants`
já removido. Revisar quando a forma real do histórico ficar definida.

---

## 7. Ordem sugerida

1. **Contrato** — `severity` no `translation-dictionary.schema.json`; schema de
   field bindings
2. **Persistência** — chart `ui-postgres`, migrations, seed inicial
3. **API** — módulo `config` no `ui-orchestrator`, GETs primeiro; trocar a linha
   em `send()` e apagar o mock
4. **Escrita** — `action()` nas rotas, POST/PUT na API, versionamento
5. **Tópicos** — declarar os quatro, publicar ao gravar, script de seed
6. **Consumo** — `ui-gateway` e `data-ingest` primeiro (substituem hardcode);
   `data-deadline-tracker` depois
7. **dbt** — materialização em ClickHouse, remoção dos seeds
8. **Autenticação** — conforme decisão de 6.5
