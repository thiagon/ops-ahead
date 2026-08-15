{{- define "trigger-service.fullname" -}}
{{ .Release.Name }}-trigger-service
{{- end }}

{{- define "trigger-service.labels" -}}
app.kubernetes.io/name: trigger-service
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
