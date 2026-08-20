# O fluxo real do incidente

**Data:** 2026-08-19

Reconstrução de como um incidente se comporta na operação da Locaweb, e do que o sistema faz em
cada momento desse percurso. A reconstrução foi por engenharia reversa: o histórico é o resultado
de um processo que ninguém documentou inteiro, e o que está aqui é o processo inferido dele.

Levantamento, não decisão.

---

## O que o processo real faz hoje

**O incidente vive.** Ele abre, é triado, pode ser escalado, é resolvido tecnicamente e só depois
encerrado. Em P2 o sistema nunca encerra sozinho: marca `Resolvido` quando a correção acontece e
espera validação humana para encerrar. São dois instantes distintos, e o prazo do OLA corre até o
primeiro.

**A violação é julgada, não calculada.** Estourar o prazo não basta para contar contra a meta.
Alguém decide, depois do fato, quais estouros são falha de operação. O critério não está escrito em
lugar nenhum, mas o efeito é mensurável: entre os incidentes que passaram do OLA, apenas 6,8%
contaram como violação.

**O julgamento tem uma lógica.** Quanto mais o incidente estoura, menos chance de contar — de 33%
entre os que passam por pouco a 1,6% entre os que passam de cinquenta vezes o prazo. Invertido para
uma métrica de qualidade, coerente para higiene de fila: um chamado esquecido por meses não é falha
de resolução. O julgamento separa "operação falhou" de "ninguém fechou o ticket".

**E é tardio.** A decisão acontece na apuração, depois do mês fechado. Quando alguém sabe que o
OLA foi perdido, não há mais nada a fazer sobre aquele incidente — só contar.

É exatamente esse ponto que o produto ataca: trazer o julgamento para dentro da janela em que ele
ainda muda o desfecho.

---

## O fluxo que o sistema implementa

```
origem  ──POST──▶  adapter  ──▶  evento de abertura        (entrada alert)
                                       │
                                       ├──▶ análise imediata (score, contexto do IC)
                                       │
                        enquanto aberto │
                                       ▼
                    ┌── marco 25% do OLA ──▶ análise ──▶ alerta se em risco
                    ├── marco 50% ─────────▶ análise ──▶ alerta
                    ├── marco 75% ─────────▶ análise ──▶ alerta
                    └── marco 100% ────────▶ constata o estouro
                                       │
                          resolvido / encerrado
                                       ▼
                            consolidação da quebra
```

**Recepção.** Qualquer origem capaz de configurar um webhook posta no gateway. O adapter da origem
traduz para o vocabulário do domínio e entrega na entrada correspondente ao tipo dela — `alert` ou
`monitor`, ver adiante. O percurso descrito neste diagrama é o da entrada `alert`, a única com prazo
a acompanhar.

**Eventos que nós criamos.** Os marcos de OLA não vêm de origem nenhuma — são produto do sistema.
Enquanto o incidente estiver aberto, cada fração do prazo consumida gera um evento que dispara
reavaliação. Os três primeiros são preventivos; o de 100% constata que o prazo foi perdido.

**Consolidação.** Quando o incidente fecha, o desfecho é consolidado: quanto durou, se estourou,
por quanto. Esse é o dado que alimenta o acompanhamento de KPI — produzido por nós, no momento em
que o fato acontece, não apurado semanas depois.

### Por que marco de OLA e não intervalo fixo

O marco escala com a prioridade sozinho: 25% são 1 hora em P2 e 3 horas em P3, sem tabela de
configuração. E gera menos evento para incidente longo — um chamado aberto há meses não precisa de
reavaliação a cada quinze minutos.

Medido no histórico: marcos de 25/50/75/100% geram **22.474 eventos** sobre 25.600 incidentes
elegíveis. Menos de um por incidente.

### Depois de 100%

O prazo já foi; não há mais o que antecipar. O que ainda faz sentido é um limiar bem maior para
**chamado abandonado** — outro problema, outra mensagem, mesmo mecanismo. No histórico são 2.499
incidentes elegíveis ao KPI abertos além de dez vezes o prazo, o extremo em 2.044 vezes.

---

## Duas entradas, não uma

