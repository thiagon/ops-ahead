{{ config(materialized='view') }}

-- Only the still-open occurrences, ordered by due_at — the tracker's read
-- path is "next to breach", not "every occurrence" (domain spec: due_at não
-- serve como chave primária da tabela cheia, por isso a fila vive separada).
select *
from {{ ref('silver_alert') }}
where closed_at is null
order by due_at
