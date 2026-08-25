{{/*
목적: Deployment/Service/ConfigMap/Job 템플릿이 각 파일마다 {{ .Release.Name }}-x를
  직접 반복하지 않고도 이름·라벨을 일관되게 유지하도록 돕는 공유 헬퍼.
용도: 이 차트의 어떤 템플릿에서든 {{ include "sharenpo.fullname" . }} /
  {{ include "sharenpo.labels" . }} 형태로 사용.
근거: 적응 전 스캐폴딩(ADR 0037)은 템플릿이 딱 하나뿐이라 이름을 직접 인라인으로
  써도 됐지만, ADR 0041에서 템플릿 5개가 더 늘면서 전부 같은 오브젝트 이름과
  selector 라벨에 맞춰야 했다.
*/}}

{{/* 차트 이름(=Chart.yaml의 name 필드)을 63자 제한에 맞춰 정리. */}}
{{- define "sharenpo.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* 오브젝트 이름의 기준 — 이 릴리스의 이름(예: helm install <이름> .). */}}
{{- define "sharenpo.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* 각 리소스의 metadata.labels 전체 — Kubernetes 표준 app.kubernetes.io/* 라벨 + Helm 자체 라벨. */}}
{{- define "sharenpo.labels" -}}
app.kubernetes.io/name: {{ include "sharenpo.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/* Deployment/Job의 selector와 Pod 템플릿 라벨이 반드시 일치해야 하므로 labels보다 더 좁은 부분집합으로 따로 둠. */}}
{{- define "sharenpo.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sharenpo.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
