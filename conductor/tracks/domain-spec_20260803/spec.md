# Specification: Camada de Domínio (Spec-Driven Development)

**Track ID:** domain-spec_20260803
**Type:** Chore
**Created:** 2026-08-03
**Status:** Complete

## Summary

Estabelecer a camada de domínio do projeto com os artefatos de **Spec-Driven Development** —
Ubiquitous Language, Context Map, Bounded Context Canvas e ACL Spec. São specs de intenção
de negócio em linguagem do domínio; não descrevem implementação nem duplicam schema.

## Context

O vocabulário do sistema nunca foi escrito em lugar nenhum. Cada app batizou seus campos por
conta e os quatro pontos que precisam concordar — schema do gateway, dicionário do producer
mock, extrações do staging e colunas dos marts — concordavam por acidente.

O custo apareceu na track `gateway-ingest_20260802`: renomear exigiu arqueologia em quatro
apps, e o `scripts/audit.sql` ficou quebrado sem ninguém notar, consultando colunas que
tinham deixado de existir.

**O padrão já tem nome.** O que a sessão inteira construiu na marra — a fronteira onde o
vocabulário português do ITSM vira o nosso, com o `itsmAdapter` traduzindo e nada a jusante
conhecendo a origem — é um **Anti-Corruption Layer**, artefato de DDD e um dos elementos de
spec do SDD Level 1. A track escreve a ACL como spec em vez de deixá-la implícita no código.

**Primeira tentativa e por que foi descartada.** A versão inicial desta track produziu um
registro caseiro (`domain/fields/*.yaml`) com nome, tipo e origem de cada campo, mais testes
que raspavam `schema.ts` e `stg_incidents.sql` por regex para conferir. Isso viola o
princípio central do SDD: spec descreve **intenção de negócio em linguagem do domínio**, não
implementação acoplada à tecnologia. Além de duplicar
`contracts/incident-event.schema.json`, que já é o schema of record, o registro obrigava um
serviço deployável a ler arquivos fora do próprio pacote. Os artefatos padrão substituem
tudo isso.

## Motivation

Sem a camada de domínio escrita, todo rename futuro repete o padrão: descobrir os nomes
lendo código, trocar em N lugares, descobrir o que ficou para trás quando algo quebra. As
tracks seguintes — fases 3–5 do gateway, `model-serving`, `burst-detector` — vão introduzir
mais nomes, e vão fazê-lo sem uma linguagem comum a que se referir.

O ganho não é documentação: é ter onde discutir uma decisão de nome **antes** de ela virar
quatro implementações divergentes.

## Success Criteria

- [x] `domain/ubiquitous-language.md` — glossário vivo dos termos do domínio, com o termo
      rejeitado quando houve disputa (breach, não violation) e o porquê
- [x] `domain/context-map.md` — os bounded contexts do sistema e como se integram; os
      tópicos Kafka aparecem como pontos de integração entre contextos, não como infra
- [x] `domain/contexts/integration.md` — Bounded Context Canvas do contexto de Integração, no
      template do DDD Crew
- [x] `domain/acl/itsm.md` — ACL Spec da origem ITSM: o que a camada traduz, o que ela
      protege o domínio de conhecer, e a regra de fronteira do vocabulário
- [x] `CLAUDE.md` cumpre o papel de constitution e aponta para `domain/` em vez de repetir
      as regras
- [x] Nenhum artefato de `domain/` duplica schema que já existe em `contracts/` ou dbt

## Risk Assessment

- **Spec virar descrição de implementação.** Foi o erro da primeira tentativa e é o risco
  que mais volta: é tentador listar campo e tipo, porque é concreto. O critério de revisão é
  simples — se a frase deixa de ser verdade quando trocamos ClickHouse por outra coisa, ela
  não pertence a `domain/`.
- **Spec envelhecer.** Real e **não resolvido por automação nesta track**. Os artefatos de
  domínio são prosa, e prosa não tem CI. A defesa é indireta: os artefatos que *são*
  verificáveis — o JSON Schema do contrato, o OpenAPI gerado do Zod, os testes do dbt — já
  rodam, e a camada de domínio só fala do que não cabe neles. Quanto menor ela for, menos
  ela tem para envelhecer. Automatizar a checagem foi tentado e descartado; se voltar, volta
  como track própria com ferramenta de mercado, não com regex.
- **Duplicar o dicionário de origem.** `domain/` não reescreve regra de negócio da Locaweb;
  para isso referencia `docs/context/data-dictionary.md`.

## Dependencies

- `gateway-ingest_20260802` — o vocabulário que os artefatos descrevem foi estabilizado lá.
  Esta track fica na **mesma branch** (`feat/gateway-ingest`) e entra no **PR #47**.

## Out of Scope

- **Harness de verificação de drift** — tentado e descartado; ver Risk Assessment
- Codegen a partir das specs
- Reescrever `docs/context/data-dictionary.md`
- Bounded Context Canvas dos contextos ainda não implementados (ML, agente)
- Renomear campos além dos que já existem

## Technical Notes

- **Artefatos e o que cada um responde:**
  - *Ubiquitous Language* — o que cada termo significa e qual palavra usar
  - *Context Map* — quais contextos existem e como conversam
  - *Bounded Context Canvas* — para um contexto: propósito, papel estratégico, comunicação
    de entrada e saída, decisões de negócio, premissas
  - *ACL Spec* — o que uma origem externa fala e como isso é traduzido antes de entrar
- **`contracts/` continua sendo o schema of record.** As specs referenciam, nunca repetem.
- **`CLAUDE.md` como constitution** — as regras duráveis do projeto. A regra de fronteira de
  vocabulário sai de lá e vira `domain/acl/itsm.md`; o `CLAUDE.md` aponta.
- **Linguagem dos artefatos:** português, como o resto de `docs/` e `conductor/`. Os
  **termos** do domínio permanecem em inglês, porque são os nomes que o código usa.

---

_Generated by Conductor. Review and edit as needed._
