# ADR 0015: 로컬 개발용 Docker·docker-compose

- 상태: 승인됨
- 날짜: 2026-07-25
- English: [0015-docker-and-compose.md](0015-docker-and-compose.md)

## 맥락

데이터베이스는 손으로 구성해 왔다 — 기여자마다 잊지 않고 띄워야 하는, 수동으로 만든
`upload-board-pg` 컨테이너였다. 이는 온보딩의 가장 큰 마찰이자, e2e 스위트([ADR 없는
Stage 1 작업](../ROADMAP.ko.md))가 이제 살아있는 Postgres를 요구하면서 남은 유일한
외부 의존성이다. 재현 가능한 빌드와 향후 AWS 배포(Stage 4)는 모두 앱 자체의
컨테이너화를 필요로 한다. 이미지 베이스 태그의 단일 출처를 확보하려고 툴체인
고정([ADR 0014](0014-node-pnpm-version-pinning.ko.md))을 먼저 처리한 이유가 바로 이것이다.

## 결정

- **멀티 스테이지 `Dockerfile`.** 빌드 스테이지는 `node:24.8.0`(전체 이미지라 네이티브
  빌드에 필요할 수 있는 컴파일러를 갖춤), 런타임은 `node:24.8.0-slim`. `nest build`를
  위해 dev 의존성을 설치한 뒤 `pnpm prune --prod`로 걷어내고 프로덕션 `node_modules`만
  slim 스테이지로 복사한다 — `bcrypt`는 glibc 프리빌드를 제공하므로 slim에서 재컴파일이
  없다. 베이스 태그는 ADR 0014의 고정값에서 온다.
- **부팅 시 마이그레이션.** 런타임 `CMD`가 커밋된 마이그레이션을 실행
  (`typeorm migration:run -d dist/data-source.js` — 멱등, 컴파일된 data source와
  typeorm CLI만 사용하고 런타임에 nest/pnpm 불필요)한 뒤 `node dist/main`을 띄운다.
  그래서 새 볼륨에서도 `docker compose up` 한 번으로 동작한다.
- **`docker-compose.yml` = `db` + `api`.** `db`는 `postgres:16`으로
  `${DB_PORT}:5432`를 노출하고 명명 볼륨과 `pg_isready` 헬스체크를 갖는다. `api`는
  Dockerfile을 빌드하고 `db` 헬스를 기다리며 `env_file`로 `.env`를 읽고 compose
  네트워크용으로 `DB_HOST=db`/`DB_PORT=5432`를 덮어쓴다. 수동 `upload-board-pg`를
  대체한다.
- **시크릿은 이미지에 굽지 않음.** `.dockerignore`가 `.env*`를 제외하고, 환경 변수는
  런타임에 주입된다. compose는 앱이 쓰는 것과 같은 `.env`에서 DB 자격증명·포트를 읽으므로
  노출 포트가 일치하고, 호스트에서 돌리는 e2e·마이그레이션도 같은 DB에 접속한다.
- **범위: 로컬 개발 + 빌드 이미지.** 프로덕션 하드닝(비루트 사용자, distroless, 헬스
  엔드포인트, 이미지 레지스트리, CI 빌드)은 CI 작업(다음)과 Stage 4로 미룬다.

## 기각된 대안

- **단일 스테이지 이미지** — dev 의존성과 컴파일러를 런타임에 그대로 실어 크기와 공격
  표면이 커진다. 멀티 스테이지 분리가 표준이다.
- **Alpine 베이스** — musl libc가 `bcrypt`의 glibc 프리빌드를 깨뜨려 소스 재컴파일(과
  그에 딸린 빌드 도구)을 강제한다. Debian `slim`은 빌드 스테이지의 glibc와 일치해
  프리빌드 바이너리가 그대로 동작한다.
- **`.env`를 이미지에 굽기** — 시크릿이 이미지 레이어로 새어 나간다. `env_file`을 통한
  런타임 주입이 정석이다.
- **마이그레이션을 별도 compose 일회성 서비스로** — `api` `CMD`에서 실행하는 쪽을
  택했다. 커밋된 마이그레이션은 이미 리뷰되었고 `migration:run`은 멱등이며, 부팅에 접어
  넣으면 `up`이 단일 명령으로 유지된다. 여기서 *generate*는 절대 실행하지 않는다 —
  오직 *run*뿐이다.

## 결과

- `docker compose up`이 Postgres + API를 로컬에 띄운다. e2e의 "수동 기동 Postgres 필요"
  의존성이 compose 사용자에게는 사라진다.
- 새 compose 볼륨은 수동 마이그레이션 없이 스키마가 준비된다(부팅이 적용). 기존 볼륨은
  영향 없다(멱등).
- 호스트 포트 5435를 레거시 `upload-board-pg`와 공유하므로, `docker compose up` 전에 그
  컨테이너를 멈춰야 한다. 폐기는 수동이자 비파괴적인 후속 작업(데이터가 개발용일 뿐)으로
  기여자에게 맡긴다.
- 아직 프로덕션 수준은 아니다: 컨테이너가 root로 돌고 distroless 베이스·헬스
  엔드포인트·레지스트리 푸시가 없다. 이는 CI(Stage 1)와 Stage 4에서 각자의 기록과 함께
  도입된다.
