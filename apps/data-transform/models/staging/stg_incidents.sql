{{ config(materialized='view') }}

select
    event_id,
    source,
    received_at,
    opened_at,
    severity,
    entity_id,
    status,

    -- ITSM fields extracted from payload_raw
    JSONExtractString(payload_raw, 'numero')                                            as numero,
    JSONExtractString(payload_raw, 'prioridade_label')                                  as prioridade_label,
    JSONExtractString(payload_raw, 'produto')                                           as produto,
    JSONExtractString(payload_raw, 'categoria')                                         as categoria,
    JSONExtractString(payload_raw, 'subcategoria')                                      as subcategoria,
    JSONExtractString(payload_raw, 'grupo_designado')                                   as grupo_designado,
    JSONExtractString(payload_raw, 'item_configuracao')                                 as item_configuracao,
    JSONExtractInt(payload_raw, 'aberto_hora')                                          as aberto_hora,
    JSONExtractInt(payload_raw, 'aberto_dia_semana')                                    as aberto_dia_semana,
    JSONExtractInt(payload_raw, 'aberto_semana_ano')                                    as aberto_semana_ano,
    JSONExtractInt(payload_raw, 'aberto_mes')                                           as aberto_mes,
    parseDateTimeBestEffortOrNull(JSONExtractString(payload_raw, 'resolvido_em'))       as resolvido_em,
    parseDateTimeBestEffortOrNull(JSONExtractString(payload_raw, 'encerrado_em'))       as encerrado_em,
    JSONExtractInt(payload_raw, 'duracao_segundos')                                     as duracao_segundos,
    JSONExtractString(payload_raw, 'codigo_fechamento')                                 as codigo_fechamento,
    JSONExtractString(payload_raw, 'solucao')                                           as solucao,
    JSONExtractString(payload_raw, 'aberto_por')                                        as aberto_por,
    JSONExtractString(payload_raw, 'incidente_pai')                                     as incidente_pai,
    JSONExtractInt(payload_raw, 'tem_incidente_pai')                                    as tem_incidente_pai,
    JSONExtractString(payload_raw, 'descricao_resumida')                                as descricao_resumida,
    JSONExtractInt(payload_raw, 'entrou_kpi')                                           as entrou_kpi,
    JSONExtractInt(payload_raw, 'kpi_violado')                                          as kpi_violado

from {{ source('raw', 'incidents_raw') }}
