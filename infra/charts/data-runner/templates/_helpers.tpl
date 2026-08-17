{{- define "data-runner.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: data-runner
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: ops-ahead
{{- end }}

{{- define "data-runner.image" -}}
{{- $image := index .Values "data-runner" "image" -}}
{{ $image.repository }}:{{ $image.tag }}
{{- end }}
