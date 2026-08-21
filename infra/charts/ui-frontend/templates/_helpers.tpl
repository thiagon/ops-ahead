{{- define "ui-frontend.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: ops-ahead
{{- end }}

{{- define "ui-frontend.image" -}}
{{- $app := index .Values "ui-frontend" -}}
{{ $app.image.repository }}:{{ $app.image.tag }}
{{- end }}
