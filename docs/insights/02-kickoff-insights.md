# Insights: Ata de Kickoff x Dataset

**Fonte:** `ata_kickoff_challenge_locaweb.md` cruzada com `incidents.csv`

---

## Escala da Operacao

- **3,4 milhoes de caixas de e-mail** e **500 mil sites hospedados**
- **~1/3 do trafego da internet brasileira** passa pela infraestrutura da Locaweb
- Qualquer instabilidade tem impacto direto em uma parcela significativa dos usuarios brasileiros de internet

---

## KPI tem Impacto Financeiro Real

- O nao cumprimento das metas de OLA **impacta diretamente o bonus anual** dos colaboradores
- P1 e P2 compartilham a mesma meta: **maximo 3 violacoes por mes combinadas**
- Isso explica a baixa taxa de violacao (~1%) no dataset — ha pressao real para manter os numeros

---

## Team14 e o N1 Humano, nao um Bot

O alto volume do Team14 (75,7% dos incidentes) gera a impressao de automacao, mas:

- E composto por **humanos** — o nivel N1 de suporte operacional
- E o **"balde padrao"** de entrada de todos os alertas do monitoramento automatico
- Atua em P2, P3 e P4 — faz triagem e resolve manualmente quando o auto-healing falha
- Meta interna: resolver **80% dos casos em 1 hora** (atualmente em 74%)

| Metrica do Team14 | Valor |
|-------------------|-------|
| Total de incidentes | 92.775 (75,7%) |
| Resolvidos pelo auto-healing (Sem Intervencao) | 75.567 (81,5%) |
| Encerrados manualmente | 5.916 (6,4%) |

---

## Auto-Healing: Como o Sistema Opera

1. Monitoramento detecta falha e abre incidente automaticamente
2. Sistema tenta resolver sozinho em ate **5 minutos**
3. Se resolver: incidente fechado como **"Sem Intervencao"**
4. Se nao resolver: permanece aberto para o Team14

Isso explica os **80.373 incidentes "Sem Intervencao"** (65,6%) — sao falhas que o proprio sistema corrigiu.

---

## O Principal Sinal Preditivo de P2

A ata revela o padrao operacional mais importante para o modelo:

> *"Falhas sucessivas 'Sem Intervencao' em um curto espaco de tempo em um mesmo Item de Configuracao (IC) sao o principal indicador de que uma queda P2 esta iminente."*

Os ICs com maior volume de falhas auto-resolvidas no dataset:

| Item de Configuracao | Sem Intervencao |
|----------------------|-----------------|
| IC00014 | 6.055 |
| IC00019 | 4.431 |
| IC00008 | 4.191 |
| IC00002 | 3.117 |
| IC00325 | 1.539 |

- IC00014 sozinho representa quase **8% de todas as falhas auto-resolvidas**
- Esses ICs sao os candidatos naturais para features de frequencia em janelas temporais curtas

---

## Incidentes de Curta Duracao Sao Ruido de Rede

A ata confirma que incidentes de duracao infima sao conhecidos pela operacao como ruidos:

- **22.010 incidentes (18%) duram menos de 60 segundos**
- Sao uma caracteristica do ambiente, nao erros de dados
- Os 86 casos P2 com menos de 60s merecem atencao especial — P2 raramente seria auto-resolvido tao rapido

---

## Anomalia: 49 P2 com "Encerrado Automaticamente"

A ata afirma que em incidentes P2 *"o sistema nunca encerra o chamado sozinho"* — exige validacao humana. Os dados mostram 49 registros contrariando essa regra. Pode indicar:

- Excecoes operacionais nao documentadas
- Comportamento anterior a alguma mudanca de processo
- Casos de repriorização pos-fechamento

---

## Regra de Repriorizacao Desde Nov/2024

Por ordem da diretoria, **e proibido repriorizar manualmente incidentes P2** abertos automaticamente. Na pratica:

- Os dados de 2025 refletem a **prioridade original atribuida pelo monitoramento**, sem interferencia humana
- A visibilidade de P2 e garantida — nao ha downgrade para P3 para "limpar" o KPI
- Isso torna os dados de 2025 mais confiaveis para modelagem de P2 do que periodos anteriores