As origens não são todas da mesma natureza, e tratá-las com um contrato só recria o problema que a
camada de tradução existe para resolver — só que ao contrário: campos vazios carregando semântica
ambígua.

| | `alert` | `monitor` |
|---|---|---|
| Quem | ServiceNow, Jira Service Management, Opsgenie, PagerDuty | Prometheus, Datadog, Grafana, Zabbix |
| O que emite | um incidente gerenciado, com dono e ciclo de vida | uma condição observada, que persiste ou cessa |
| Ciclo de vida | é da origem — se ela diz "resolvido", está resolvido | firing / resolved, nada além |
| Reconhecimento humano | tem: ack, atribuição, escalonamento | não existe |
| Prazo | contratual, definido lá | não existe |
| O que o sistema faz | complementa uma gestão que já existe | cria a gestão que não existe |

Cada tipo tem seu tópico, sua tabela e seu contrato. Não há tentativa de unificar: um alerta do
Prometheus não tem número de chamado, grupo designado nem prazo, e fingir que tem só adia a
confusão para o consumidor.

```
ServiceNow, Jira SM, Opsgenie ──▶ adapter ──▶ tópico alert ──▶ tabela de incidentes
                                                     (ciclo de vida, ack, prazo, grupo)

Datadog, Prometheus, Zabbix ───▶ adapter ──▶ tópico monitor ──▶ tabela de sinais
                                                     (condição, firing/resolved, host)
                                                              │
                                        correlação por entity ┘
```

**O que une os dois é a `entity`, não o schema.** É por ela que o sistema pergunta: este recurso tem
quantos sinais de monitoração disparando agora, e há quanto tempo o incidente dele está aberto no
gerenciador? Essa correlação é o precursor que a mentoria descreveu, e ela fica mais legível com as
duas entradas separadas do que espremidas num registro só.

A separação também resolve de onde sai o prazo: ele só existe onde é contratual. O acompanhamento de
OLA opera sobre a entrada `alert`. A entrada `monitor` alimenta contexto, detecção de rajada e
correlação — sem relógio, porque não há prazo para correr.

---

## O que o sistema precisa saber em cada momento

**Na abertura:** identidade na origem, quando abriu, gravidade, entidade afetada, quem abriu,
título, grupo responsável. Todos os oito sistemas de origem pesquisados entregam isso.

**Durante:** se alguém já reconheceu o incidente. Este é o eixo que falta hoje e que muda o
prognóstico — "aberto há 40 minutos e ninguém pegou" é o preditor mais direto que existe. Nas
origens do tipo `alert` ele é um campo separado do status: no Opsgenie, `status` vale `open` ou
`closed` e `acknowledged` é um booleano à parte; o PagerDuty comprime os dois em
`triggered → acknowledged → resolved`, mas `acknowledged` ali marca a entrada de um humano, não
progresso de resolução.

Origens do tipo `monitor` não têm esse eixo — observam, não gerenciam trabalho humano. Por isso a
topologia de integração importa: Datadog conectado direto entrega menos que Datadog → Opsgenie →
nós, porque no segundo caminho o incidente passa a ter dono, ack e prazo.

**No fechamento:** quando resolveu, quando encerrou, com que código, se houve solução definitiva ou
contorno.

---

## O que isso implica nas camadas

Cada entrada tem sua própria cadeia. Elas não se fundem em nenhum ponto — se encontram por
`entity`, quando a análise precisa das duas.

```
monitor:  bronze              silver                 gold
          sinal cru      →    está firing agora?  →  agregações por entity
                                                            │
                                                            │  contexto
                                                            ▼
alert:    bronze              silver                 gold
          eventos de vida →   incidente vivo      →  KPI, quebras consolidadas
                                    │                        │
                                    ▼                        ▼
                              fila + marcos            painel do gestor
```

### As duas cadeias têm finalidades diferentes

O gold do `monitor` **não é produto final, é insumo**. Ninguém abre uma tela para ver contagem de
sinais por recurso na última hora; isso existe para entrar na análise do incidente e nas features do
modelo. Já o gold do `alert` é o que chega ao gestor: KPI do mês, quebras consolidadas, projeção.

