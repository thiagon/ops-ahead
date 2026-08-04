{{- define "ui-gateway.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: gateway
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: ops-ahead
{{- end }}

{{- define "ui-gateway.image" -}}
{{- $image := index .Values "ui-gateway" "image" -}}
{{ $image.repository }}:{{ $image.tag }}
{{- end }}
