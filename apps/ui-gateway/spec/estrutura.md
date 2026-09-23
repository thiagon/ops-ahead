# Código novo no ui-gateway

**Criado:** 2026-09-23
**Estado:** fonte da verdade para onde colocar código novo
**Escopo:** `apps/ui-gateway/src`

Classifique a peça antes de criar o arquivo. Ela mora em uma pasta só.

| A peça… | Pasta |
|---|---|
| sobe com o processo e precisa de hook do Fastify | `src/plugins` |
| decide o que um fato do negócio significa | `src/services/<nome>` |
| abstrai uma API genérica demais para o caso de uso deste app | `src/lib` |
| expõe uma operação que o service já decidiu | `src/modules/<nome>` |

## Lib

A lib é a abstração do nosso caso de uso. A dependência chega genérica demais; a lib publica a chamada que fazemos, e o detalhe que não interessa repetir fica nela.

1. Cada chamada de fora nomeia o caso de uso. Opção que sairia igual em todo lugar — confirmação, envelope, algoritmo — fica dentro da lib.
2. Construir o cliente no plugin e repetir essa opção em cada chamada é o sinal de que a chamada ainda não é a lib.
3. Quem recebe a lib no construtor depende dessa chamada, para um teste ou outra implementação ocupar o lugar.
4. Não importa Fastify.
5. Não decide produto: o que um claim significa, quem pode escrever, para onde um redirect volta.
6. Um tipo que plugin e service usam os dois mora na lib.
7. Um schema que só o service e as rotas dele usam fica em `src/services/<nome>/schema.ts`.

## Plugin

O plugin é a camada Fastify. Ele publica na instância algo cuja vida é o processo: conectar ao subir, verificar o pool, fechar ao encerrar.

1. Instancia quando o processo sobe e registra o hook que essa vida pede.
2. Decora a instância com o que o resto do app chama.
3. Quem monta o app pode entregar outra implementação antes. O plugin cria a padrão só quando o decorator ainda não existe.
4. Nome, header, texto e os demais valores deste processo ficam no plugin e entram na lib como argumento.
5. O que o plugin usa por request se lê na hora do request. Dependência de registro é só o que ele usa ao registrar.
6. Não importa arquivo de `src/services`.
7. O plugin passou de instanciar, decorar e registrar hook? O que sobrou é lib, se for abstração do caso de uso, ou service, se for decisão. O hook continua no plugin.

## Service

1. Decide produto.
2. Recebe a abstração da lib pelo construtor e chama o caso de uso. O detalhe genérico da dependência não se repete aqui.
3. Não importa Fastify. O único HTTP que gera é erro, com `http-errors`. Quem vira isso em status é a rota, quando ela responde, ou o plugin de erro, no handler do Fastify.
4. Não importa plugin.
5. O único plugin em `src/services` é o `index.ts`, que instancia os services. Uma pasta nova aí dentro não é plugin.
6. Service novo é uma pasta nova registrada nesse `index.ts`. Não há segunda lista.

## Module

1. `index.ts` só registra as rotas, com nome e dependências.
2. `routes.ts` valida o HTTP, chama o service e devolve o status.
3. A rota não decide quem pode, nem o que o dado significa. Isso já chegou em `request.auth` ou no retorno do service.
4. A rota importa schema da lib ou do service. Não importa arquivo de plugin. O que o plugin publicou se usa pela instância.

## Imports permitidos

| De | Para |
|---|---|
| lib | lib |
| plugin | lib |
| service | lib, service |
| module | lib, schema de service |

Fora desta tabela, a ligação é pela instância, em runtime. Plugin e module chamam o que foi decorado. O service não chama plugin: a lib chegou no construtor.

## Antes de abrir o arquivo

1. Qual linha da tabela descreve a peça?
2. O import está na tabela de imports permitidos?
3. A chamada nova repetiria um detalhe genérico que não é do caso de uso? Esse detalhe fica na lib.
4. Plugin e service precisam do mesmo tipo? O tipo está na lib.
5. Precisa existir quando o processo sobe, ou de um hook? O plugin instancia, decora e registra o hook. Passou disso? O resto sai.
6. É decisão? Está no service, dependendo da interface da lib, sem Fastify. Erro sai por `http-errors`; status fica na rota ou no plugin de erro.
7. É rota? O `index.ts` só registra.
