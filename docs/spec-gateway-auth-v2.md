# Autenticação do `ui-gateway` (Authentik, tenant como grupo, run key)

**Criado:** 2026-09-20
**Estado:** em implementação — gateway, contratos, Prisma, CronJob, consumers e
tela de entrada no front; Authentik no cluster ainda não verificado em runtime
**Relacionada:** `conductor/tracks/ui-dashboard_20260821` — SSO e seletor de tenant
estavam fora, e passam a caber aqui · `docs/sprints/sprint-3-mvp.md` — Authentik adiado
para Sprint 4

Não há chart `infra-authentik` no cluster até o sync, mas o manifesto, o
plugin de auth do gateway e o rename `X-Run-Key` já estão no repositório.

## Problema

O gateway é a fronteira HTTP e quase toda ela está aberta. HMAC cobre o webhook;
a run key cobre o `PATCH` de uma execução. Sources, rules, `POST/GET /analyses` e
`/mcp/:tenant` aceitam qualquer caller. O CronJob `data-runner-daily` e o encadeamento
do `data-runner` entram nesse mesmo `POST` sem credencial. O front vai passar a falar
com o gateway, e um usuário opera mais de um tenant: seletor na URL sem saber quem é a
pessoa deixa qualquer cliente visível.

## Decisões

### O gateway não guarda pessoa

É fronteira: valida credencial, resolve autorização, encaminha. Cadastro de gente,
grupo e revogação são do Authentik, que faz isso melhor e é a peça de plataforma já
prevista. O gateway não tem tabela de usuário, de sessão nem de membership.

O que sustenta isso é a introspecção (RFC 7662): a cada request o gateway pergunta ao
Authentik se aquele token ainda vale. Um JWT validado offline pelo JWKS obrigaria a
esperar a expiração para revogar acesso — foi por isso que a versão anterior desta spec
inventou uma tabela de sessão. Com `/application/o/introspect/` a revogação vale no
instante em que alguém a faz, e não sobra estado para manter.

A resposta da introspecção é cacheada por `INTROSPECTION_CACHE_TTL_MS` (5s). Essa
janela é o atraso de uma revogação, e é o único motivo de ela não ser zero.

### Tenant é o grupo do Authentik

Não um grupo que o gateway decodifica: o mesmo nome. O grupo `locaweb` no Authentik
**é** o tenant `locaweb` (`domain/ubiquitous-language.md#tenant`). O claim `groups` do
token já é a lista de clientes que a pessoa opera — não há mapa para manter, nem
segunda fonte para divergir.

A tabela `tenants` continua existindo, porque `sources`, `mappings`, `deadlines` e
`targets` referenciam ela. Mas deixa de ser autoridade: a linha é materializada na
primeira vez que um tenant do claim aparece, nunca escrita à mão. O grupo diz quem
existe; o Postgres só permite referenciar.

### Tenant na URL é seleção; o claim é autorização

O `:tenant` do path é o cliente desta request. Não está no `groups` do token → 403.
Não existe como grupo → 404. Não se colapsa os dois.

Rotas que já carregam tenant (`/sources/:tenant`, `/rules/.../:tenant`, `/mcp/:tenant`)
ganham essa checagem. `POST /analyses` feito por pessoa ou MCP passa a ser
`POST /:tenant/analyses` (e `GET /:tenant/analyses` lista o cliente). O CronJob e o
encadeamento não escolhem tenant na URL: o cron é plataforma; o filho herda o tenant do
parent, que a tabela `analyses` já carrega em `tenantId`.

### Papel é atributo da pessoa; `viewer` só lê

O grupo diz *quais* clientes a pessoa vê. O que ela pode mudar neles vem do claim
`ops_ahead_role`, que o scope mapping `ops-ahead role` lê do atributo `ops_ahead_role`
do usuário no Authentik. Dois valores:

| Papel | Lê | Publica regras, mexe em origens, dispara análise |
|---|---|---|
| `operator` | sim | sim |
| `viewer` | sim | não — 403 |

No Authentik, usuário sem o atributo sai como `operator`, o comportamento de antes. No
gateway, só `operator` explícito escreve: token sem o claim, ou com um valor
desconhecido, lê. As rotas de escrita usam `app.auth.operator` no lugar de
`app.auth.tenant`. No MCP, um `viewer` recebe o servidor sem as tools de escrita.

O front faz a mesma checagem nas `action`s (`requireOperator`) e esconde os controles de
escrita. O que barra de fato é o gateway, e o front evita que a request chegue até lá.

