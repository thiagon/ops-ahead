# Produção de configuração pelo `ui-gateway`

**Criado:** 2026-09-19
**Estado:** implementado

## Problema

As regras que o pipeline consome — bindings, dicionário de tradução, prazos e metas de
KPI — não têm produtor. Os consumidores já existem e já reidratam dos tópicos
compactados, mas nada publica neles: a tradução morre em `UnknownSourceError` antes de
qualquer evento chegar ao ClickHouse.

O `ui-frontend` tem o Prisma com o registro inteiro, mas não tem cliente Kafka. Esta
spec resolve a produção pelo gateway, sem o front.

## Decisões

### O Kafka é transporte, não armazenamento

O tópico compactado retém o último valor por chave e seria, em tese, o store. Em dev não
é: `infra/charts/data-kafka/values-dev.yaml` declara `storage.type: ephemeral`, e todo
restart do broker apaga o log inclusive dos tópicos compactados. Em prod é
`persistent-claim`, então o problema é exclusivo do ambiente onde se trabalha todo dia.

A fonte da verdade passa a ser o MinIO. O Kafka carrega a mudança ao vivo; o MinIO
garante que ela sobreviva ao broker.

### O Kafka de dev deixa de tentar guardar coisa

Com o MinIO como fonte da verdade, o broker não precisa mais reter nada entre execuções.
Isso libera simplificar o `data-kafka` em dev — storage efêmero, retenção curta, sem
ZooKeeper — que é trabalho próprio, especificado em
[spec-kafka-dev.md](./spec-kafka-dev.md).

### Só o `data-ingest` conhece o MinIO

O gateway publica e nada mais. Não ganha cliente S3, não lê estado, não confirma
aplicação. O `data-ingest` — que já fala com MinIO em `writer.py` para o data lake — é
quem grava a configuração recebida e quem a relê no boot.

Mantém a fronteira onde ela já está: um app que conhece o object storage, não dois.

### O boot do `data-ingest` é bloqueante

Ler a configuração do MinIO acontece antes de assinar os tópicos, e falha derruba o pod.

A alternativa best-effort deixaria o consumidor traduzir com configuração parcial, e
configuração parcial não degrada: `translate.py` levanta `UnknownSourceError` e o evento
morre. Perda silenciosa de evento é pior que pod que não sobe — e o evento permanece no
Kafka, então um pod que sobe depois o processa.

### Bindings e dicionário são um record só

Um dicionário que diz "o valor `1 - Crítica` significa severidade 1" não significa nada
sem o binding que diz de qual campo do payload esse valor é lido. As duas metades nascem
juntas, vivem juntas e são versionadas juntas por `dictionary_version`.

Um tópico (`rules.mapping`), um record, uma rota. Some o estado meio-configurado.

### Nenhuma configuração é removida

Sem DELETE, sem tombstone, sem `retract`. A configuração é append-only: cada publicação
substitui a anterior sob a mesma chave, e nada apaga.

Inativar é outra track. O caminho de tombstone continua existindo e funcionando nos
consumidores (`config_stream.py`, `deadlines.py`) — esta spec só não oferece meio de
acioná-lo.

### `kpi_group` sai da configuração

A configuração de meta passa a carregar `severities: [1,2]` em vez de
`kpi_group: "p1_p2"`. A string era a regra da Locaweb petrificada em rótulo opaco: um
tenant que quisesse P1 isolado, ou P3+P4 juntos, não tinha como expressar.

A troca vai até o ClickHouse: `tenant_kpi_targets` passa a ter `severities`.

## Escopo

**Dentro:** publicação de bindings, dicionário, prazos e metas; persistência no MinIO; o
caminho até as tabelas do ClickHouse.

**Fora:** cadastro de origem — vive em `/tenants/{tenant}/sources`, com o secret cifrado
no Postgres e a chave que o decifra no Vault. As rotas de regra não o aceitam nem o
devolvem. Também fora: o front, a inativação, e o conserto do consumo
analítico descrito em "Débito assumido".

## Desenho

```
PUT /rules/...   →  gateway valida  →  publica no Kafka
                                          ↓
                    ingest consome  →  aplica em memória / ClickHouse
                                    →  grava no MinIO
                                          ↓
                    ingest (re)sobe →  lê MinIO  →  depois assina os tópicos
```

### Rotas

```
PUT /rules/mappings/:tenant/:source     → rules.mapping
PUT /rules/deadlines/:tenant            → rules.deadline
PUT /rules/targets/:tenant              → rules.target
```

`PUT` porque compactação é idempotente por natureza. Resposta `202 {key, topic}`:
aceito, não aplicado — os consumidores convergem por conta própria.

### Chaves

`tenant:source` para o mapeamento, `tenant` sozinho para prazos e metas. É o que os
consumidores já fazem `partition(":")` esperando.

### Layout no MinIO

Bucket do lake, prefixo próprio:

```
rules/mapping/{tenant}/{source}.json
rules/deadline/{tenant}.json
rules/target/{tenant}.json
```

Bucket separado daria lifecycle independente — o lake é volumoso e descartável,
configuração é pequena e preciosa. Fica para quando doer: separar depois é mover
objetos, não redesenhar.

## Trabalho

### `ui-gateway` — publicar

`src/services/rules/{schema,publish,service,index}.ts`, espelhando
`services/analyses/`, sem `store.ts` — o gateway não persiste. Registro em
`services/index.ts`. Rotas em `src/modules/rules/{routes,index}.ts`. As três variáveis
de tópico em `env.ts` e no chart.

`schema.ts` valida contra `contracts/field-binding.schema.json` e
`contracts/translation-dictionary.schema.json` — as duas metades do mesmo record —, com
`severities: number[]` no lugar de `kpi_group`.

### `data-ingest` — persistir e reidratar

`config_store.py` com `save` e `load_all`, sem `delete`. Os três handlers de
`main.py` gravam depois de aplicar. `load_all()` roda no boot antes de assinar.

Migration alterando `tenant_kpi_targets` para `severities Array(UInt8)`, com `ORDER BY`
correspondente; `config_stream.py` e `writer.py` acompanham.

### Semear e verificar

`scripts/seed_config.py` publica o `service_now` ponta a ponta: o mapeamento com
bindings e dicionário, os prazos e as metas.

A verificação vai até o ClickHouse e para ali: evento traduzido, linhas em
`tenant_deadlines` e `tenant_kpi_targets`. O teste que justifica o desenho vem depois —
derrubar o Kafka, reiniciar o `data-ingest`, confirmar que ainda traduz.

## Débito assumido

**O consumo analítico quebra.** `gold_alert_kpi_achievement.sql` junta por
`t.kpi_group = c.kpi_group` e produz o próprio lado com um `multiIf` hardcoded. Sem
`kpi_group` em `tenant_kpi_targets`, a mart sai vazia, e caem junto `ml-trainer`
(`kpi_projection/run.py`, `data.py`) e o dashboard (`ui-frontend/app/clickhouse.server.ts`,
três queries).

É deliberado: esta track fecha a produção, não o consumo.

A próxima faz o dbt agrupar por severidade e o rótulo virar derivado da configuração —
é o que torna `[1,2,4]` possível de verdade, em vez de rejeitado por não estar numa
lista.

**Inativação de configuração.** Precisa decidir de onde o gateway lê o status antes de
publicar: hoje ele não guarda nada, e o único lugar com `Status` é o Prisma do front.
