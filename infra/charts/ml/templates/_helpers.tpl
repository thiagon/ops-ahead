{{- define "ops-ahead-ml.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: ops-ahead
{{- end }}

{{- define "ops-ahead-ml.postgresHost" -}}
{{ .Release.Name }}-mlflow-postgres
{{- end }}