O usuário `demo` (grupo `locaweb`, `ops_ahead_role: viewer`) existe no blueprint para
mostrar o produto sem risco. A senha vem de `AUTHENTIK_DEMO_PASSWORD`.

### Quatro credenciais, nenhum esquema único

Cada caller tem um material. Reusar um no lugar do outro mistura ameaça.

| Caller | Material | O que prova |
|---|---|---|
| Origem ITSM | `X-Signature` (HMAC do corpo) | esta mensagem foi assinada por aquele `(tenant, source)` |
| Browser | cookie `HttpOnly` com o token dentro | a pessoa completou o login no Authentik |
| MCP (Cursor, agente) | `Authorization: Bearer` do Authentik | o cliente completou OAuth 2.1 |
| CronJob | API key `scheduler` em `Authorization: Bearer` | o relógio está disparando |
| Consumer da execução | `X-Run-Key` | o caller leu a mensagem Kafka daquele run |

O `data-runner` **não** tem API key. Ele é o consumidor da mensagem do parent: o
`X-Run-Key` que já autentica o `PATCH` autentica também o `POST` dos filhos.

### O browser não vê token — BFF

O gateway conduz o Authorization Code + PKCE, encripta access e refresh token com
`SESSION_COOKIE_KEY` e guarda **no próprio cookie**. O cookie é o armazenamento; não há
linha em lugar nenhum. JS no browser não alcança o token (`HttpOnly`), e o gateway
decripta e introspecta a cada request.

Nome `oa_session`. `HttpOnly`, `SameSite=Lax` (dev sem `Secure`; prod com
`HTTPS_ENABLED` liga `Secure`), `Domain` do parent compartilhado com o front
(`SESSION_COOKIE_DOMAIN`; vazio = host-only). Sem o Domain o cookie fica só no
host do gateway e o loader do UI nunca vê a sessão. Refresh expirado → 401, o
front reentra no login.

CSRF: cookie não-HttpOnly `oa_csrf` + header `X-CSRF-Token` em métodos que mudam
estado. GET de leitura dispensa. O CronJob e o MCP não usam cookie, não pagam CSRF.

CORS: `credentials: true`, origem explícita do front em `CORS_ORIGINS` — some o
`origin: true` quando a lista é vazia.

### `trigger` e `parent_id` saem do body

O body de criação é só a análise e os parâmetros de negócio. Mandar `trigger` ou
`parent_id` é 400.

| Auth na request | Gateway grava |
|---|---|
| cookie / Bearer Authentik (MCP) | `manual` |
| API key `scheduler` | `scheduled` |
| `X-Run-Key` que resolve um `full_pipeline` | `chained`; `parent_id` = `id` dessa linha |

Sem credencial reconhecida → 401, nunca um run anônimo. `manual` deixa de ser default
do schema.

`X-Run-Key` no `POST` só vale se a linha for `analysis = full_pipeline`. Não se
encadeia a partir de um treino. Não se exige `status = succeeded`: o
`run_full_pipeline` encadeia antes do `PATCH` terminal.

### `X-Update-Key` virou `X-Run-Key`

A mesma credencial identifica o run: PATCH daquele `id`, ou POST dos filhos (a key
**é** o parent). O campo Kafka e a coluna acompanharam: `update_key` → `run_key`,
`update_key_hash` → `run_key_hash` com unique. O 202 continua sem a chave.

```
PATCH /analyses/{id}
X-Run-Key: <run_key deste id>

POST /analyses
X-Run-Key: <run_key do full_pipeline>
{ "analysis": "volume_forecast", "train_end": "...", ... }
```

Lookup do POST é por hash, não por `id`. O `parent_id` não vem no JSON.

`X-Signature` não se reusa aqui: é HMAC do webhook, outro caller, outro material.

### Uma API key, e é a do cron

Tabela `api_keys` (`kind = scheduler`, hash, prefixo para log). Plaintext só no Secret
do CronJob, via Vault/ESO. O gateway compara hash. Não existe `kind = runner`.

O cron poderia pegar token por client credentials no Authentik, mas aí o CronJob vira
cliente OAuth para publicar um `full_pipeline` — mais peça móvel que uma key com hash.

## Escopo

**Dentro:** Authentik no cluster; login OIDC do front via BFF; cookie com token
encriptado; introspecção por request; OAuth do MCP; API key do cron; `X-Run-Key` no
PATCH e no encadeamento; tenant como grupo; `trigger`/`parent_id` derivados da auth;
proteger sources, rules, analyses e MCP; CORS com credentials e CSRF no cookie.

