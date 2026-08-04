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
| **Copiloto** | Transformar sinal em recomendação explicável para o operador | previsto |

*Previsto* significa que a arquitetura reserva o lugar e o ponto de integração existe, mas
nenhuma implementação o ocupa.

## Integrações

```
  ITSM ──ACL──▶ Integração ──PL──▶ Acervo
   (externo)         │                │
                     │                └──PL──▶ Predição ──┐
                     │                └──PL──▶ Detecção ──┤
                     │                                    ▼
                     └◀────────── PL ──────────────── Copiloto
```

### ITSM → Integração — Anti-Corruption Layer

O sistema de origem fala seu próprio vocabulário, e não temos poder sobre ele. A Integração
traduz na entrada, e o domínio nunca aprende os termos da origem.

É o padrão que permite adicionar uma origem sem tocar em nada a jusante: cada uma ganha sua
tradução, todas produzem o mesmo event.

Especificado em [`acl/itsm.md`](./acl/itsm.md).

### Integração → Acervo — Published Language

A Integração publica events num formato versionado e público, e quem consome se conforma a
ele. O contrato é [`contracts/incident-event.schema.json`](../contracts/incident-event.schema.json).

O upstream aqui é o **fornecedor**: mudar o formato quebra todo mundo a jusante, e por isso
a mudança passa por versão do contrato, não por combinação entre dois times.

### Acervo → Predição, Acervo → Detecção — Published Language

Os dois consomem o mesmo event publicado, cada um com sua leitura: Predição estima, Detecção
reconhece padrão em janela. Nenhum conhece o outro.

Consumir a mesma publicação em vez de conversarem entre si é o que permite acrescentar um
terceiro consumidor sem renegociar nada.

### Predição, Detecção → Copiloto — Customer/Supplier

O Copiloto é cliente dos dois: precisa de score e de sinal de rajada para recomendar. É a
única integração em que o consumidor tem voz sobre o que o produtor emite — se a recomendação
precisa de um campo, os produtores o incluem.

### Copiloto → Integração — Published Language

A recomendação volta à fronteira para sair do sistema. A Integração é o único contexto que
fala com o mundo externo, nas duas direções.

Fechar o ciclo pela mesma fronteira que o abriu é o que mantém autenticação, assinatura e
formato externo em um lugar só.

## O que os pontos de integração carregam

| Ponto | Entre | Carrega |
|-------|-------|---------|
| `incidents.received` | Integração → Acervo, Detecção | event normalizado, logo após a tradução |
| `incidents.scored` | Predição → Copiloto | event com risco de breach estimado |
| `alerts.burst` | Detecção → Copiloto | rajada reconhecida numa entity |
| `recommendations` | Copiloto → Integração | recomendação explicável, pronta para sair |
| `actions.taken` | Integração → Acervo | o que o operador decidiu, para avaliar o Copiloto |

Só `incidents.received` tem tráfego hoje. Os outros existem como ponto de integração
reservado — declará-los cedo é o que permite implementar os contextos em qualquer ordem.
