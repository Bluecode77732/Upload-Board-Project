# syntax=docker/dockerfile:1

# ============================================================================
# development — 네이티브 빌드에 필요한 컴파일러까지 다 들어간 풀 이미지.
# Node/pnpm은 ADR 0014에 따라 고정돼 있으므로(.nvmrc / package.json packageManager),
# 이 태그가 둘 다의 단일 진실 공급원이다.
# ============================================================================
FROM node:24.8.0 AS development
WORKDIR /app
RUN corepack enable

# 이게 없으면 pnpm 자체의 확인 프롬프트(예: install 단계의 --store-dir와 이후
# 순수 `pnpm build`의 store-dir가 어긋났을 때 뜨는 "modules directory will be
# removed and reinstalled from scratch")가 영원히 막힌다: Docker RUN 단계에는
# (Y/n)에 답할 stdin/TTY가 없어서 빌드가 그냥 멈춘다. CI=true는 pnpm(그리고
# 대부분의 JS CLI)이 이런 프롬프트를 건너뛰라는 신호로 확인하는 표준값이다.
ENV CI=true

# 나머지 소스보다 먼저 매니페스트만 — 이 레이어(와 아래 install)는 락파일 자체가
# 바뀌기 전까지 캐시된 채로 남는다.
COPY package.json pnpm-lock.yaml ./

# --store-dir와 캐시 마운트가 있어야, 이 레이어가 락파일 변경으로 무효화되더라도
# pnpm의 콘텐츠 주소 기반 store가 빌드 사이사이 살아남는다 — 그래서 의존성 하나
# 올릴 때마다 전체 패키지를 레지스트리에서 새로 받지 않는다. 빌드 시점에만
# 쓰이고, 이미지 레이어에는 아무것도 커밋되지 않는다.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY . .

# dist/로 컴파일한 뒤 dev 의존성을 버려서 production에는 prod 모듈만 남긴다.
# bcrypt는 여기서 아키텍처별 별도 처리가 필요 없다 — amd64/arm64 glibc용
# prebuild를 둘 다 번들에 담고 있고, 스크립트가 아니라 tarball에서 이미 풀린
# 파일을 require 시점에 node-gyp-build가 찾아 쓴다 — arm64 에뮬레이션에서
# 검증됨(ADR 0035, ADR 0030의 "bcrypt prebuild는 전부 x64" 주장을 정정).
# install 단계와 동일한 캐시 마운트가 여기도 다시 필요하다: `pnpm prune`이
# node_modules가 링크된 store 경로를 조회하는데, 마운트가 없으면 그 링크를
# 검증할 수 없다 — 그러면 지우고 재설치할지 묻는 프롬프트가 뜨고, stdin이
# 없으니 빌드가 그냥 멈춘다.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm build && pnpm prune --prod

# ============================================================================
# production — 컴파일러가 필요 없는 슬림 이미지; prod node_modules/dist는 위
# development 스테이지에서 가져온다. Distroless도 검토했지만(ADR 0030) 보류했다
# — 정확한 Node 24 태그가 검증되지 않았고, 이 프로젝트에는 그게 없애버릴 셸을
# 대신할 ephemeral-debug-container 툴링이 아직 없다.
# ============================================================================
FROM node:24.8.0-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=development /app/node_modules ./node_modules
COPY --from=development /app/dist ./dist

# temp_ -> granted_ 승격 계약이 성립하려면 두 업로드 폴더가 모두 있어야 한다;
# 영속성을 위해 런타임에는 compose 볼륨이 이 위에 마운트된다.
RUN mkdir -p file/temp file/upload

# Non-root(ADR 0030): 프로세스가 뚫려도 컨테이너의 user namespace 안에서 더는
# root를 갖지 않는다. uid/gid 1001은 임의값이지만 고정값이라, Linux 호스트가
# ./file을 bind-mount할 때(docker-compose.yml, 로컬 개발 전용) 한 번 chown으로
# 맞춰줄 수 있다; Windows/Mac Docker Desktop의 마운트 레이어는 영향 없다.
RUN groupadd --gid 1001 appgroup \
  && useradd --uid 1001 --gid appgroup --no-create-home appuser \
  && chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

# Liveness만 확인한다(ADR 0031) — DB 장애가 멀쩡한 프로세스를 재시작시키면 안
# 된다; 그건 readiness(GET /health/ready)의 일이고, Docker 자체의 재시작
# 정책이 아니라 오케스트레이터/LB가 확인한다.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:3000/health/live',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# 마이그레이션은 더 이상 여기서 돌지 않는다(ADR 0032) — 다중 인스턴스가 동시에
# 뜨면 같은 DB를 상대로 `migration:run`이 서로 레이스하게 된다. 이 컨테이너가
# 뜨기 전에 별도 단계로 실행된다(docker-compose.yml의 `migrate` 서비스; 최종
# Helm 차트에서는 Kubernetes Job).
CMD ["node", "dist/main"]