**Fora:** LDAP/AD de verdade (Authentik em dev com usuários locais); SSO nos demais
ingress (Grafana, ArgoCD, MLflow) — a peça sobe, o encaixe neles é outro trabalho;
API key por usuário; mTLS; Feast/Langfuse; o front deixar de ter Prisma próprio de
configuração — ele passa a mandar cookie nas chamadas ao gateway que já existem, não
migra o registry nesta spec.

## Desenho

```
browser ──cookie (token dentro)──▶ ui-gateway ──OIDC──▶ Authentik
                                        │
MCP ────Bearer access token─────────────┤          introspect
                                        │          (a cada request)
Cron ───Bearer scheduler key────────────┤
                                        │
data-runner / ml-trainer ───────────────┤  X-Run-Key  (do Kafka, nunca do 202)
                                        │
ITSM ──────────X-Signature──────────────┘
```

### Dispatch no `POST /analyses`

Ordem fixa, o primeiro que casar ganha. Não se mistura.

1. Header `X-Run-Key` → hash → unique `run_key_hash` → tem que ser `full_pipeline` →
   `chained` + `parent_id`.
2. Senão `Authorization: Bearer` que casa com `api_keys.kind = scheduler` →
   `scheduled`. Body permitido: `{ "analysis": "full_pipeline" }` e mais nada.
3. Senão cookie **ou** Bearer do Authentik, com o `:tenant` da rota no claim `groups`
   → `manual`.
4. Senão 401.

`GET /analyses/:id` e listagens por tenant exigem cookie ou Bearer (e o tenant no
claim). O CronJob não lê status. Consumers não leem: só PATCHam.

### MCP

`/mcp/:tenant` não lê cookie. 401 sem Bearer traz

```
WWW-Authenticate: Bearer realm="gateway", resource_metadata="https://gateway.../.well-known/oauth-protected-resource"
```

O documento aponta o Authentik como authorization server (RFC 9728 + spec MCP). O
Authentik faz Dynamic Client Registration (RFC 7591), então o cliente MCP se registra
sozinho. Mesma introspecção e mesma checagem de grupo do REST. Tools continuam sem
argumento `tenant`.

### Authentik no cluster

Chart `infra/charts/infra-authentik`, Application em `ns: infra`, ingress
`auth.ops-ahead.localtest.me`. Database `authentik` na instância
`config-postgres` (`ui-postgres.extraDatabases`) — Postgres já existe; Redis do
`ml-redis` não se reusa. Cache Authentik no próprio Postgres.

Dois aplicativos OAuth no Authentik (bootstrap documentado, valores no Vault):

- **gateway-web** — confidential, redirect `https://gateway.../auth/callback`, PKCE.
- **gateway-mcp** — public + PKCE, o que o cliente MCP registra / usa.

Property mapping que põe `groups` no token — é o claim inteiro da autorização.

Grupo de dev: `locaweb`, mesmo nome do tenant. Bootstrap Authentik + usuário inicial,
vars no `.env` / Vault, sem lista hardcoded em script (`infra/scripts/README.md`).

NetworkPolicy: egress `ns:ui` → Authentik Service (http 80 / 9000 no pod);
ingress Authentik a partir do Traefik; Postgres já aceita `ns:infra` ou passa a
aceitar na porta 5432. O gateway não resolve o hostname público do issuer
dentro do pod (`localtest.me` é 127.0.0.1): discovery, token e introspecção
usam `AUTHENTIK_INTERNAL_ORIGIN` (o Service in-cluster). O browser continua
no host público do discovery.

## Modelo

```
ApiKey     id, kind (scheduler), prefix, hash @unique, createdAt, revokedAt?
Analysis   runKeyHash @unique   // rename de updateKeyHash
Tenant     // já existe; a linha passa a ser materializada a partir do claim
```

Nada de `User`, `Session` ou `UserTenant` — o Authentik é dono dos três.

## Rotas novas

```
GET  /auth/login      → redirect Authentik
GET  /auth/callback   → cookie com o token + redirect ao front
POST /auth/logout     → revoga no Authentik, limpa cookie
GET  /auth/me         → { sub, tenants[] }   (do token, não do banco)
GET  /.well-known/oauth-protected-resource
```

`/health` e `/metrics` continuam abertos. `/docs` fica atrás do cookie. Webhook e
`PATCH /analyses/:id` fora do hook de auth — HMAC e `X-Run-Key`.

OpenAPI: schemes `cookieAuth`, `bearerAuth` (Authentik), `schedulerKey`, `runKey`
(`X-Run-Key`), `hmac` (`X-Signature`). Cada rota declara o que aceita.

