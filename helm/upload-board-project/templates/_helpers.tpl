{{/*
Purpose: shared name/label helpers so Deployment/Service/ConfigMap/Job templates
  stay consistent without repeating {{ .Release.Name }}-x by hand in each file.
Usage: {{ include "upload-board-project.fullname" . }} /
  {{ include "upload-board-project.labels" . }} from any template in this chart.
Rationale: the pre-adaptation scaffold (ADR 0037) had exactly one template and
  inlined names directly; ADR 0041 adds five more templates that need to agree
  on the same object names and selector labels.
*/}}

{{- define "upload-board-project.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "upload-board-project.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "upload-board-project.labels" -}}
app.kubernetes.io/name: {{ include "upload-board-project.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{- define "upload-board-project.selectorLabels" -}}
app.kubernetes.io/name: {{ include "upload-board-project.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
