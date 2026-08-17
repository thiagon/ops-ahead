{{- define "ml-model-serving.fullname" -}}
{{ .Release.Name }}-ml-model-serving
{{- end }}

{{- define "ml-model-serving.labels" -}}
app.kubernetes.io/name: ml-model-serving
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
