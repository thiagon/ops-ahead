{{- define "ml-trainer.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: ml-trainer
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: ops-ahead
{{- end }}

{{- define "ml-trainer.image" -}}
{{- $image := index .Values "ml-trainer" "image" -}}
{{ $image.repository }}:{{ $image.tag }}
{{- end }}
