# **Ata de Reunião: Kickoff Challenge Locaweb – FIAP+ (AIOps)**

## **1\. Contexto e Cenário Operacional**

A Locaweb opera um ecossistema crítico onde a estabilidade é o pilar do negócio:

- **Escala:** 3.4 milhões de caixas de e-mail, 500 mil sites hospedados e o Locaweb Cloud.
- **Relevância:** Cerca de 1/3 do tráfego da internet brasileira passa pela infraestrutura da empresa.
- **Equipa Operacional ("BOPE"):** A área de _Baseline Operation_ trata incidentes escalados além do suporte básico, dividida em níveis N1, N2 e N3.

## **2\. O Desafio e o Dataset**

O objetivo é utilizar Machine Learning para prever incidentes e identificar tendências de falhas antes que elas impactem o cliente final.

- **Volume:** Dataset com mais de 120 mil linhas (dados de 2025 e volume imputado).
- **Tratamento de Dados:** \* Anonimização via IA para proteção de dados sensíveis.
  - **Exclusão Crítica:** Aproximadamente **100 incidentes de segurança** (ataques hacker) foram removidos, pois a IA não conseguiu garantir a anonimização total das descrições.

## **3\. Definições de SLA e KPIs (Impacto Financeiro)**

O não cumprimento das metas de tempo (OLA) impacta diretamente o bônus anual dos colaboradores.

| Prioridade | Definição                                         | Prazo de Resolução | Meta de Erro (Mensal) |
| :--------- | :------------------------------------------------ | :----------------- | :-------------------- |
| **P1**     | Crítico (ex: Falha de operadora/backbone)         | 4 Horas            | Máximo 3 (P1+P2)      |
| **P2**     | Grave (ex: Serviço fora do ar para um grupo)      | 4 Horas            | Máximo 3 (P1+P2)      |
| **P3**     | Médio (Degradação de performance)                 | 12 Horas           | Tabela interna        |
| **P4**     | Baixo (Dúvida ou problema pontual)                | 96 Horas           | N/A                   |
| **P5**     | Muito Baixo (Geralmente falha do próprio cliente) | 96 Horas           | N/A                   |

## **4\. Lógica de Operação e Automatização**

- **Auto-healing:** O sistema de monitorização tenta resolver falhas automaticamente antes de gerar alerta humano. Se o serviço estabilizar em até 5 minutos, o incidente é fechado sem intervenção.
- **Gatilhamento Preditivo:** Falhas sucessivas "Sem Intervenção" em um curto espaço de tempo em um Item de Configuração (IC) são o principal indicador de que uma queda P2 está iminente.
- **Regra de Repriorização (Nov/2024):** Por ordem da diretoria, é terminantemente proibido repriorizar manualmente incidentes **P2** abertos automaticamente. Eles devem ser mantidos como P2 para garantir a visibilidade do incidente.

## **5\. Destaques da Sessão de Q\&A (Esclarecimentos Cruciais)**

### **O Caso do Team 14 (Nível 1\)**

- **Natureza Humana:** Ao contrário do que se supunha inicialmente, o **Team 14 é composto por humanos**. Ele representa o primeiro nível (N1) de suporte operacional.
- **Por que o alto volume?** Sendo o N1, é o "balde" padrão onde caem todos os incidentes abertos automaticamente pelo monitoramento.
- **Atuação:** O Team 14 atua em incidentes P2, P3 e P4. Embora muitos chamados no dataset apareçam como "Sem Intervenção" (resolvidos pelo robô), o time é responsável pela triagem e resolução manual quando o _auto-healing_ falha.
- **Métricas de Eficiência:** A meta de resolução do N1 é de **1 hora**. Atualmente, resolvem 74% dos casos, com meta de atingir 80% até 2026\.

### **Detalhes Técnicos Adicionais**

- **Status "Resolvido" vs "Encerrado":** Em incidentes graves (P2), o sistema nunca encerra o chamado sozinho. Ele marca como "Resolvido" após a correção técnica, mas o encerramento final exige validação humana (técnico ou cliente).
- **Itens de Configuração (IC) Vazios:** Ocorrem quando a ferramenta de monitoramento deteta a falha, mas não consegue identificar o ID específico do componente no milissegundo da abertura.
- **Falsos Positivos:** Incidentes de duração ínfima (ex: 14 segundos) são considerados ruídos de rede e devem ser tratados como tal na limpeza do modelo.
