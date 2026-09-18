{{- define "notify-slack.fullname" -}}
{{ .Release.Name }}-notify-slack
{{- end }}

{{- define "notify-slack.labels" -}}
app.kubernetes.io/name: notify-slack
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
