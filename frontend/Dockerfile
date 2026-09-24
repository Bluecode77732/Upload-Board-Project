# syntax=docker/dockerfile:1

# ============================================================================
# build — Vite 정적 산출물(dist/)만 만든다(ADR 0060). --platform=$BUILDPLATFORM 덕분에
# arm64 이미지를 만들 때도 이 단계는 러너 네이티브로 돌아 QEMU 에뮬레이션 비용을 치르지
# 않는다 — 산출물이 아키텍처와 무관한 정적 파일이라서 가능한 일이다(백엔드 Dockerfile은
# bcrypt 네이티브 모듈 때문에 그럴 수 없다). Node 버전은 루트 Dockerfile·.nvmrc와 같다.
# ============================================================================
FROM --platform=$BUILDPLATFORM node:24.8.0-slim AS build
WORKDIR /app
# frontend/package.json에 packageManager 핀이 없던 2026-09-21에는 corepack이 "최신" pnpm을
# 받았는데, 그 최신(12.5.1)이 이 Node 이미지의 corepack 0.34.0과 맞지 않아 install이 바로
# 실패했다(bin/pnpm.cjs를 못 찾음, 실측). 지금은 package.json에도 같은 10.14.0 핀(ADR 0014)이
# 있다. 이 줄은 그 핀과 별개로 이미지 빌드가 항상 이 버전을 쓰게 남겨 둔 것이다.
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

# 루트 Dockerfile과 같은 이유: pnpm의 확인 프롬프트가 stdin 없는 RUN 단계를 영원히 막는다.
ENV CI=true

# 소스보다 먼저 매니페스트만 — 락파일이 바뀌기 전까지 install 레이어가 캐시된다.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store-frontend,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY . .

# same-origin 배포(ADR 0060 D1)라서 API 주소를 번들에 굽지 않는다 — client.ts가 상대
# 경로로 요청한다. 빈 값으로 못 박는 이유: 개발용 .env(예: VITE_API_BASE=http://localhost:3000)가
# 빌드에 섞여 들어가면 운영 번들이 엉뚱한 origin으로 요청하게 된다. .dockerignore가 .env를
# 컨텍스트에서 이미 빼지만, Vite는 이미 있는 환경변수를 .env 파일보다 우선하므로 여기서
# 한 번 더 막는다.
ENV VITE_API_BASE=
RUN pnpm build

# ============================================================================
# production — 정적 파일 nginx. nginx-unprivileged는 uid 101(nginx)로 8080에서 뜨는
# non-root 이미지라(ADR 0030의 방침) 별도 USER 지정이 필요 없다. RUN 없이 COPY만 있어서
# multi-arch 빌드에서도 대상 아키텍처의 에뮬레이션이 필요 없다.
# ============================================================================
FROM nginxinc/nginx-unprivileged:1.28-alpine AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

# 백엔드 Dockerfile의 HEALTHCHECK와 같은 목적(로컬 docker run/compose에서 상태 확인) —
# Kubernetes는 이걸 쓰지 않고 차트의 probe를 쓴다. 정적 서버라 `/`가 200이면 충분하다.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
