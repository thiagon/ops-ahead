# Insights: Mentoria Locaweb x Dataset

**Fonte:** `transcricao_mentoria_locaweb.txt` cruzada com `incidents.csv` e [02-kickoff-insights.md](02-kickoff-insights.md)

---

## Hierarquia do Escopo: Previsibilidade e o Resto

Douglas reordenou o escopo do challenge na mentoria, contrariando a ordem do documento original:

1. **Previsibilidade de volume D+1 e D+7** — prioridade absoluta
2. **Tendencia de perda/atingimento de OLA** — segundo
3. **Clusterizacao de incidentes** — terceiro, "exemplificativo"

> *"Se a gente tiver que decidir a priorizacao das tarefas, o numero um e o principal. E a previsibilidade dos incidentes D mais um e D mais sete."*

A previsao temporal e o entregavel inegociavel.

---

## Probabilidade e Atingimento de KPI

Esta foi a tese matematica central da mentoria — nao esta na ata do kickoff.

> *"Se eu perdi um incidente no dia 1, a minha probabilidade de atingimento daquele mes de OLA diminui muito. E muito diferente eu ter a perda do incidente no dia um do que eu perder o incidente no dia 28."*

A faixa de 100% do KPI de violacao de OLA P2 esta entre **36 e 39 incidentes ao ano** (≈3/mes). A leitura nao e binaria ("perdeu/atingiu"), e probabilistica:

- Perda no inicio do mes consome o "orcamento" cedo e reduz probabilidade de fechar o mes em 100%
- Perda no fim do mes preserva probabilidade
- O modelo deve estimar: dado o ritmo atual de perdas, qual a probabilidade de fechar em 100%, 125%, 150%?

Volume de P2 dentro de 100% do KPI: **5.389 a 6.168 incidentes/ano**.

Os dois eixos (volume e perda de OLA) sao calculos de probabilidade independentes que vao no dashboard.

---

## P4 e o Precursor de P2

> *"Eu tenho um P4 50% de disco em uso, depois ele 25% de disco sobrando, depois 10%, 5%. Isso, se continuar a gerar esse dente, vai gerar um P2 automaticamente porque houve impacto para o cliente real."*

Padrao operacional concreto para feature engineering:

- P4 e quase exclusivamente monitoramento de threshold (disco, memoria, CPU, ping)
- Thresholds escalonam: 70% abre P4, 80% abre P4, 90% pode abrir P2 ou P3
- **Sequencias crescentes de P4 no mesmo IC sao preditoras de P2 iminente**

Complementa o sinal ja documentado no kickoff (sucessao de "Sem Intervencao" em um mesmo IC).

---

## Duas Visoes Distintas no Dashboard

Douglas separou claramente o que ele espera ver:

| Visao | Pergunta que responde | Natureza |
|-------|----------------------|----------|
| Previsibilidade | O que vai acontecer amanha e em 7 dias? | Preditiva ("mae Dinah") |
| Atingimento de KPI | Onde estou agora no meu KPI? Vou fechar o mes? | Probabilistica/projetiva |

Ambas em **near real-time** — nao real-time, porque a fonte sera o ITSM da Locaweb conectado ao sistema entregue, nao streaming direto.

Forma do entregavel: dashboard navegavel, agnostico de cloud. Sugestao mencionada: **Docker** para portabilidade.

---

## PPR Esta Atrelado a Quatro KPIs Independentes

A ata ja registrava que OLA afeta o bonus. A mentoria detalhou a estrutura:

| KPI | Dimensao |
|-----|----------|
| Volume de P2/mes | Quantidade |
| Volume de P3/mes | Quantidade |
| Perda de OLA P2/mes | Qualidade |
| Perda de OLA P3/mes | Qualidade |

> *"A gente nao atingiu um daqueles, zera aquela porcentagem dentro do PPR do colaborador."*

Cada KPI tem peso proprio. **Falhar em um zera a fatia correspondente** — nao ha compensacao entre dimensoes. Por isso o modelo precisa monitorar as quatro projecoes simultaneamente, nao um indicador agregado.

