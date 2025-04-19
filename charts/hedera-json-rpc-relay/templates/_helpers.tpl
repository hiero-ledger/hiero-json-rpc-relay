{{/*
Expand the name of the chart.
*/}}
{{- define "json-rpc-relay.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "json-rpc-relay.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "json-rpc-relay.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "json-rpc-relay.labels" -}}
helm.sh/chart: {{ include "json-rpc-relay.chart" . }}
{{ include "json-rpc-relay.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Namespace
*/}}
{{- define "json-rpc-relay.namespace" -}}
{{- default .Release.Namespace .Values.global.namespaceOverride -}}
{{- end -}}

{{/*
Selector labels
*/}}
{{- define "json-rpc-relay.selectorLabels" -}}
app.kubernetes.io/name: {{ include "json-rpc-relay.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "json-rpc-relay.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "json-rpc-relay.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Update Redis configuration based on parent chart Redis status
*/}}
{{- define "json-rpc-relay.redis-config" -}}
{{- $redisEnabled := false -}}
{{- $redisUrl := "" -}}

{{/* Check if Redis is enabled in parent chart */}}
{{- if and .Values.redis.autoconfig ((.Values.global).redis).enabled -}}
  {{- $redisEnabled = true -}}
  {{- $redisUrl = printf "redis://%s-redis-master:6379" .Release.Name -}}
{{- end -}}

{{- if $redisEnabled -}}
REDIS_ENABLED: "true"
REDIS_URL: {{ $redisUrl | quote }}
{{- end -}}
{{- end -}}
