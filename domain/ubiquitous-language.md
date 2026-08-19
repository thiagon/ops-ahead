# Ubiquitous Language

Glossário vivo do domínio. Estes são os termos que valem em conversa, em spec e em código —
quando um deles aparece num nome de campo, de tabela ou de função, é este significado.

O documento define **o que os termos querem dizer**. O formato dos dados é assunto de
[`contracts/`](../contracts/); o significado de negócio de cada campo da Locaweb está no
[dicionário de dados](../docs/context/data-dictionary.md).

## Termos

### incident

Uma ocorrência no sistema de origem. Vive ao longo do tempo: é aberta, trabalhada,
resolvida e encerrada, e pode mudar de severity no caminho.

Um incident **não** é o que trafega pelo sistema — o que trafega é o *event*.

### event

Uma observação de um incident num instante, publicada no barramento. É a unidade que se
move entre contextos.

O mesmo incident gera vários events ao longo da vida. Recategorizar prioridade não corrige
um event anterior: emite um novo. Por isso o sistema consegue reconstruir a história de um
incident sem que nenhum contexto precise guardar estado sobre ele.

*Não use:* message, record.

### source

O sistema que emitiu o event. Cada source fala seu próprio vocabulário e tem seu próprio
contrato — o domínio nunca aprende nenhum deles, porque a tradução acontece na
[ACL](./acl/itsm.md).

*Não use:* origin, provider.

### entity

O que foi afetado — um ativo de TI, host ou serviço. É por entity que o sistema agrupa para
detectar repetição e agravamento.

*Não use:* asset. `CI` aparece em conversa por herança do ITSM, mas não em nome de campo.

### severity

A urgência do incident numa escala normalizada de 1 a 5: 1 Crítica, 2 Alta, 3 Média,
4 Baixa, 5 Muito Baixa.

É a tradução da prioridade da origem para a escala do domínio. A distinção importa: cada
source pode ter sua própria escala, e `severity` é a única que o domínio conhece. Depois da
fronteira de ingestão, *priority* não é mais um termo do sistema.

### OLA

O limite de tempo de resolução acordado, por severity: P1 e P2 até 4h, P3 até 12h, P4 até
24h, P5 até 96h.

*Não use:* SLA. É acordo operacional interno, não com cliente.

### breach

Estourar o limite do OLA. É o evento que o projeto existe para antecipar.

*Não use:* **violation**. Os dois circularam no código até a linguagem ser escrita. `breach`
ganhou porque já era a língua do projeto fora dele — o objetivo do produto está descrito
como *identify OLA breach risk*, e o dicionário de origem traduz `KPI Violado?` como *OLA
was breached*. `violation` tinha entrado só como nome de coluna em dois modelos analíticos,
sem lastro em lugar nenhum.

### KPI

O indicador que a Locaweb mede mensalmente. Nem todo incident conta: entram apenas severity
1, 2 e 3, e ficam de fora os que têm incident pai ou que foram encerrados sem intervenção.

Um incident **contado no KPI** pode ou não ter sofrido breach — são duas perguntas
diferentes, e confundi-las inverte o indicador. As regras completas estão no
[dicionário de dados](../docs/context/data-dictionary.md).

### no_intervention

Incident encerrado sem nenhuma ação humana — o monitoramento abriu e o próprio evento se
resolveu sozinho. Fica de fora do KPI. Tradução para a Ubiquitous Language do status ITSM
"Sem Intervenção" — vocabulário de origem que não deveria aparecer em nome de campo além
do adapter ([`acl/itsm.md`](./acl/itsm.md)).

*Não use:* sem_intervencao, em nome de campo nem em valor. O status chega do ITSM em
português e é traduzido no adapter do `ui-gateway`, que é onde a ACL acontece — do contrato
publicado em diante, `no_intervention` é o único nome.

### external event

Anomalia num dia ou janela — não num incident individual — que não é sinal do domínio: um
evento fora da Locaweb (AWS, registro.br, CrowdStrike) que se parece com pico de
incidentes mas contaminaria o treino se entrasse como se fosse comportamento normal.
Marcado por dia (`is_external_event`, `anomaly_score`), consumido como filtro de treino
pelos outros modelos da Predição — nunca pelo Copiloto diretamente.

### analysis

O que se pede quando se dispara uma execução sob demanda — a pergunta de negócio, não o
mecanismo por trás dela. É o único campo discriminador do payload que entra pelo ponto de
entrada único (`ui-orchestrator`, ver [Context Map](./context-map.md)).

Valores hoje:

- **`volume_forecast`** — treinar o modelo de previsão de volume de incidentes.
- **`breach_risk`** — treinar o modelo de risco de breach de OLA.
- **`kpi_projection`** — projetar o fechamento mensal dos 4 KPIs do PPR (Monte Carlo).
- **`external_event_detection`** — treinar o detector de evento externo (Isolation Forest).
- **`data_refresh`** — rematerializar os marts a partir do dado recebido.
- **`data_quality_check`** — rodar a suite de qualidade sobre os marts.

`analysis` nunca é um nome de `Job`, tópico ou imagem — é vocabulário de quem pede a
execução, não de quem a executa. A tradução para o mecanismo interno (qual tópico
publicar, qual app consome) é responsabilidade exclusiva do `ui-orchestrator`; nenhum
outro contexto precisa conhecer essa tradução.

*Não use:* workload, job, trigger. São termos de infraestrutura — o que a execução *é*
por baixo, não o que foi pedido.

## Como nomear um estágio

Um estágio se chama pelo **que aconteceu com o dado**, não pelo que ele ainda não passou.

Nomes que descrevem ausência — `raw`, `unprocessed`, `temp` — envelhecem mal: descrevem uma
etapa pela negativa e passam a mentir assim que ela faz alguma coisa. Foi o que aconteceu
com o primeiro nome do estágio de ingestão, que carregava dados normalizados desde o
primeiro dia enquanto se chamava *raw*.

Os estágios e como os contextos se integram estão no [Context Map](./context-map.md).
