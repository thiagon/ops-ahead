{{- define "ops-ahead-ui.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: ops-ahead
{{- end }}

{{- define "ops-ahead-ui.nginxConfig" -}}
server {
    listen 80;
    location /health {
        return 200 'ok';
        add_header Content-Type text/plain;
    }
    location / {
        return 200 'ops-ahead stub';
        add_header Content-Type text/plain;
    }
}
{{- end }}
