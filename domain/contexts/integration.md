# Bounded Context Canvas — Integração

Template: [DDD Crew — Bounded Context Canvas](https://github.com/ddd-crew/bounded-context-canvas).
Termos: [Ubiquitous Language](../ubiquitous-language.md) · Relações: [Context Map](../context-map.md)

## Propósito

Ser a única fronteira entre o sistema e o mundo externo, nas duas direções. Recebe o que
origens externas emitem, traduz para a linguagem do domínio e publica; e leva para fora o
que o domínio decidiu.

Nenhum outro contexto fala com sistemas externos. É o que mantém autenticação, assinatura,
formato de terceiros e tolerância a origem malcomportada num lugar só.

## Classificação estratégica

| Eixo | Valor | Por quê |
|------|-------|---------|
| **Domínio** | Supporting | Não é onde está a vantagem do produto — essa está em Predição e Copiloto. Mas não é genérico: a tradução de cada origem é específica do problema |
| **Contribuição** | Habilitador | Não gera valor sozinho. Nenhum outro contexto recebe dado sem ele |
| **Evolução** | Custom built | Receber webhook é quase commodity; traduzir o vocabulário de cada origem não é |

## Papel de domínio

**Gateway Context.** Isola o resto do sistema da variabilidade externa — formato, vocabulário,
escala de prioridade, fuso e comportamento de cada origem param aqui.

O arquétipo tem uma consequência que vale explicitar: quando uma origem muda, **este contexto
absorve**. Se a mudança vaza para outro contexto, o padrão foi violado.

## Comunicação de entrada

| Colaborador | O que envia | Natureza |
|-------------|-------------|----------|
| ITSM da Locaweb | Abertura e atualização de incident | Comando — pede que o sistema registre |
| Produtor de mock (dev) | Reprodução do histórico | Comando, mesmo formato do ITSM |
| Origens futuras (monitoração, observabilidade) | Alerta próprio | Comando |
| Copiloto | Recomendação pronta para sair | Evento — já foi decidido |

## Comunicação de saída

| Colaborador | O que envia | Natureza |
|-------------|-------------|----------|
| Acervo, Detecção | Event normalizado | Evento — fato consumado |
| Destinos externos | Recomendação para o operador | Comando — pede ação de gente |
| Acervo | Decisão que o operador tomou | Evento |

## Decisões de negócio

1. **Origem desconhecida é recusada, não adivinhada.** Sem tradução declarada, o dado não
   entra. Adivinhar produziria event com campo errado, e errado que entra é pior que
   ausente — vira treino do modelo.
2. **O que a origem enviou é preservado íntegro.** A tradução preenche os campos do domínio,
   mas o evento original continua junto. É o que permite descobrir depois um campo que
   ninguém tinha percebido que importava, sem pedir reenvio.
3. **Um event só é aceito depois de publicado.** Confirmar recebimento antes de o event
   durar transforma indisponibilidade do barramento em perda silenciosa. *(Ainda não vale:
   hoje a fronteira confirma antes de publicar — ver Questões abertas.)*
4. **Traduzir é responsabilidade da fronteira, nunca de quem consome.** Um consumidor que
   precisa saber de qual origem veio o dado indica que a tradução ficou incompleta.
5. **Toda entrada externa é autenticada.** Sem verificação de assinatura, qualquer um
   injeta incident e envenena a predição.

## Premissas

- A origem reenvia o mesmo incident quando ele muda — inclusive com severity diferente. O
  sistema recebe vários events do mesmo incident, e isso é normal, não duplicata.
- A origem não garante ordem de chegada.
- A origem não avisa mudança de contrato; descobrimos quando quebra.
- O histórico tem ~122 mil incidents. A taxa de chegada em produção real é desconhecida — o
  dimensionamento hoje é palpite.

## Métricas de verificação

- Events publicados sobre events recebidos: qualquer diferença é perda
- Recusas por origem desconhecida, por período — sinaliza origem nova não declarada
- Recusas por assinatura inválida — sinaliza configuração errada ou tentativa de injeção
- Latência da fronteira: quanto do tempo até o insight é gasto aqui

## Questões abertas

- **Reenvio duplicado.** A premissa diz que o mesmo incident volta quando muda. Mas e quando
  a origem reenvia o *mesmo* estado — retry dela, não mudança? Hoje nada distingue, e cada
  reenvio vira event novo. Precisa de chave de idempotência, e ela tem que vir da origem.
- **Barramento indisponível.** A decisão 3 diz para não confirmar antes de publicar. Falta
  decidir o que fazer então: recusar e devolver o problema para a origem, ou enfileirar
  localmente e assumir a responsabilidade de não perder.
- **Retenção do evento original.** Preservar íntegro tem custo que cresce sem limite. Não há
  política de expiração definida.
- **Contrato de saída.** As decisões acima foram pensadas para a entrada. A direção de saída
  — recomendação e retorno do operador — ainda não foi especificada.
