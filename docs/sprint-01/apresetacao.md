# **Roteiro de Apresentação \- SPRINT 1: Ideação do Projeto (Locaweb Challenge 2026\)**

## **SLIDE 1: Capa**

_Insira aqui o padrão visual da sua equipe._

- **Nome da Equipe:** \[Insira o nome da sua equipe, ex: DataOps Innovators\]
- **Membros e RM:**
  - \[Nome do Aluno 1\] \- RM: \[00000\]
  - \[Nome do Aluno 2\] \- RM: \[00000\]
  - \[Nome do Aluno 3\] \- RM: \[00000\]
  - \[Nome do Aluno 4\] \- RM: \[00000\]
  - \[Nome do Aluno 5\] \- RM: \[00000\]

_(Dica: Adicione uma foto de cada integrante para gerar mais empatia com os avaliadores)._

## **SLIDE 2: Nome da Solução/Projeto**

_Crie um logotipo simples usando ferramentas gratuitas (como Canva) para ilustrar este slide._

- **Nome Escolhido:** **Ops Ahead** — operação à frente, visão antecipada.
- **Slogan sugerido:** _Veja o incidente antes que ele aconteça_
- **Conceito Visual:** Uma seta apontando para frente sobre uma linha do tempo de incidentes, representando a transição de reativo para preditivo.

## **SLIDE 3: Contextualização do Problema**

_(Dica: Use ícones para representar a escala da Locaweb)._

A Locaweb opera uma infraestrutura crítica colossal, onde cerca de **1/3 do tráfego da internet brasileira** passa por seus servidores (3.4 milhões de caixas de e-mail e 500 mil sites hospedados).

- **Operação 24x7:** A equipe BOPE (Baseline Operation) atua em três níveis (N1, N2 e N3) para tratar incidentes severos.
- **Metas Agressivas (OLA):** Incidentes P1 e P2 exigem resolução em até 4 horas.
- **O Peso do OLA:** A margem de erro anual é minúscula (\~36–39 quebras de P2 para atingir 100% da meta). O não cumprimento impacta diretamente o bônus anual dos colaboradores.

## **SLIDE 3.1: O que os dados já nos mostram**

_(Dica: Use números grandes e destaque visual — este slide mostra que o grupo já conhece a operação.)_

Análise preliminar dos **122.543 incidentes** do dataset:

| Dado | Número | O que significa |
| :--- | :--- | :--- |
| Incidentes "Sem Intervenção" | **65.6%** do total | Auto-healing resolve a maioria, mas esses eventos são descartados — e poderiam ser sinais preditivos |
| Abertos por monitoramento | **85%** | Dados já nascem estruturados e prontos para modelagem |
| Concentração no Team14 (N1) | **75.7%** do volume | Gargalo operacional claro — um único time absorve 3/4 da carga |
| Violações de OLA | **248** (1% do KPI) | O problema não é volume de falhas, é a imprevisibilidade das poucas que importam |
| Incidentes < 60 segundos | **18%** | Ruído que hoje compete por atenção com incidentes reais |

## **SLIDE 4: Problema a ser Resolvido**

_(Dica: Destaque a palavra "Reativa" neste slide)._

A operação hoje é **reativa** — age-se após a falha. Com base nos dados, identificamos quatro problemas centrais:

- **Picos não antecipados:** O volume varia \~30% entre dias úteis e fins de semana, com pico entre 9h–16h, mas essa sazonalidade não alimenta previsão de escala.
- **Sinais preditivos desperdiçados:** As 80 mil ocorrências anuais de "Sem Intervenção" são descartadas do KPI, mas rajadas desses eventos em um mesmo IC são o principal indicador de falha P2 iminente. Ninguém monitora isso.
- **Risco de OLA invisível:** Os 248 breaches representam apenas 1% do volume KPI, mas cada um pressiona as metas de atingimento. A equipe só descobre a violação depois que o prazo estourou.
- **Concentração sem resposta:** O Team14 absorve 75.7% dos incidentes e apenas 3 servidores de monitoramento de aplicações concentram \~11% do volume. Não existe mecanismo para redistribuir antes da sobrecarga.

## **SLIDE 5: Público-Alvo**

| Nível          | Público                               | Como se Beneficia                                                                    |
| :------------- | :------------------------------------ | :----------------------------------------------------------------------------------- |
| **Primário**   | **Equipe BOPE (N1/N2/N3)**            | Antecipação de picos, priorização proativa e redução do estresse operacional.        |
| **Secundário** | **Gestores Operacionais e Diretoria** | Decisões de alocação de equipe (escala) embasadas em dados, acompanhamento de metas. |
| **Indireto**   | **Clientes Locaweb**                  | Redução drástica do tempo de indisponibilidade dos serviços (Downtime).              |

