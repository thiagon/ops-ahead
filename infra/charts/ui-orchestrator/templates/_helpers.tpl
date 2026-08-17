{{- define "ui-orchestrator.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: orchestrator
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: ops-ahead
{{- end }}

{{- define "ui-orchestrator.image" -}}
{{- $image := index .Values "ui-orchestrator" "image" -}}
{{ $image.repository }}:{{ $image.tag }}
{{- end }}