### Bronze — todos os eventos, append-only

Nas duas entradas. No `alert`: abertura, transições, ack, marcos, resolução, encerramento. No
`monitor`: cada disparo e cada cessação da condição. É o que permite reconstruir o estado em
qualquer instante.

### Silver — o estado atual

No `alert`, o estado de cada incidente: um `argMax(..., received_at)` por identidade. Com stream
isso é obrigatório — sem deduplicar, o mesmo incidente é contado uma vez por evento.

No `monitor`, quais condições estão ativas agora por recurso.

### Gold do `monitor` — pré-análises por entity

Todas por `entity` × janela, sem modelo:

| Pré-análise | Para que serve |
|-------------|----------------|
| contagem de sinais por janela (15min / 1h / 6h) | contexto imediato do recurso |
| taxa de auto-resolução do recurso | separa recurso ruidoso de recurso com problema real |
| intervalo típico entre sinais | régua para dizer se a repetição atual é anômala |
| sequência de severidade crescente | o precursor descrito na mentoria |

### Gold do `alert` — o que o negócio consome

Consolidação de quebras (dos fechados), estado do KPI no mês, projeção de fechamento (que precisa
dos abertos em risco — "vou fechar o mês?" não se responde só com desfecho) e carga por grupo, que
depende dos vivos: fechado não pesa em ninguém.

### Onde os marts de hoje se encaixam

Nenhum precisa ser reescrito — mudam de lado, porque hoje leem de uma entrada só que mistura as duas
naturezas:

| Mart atual | Lado | Por quê |
|------------|------|---------|
| `incidents_by_ic` | `monitor` | contagem por recurso e janela é agregação de sinal |
| `p4_sequences_by_ci` | `monitor` | sequência de severidade no recurso |
| `daily_anomaly_features` | `monitor` | volume, dispersão e taxa de auto-resolução do dia |
| `first_touch_duration` | `alert` | depende de grupo responsável e desfecho |
| `group_load_by_window` | `alert` | carga de quem trabalha o incidente |
| `kpi_monthly_state` | `alert` | veredito de negócio sobre prazo contratual |
| `priority_changes_log` | `alert` | recategorização é decisão de quem gerencia |

### O que a separação torna possível

O gold do `monitor` existe para recursos que **não têm incidente nenhum aberto**. Um servidor com
sinais disparando e nenhum chamado registrado é exatamente o caso que interessa antecipar — e hoje
ele é invisível, porque sem chamado não há linha no histórico.

### A armadilha do treino

Treino que sai do silver vaza futuro, porque o silver guarda o último estado — o desfecho. O treino
precisa do estado no instante da predição, que só o bronze reconstrói.

Cada marco emitido já é uma linha de treino pronta: *P3, Team14, 25% do prazo consumido, três sinais
de severidade crescente na mesma entity na última hora, ninguém deu ack* — e o desfecho, conhecido
depois, vira o rótulo. Um incidente que passa por três marcos gera três exemplos, cada um com menos
tempo restante. A unidade de treino passa a ser (incidente × marco), não (incidente).

---

## Onde cada coisa fica

O critério não é a camada — é o padrão de acesso.

| Padrão | Destino | O que vai ali |
|--------|---------|---------------|
| agregação sobre muitas linhas | ClickHouse | bronze, silver e o gold analítico das duas cadeias |
| cópia bruta para reprocessar e treinar | MinIO (Parquet) | os eventos como chegaram |
| leitura em milissegundos dentro de uma requisição | Redis | estado dos incidentes vivos, snapshot de features por entity |
| leitura por chave e escrita transacional | Postgres | o que o produto gera e a tela consome |
| busca por similaridade | Postgres + pgvector | casos resolvidos indexados, para o copiloto |

O Redis é sempre cache: tudo que está nele é reconstruível do bronze por replay. Nada que exista só
ali pode ser fonte de coisa nenhuma.

**Uma lacuna atual:** as análises de projeção de KPI e de evento externo leem do ClickHouse e gravam
o resultado apenas como métrica de execução no MLflow. Não há tabela consultável — nenhuma tela tem
de onde ler o que elas calcularam.

