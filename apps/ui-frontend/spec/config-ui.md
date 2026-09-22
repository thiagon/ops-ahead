# Configuração da ingestão — tela e persistência

**Criado:** 2026-09-17
**Atualizado:** 2026-09-21
**Estado:** telas no `ui-frontend`; registry no `ui-gateway` (REST e MCP)
**Escopo:** `apps/ui-frontend` (telas), `apps/ui-gateway` (cadastro), `infra/charts/ui-frontend`

---

## 1. O problema

Configurar uma origem de eventos hoje exige editar arquivos e fazer deploy:

| Configuração | Onde vivia | Quem lia |
|---|---|---|
| Credencial e rota da origem | `apps/ui-gateway/.../registry.ts`, hardcoded | `ui-gateway` |
| De onde vem cada campo no payload | `apps/data-ingest/src/sources/itsm.py`, hardcoded | `data-ingest` |
| Tradução de valores | `apps/data-ingest/dictionaries/...`, montado read-only | `data-ingest` |
| Prazos de OLA | `apps/data-runner/seeds/tenant_deadlines.csv`, dbt seed | `data-runner`, `data-deadline-tracker` |
| Metas de KPI | `apps/data-runner/seeds/tenant_kpi_targets.csv`, dbt seed | `data-runner` |

Consequência: **só existe uma origem no sistema**, e adicionar a segunda é trabalho
de engenharia, não de configuração.

## 2. O que muda

O cliente cadastra a integração pela tela. O registry fica no Postgres do gateway.

```
ui-frontend ──► ui-gateway ──► Postgres (ns: ui, config-postgres / gateway)
   telas         REST + MCP      origens, mapeamentos, prazos, metas
```

**O gateway é o cadastro.** REST e MCP chamam as mesmas funções. O histórico são os
últimos dez documentos publicados; republicar um é um PUT do corpo. Só o `ui-gateway`
fala com o banco (`prisma/schema.prisma`).

O `ui-frontend` não tem banco próprio de configuração: os loaders gastam o cookie da
sessão em `GATEWAY_URL` (`app/features/auth/gateway.server.ts`).

### Sem configuração, não roda (quando a propagação existir)

Um serviço que sobe e não encontra a configuração de que depende não fica pronto
— o readiness probe falha. Não há arquivo-semente embutido na imagem: falha
visível em vez de degradação silenciosa.

Não há seed neste app: a configuração nasce no gateway, pela tela ou pelo MCP.

---

## 3. As telas

Rotas de Ajustes, todas sob `/:tenant`.

**URLs são inglês.** O menu e os títulos da tela são português. Um caminho novo
nunca entra em português (`/targets`, nunca `/metas`; `/deadlines`, nunca `/prazos`).

| URL | Menu | Conteúdo |
|---|---|---|
| `/:tenant/targets` | Metas | Faixas de atingimento e teto anual de violações |
| `/:tenant/deadlines` | Prazos | Tempo máximo de atendimento por prioridade |
| `/:tenant/integrations` | Integrações → Entrada | Origens que enviam eventos, cada uma com o que falta |
| `/:tenant/integrations/:source` | (detalhe da Entrada) | Envio, campos e valores de uma origem |

Em Metas e Prazos, **Visualizar** só carrega o estado anterior na tela.
**Descartar alterações** volta ao publicado. **Publicar** é o que grava, e
os dois só ficam clicáveis quando o rascunho difere do publicado.

`/` pede o slug do tenant. O cliente não escolhe entre vários nem cria outros:
digita o identificador que já tem. O `id` numérico fica nas FKs; o `slug` vai
na URL; o `name` só aparece na tela (pode ter acento, não é único).

As demais telas:

| URL | Conteúdo |
|---|---|
| `/:tenant` | Painel N1/N2 |
| `/:tenant/manager` | Painel do gestor |
| `/:tenant/queue` | Fila de ocorrências |
| `/:tenant/occurrences/:source/:externalId` | Detalhe de uma ocorrência |

### Vocabulário

| Domínio | Tela |
|---|---|
| `intake: alert` | Monitor — ServiceNow / ITSM; métricas e previsão entram em cima |
| `intake: monitor` | Sinais — Prometheus, Zabbix e afins |
| `source` | Sistema de origem, nomeado pelo cliente (`service_now`, `zabbix`) |

### Detalhe da integração

**Envio** — URL completa copiável e chave de assinatura (exibida uma única vez,
com confirmação antes de rotacionar). **Inativar** deixa a origem na lista,
desligada; **Reativar** liga de novo.

**Campos** — aba à parte, uma linha por campo do contrato traduzido, com o
caminho no payload. Campos com vocabulário fixo expandem a tradução de valores
ali mesmo. **Publicar** grava os caminhos e marca o dicionário `active`.

---

## 4. O que está construído

Em `apps/ui-frontend/`:

```
app/features/config/
  types.ts                 vocabulário de apresentação (prioridade, intake)
  contract-schema.ts       parser de GET /rules/schema
  repo.server.ts           cliente HTTP do gateway (loaders e actions)
  secret-flash.server.ts   cookie de uma vez após criar integração
app/features/auth/
  gateway.server.ts        encaminha o cookie da sessão
app/routes/
  integrations.tsx · integration-detail.tsx · targets.tsx · deadlines.tsx
```

Os loaders e `action()` chamam `repo.server.ts`, que fala com o gateway. O
vocabulário do dicionário (campos, obrigatórios, enums) vem de `GET /rules/schema`.
Não há Prisma neste app.

A URL de envio é `/webhook/:tenant/:source` (o `version` opcional seleciona o
dicionário; omitido, o gateway usa o vigente).

---

## 5. Pendências posteriores

### 5.1 Propagação

Tópicos compactados `config.*`, escrita no Vault do HMAC, e consumidores em
`ui-gateway` / `data-ingest` / `data-deadline-tracker` / `data-runner` (materializar
prazos/metas no ClickHouse no lugar dos seeds).

### 5.2 Contrato

`severity` ainda precisa entrar em `contracts/translation-dictionary.schema.json`
(a tela já trata como campo traduzido).

### 5.3 Autenticação

A sidebar mostra o nome do operador lido do `/auth/me` do gateway (claims `name`
ou `preferred_username` do Authentik) e um avatar DiceBear gerado a partir do `sub`. O histórico
grava autor `anonymous` até haver IdP.

### 5.4 HMAC não serve para toda origem

Quando entrar uma origem que não assina com HMAC, o método de autenticação
também vira configuração por integração.
