# Ubiquitous Language

Glossário vivo do domínio. Estes são os termos que valem em conversa, em spec e em código —
quando um deles aparece num nome de campo, de tabela ou de função, é este significado.

O documento define **o que os termos querem dizer**. O formato dos dados é assunto de
[`contracts/`](../contracts/); o significado de negócio de cada campo da Locaweb está no
[dicionário de dados](../docs/context/data-dictionary.md).

## Termos

### incident

Uma ocorrência gerenciada, sob a entrada [intake](#intake) `alert`: tem dono, ciclo de vida
e prazo. Vive ao longo do tempo — é aberta, trabalhada, resolvida e encerrada, e pode mudar
de severity no caminho.

Um incident **não** é o que trafega pelo sistema — o que trafega é o *event*. E não é toda
observação de origem: uma origem que só observa, sem gerenciar trabalho, produz *condition*,
não incident.

*Não use:* para a entrada `monitor` — ver [condition](#condition).

### condition

O que uma origem do tipo `monitor` reporta: um estado observado numa [entity](#entity), que
dispara (`firing`) ou cessa (`cleared`). Sem dono, sem [acknowledgment](#acknowledgment), sem
prazo — a origem observa, não gerencia trabalho.

*Não use:* incident, para a entrada `monitor`. Os dois termos existem porque as origens não
são da mesma natureza — ver [intake](#intake).

### intake

A natureza de uma origem, atribuída pelo gateway a partir da rota que recebeu o evento —
`alert` (ocorrência gerenciada, ver [incident](#incident)) ou `monitor` (condição observada,
ver [condition](#condition)). Nunca é declarada pelo payload: é a rota, vinculada à
credencial da integração, que determina.

Cada intake tem seu próprio tópico, sua própria tabela e seu próprio contrato — não há
tentativa de unificar. Um contrato único para as duas naturezas produz campo vazio
carregando semântica ambígua.

*Não use:* nature, kind, em nome de campo — o campo publicado é `intake`.

### acknowledgment

O eixo que registra se um humano já assumiu o incident, separado do ciclo de vida
(`status`). Um incident pode estar aberto e reconhecido, aberto e não reconhecido, ou
encerrado tendo sido ou não reconhecido antes — quatro combinações distintas, por isso não
é um valor de `status`.

Só existe na entrada `alert`: origens do tipo `monitor` observam, não gerenciam trabalho
humano.

*Não use:* ack em nome de campo — o campo publicado é `acknowledged_at`.

### event

Uma observação de um incident ou de uma condition num instante, publicada no barramento. É a
unidade que se move entre contextos — o [intake](#intake) diz qual das duas ela descreve.

O mesmo incident (ou a mesma condition) gera vários events ao longo da vida. Recategorizar
severity não corrige um event anterior: emite um novo. Por isso o sistema consegue
reconstruir a história de um incident sem que nenhum contexto precise guardar estado sobre
ele.

*Não use:* message, record.

### source

O sistema que emitiu o event. Nunca é declarado pelo payload — é atribuído pelo gateway, a
partir da rota e da credencial da integração vinculada a ela. Cada source fala seu próprio
vocabulário e tem seu próprio contrato — o domínio nunca aprende nenhum deles, porque a
tradução acontece na [ACL](./acl/itsm.md).

*Não use:* origin, provider.

### tenant

O cliente a quem um event pertence. Como `source`, nunca é declarado pelo payload — vem da
credencial da integração, atribuído pelo gateway. Prefixa a identidade em toda camada: o
identificador que uma origem dá a uma ocorrência só é único dentro de uma origem de um
tenant, então a chave real é `(tenant_id, source, external_id)`, nunca `external_id`
sozinho.

Dois tenants no mesmo sistema de origem podem customizar estados diferentes — por isso o
dicionário de tradução é indexado por tenant e origem, não por origem sozinha, e a tabela de
prazo por severidade é configuração por tenant, não constante do código: o prazo é contrato
de cada cliente.

*Não use:* customer, client, org — o campo publicado é `tenant_id`.

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

### marco

O que o acompanhador de prazo emite quando um incident aberto e elegível cruza 25%, 50%,
75% ou 100% do seu [OLA](#ola) vigente, ou o limiar de abandono — carrega o que se sabia do
incident naquele instante, nunca o desfecho final. O marco de 100% constata o
[breach](#breach); nenhum marco de prazo é emitido depois dele, só o de abandono, que é um
eixo separado.

Só existe para a entrada `alert`: [OLA](#ola) é prazo contratual, e a entrada `monitor` não
tem prazo — ver [condition](#condition).

Depois desta track, é a unidade de treino da Predição: cada incident que atravessa marcos
vira (incident × marco), não uma linha só por incident.

*Não use:* milestone em conversa ou em nome de campo/tópico de negócio — o código publica em
inglês (`deadlines.milestone`, contrato `deadline-milestone`), mas o termo do domínio, em
português, é `marco`.

### KPI

O indicador que a Locaweb mede mensalmente. Nem todo incident conta: entram apenas severity
1, 2 e 3, e ficam de fora os que têm incident pai ou que foram encerrados sem intervenção.

Um incident **contado no KPI** pode ou não ter sofrido breach — são duas perguntas
diferentes, e confundi-las inverte o indicador. As regras completas estão no
[dicionário de dados](../docs/context/data-dictionary.md).

### no_intervention

Incident encerrado sem nenhuma ação humana — a origem abriu por monitoramento e o próprio
incident se resolveu sozinho. Fica de fora do KPI.

Deixou de ser um valor de `status`: o `status` da entrada `alert` é o ciclo de vida genérico
entre naturezas de origem (`open` / `in_progress` / `waiting` / `resolved` / `closed` /
`canceled` / `unknown`), e "Sem Intervenção" — vocabulário do ITSM — não é um estado de
ciclo de vida, é um veredito sobre como o incident terminou. Passa a viver em
`resolution_code` (valor de origem, traduzido) e é a regra de `is_eligible`, no silver, que
o exclui do KPI — nunca mais lido de um campo de status.

*Não use:* sem_intervencao, em nome de campo nem em valor; e não use como valor de
`status`. Decisão a confirmar com a Locaweb junto das outras pendências desta track — ver
[fluxo-do-incidente.md](../docs/insights/fluxo-do-incidente.md).

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
