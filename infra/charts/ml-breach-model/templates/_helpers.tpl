{{- define "ml-breach-model.fullname" -}}
{{ .Release.Name }}-ml-breach-model
{{- end }}

{{- define "ml-breach-model.labels" -}}
app.kubernetes.io/name: ml-breach-model
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