---

## O read model do front

A tela não consulta o pipeline. Ela lê uma projeção de leitura, no formato que ela consome, mantida
separada de como o dado é produzido atrás.

O read model não substitui o warehouse. A divisão é por natureza da consulta:

| O que a tela pede | De onde | Por quê |
|-------------------|---------|---------|
| projeção, previsão, realizado, carga, ruído | read model | agregação cara, resultado pequeno e estável, recalculado periodicamente |
| lista de incidentes com filtro, ordenação e paginação | warehouse | volumoso e exploratório — o recorte é escolhido na hora |
| série histórica com período variável | warehouse | não dá para pré-materializar todas as combinações |

Materializar a lista de incidentes no read model seria transformá-lo em réplica parcial do
warehouse: sincronização constante para um dado que o warehouse já serve bem.

**O desacoplamento vem do gateway, não do banco.** É ele a fronteira — a tela nunca fala com
armazenamento nenhum. Se a lista mudar de tabela, de schema ou de banco por causa da separação de
entradas, quem absorve é o gateway. O read model resolve outra coisa: latência e estabilidade de
formato para o que é caro de calcular. Uma projeção Monte Carlo não roda a cada atualização de tela.

O motivo é de acoplamento, não de desempenho. Separar `alert` de `monitor`, realocar marts, decompor
o evento em ciclo de vida, trocar a base de origem — tudo isso mexe na produção do dado. Com um read
model no meio, nada disso alcança a tela: muda o que alimenta a tabela, não o que a tela consome.

Quem materializa é o gateway, não quem produz:

```
análises      ──▶ publicam resultado ────┐
marts         ──▶ atualizados ───────────┼──▶ gateway ──▶ read model ──▶ front
copiloto      ──▶ publica recomendação ──┘
```

Isso mantém a regra que o resto do sistema já segue: quem produz publica, quem serve materializa.
Nenhum produtor escreve direto no banco de leitura, e nenhum deles precisa saber que a tela existe.

### O que um dashboard de gestão consome

| Painel | De onde vem o número |
|--------|----------------------|
| projeção de fechamento do mês, com intervalo e probabilidade de atingir a meta | análise de projeção de KPI (Monte Carlo) |
| volume esperado para D+1 e D+7 por prioridade | modelo de volume, via serving |
| realizado do mês contra a meta | mart de estado mensal do KPI |
| dias marcados como evento externo | detector de evento externo |
| carga por grupo no momento | mart de carga por janela |
| recursos que concentram repetição de sinal | agregações diárias por entity |

Quatro dos seis já têm mart com dado; dois dependem de as análises ganharem destino consultável.

### As tabelas do read model

| Tabela | Alimentada por | Serve |
|--------|----------------|-------|
| `kpi_projection` | análise de projeção de KPI | projeção de fechamento do mês |
| `external_event_days` | detector de evento externo | dias marcados como anômalos |
| `volume_forecast` | modelo de volume, via serving | previsão D+1 e D+7 |
| `kpi_state` | mart de estado mensal do KPI | realizado contra a meta |
| `group_load` | mart de carga por janela | carga por grupo no momento |
| `noisy_entities` | agregações diárias por entity | recursos que concentram repetição |

Depois, sem mudança estrutural, entram `recommendations` e `actions` — o que o copiloto gerou e o
que o operador decidiu. Já embeddings e auditoria de chamadas de LLM são outra responsabilidade: não
são leitura de tela, e pertencem ao armazenamento do próprio copiloto.

---

## Evidências

Números medidos sobre o histórico, que sustentam o desenho acima.

### O consumo de prazo é um preditor forte por si só

| | P2 (OLA 4h) | P3 (OLA 12h) |
|---|---|---|
| passou de 25% do prazo | 20,6% | 38,4% |
| passou de 50% | 7,7% | 25,6% |
| passou de 75% | 2,9% | 20,2% |
| estourou | 1,1% | 17,5% |
| duração mediana | 26 min | 1h45 |

