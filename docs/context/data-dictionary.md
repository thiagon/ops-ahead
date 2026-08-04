# Dicionário de Dados — Challenge AIOps Locaweb

**Versão: 2**

> Este documento descreve o **sistema de origem** — os campos do ITSM da Locaweb, no
> vocabulário da ferramenta, e as regras de negócio do KPI. É a autoridade sobre o que cada
> dado significa.
>
> A linguagem da **plataforma** é outra: está em [`domain/`](../../domain/). A tradução
> entre as duas está especificada em [`domain/acl/itsm.md`](../../domain/acl/itsm.md).

---

## Campos do Incidente

| Campo | Descrição | Tipo | Formato / Restrições | Obrigatório | Valores Aceitos |
|-------|-----------|------|----------------------|-------------|-----------------|
| **Número** | Identificador único e sequencial do incidente | Texto | `INCXXXXXXX` (XXXXXXX = número sequencial) | Sim | N/A |
| **Prioridade** | Nível de urgência e impacto do incidente | Texto | `X - aaaaaaa` (X = número, aaaaaaa = texto). Somente prioridades 1, 2 e 3 entram no KPI | Sim | 1-Crítica, 2-Alta, 3-Média, 4-Baixa, 5-Muito Baixa |
| **Produto** | Produto ou serviço afetado pelo incidente | Texto | N/A | Não | N/A |
| **Categoria** | Classificação primária do tipo de incidente | Texto | N/A | Não | N/A |
| **Subcategoria** | Classificação secundária, refinando a Categoria | Texto | Requer Categoria previamente selecionada | Não | N/A |
| **Grupo designado** | Equipe responsável por trabalhar na solução do incidente | Texto | N/A | Sim | N/A |
| **Item de configuração** | Ativo de TI específico que está com o problema | Texto | N/A | Não | N/A |
| **Aberto** | Data e hora exatas em que o incidente foi registrado | Data/Hora | `dd/mm/aaaa hh:mm:ss` | Sim | N/A |
| **Resolvido** | Data e hora em que a equipe técnica determinou que o incidente foi corrigido | Data/Hora | `dd/mm/aaaa hh:mm:ss` | Não | N/A |
| **Encerrado** | Data e hora em que o incidente é finalizado (após confirmação da solução pelo usuário ou período de espera) | Data/Hora | `dd/mm/aaaa hh:mm:ss` | Sim | N/A |
| **Duração** | Tempo total decorrido entre a abertura e a resolução (ou encerramento) | Numérico | Tempo em segundos | Sim | N/A |
| **Código de fechamento** | Razão formal para o encerramento do incidente | Texto | N/A | Não | N/A |
| **Descrição resumida** | Título conciso do incidente, facilitando busca e identificação | Texto | N/A | Sim | N/A |
| **Solução** | Informa se a solução foi definitiva, contorno ou nenhuma | Texto | N/A | Não | Contorno, Definitiva, (em branco) |
| **Aberto por** | Nome e/ou identificação de onde o incidente foi aberto | Texto | N/A | Sim | Manual, Monitoramento |
| **Incidente Pai** | Referência a um incidente anterior relacionado ou duplicado | Texto | `INCXXXXXXX` (XXXXXXX = número sequencial) | Não | N/A |
| **Status** | Ponto atual do incidente no seu ciclo de vida | Texto | N/A | Sim | Aguardando Problema, Encerrado, Encerrado Automaticamente, Sem Intervenção |
| **Entrou para KPI?** | Indica se o incidente deve ser considerado no cálculo dos KPIs | Booleano | SIM / NAO | Sim | N/A |
| **KPI Violado?** | Indica se o tempo de solução excedeu o limite do OLA | Booleano | SIM / NAO | Sim | N/A |

---

## Informações Importantes

### Status: "Sem Intervenção"

A maioria dos incidentes fechados como **Sem Intervenção** estão associados ao campo **Aberto por: Monitoramento**.

### Regras de Exclusão do KPI

Incidentes **não entram no KPI** quando:
- Campo **Incidente Pai** está preenchido
- Campo **Status** = `Sem Intervenção`

> Obs: Incidentes com Status "Sem Intervenção" não entram no KPI, mas podem prejudicar outros incidentes que entraram ou em que o KPI foi violado.

### Tempo de Resolução por Prioridade (campo Duração)

| Prioridade | Limite de Duração |
|------------|-------------------|
| 1 - Crítica | até 4h |
| 2 - Alta | até 4h |
| 3 - Média | até 12h |
| 4 - Baixa | até 24h |
| 5 - Muito Baixa | até 96h |

> KPIs são medidos apenas para prioridades **1 - Crítica**, **2 - Alta** e **3 - Média**.

---

## Metas Anuais de KPI

Indicador medido **mensalmente**.

### Incidentes com OLA Quebrado no Ano (campo Duração)

#### Prioridade 2 - Alta

| Quantidade de Incidentes | % de Atingimento |
|--------------------------|-----------------|
| < 31 | 150% |
| 31 a 35 | 125% |
| 36 a 39 | 100% |
| 40 a 45 | 75% |
| 46 a 53 | 50% |
| > 53 | 0% |

#### Prioridade 3 - Média

| Quantidade de Incidentes | % de Atingimento |
|--------------------------|-----------------|
| < 201 | 150% |
| 201 a 230 | 125% |
| 231 a 263 | 100% |
| 264 a 290 | 75% |
| 291 a 320 | 50% |
| > 320 | 0% |

---

### Volume Total de Incidentes Tratados no Ano

#### Prioridade 2 - Alta

| Quantidade de Incidentes | % de Atingimento |
|--------------------------|-----------------|
| < 4585 | 150% |
| 4585 a 5388 | 125% |
| 5389 a 6168 | 100% |
| 6169 a 6252 | 75% |
| 6253 a 6336 | 50% |
| > 6336 | 0% |

#### Prioridade 3 - Média

| Quantidade de Incidentes | % de Atingimento |
|--------------------------|-----------------|
| < 19489 | 150% |
| 19489 a 22116 | 125% |
| 22117 a 22524 | 100% |
| 22525 a 23892 | 75% |
| 23893 a 24276 | 50% |
| > 24276 | 0% |