---

## Recategorizacao Existe e e Permitida

A regra de Nov/2024 (documentada no kickoff) proibe repriorizar P2 abertos automaticamente. Mas a **recategorizacao em escalonamento** continua valida:

> *"Pode acontecer do suporte entender que esse incidente esta causando um problema muito maior do que ele e. Ele pode mudar de categoria de P3 para P2. A mesma coisa P2 pode virar um P1."*

Isso significa:

- Subir prioridade (P3→P2, P2→P1) e operacionalmente comum
- O incidente permanece no KPI, so muda de categoria
- O unico P1 do dataset provavelmente comecou como P2 e foi escalado por impactar multiplos produtos simultaneamente

---

## Pico de Setembro 2025: O Desafio Aberto

> *"Esse e o trabalho que voces vao ter que fazer. A gente sabe o que aconteceu, mas voces vao ter que passar para a gente."*

Douglas confirmou que **sabe** a causa do pico de setembro mas nao vai revelar — explicabilidade do evento e parte do entregavel. Pistas dadas:

- **Nao foi Black Friday** — a Locaweb nao sofre com BF (Tray e Wake do grupo sofrem, Locaweb nao)
- Provavel candidato: cliente VPS com e-commerce sofrendo aumento de trafego
- O caminho de investigacao e analisar IC e produto especificos no periodo

A entrega tem que provar a hipotese, nao apenas apresenta-la.

---

## Limites do Dataset Reconhecidos por Douglas

Pontos onde a Locaweb sabe que o dado e insuficiente:

| Limitacao | Origem |
|-----------|--------|
| **Descricao completa removida** | Anonimizacao falhou (nomes de cliente, IPs, hostnames). So restou descricao resumida |
| **Gatilhos externos invisiveis** | registro.br, Enon (SSL), operadoras de link, CrowdStrike — influenciam OLA mas nao tem flag no dataset |
| **Encadeamento humano de incidente pai** | A associacao filho→pai e feita manualmente pelo N1, nao pelo monitoramento. So o pai entra no KPI |
| **Abertura manual ~14-15%** | Quando suporte abre porque o monitoramento nao pegou — sinaliza buraco de observabilidade |

Implicacoes:

- NLP profundo na descricao tem teto baixo — texto pouco informativo
- Picos sem causa interna identificavel podem ser eventos externos que o modelo nunca vai aprender
- Features de "abertura manual em alto volume" podem indicar degradacao do monitoramento, nao do servico

---

## Sazonalidade Horaria Confirmada

> *"A gente sabe que 10 da manha tem pico. Existe overlap maior de profissionais entre 10 e 16."*

- Janela de pico operacional: **10h-16h**
- Operacao normal: 06h-22h
- Plantao: **22h-06h** (nao 18h como ele inicialmente falou)
- N1 e N2 sao 24/7 efetivo; N3 e acionamento sob plantao

Hora-do-dia como feature ja tem suporte explicito da operacao.

---

## Regra de Escalonamento Interno do N1

Douglas revelou um numero que nao esta no dataset mas explica o comportamento:

- N1 pode "cozinhar" o incidente ate **25% do OLA** antes de escalar (1h em P2 de 4h)
- Na operacao real da Locaweb, esse limite e mais apertado: **15 minutos**
- Acima disso, o incidente passa para N2 ou N3 obrigatoriamente

Isso explica o padrao no dataset: incidentes resolvidos rapido tendem a ficar no Team14; demoras saem dele.

---

## Eventos Externos Catastroficos Reais

Citados como exemplos de causa de violacao de OLA que o dataset nao consegue capturar:

- **AWS fora** — Locaweb teve servico afetado por usar AWS em parte da stack
- **CrowdStrike 2024** — 800-900 servidores Windows da Locaweb fora simultaneamente, mundial, sem rollback possivel
- **registro.br fora** — bloqueia venda de dominios nacionais

Esses eventos aparecem como anomalias inexplicaveis no dataset. O modelo deve trata-los como outliers em vez de tentar prever — sao ruido externo, nao sinal.
