{{- define "ml-burst-detector.fullname" -}}
{{ .Release.Name }}-ml-burst-detector
{{- end }}

{{- define "ml-burst-detector.labels" -}}
app.kubernetes.io/name: ml-burst-detector
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
