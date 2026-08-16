# TypeScript Style Guide

Aplica-se aos apps Node/Fastify do monorepo (`ui-orchestrator`, e qualquer app Node
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

| Arquivo | Papel | Pode ler decorators do `app` (`app.kafka`, `app.env`, ...)? |
|---|---|---|
| `index.ts` | Plugin `fp()`; instancia o service (se houver) e liga as rotas | Sim |
| `routes.ts` | Registra rotas HTTP — recebe `app: FastifyInstance` (a própria API de rota do Fastify exige isso) e pode ler decorators de plugin direto dele antes de chamar o service | Sim — mesmo padrão do template (`registerTodoRoutes(app, service)`) |
| `schema.ts` | Schemas `zod` + tipos inferidos | Não |
| `service.ts` | Lógica de negócio pura | **Não, nunca** |

Um módulo **não** tem arquivo de consumer Kafka próprio. Se um estado/capability
(read model, contador, o que for) precisa ser visto por mais de um módulo — como o
status de um run, lido tanto pela rota REST quanto pela tool MCP — ele não pertence a
nenhum dos dois módulos: vira um **plugin** (ver seção abaixo).

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

### Estado/capability compartilhado entre módulos é plugin, não módulo

Um módulo é dono de uma fatia de API de negócio (rotas + o service por trás delas) —
não de um pedaço de estado que outro módulo também precisa enxergar. Sinal de que algo
deveria ser plugin, não módulo: mais de um módulo precisaria importar o `service.ts` de
outro, ou pior, os dois acabariam com instâncias/Maps diferentes do "mesmo" dado.

Exemplo real: o status de um run precisa ser lido tanto por `GET /runs/:run_id`
(módulo `runs`) quanto pela tool MCP `get_run_status` (módulo `mcp`) — os dois têm que
enxergar exatamente o mesmo dado. Isso é `src/plugins/run-status.ts`: dono do
`RunsService` (a classe com o Map), decora `app.runsService`, e é quem consome
`trigger.status` do Kafka pra manter esse estado atualizado — no mesmo pé que o plugin
`kafka` já ocupa. Os módulos `runs`/`mcp` só leem `app.runsService.getStatus(...)`, cada
um pela própria borda (`routes.ts`/`server.ts`), com `dependencies: [..., 'run-status']`
no `fp()` pra garantir que o plugin já rodou.

Diferença pra um plugin "genérico" como `kafka.ts`: `run-status.ts` é propositalmente
acoplado ao domínio (importa `RunStatus` de `modules/runs/schema.ts`) — não é reutilizável
fora deste app, e tudo bem, o motivo de ser plugin é *compartilhamento entre módulos*, não
reuso entre projetos.

### Módulos só conhecem módulos (e plugins, nunca o contrário)

- Um módulo pode importar de `schema.ts`/`service.ts` de **outro módulo** (a API pública
  dele) — nunca de `routes.ts`/`index.ts` de outro módulo.
- Um módulo **nunca** importa código de `src/plugins/*`. O que um plugin disponibiliza
  chega via decorator ambient do Fastify (`declare module 'fastify'` dentro do próprio
  plugin, ex.: `app.kafka`, `app.runsService`) — lido de `app` em `routes.ts`/`index.ts`.
  Exceção deliberada: um plugin bem específico de domínio (ex.: `run-status.ts`) pode
  importar um *tipo* (`import type`) de `modules/*/schema.ts` pra não duplicar a forma do
  dado — nunca o inverso, e nunca importar comportamento.
- Um módulo **nunca** edita `src/app.ts` ou `src/server.ts`. Registro de plugins e
  módulos é `@fastify/autoload` — adicionar um módulo é criar a pasta, nunca tocar o
  bootstrap.
- `dependencies` do `fp()` em `index.ts` deve listar exatamente o que o módulo usa —
  nomes de plugin (`env`, `kafka`, `run-status`) e/ou de outro módulo, nunca um plugin
  que o módulo não toca diretamente.

## Naming Conventions

| Elemento | Convenção | Exemplo |
|---|---|---|
| Arquivos | `kebab-case.ts` | `run-status.ts` |
| Interfaces/Types | `PascalCase` | `TriggerResult` |
| Classes | `PascalCase` | `RunsService` |
| Funções | `camelCase` | `triggerAnalysis()` |
| Constantes | `UPPER_SNAKE` | `ANALYSIS_DOMAIN` |

## Testing

- Framework: Vitest
- Arquivos de teste: `*.test.ts`, espelhando `src/` (`test/unit/plugins/run-status.test.ts`
  testa `src/plugins/run-status.ts`)
- `service.ts` (módulo) e a lógica pura de um plugin (ex.: `parseStatusMessage`,
  `RunsService` em `run-status.ts`) são testáveis sem Fastify no ar — é a razão de serem
  puros; `routes.ts` e a fiação em `index.ts` são cobertos por teste e2e subindo o app
  (`test/helpers/app.ts`)