## **SLIDE 6: Proposta de Solução (Como será resolvido)**

_(Dica: Desenhe um diagrama simples de 3 blocos ou use ícones de engrenagem, cérebro e painel para ilustrar)._

O **Ops Ahead** atua em três camadas integradas e é _cloud-agnostic_:

1. **Camada de Dados (Pipeline):**
   - Ingestão contínua do ITSM.
   - Enriquecimento com _features_ temporais (sazonalidade, turno) e frequência.
   - Filtro de ruídos (falsos positivos e incidentes automáticos vs. manuais).
2. **Camada de Inteligência (Modelos Preditivos):**
   - _Previsão de Volume:_ Projeta incidentes para amanhã (D+1) e próxima semana (D+7).
   - _Risco de Breach (OLA):_ Calcula probabilidade de estourar prazos.
   - _Detecção de Rajada:_ Alerta quando um IC entra em trajetória de falha grave.
3. **Camada de Decisão (Interfaces):**
   - _Painel Operacional (N1/N2):_ Alertas de rajada e risco de breach em tempo real.
   - _Painel Tático (Gestores):_ Projeção de volume e indicadores para escala da equipe.

## **SLIDE 7: Impactos da Solução**

_(Dica: Divida em 4 quadrantes visuais)_

- **📈 Impacto Operacional:** Transição definitiva de uma postura reativa (apagar incêndios) para proativa (prevenir incêndios). Alocação inteligente da força de trabalho antes dos picos.
- **💰 Impacto Financeiro (Equipe):** Proteção direta do bônus anual dos colaboradores BOPE, garantindo o cumprimento rígido das metas de OLA.
- **🤝 Impacto no Cliente:** Maximização do _uptime_, entregando uma experiência de serviço mais fluida e confiável com a infraestrutura Locaweb.
- **📊 Impacto na Gestão:** Tomada de decisão baseada em dados reais e projeções matemáticas, eliminando a dependência do "feeling" ou intuição individual.

## **SLIDE 8: Benefícios Esperados**

_(Dica: Divida em dois blocos — "Operacionais" à esquerda, "Estratégicos" à direita)._

**Operacionais:**
- **Cumprimento de Metas:** Redução de breaches de OLA através de ação preventiva sobre incidentes de alto risco.
- **Desafogamento do N1:** O Team14 absorve 75.7% da carga — com previsão de picos, é possível redistribuir antes da sobrecarga.
- **Filtragem de ruído:** 18% dos incidentes duram menos de 60s. Separar ruído de sinal libera a equipe para focar no que importa.

**Estratégicos:**
- **Planejamento de capacidade:** Projeções de volume fundamentam decisões de contratação, escala de plantão e orçamento com dados, não estimativas.
- **Redução de turnover:** Pressão constante de OLA gera desgaste. Previsibilidade reduz urgência e dá controle à equipe.
- **Preservação de conhecimento:** Padrões capturados pelo modelo documentam o que hoje só existe na cabeça de operadores veteranos.
- **Evolução do auto-healing:** Ao revelar quais "Sem Intervenção" precedem falhas graves, a solução aponta onde investir em automação mais eficaz.

## **SLIDE 9: Comparativo com a Concorrência**

_(Crie uma tabela visualmente atraente no PPT. Coloque o Ops Ahead com "Checks" verdes em tudo)._

| Funcionalidades / Solução              | Ops Ahead | PagerDuty AIOps | Moogsoft | BigPanda | Dynatrace AI |
| :------------------------------------- | :-------- | :-------------- | :------- | :------- | :----------- |
| **Projeção de Volume (D+1 / D+7)**     | ✅        | ❌              | ❌       | ❌       | ❌           |
| **Rajada como Indicador Antecedente**  | ✅        | ❌              | ❌       | ❌       | ❌           |
| **Projeção de Quebra de OLA (Breach)** | ✅        | ❌              | ❌       | ❌       | ❌           |
| **Explicabilidade para Alocação**      | ✅        | ❌              | ❌       | ❌       | ❌           |
| Correlação e Supressão de Alertas      | ✅        | ✅              | ✅       | ✅       | ✅           |
| Análise de Causa Raiz (RCA)            | ✅        | ✅              | ✅       | ✅       | ✅           |

_O grande diferencial do Ops Ahead é o salto da análise de tempo real (o que está quebrando agora) para a **previsão temporal** (o que vai quebrar amanhã)._

## **SLIDE 10: Finalização e Agradecimentos**

**O Futuro da Operação de TI é Preditivo.**

Com o **Ops Ahead**, a Locaweb não apenas reage mais rápido, mas se antecipa ao problema.

**Obrigado\!**

\[Deixe os contatos do grupo, LinkedIn dos membros, ou e-mail do representante\]
