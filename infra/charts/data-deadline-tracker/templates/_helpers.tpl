{{- define "data-deadline-tracker.fullname" -}}
{{ .Release.Name }}-data-deadline-tracker
{{- end }}

{{- define "data-deadline-tracker.labels" -}}
app.kubernetes.io/name: data-deadline-tracker
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
