# TypeScript Style Guide

Aplica-se aos apps Node/Fastify do monorepo (`ui-gateway`, e qualquer app Node
futuro). Segue o template de referência
[`thiagon/template-fastify`](https://github.com/thiagon/template-fastify/tree/main/src/modules/todos)
— consulte o módulo `todos` de lá como exemplo canônico antes de desviar do padrão.

## Tooling

- **Framework**: Fastify
- **Validação/tipos**: `zod` + `fastify-type-provider-zod`
- **Plugins**: `fastify-plugin` (`fp`), carregados via `@fastify/autoload`
- **Type checker**: `tsc` (strict mode)

## General Rules

- Strict TypeScript (`strict: true` no tsconfig)
- Prefer `const` sobre `let`; nunca usar `var`
- No `any` — usar `unknown` se o tipo é genuinamente desconhecido

## Layout de um módulo (`src/modules/<nome>/`)

Cada módulo é uma pasta com até 4 arquivos, cada um com uma responsabilidade fixa:

| Arquivo | Papel | Pode ler decorators do `app` (`app.kafka`, `app.env`, `app.services`, ...)? |
|---|---|---|
| `index.ts` | Plugin `fp()`; liga as rotas | Sim |
| `routes.ts` | Registra rotas HTTP. Se o service é só deste módulo, cria aqui e passa no handler — sem decorate. Se é compartilhado, lê `app.services.<nome>` e passa no handler | Sim |
| `schema.ts` | Schemas `zod` + tipos inferidos | Não |
| `service.ts` | Lógica de negócio pura — só existe no módulo quando o service não é compartilhado | **Não, nunca** |

Um módulo **não** tem arquivo de consumer Kafka próprio.

### Service de um módulo vs service compartilhado

Service usado **só** por um módulo: `register*Routes` é chamado uma vez (autoload).
Cria o service ali e passa no handler. Não vira `app.decorate`.

Service usado por **dois módulos** (ex.: `analyses` REST e MCP): não vive em nenhum
dos dois — iria duplicar a instância. Vai em `src/services/`, plugin singleton que
decora `app.services`, e cada borda lê `app.services.analyses` e passa essa
referência no handler (`const analyses = app.services.analyses`).

### Regra central: `service.ts` não conhece Fastify

`service.ts` nunca importa `fastify`, `fastify-plugin`, o tipo `FastifyInstance`, nem
nada de `src/plugins/*` — nem para tipos. Dependências externas (publisher de evento,
config) entram como parâmetros explícitos da função/construtor, com um tipo definido
pelo próprio módulo — nunca o `FastifyInstance` inteiro. Ver `TodoService` no template:
zero import de Fastify.

Errado (acopla o service ao framework):

```typescript
// service.ts
export async function triggerAnalysis(
  app: { env: TopicEnv; kafka: FastifyInstance['kafka'] },
  request: TriggerRequest,
) { ... }
```

Certo (a borda em `routes.ts` resolve o que o service precisa antes de chamá-lo):

```typescript
// service.ts
export interface EventPublisher {
  publish(topic: string, message: { key: string; value: string }): Promise<void>;
}

export async function triggerAnalysis(
  publisher: EventPublisher,
  topic: string,
  request: TriggerRequest,
) { ... }
```

### `src/services/` — singleton compartilhado

Autoload com `maxDepth: 0` carrega só `services/index.ts`. Esse plugin instancia
`AnalysesService` uma vez e decora `app.services`. Módulos que leem o singleton
declaram `dependencies: ['services']`.

A classe em si (`services/analyses/service.ts`) continua pura: Prisma e publisher
entram no construtor, sem Fastify.

### Módulos só conhecem módulos (e plugins, nunca o contrário)

- Um módulo pode importar de `schema.ts`/`service.ts` de **outro módulo** (a API pública
  dele) — nunca de `routes.ts`/`index.ts` de outro módulo.
- Um módulo **nunca** importa código de `src/plugins/*`. O que um plugin ou
  `src/services/` disponibiliza chega via decorator (`app.kafka`, `app.prisma`,
  `app.services`) — lido de `app` em `routes.ts`/`index.ts`.
- Um módulo **nunca** edita `src/app.ts` ou `src/server.ts`. Registro de plugins,
  services e módulos é `@fastify/autoload`.
- `dependencies` do `fp()` em `index.ts` deve listar exatamente o que o módulo usa —
  nomes de plugin (`env`, `kafka`, `prisma`, `services`) e/ou de outro módulo.

## Naming Conventions

| Elemento | Convenção | Exemplo |
|---|---|---|
| Arquivos | `kebab-case.ts` | `error-handler.ts` |
| Interfaces/Types | `PascalCase` | `AnalysisRequest` |
| Classes | `PascalCase` | `AnalysesService` |
| Funções | `camelCase` | `startAnalysis()` |
| Constantes | `UPPER_SNAKE` | `ANALYSIS_DOMAIN` |

## Testing

- Framework: Vitest
- Arquivos de teste: `*.test.ts`, espelhando `src/` (`test/unit/services/analyses/service.test.ts`
  testa `src/services/analyses/service.ts`)
- A classe em `services/` é testável sem Fastify no ar; `routes.ts` e a fiação em `index.ts`
  são cobertos por teste e2e subindo o app (`test/helpers/app.ts`)