35% dos incidentes elegíveis (8.922) vivem tempo suficiente para serem reavaliados. Um P3 que
passou de 75% do prazo estoura em 87% dos casos; em 25%, em 46%. Sem modelo nenhum — só tempo
decorrido contra o prazo da prioridade. O `burst-detector` calibrado ficou em 10% de precision.

### Repetição de sinal no mesmo recurso

| IC | ocorrências sem intervenção | % do total dele | duração mediana |
|----|------------------------------|-----------------|-----------------|
| IC00014 | 6.055 | 99,8% | 45s |
| IC00019 | 4.431 | 99,9% | 253s |
| IC00008 | 4.191 | 99,9% | 255s |
| IC00002 | 3.117 | 99,9% | 36s |

Dois terços do histórico (65,6%) são ocorrências que se resolveram sozinhas, e **dez recursos
concentram 31% delas**. 43% fecham em até cinco minutos — a janela de auto-healing descrita no
kickoff.

Isso não muda a natureza da origem nem o lugar do detector de rajada: continuam sendo entrada
`monitor` e detecção de repetição por recurso. O que o dado sugere é **material de análise** — quando
o agente monta a recomendação sobre um alerta desse recurso, ou quando uma análise periódica olha o
conjunto, cabe apontar que a repetição ali tem cara de limiar mal ajustado. É conclusão de saída,
entregue a quem decide, não reclassificação de componente.

### O julgamento da violação, medido

Entre os que estouraram o prazo, quanto foi contado como violação:

| Quanto estourou | Incidentes | Contados |
|-----------------|-----------|----------|
| 1× a 1,5× | 240 | 33,3% |
| 1,5× a 2× | 206 | 12,6% |
| 2× a 3× | 225 | 12,9% |
| 3× a 5× | 201 | 9,0% |
| 5× a 10× | 274 | 8,8% |
| 10× a 50× | 1.021 | 4,6% |
| acima de 50× | 1.478 | 1,6% |
| **total** | **3.645** | **6,8%** |

Três hipóteses de fórmula foram testadas e descartadas: prazo corrido (3.645 previstas contra 248),
prazo em horário útil (3.018 contra 206 em P3) e código de fechamento como filtro (não separa —
de 1% a 33% em todas as categorias). A aritmética das metas fecha: o material de negócio fixa 36 a
39 violações de P2 por ano e 231 a 263 de P3; uma fórmula mecânica produziria quinze vezes isso.

### Duas naturezas de rótulo

| Rótulo | Positivos | Taxa |
|--------|-----------|------|
| violação apurada | 248 | 0,97% |
| prazo estourado | 3.645 | 14,2% |

O desbalanceamento extremo que o material da Sprint 3 trata como desafio central é, em parte,
artefato de treinar contra a apuração. Os dois não competem: um é o alerta do meio do caminho, o
outro é o número que o gestor vê no fim do mês. Treinar contra o prazo puro, porém, traria os 2.499
incidentes acima de dez vezes o prazo — que não são casos que a operação poderia ter salvo.

### Regras que estavam implícitas

- **Duração** = do início até a resolução, ou até o encerramento quando não houve resolução
  registrada. Reproduz 99,6% do histórico.
- **Elegibilidade ao KPI** = prioridades 1 a 3, sem incidente pai, status diferente de sem
  intervenção. Reproduz 99,88%.

---

## Pendências

- **Qual o critério da apuração?** A hipótese de higiene de fila explica o padrão medido, mas não
  foi confirmada com a Locaweb. Se houver desconto de tempo em pausa, o histórico de transições do
  service desk resolveria — e mudaria o que dá para prever.
- **O simulador emite o estado final.** Hoje o incidente chega ao sistema já fechado, com duração
  preenchida. Não existe "continua aberto" para reavaliar, então o fluxo do meio não tem como ser
  demonstrado.
- **O contrato publicado tem nove campos; a camada de dados consome vinte**, os outros onze
  extraídos do payload bruto da origem. Com uma origem que não use os mesmos nomes, a extração
  devolve vazio e nada falha — os agregados ficam populados de zero.
- **Divergência documental:** o material de kickoff registra P4 = 96 horas, o dicionário de dados
  registra 24 horas. P4 não entra no KPI, mas o cálculo de primeiro toque usa esses limites.
