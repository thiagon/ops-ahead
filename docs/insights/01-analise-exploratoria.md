# Analise Exploratoria — Dataset Locaweb AIOps

**Base:** `assets/material/incidents.csv`
**Total de registros:** 122.543
**Periodo:** 2023-01-02 a 2025-12-31

---

## Volume

- Media de **190 incidentes/dia**, com desvio padrao de 298 — ha dias com 1 incidente e dias com 1.431
- Distribuicao muito assimetrica entre os anos: 2023 (110), 2024 (622), 2025 (121.811)

---

## Distribuicao de Prioridade

| Prioridade | Total | % do Total |
|------------|-------|------------|
| 4 - Baixa | 64.828 | 52,9% |
| 3 - Media | 41.732 | 34,0% |
| 2 - Alta | 15.649 | 12,8% |
| 5 - Muito Baixa | 333 | 0,3% |
| 1 - Critica | 1 | ~0% |

- Mais da metade dos incidentes sao P4
- P2 e P3 juntos representam **46,8%** do volume total

---

## Status dos Incidentes

| Status | Total | % |
|--------|-------|---|
| Sem Intervencao | 80.373 | 65,6% |
| Encerrado Automaticamente | 26.830 | 21,9% |
| Encerrado | 15.339 | 12,5% |
| Aguardando Problema | 1 | ~0% |

- **65% dos incidentes tem status "Sem Intervencao"**
- Apenas 12,5% passam por encerramento manual

---

## Origem dos Incidentes

| Aberto Por | Total | % |
|------------|-------|---|
| Monitoramento | 104.299 | 85,1% |
| Manual | 18.244 | 14,9% |

- **85% dos incidentes sao abertos por Monitoramento**, 15% manualmente

---

## KPI e Violacoes de OLA

- **25.600 incidentes (20,9%)** entram no calculo de KPI
- **96.943 (79,1%)** nao entram — excluidos por `Sem Intervencao`, `Incidente Pai` preenchido ou prioridade 4/5

| Prioridade | Entrou KPI | Violou OLA | % Violacao |
|------------|-----------|------------|------------|
| 2 - Alta | 5.159 | 42 | 0,81% |
| 3 - Media | 20.441 | 206 | 1,01% |

- Taxa de violacao de OLA proxima a 1% nos incidentes que entraram no KPI

---

## Concentracao por Time

| Time | Incidentes | % do Total |
|------|-----------|------------|
| Team14 | 92.775 | 75,7% |
| Team11 | 9.790 | 8,0% |
| Team05 | 9.276 | 7,6% |
| Team09 | 3.425 | 2,8% |
| Team12 | 2.173 | 1,8% |
| Outros | 3.104 | 2,5% |

- **Team14 concentra 3 em cada 4 incidentes** — distribuicao fortemente desbalanceada entre os times

---

## Sazonalidade

### Por Dia da Semana

| Dia | Incidentes |
|-----|-----------|
| Quarta-feira | 19.964 |
| Terca-feira | 19.482 |
| Segunda-feira | 19.070 |
| Quinta-feira | 18.806 |
| Sexta-feira | 18.170 |
| Sabado | 14.432 |
| Domingo | 12.619 |

- Volume decresce ao longo da semana — pico na quarta, vale no domingo
- Fins de semana representam **22% do volume total** — operacao nao para

### Por Hora do Dia (Top 10)

| Hora | Incidentes |
|------|-----------|
| 09h | 6.428 |
| 10h | 6.356 |
| 11h | 6.294 |
| 15h | 6.124 |
| 14h | 5.624 |
| 12h | 5.617 |
| 00h | 5.609 |
| 16h | 5.465 |
| 17h | 5.399 |
| 13h | 5.188 |

- Pico principal: **9h–11h**
- **00h aparece em 7º lugar com 5.609 incidentes** — volume expressivo fora do horario comercial

---

## Duracao por Prioridade

| Prioridade | Mediana (s) | Media (s) | Maximo (s) | Maximo aprox. |
|------------|-------------|-----------|------------|---------------|
| 2 - Alta | 1.799 | 3.278 | 1.906.572 | ~22 dias |
| 3 - Media | 2.310 | 585.852 | 88.280.481 | ~1.022 dias |
| 4 - Baixa | 330 | 88.367 | 72.574.343 | ~840 dias |

- A mediana e muito mais representativa que a media — ha incidentes com duracao de anos
- P4 tem mediana de apenas 330s (~5 min), mas media de 88.367s — fortemente puxada pelos valores extremos

---

## Incidentes de Curta Duracao (Ruido de Rede)

| Duracao | Total | % do Dataset |
|---------|-------|--------------|
| Menos de 60 segundos | 22.010 | 17,96% |

Por prioridade:
| Prioridade | Total < 60s |
|------------|-------------|
| 4 - Baixa | 20.225 |
| 3 - Media | 1.699 |
| 2 - Alta | 86 |

- Quase 1 em cada 5 incidentes dura menos de 1 minuto
