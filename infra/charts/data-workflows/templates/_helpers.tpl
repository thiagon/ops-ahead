{{- define "data-workflows.labels" -}}
app.kubernetes.io/name: data-workflows
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
