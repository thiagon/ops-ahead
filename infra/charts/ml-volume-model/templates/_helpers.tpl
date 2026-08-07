{{- define "ml-volume-model.fullname" -}}
{{ .Release.Name }}-ml-volume-model
{{- end }}

{{- define "ml-volume-model.labels" -}}
app.kubernetes.io/name: ml-volume-model
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
