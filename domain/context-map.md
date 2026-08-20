# Context Map

Os bounded contexts do sistema e como conversam. Cada integração tem um padrão de
relacionamento nomeado — é o padrão que diz quem se adapta a quem quando um lado muda.

Os termos usados aqui estão na [Ubiquitous Language](./ubiquitous-language.md).

## Contextos

| Contexto | Responde por | Estado |
|----------|--------------|--------|
| **Integração** | A fronteira com o mundo externo: recebe do que está fora, traduz para o domínio, e devolve para fora o que o domínio decidiu | implementado |
| **Acervo** | Guardar todo event recebido e modelá-lo para análise; é a memória do sistema | implementado |
| **Predição** | Estimar volume futuro e risco de breach | previsto |
| **Detecção** | Reconhecer rajada e agravamento por entity, em tempo quase real | previsto |
| **Acompanhamento** | Reagir à passagem do tempo sobre incidents abertos, emitindo marco de consumo do OLA | implementado |
| **Copiloto** | Transformar sinal em recomendação explicável para o operador | previsto |

*Previsto* significa que a arquitetura reserva o lugar e o ponto de integração existe, mas
nenhuma implementação o ocupa.

## Integrações

```
  ITSM ──ACL──▶ Integração ──PL──▶ Acervo
   (externo)         │                │
                     │                ├──PL──▶ Predição ────────┐
                     │                ├──PL──▶ Detecção ────────┤
                     │                └──PL──▶ Acompanhamento ──┤
                     │                                          ▼
                     └◀────────── PL ────────────────────── Copiloto
```

### ITSM → Integração — Anti-Corruption Layer

O sistema de origem fala seu próprio vocabulário, e não temos poder sobre ele. A Integração
traduz na entrada, e o domínio nunca aprende os termos da origem.

É o padrão que permite adicionar uma origem sem tocar em nada a jusante: cada uma ganha sua
tradução, todas produzem o mesmo event.

Especificado em [`acl/itsm.md`](./acl/itsm.md).

### Integração → Acervo — Published Language

A Integração publica events num formato versionado e público, e quem consome se conforma a
ele. Um contrato por intake — [`contracts/incident-alert.schema.json`](../contracts/incident-alert.schema.json)
e [`contracts/condition-monitor.schema.json`](../contracts/condition-monitor.schema.json) —
porque as duas naturezas de origem não têm o mesmo formato (ver
[intake](./ubiquitous-language.md#intake)). O envelope cru que antecede a tradução, agnóstico
de natureza, é [`contracts/event-envelope.schema.json`](../contracts/event-envelope.schema.json)
— a ACL ainda é quem o lê, mesmo rodando no processo que também grava o Acervo (ver
[`acl/itsm.md`](./acl/itsm.md#onde-a-tradução-acontece)).

O upstream aqui é o **fornecedor**: mudar o formato quebra todo mundo a jusante, e por isso
a mudança passa por versão do contrato, não por combinação entre dois times.

### Acervo → Predição, Acervo → Detecção, Acervo → Acompanhamento — Published Language

Os três consomem o mesmo event publicado, cada um com sua leitura: Predição estima, Detecção
reconhece padrão em janela, Acompanhamento mede consumo de prazo. Nenhum conhece os outros.

Consumir a mesma publicação em vez de conversarem entre si é o que permite acrescentar um
quarto consumidor sem renegociar nada — foi assim que Acompanhamento entrou.

### Predição, Detecção, Acompanhamento → Copiloto — Customer/Supplier

O Copiloto é cliente dos três: precisa de score, de sinal de rajada e de marco de prazo para
recomendar. É a única integração em que o consumidor tem voz sobre o que o produtor emite —
se a recomendação precisa de um campo, os produtores o incluem.

### Copiloto → Integração — Published Language

A recomendação volta à fronteira para sair do sistema. A Integração é o único contexto que
fala com o mundo externo, nas duas direções.

Fechar o ciclo pela mesma fronteira que o abriu é o que mantém autenticação, assinatura e
formato externo em um lugar só.

### Execução sob demanda — um segundo tipo de fronteira

Todas as integrações acima são pub/sub assíncrono: um contexto publica, outro consome,
sem saber quem está do outro lado. A execução sob demanda (`ui-orchestrator`, ver
[`analysis`](./ubiquitous-language.md#analysis)) é um padrão diferente — quem chama
(dev, N1, agente de IA) pede uma ação específica de **Predição** ou **Acervo** e recebe
de volta um identificador pra acompanhar o resultado. Não é Integração: não traduz
vocabulário de um sistema externo, é uma fronteira pra chamador **interno**, autenticado
implicitamente pelo próprio acesso à rede da plataforma.

Igual à Integração, é a única porta de entrada pra esse tipo de pedido — Predição e
Acervo nunca são acionados sob demanda por nenhum outro caminho. Ao contrário da
Integração, não fica no meio do fluxo pub/sub principal (`events.raw.*`, `events.alert`/
`events.monitor` e o resto continuam fluindo sem passar por ela).

## O que os pontos de integração carregam

| Ponto | Entre | Carrega |
|-------|-------|---------|
| `events.raw.alert` / `events.raw.monitor` | Integração → Integração (tradução) | envelope cru, corpo opaco — nenhum consumidor de negócio lê estes |
| `events.alert` / `events.monitor` | Integração → Acervo, Detecção, Acompanhamento | event traduzido, um tópico por intake |
| `incidents.scored` | Predição → Copiloto | event com risco de breach estimado |
| `alerts.burst` | Detecção → Copiloto | rajada reconhecida numa entity |
| `deadlines.milestone` | Acompanhamento → Integração (bronze), Predição, Copiloto | marco de consumo do OLA (25/50/75/100% ou abandono) de um incident aberto |
| `recommendations` | Copiloto → Integração | recomendação explicável, pronta para sair |
| `actions.taken` | Integração → Acervo | o que o operador decidiu, para avaliar o Copiloto |
| `trigger.ml` / `trigger.data` | execução sob demanda → Predição / Acervo | `analysis` + parâmetros de um pedido validado, um tópico por domínio |
| `trigger.status` | Predição / Acervo → execução sob demanda | estado atual de um pedido (`run_id` como key, log compactado — só a última mensagem por run sobrevive) |

`events.raw.*`, `events.alert`, `events.monitor` e `deadlines.milestone` têm tráfego hoje
entre os pontos pub/sub — os três primeiros substituem o antigo `incidents.received`, cortado
sem alias, e o último é novo, ambos na track `incident-flow_20260819`. `trigger.ml`/
`trigger.data`/`trigger.status` têm tráfego real desde a track `exec-trigger_20260807`. Os
demais continuam reservados — declará-los cedo é o que permite implementar os contextos em
qualquer ordem.
