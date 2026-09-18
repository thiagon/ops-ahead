# Configuração da ingestão — tela e persistência

**Criado:** 2026-09-17
**Atualizado:** 2026-09-18
**Estado:** telas e registry Prisma no `ui-frontend`; propagação aos consumidores (Kafka) é passo posterior
**Escopo:** `apps/ui-frontend` (telas + Postgres), `infra/charts/ui-postgres`, `infra/charts/ui-frontend`

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

O cliente cadastra a integração pela tela. O registry fica no Postgres deste app.

```
ui-frontend ──► Postgres (ns: ui, config-postgres)
   telas          cadastro, histórico, rollback
```

**Postgres é o cadastro.** Guarda quem alterou, quando, e a versão anterior —
é o que sustenta o histórico e o rollback. Só o `ui-frontend` fala com ele
(`prisma/schema.prisma`, `app/features/config/repo.server.ts`).

Publicar o estado corrente para o pipeline (tópicos `config.*`, Vault HMAC,
consumidores em gateway/ingest) é um passo posterior — as telas já persistem;
a propagação ainda não.

### Sem configuração, não roda (quando a propagação existir)

Um serviço que sobe e não encontra a configuração de que depende não fica pronto
— o readiness probe falha. Não há arquivo-semente embutido na imagem: falha
visível em vez de degradação silenciosa.

O seed inicial nasce no Postgres (`npm run db:seed` / `prisma/seed.ts`).

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

### Vocabulário

| Domínio | Tela |
|---|---|
| `intake: alert` | Chamados |
| `intake: monitor` | Sinais de monitoração |
| `source` | Sistema de origem, nomeado pelo cliente (`service_now`, `zabbix`) |

### Detalhe da integração

**Envio** — URL completa copiável e chave de assinatura (exibida uma única vez,
com confirmação antes de rotacionar).

**Campos** — uma linha por campo do contrato traduzido, com o caminho no payload.
Campos com vocabulário fixo expandem a tradução de valores ali mesmo.
**Publicar** grava os caminhos e marca o dicionário `published`.

---

## 4. O que está construído

Em `apps/ui-frontend/`:

```
app/features/config/
  types.ts                 vocabulário do domínio, CONTRACT_FIELDS, DOMAIN_VALUES
  repo.server.ts           leitura/escrita Prisma (loaders e actions)
  secret-flash.server.ts   cookie de uma vez após criar integração
prisma/
  schema.prisma            registry (config_*)
  seed.ts                  estado inicial locaweb/itsm
app/routes/
  integrations.tsx · integration-detail.tsx · targets.tsx
```

Os loaders e `action()` chamam só `repo.server.ts`. Não há API HTTP intermediária.

Migrations: PreSync Job no chart `ui-frontend` (`prisma migrate deploy`).

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

O `ui-frontend` não tem login — a sidebar mostra "Sessão anônima". O histórico
grava autor `anonymous` até haver IdP.

### 5.4 HMAC não serve para toda origem

Quando entrar uma origem que não assina com HMAC, o método de autenticação
também vira configuração por integração.