## Trabalho

### `infra` — Authentik

Chart + `infra/apps/infra-authentik.yaml` + overlay. ExternalSecret para
`AUTHENTIK_SECRET_KEY`, senha do admin, client secrets dos dois apps, senha do
database. `extraDatabases: [gateway, authentik]`. Ingress no mesmo padrão dos
outros `*.ops-ahead.localtest.me`. Script de bootstrap **sem** lista nova: o
ExternalSecret entra no glob que o `dev-up.sh` já lê.

### `ui-gateway` — auth

Plugin `src/plugins/auth.ts`: lê cookie / Bearer / `X-Run-Key` / API key, introspecta
quando é token, decora `request.auth` (`user` | `scheduler` | `run` | `none`) com os
`groups`. Hook `preHandler` nas rotas que exigem um deles; webhook continua no HMAC
`preParsing`.

`SESSION_COOKIE_KEY`, `SESSION_COOKIE_DOMAIN`, `AUTHENTIK_ISSUER`,
`AUTHENTIK_INTERNAL_ORIGIN`, `AUTHENTIK_CLIENT_ID`,
`AUTHENTIK_CLIENT_SECRET`, `AUTHENTIK_MCP_CLIENT_ID`, `INTROSPECTION_CACHE_TTL_MS`,
`FRONTEND_ORIGIN`, `PUBLIC_URL`.

Services `oidc/` (discovery, code exchange, introspecção com cache), `api-keys/`,
`tenants/` (materializa a linha a partir do claim). Analyses: body sem `provenance`;
`start` recebe o `auth` já resolvido. Store: `findByRunKeyHash`.

### CronJob e consumers

`infra/charts/data-runner/templates/cronjob.yaml`: Secret com a key `scheduler`,
header `Authorization: Bearer`. Body `{"analysis":"full_pipeline"}` — some
`"trigger":"scheduled"`.

`data-runner` `start_analysis`: header `X-Run-Key` com o `run_key` da mensagem do
parent; some `trigger` e `parent_id` do JSON. `report_status` e o `ml-trainer`
trocam o header para `X-Run-Key`; leem `run_key` do evento.

### Contratos — feito

`contracts/trigger-*.schema.json`: `update_key` → `run_key`, descrito como a
credencial do run (PATCH daquele `id`, e POST encadeado quando é `full_pipeline`).

### `ui-frontend`

Tela de entrada: login (redirect) antes do seletor. Seletor lista `GET /auth/me`
→ `tenants`, não um slug livre. Chamadas ao gateway (`credentials: 'include'`,
`X-CSRF-Token`). O zustand `ops-ahead:session` continua chrome de UI (last slug,
sidebar); **não** é a sessão de auth.

## Como verificar

- Sem cookie, `GET /sources/locaweb` e `POST /analyses` (sem headers) → 401.
- Login OIDC → cookie → `GET /auth/me` traz os grupos como tenants;
  `GET /sources/outro` fora do claim → 403.
- Tirar a pessoa do grupo no Authentik e revogar o token → a request seguinte responde
  401/403 dentro da janela do cache, sem logout.
- Cron com a key → linha `trigger = scheduled`, body sem `trigger`.
- `full_pipeline` publicado → `data-runner` POST com `X-Run-Key` do parent → filho
  `trigger = chained`, `parent_id` da linha, body sem os dois campos.
- `X-Run-Key` de um `volume_forecast` no POST → 401/409, não encadeia.
- MCP sem Bearer → 401 com `resource_metadata`; com token de quem não tem o grupo →
  403 no `/mcp/:tenant`.
- HMAC do webhook e PATCH com `X-Run-Key` do próprio `id` continuam verdes.

## Débito assumido

**Introspecção custa uma chamada por request.** Cacheada por 5s, e o Authentik está no
mesmo cluster. Se virar gargalo, o caminho é validar o JWT offline e introspectar só o
que for sensível — aí a revogação volta a depender da expiração.

**Tenant criado na primeira aparição.** Um `GET` de alguém cujo grupo ainda não tem
linha em `tenants` escreve essa linha. Alternativa seria exigir provisionamento
prévio, que reintroduz o cadastro manual que a decisão do grupo eliminou.

**Cron ainda é um `full_pipeline` global.** O relógio não escolhe cliente, e a auth não
muda isso: quem roda por tenant é o treino, dentro do próprio consumidor.

**SSO dos outros UIs.** Authentik sobe uma vez; Grafana/ArgoCD/MLflow continuam
com a auth que já têm até alguém apontar o mesmo IdP.
