{{- define "data-ingest.fullname" -}}
{{ .Release.Name }}-data-ingest
{{- end }}

{{- define "data-ingest.labels" -}}
app.kubernetes.io/name: data-ingest
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
