import pandas as pd
from pathlib import Path

INPUT = Path("assets/material/LW-DATASET.xlsx")
OUTPUT = Path("assets/material/incidents.csv")

df = pd.read_excel(INPUT)

# Renomear colunas para snake_case sem caracteres especiais
df.columns = [
    "numero",
    "prioridade",
    "produto",
    "categoria",
    "subcategoria",
    "grupo_designado",
    "item_configuracao",
    "aberto_em",
    "resolvido_em",
    "encerrado_em",
    "duracao_segundos",
    "codigo_fechamento",
    "descricao_resumida",
    "solucao",
    "aberto_por",
    "incidente_pai",
    "status",
    "entrou_kpi",
    "kpi_violado",
]

# Booleans: SIM/NAO → 1/0 (int para compatibilidade ampla com SQL/BI)
df["entrou_kpi"] = (df["entrou_kpi"] == "SIM").astype(int)
df["kpi_violado"] = df["kpi_violado"].map({"SIM": 1, "NAO": 0})  # preserva NaN

# Extrair código numérico da prioridade (ex: "3 - Média" → 3)
df["prioridade_codigo"] = df["prioridade"].str.extract(r"^(\d)").astype("Int64")
df["prioridade_label"] = df["prioridade"].str.extract(r"^\d - (.+)$")
df = df.drop(columns=["prioridade"])

# Duração: adicionar colunas derivadas úteis para análise
df["duracao_minutos"] = (df["duracao_segundos"] / 60).round(2)
df["duracao_horas"] = (df["duracao_segundos"] / 3600).round(4)

# Features temporais derivadas do campo aberto_em
df["aberto_data"] = df["aberto_em"].dt.date
df["aberto_hora"] = df["aberto_em"].dt.hour
df["aberto_dia_semana"] = df["aberto_em"].dt.day_name()
df["aberto_semana_ano"] = df["aberto_em"].dt.isocalendar().week.astype("Int64")
df["aberto_mes"] = df["aberto_em"].dt.month

# Flag: tem incidente pai
df["tem_incidente_pai"] = df["incidente_pai"].notna().astype(int)

# Reordenar colunas
colunas = [
    "numero",
    "prioridade_codigo",
    "prioridade_label",
    "produto",
    "categoria",
    "subcategoria",
    "grupo_designado",
    "item_configuracao",
    "aberto_em",
    "aberto_data",
    "aberto_hora",
    "aberto_dia_semana",
    "aberto_semana_ano",
    "aberto_mes",
    "resolvido_em",
    "encerrado_em",
    "duracao_segundos",
    "duracao_minutos",
    "duracao_horas",
    "status",
    "codigo_fechamento",
    "solucao",
    "aberto_por",
    "incidente_pai",
    "tem_incidente_pai",
    "descricao_resumida",
    "entrou_kpi",
    "kpi_violado",
]
df = df[colunas]

df.to_csv(OUTPUT, index=False)

print(f"Dataset salvo: {OUTPUT}")
print(f"Linhas: {len(df):,} | Colunas: {len(df.columns)}")
print(f"\nTipos:\n{df.dtypes}")
print(f"\nNulos por coluna:\n{df.isnull().sum()[df.isnull().sum() > 0]}")
