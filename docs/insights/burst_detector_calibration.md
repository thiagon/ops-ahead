# Calibração e decisão sobre o gatilho do detector de rajada

**Data:** 2026-08-17
**Track:** `ml-layer2-gaps_20260817`, Fase 5

## Piso de utilidade — definido antes da varredura

Fixado antes de rodar `apps/ml-burst-detector/scripts/calibrate.py` (`USEFULNESS_FLOOR` no script),
sobre a janela de calibração:

| Métrica | Piso | Por quê |
|---------|------|---------|
| Precision | ≥ 0,15 | Abaixo disso, o N1 gasta a maior parte do tempo investigando alerta falso — o inverso do que o produto promete |
| Recall | ≥ 0,10 | Cobrir pelo menos 1 em cada 10 P1/P2 reais já justifica o detector como sinal auxiliar; abaixo disso ele não pega quase nada do que deveria |
| Lead-time mediano | ≥ 900s (15min) | O mesmo piso de `MIN_LEAD_TIME_SECONDS` — já é o teto de ação do N1 (`docs/insights/03-mentoria-insights.md`); exigir menos que isso do *mediano* aceitaria um detector cujo "sucesso" típico já não dá tempo real de ação |

Varredura: `Z_SCORE_THRESHOLD` ∈ {2,5 · 3,5 · 4,5}, `CUSUM_K` ∈ {0,5 · 1,0}, `CUSUM_H` ∈ {3,0 · 5,0},
`MIN_ROBUST_STD` ∈ {1,0 · 2,0}, janelas ∈ {todas · só 15m · só 1h · só 6h} — 96 combinações, todas na
janela de calibração (85.780 linhas).

## Resultado da varredura

**0 de 96 combinações atingem o piso.** Top 10 por recall (janela de calibração, 85.780 linhas):

| Z | K | H | MIN_ROBUST_STD | Janelas | Alertas | Precision | Recall | Lead-time |
|---|---|---|-----------------|---------|---------|-----------|--------|-----------|
| 2,5 | 0,5 | 3,0 | 1,0 | 15m,1h,6h | 17.873 | 0,032 | 0,016 | 1.647s |
| 3,5 | 0,5 | 3,0 | 1,0 | 15m,1h,6h | 17.656 | 0,032 | 0,016 | 1.632s |
| 4,5 | 0,5 | 3,0 | 1,0 | 15m,1h,6h | 17.656 | 0,032 | 0,016 | 1.632s |
| 2,5 | 0,5 | 5,0 | 1,0 | 15m,1h,6h | 13.983 | 0,038 | 0,016 | 1.618s |
| 2,5 | 1,0 | 3,0 | 1,0 | 15m,1h,6h | 12.865 | 0,039 | 0,014 | 1.618s |
| 2,5 | 1,0 | 5,0 | 1,0 | 15m,1h,6h | 10.926 | 0,045 | 0,014 | 1.599s |
| 3,5 | 0,5 | 5,0 | 1,0 | 15m,1h,6h | 12.441 | 0,036 | 0,014 | 1.579s |
| 4,5 | 0,5 | 5,0 | 1,0 | 15m,1h,6h | 12.264 | 0,036 | 0,014 | 1.552s |
| 2,5 | 0,5 | 3,0 | 1,0 | 6h (só) | 13.252 | 0,021 | 0,013 | 1.649s |
| 2,5 | 0,5 | 3,0 | 2,0 | 15m,1h,6h | 14.521 | 0,031 | 0,013 | 1.595s |

O melhor recall obtido (0,016) fica a 6× do piso (0,10); a melhor precision entre esses (0,045) fica a
3× do piso (0,15). Nenhuma combinação de janela isolada (só 15m, só 1h, só 6h) supera a combinação das
três — restringir a uma única janela sempre piora recall sem melhorar precision o suficiente para
compensar. `Z_SCORE_THRESHOLD` tem efeito quase nulo (linhas 2 e 3 empatam, threshold 3,5 vs 4,5); quem
move o resultado é `CUSUM_H` (mais alto → menos alertas, precision um pouco melhor, recall pior) — o
que já era visível na curva achatada da Fase 4.

## Decisão

**Nenhum operating point atinge o piso.** O detector de rajada, na configuração atual (z-score +
CUSUM sobre contagem de "Sem Intervenção" por IC), não separa sinal de ruído o suficiente nos
parâmetros testados — em qualquer ponto da grade, a maioria dos alertas é falsa e a cobertura dos
P1/P2 reais é marginal.

**Parâmetros em produção ficam congelados nos valores atuais** (`Z_SCORE_THRESHOLD=3,5`, `CUSUM_K=0,5`,
`CUSUM_H=5,0`, `MIN_ROBUST_STD=1,0`, três janelas) — não há candidato melhor para trocar. O resultado na
janela de avaliação com esses parâmetros já está em `docs/insights/burst_detector_methodology.md`:
precision 0,003, recall 0,006, lead-time mediano 1.506s.

**Consequência para o fluxo: nenhuma.** O detector de rajada segue sendo o gatilho do fluxo que a
seção 4 de `docs/sprints/sprint-2-architecture.md` define — decisão do usuário em 2026-08-17, ao
revisar esta calibração. O resultado acima não diz que o componente não deve existir nem que o desenho
está errado; diz que o sinal, na configuração e no dado disponíveis hoje, ainda não entrega a precisão
que o produto promete. As duas leituras têm consequências diferentes: trocar o gatilho seria mudar a
arquitetura por causa de um número; mantê-lo trata o número como o que ele é — trabalho de modelagem em
aberto.

**Caminhos para a Sprint 4**, em ordem de custo:

1. **Contagem por IC é fraca demais como base.** 67,5% das janelas têm histórico flat (0-1 incidente por
   bucket de 15min) — a estatística robusta não tem de onde extrair sinal. Agregar por grupo designado
   ou por família de IC daria série mais densa.
2. **O sinal pode não estar na contagem de "Sem Intervenção" isolada**, e sim na composição (share de
   P4 crescente + abertura manual + carga do grupo). O modelo de breach já usa essas features e é
   supervisionado sobre o outcome que importa — vale medir quanto o breach score sozinho antecipa P1/P2,
   como referência de comparação para o detector.
3. **A janela de 15min pode ser curta** para o fenômeno: se a rajada se desenvolve em horas, buckets
   maiores com CUSUM captariam a mudança de regime melhor do que z-score sobre bucket curto.
