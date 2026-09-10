# ADR 0049: 성능·용량 기준

- Status: Accepted — implemented
- Date: 2026-08-31
- Amends: [ADR 0021](0021-list-query-search-filter-sort.md) (유예해 둔 인덱스 3종을 채택)
- Extends: [ADR 0047](0047-observability-prometheus-grafana.md) (디스크 사용량은 이미 배포된
  관측 스택으로 확인하며, 새 지표를 추가하지 않는다)
- 한국어: [0049-performance-capacity-criteria.ko.md](0049-performance-capacity-criteria.ko.md)

## Context

[ROADMAP.md](../ROADMAP.md) Stage 4는 "성능/용량 기준" — 인덱스 정책, 응답시간 목표, 디스크
상한, 측정 후 최적화 — 를 배포 종착 작업 직전 마지막 미결 항목으로 남겨두었다. 이 작업의
시점이 이르지도 늦지도 않은 이유는 두 가지다: 게시판 도메인(Stage 3)이 완성돼 측정 대상
쿼리 모양이 더 이상 바뀌지 않고, 관측 스택([ADR 0047](0047-observability-prometheus-grafana.md))이
이미 랜딩해 `http_request_duration_seconds`와 인프라 지표가 향후 측정치를 비교할 기준으로
이미 존재하기 때문이다.

[ADR 0021](0021-list-query-search-filter-sort.md)은 `file_entity` 인덱스 3개를 "10^4+ 규모에서
측정 가능해지면"이라는 명시적 트리거와 함께 유예했고, 응답시간 목표나 디스크 상한 정책은
아예 정해둔 적이 없었다. 이 저장소에는 이번 ADR 이전까지 부하 테스트 도구도, 문서화된
p50/p95 목표도, 파일 저장소 용량 방침도 전혀 없었다.

## Decision

### D1 — 엔드포인트 유형별 응답시간 목표(p50/p95)

| 유형 | 목표 | 엔드포인트 |
|---|---|---|
| 목록 | p50 < 50ms / p95 < 200ms | `GET /file`, `GET /post`, `GET /comment`(스레드) |
| 단건 | p50 < 30ms / p95 < 100ms | `GET /file/:id`, `GET /post/:id` |
| 콘텐츠 서빙(로컬 디스크) | p50 < 100ms / p95 < 300ms | `STORAGE_DRIVER=local`에서의 `GET /file/:id/content` |
| 쓰기 | p50 < 100ms / p95 < 300ms | File/Post/Comment 전반의 `POST`/`PATCH`/`DELETE` |

이 수치는 로컬/도커 Postgres 기준으로 DB+앱 레이어에서 측정한 값이며, 라이브 AWS 배포를
대상으로 한 것이 아니다 — 라이브 스택은 검증 사이클마다 파기되고(ROADMAP §9) 이번 작업의
제약상 범위 밖이었다. 이 수치는 감(UX 추측)이 아니라 자원/용량 비용 관점의 트레이드오프로
정했다: 이 프로젝트의 기본 TypeORM 커넥션 풀(10개) 기준으로, 목록/단건 목표는 인스턴스당
초당 약 50~100건의 지속 처리량을 시사한다 — 이 프로젝트의 실제 트래픽이 한 번도 근접한 적
없는 여유이면서도, 진짜 회귀(N+1 재발, take/skip 누락)는 잡아낼 만큼 빡빡하다.

### D2 — 측정 방법과 도구

`autocannon`(MIT, devDependency)으로 HTTP 레벨 부하를 걸고, `EXPLAIN (ANALYZE, BUFFERS)`로
쿼리 플래너가 실제로 무엇을 했는지 확인한다. 둘 다 `sharenpo_perf`라는 일회용 데이터베이스
— 개발 DB는 절대 아님 — 에서 실행하며, `test/e2e-utils.ts`가 e2e에 이미 쓰는 것과 같은
일회용 DB 패턴을 그대로 따른다. 스키마는 실제로 커밋된 마이그레이션으로 만든다
(`synchronize: true`는 절대 쓰지 않음). `perf/seed.js`는 사용자 50명, `file_entity` 1만 행,
`post_entity` 1만 행 — ADR 0021이 트리거로 명시했던 바로 그 규모 — 을 시드하고, 콘텐츠 서빙
측정용 실제 파일 2개도 디스크에 만든다(목록/단건 측정은 실제 바이트가 필요 없지만
`GET /file/:id/content`는 필요하다). `perf/explain.js`는 대표 쿼리 6개(기본 정렬, `ILIKE`
검색, `creatorId` 필터 — `file_entity`/`post_entity` 각각)를 D3의 인덱스 적용 전/후로
실행한다. `perf/load-test.js`는 시드된 측정용 사용자로 로그인한 뒤 목록/단건/콘텐츠/쓰기
엔드포인트에 autocannon 부하를 걸어 p50과 autocannon 내장 백분위수 중 이 ADR의 p95 목표에
가장 가까운 p97.5를 D1 기준과 비교해 보고한다. k6와 Artillery도 검토했으나 기각했다: k6는
pnpm 툴체인 밖의 독립 바이너리가 필요한데 이 프로젝트의 엔드포인트 모양엔 그 기능이
필요 없고, Artillery의 시나리오/단계별 부하 DSL은 고정된 단일 요청 벤치마크 몇 개에는 쓰지
않는 기능이다(YAGNI).

### D3 — ADR 0021이 유예한 인덱스 3종 모두 채택, File과 Post 양쪽 다

ADR 0021은 인덱스 후보와 그 트리거를 `file_entity`에 대해서만 적어두었다; `post_entity`는
같은 읽기 계층(검색/정렬/`creatorId`)을 그대로 물려받았으면서도 정작 자기만의 인덱스 후보
검토는 한 번도 받은 적이 없었다. 1만 행씩 함께 측정한 결과:

**EXPLAIN (ANALYZE, BUFFERS), 적용 전 → 후(실제 마이그레이션으로 만든 인덱스):**

| 쿼리 | 적용 전 | 적용 후 | 배수 | 사용된 인덱스 |
|---|---|---|---|---|
| `file_entity` 기본 정렬 | 3.43ms (Seq Scan) | 0.298ms (Index Scan Backward) | 11.5배 | `IDX_file_entity_createdAt_id` |
| `file_entity` 검색 `ILIKE` | 4.43ms (Seq Scan) | 1.222ms (Bitmap Index Scan) | 3.6배 | `IDX_file_entity_title_trgm` |
| `file_entity` `creatorId` 필터 | 0.63ms (Seq Scan) | 0.204ms (Bitmap Index Scan) | 3.1배 | `IDX_file_entity_creatorId` |
| `post_entity` 기본 정렬 | 2.82ms (Seq Scan) | 0.040ms (Index Only Scan) | 70배 | `IDX_post_entity_createdAt_id` |
| `post_entity` 검색 `ILIKE` | 3.96ms (Seq Scan) | 0.917ms (Bitmap Index Scan) | 4.3배 | `IDX_post_entity_title_trgm` |
| `post_entity` `creatorId` 필터 | 0.55ms (Seq Scan) | 0.334ms (Index Scan Backward + 필터) | 1.6배 | `IDX_post_entity_createdAt_id`(플래너가 별도 정렬을 피하려고 단순 `creatorId` 인덱스 대신 정렬용 인덱스를 선택) |

**autocannon(동시연결 20, 10초), 적용 전 → 후 — 어느 쪽이든 D1 목표를 모두 통과:**

| 엔드포인트 | 전 p50/p95 | 후 p50/p95 | 처리량(전 → 후) |
|---|---|---|---|
| `GET /file`(목록) | 30/45ms | 23/29ms | 639 → 831 req/s |
| `GET /file?search=holiday` | 41/50ms | 23/28ms | 472 → 837 req/s |
| `GET /file?creatorId=` | 24/34ms | 21/31ms | 801 → 882 req/s |
| `GET /post`(목록) | 29/47ms | 22/27ms | 661 → 866 req/s |
| `GET /file/:id`(단건) | 9/12ms | 9/13ms | ~2000 req/s(영향 없음, 예상대로) |
| `GET /file/:id/content`(로컬, public) | 14/25ms | 14/25ms | 영향 없음 — 인덱스와 무관한 경로 |
| `GET /file/:id/content`(로컬, private) | 17/28ms | 16/26ms | 영향 없음 |
| `PATCH /file/:id`(쓰기) | 19/32ms | 16/19ms | 960 → 1189 req/s |

디스크 비용: 1만 행 기준 새 인덱스 6개 합계 **약 2.16MB**(`file_entity`/`post_entity` 테이블
본체는 각 약 3MB) — 무시할 수준.

**측정 결과를 있는 그대로 읽으면**: 이 인덱스들이 없어도 이 행 수에서는 모든 엔드포인트가
이미 D1 목표를 통과한다 — Node/Nest 자체 오버헤드(검증, 직렬화, 가드)가 5ms 미만인 쿼리
비용보다 훨씬 크기 때문에, 종단 간 HTTP 개선폭은 크지 않다(목록 엔드포인트 처리량 +20~30%).
반면 SQL 레벨 개선은 실제로 크고(최대 70배) 비용은 거의 0에 가까우며, Stage 3의 게시판
확장으로 행 수는 앞으로도 늘어나기만 한다 — ADR 0021 자신이 정해둔 트리거("10^4+ 행에서
측정 가능해지면")가 이제 발동했고 결과가 긍정적이며 비용도 저렴하니, 더 미루는 것은 이미
측정으로 답한 질문을 다시 여는 것일 뿐이다. `file_entity`만이 아니라 두 테이블 모두 채택한다.

ADR 0021 본문 자체에 대한 정정 사항 하나: 검색 후보를 "`lower(title)` 위의 `pg_trgm`
GIN"이라고 적어두었다. 직접 측정해 보니 `lower(title)` 표현식 인덱스는 플래너가 전혀 고르지
않는다 — `FileService.getFiles`/`PostService.getPosts`가 `ILIKE`를 `lower(title)`이 아니라
원본 `title` 컬럼에 그대로 걸기 때문에, Postgres가 표현식 인덱스를 매칭하려면 그 표현식이
쿼리에 그대로 나타나야 한다. 그래서 채택한 인덱스는 원본 `title` 컬럼 위의 것이고
(`gin_trgm_ops`), 실측된 `Bitmap Index Scan`이 플래너가 실제로 이 인덱스를 쓴다는 것을
확인해 준다.

**마이그레이션**: `backend/migrations/1788180660994-AddPerformanceIndexes.ts`, `migration:generate`
출력이 아니라 수기로 작성했다 — `AddFileMediaType1786818802632`가 그랬던 것과 같은 이유로,
`migration:generate`는 엔티티 메타데이터만으로 `gin_trgm_ops` 연산자 클래스를 쓰는 GIN
인덱스를 표현할 수 없다. `file.entity.ts`/`post.entity.ts`는 단순 btree 후보 2개
(`createdAt`+`id`, `creatorId`)만 `@Index`로 선언한다; 트라이그램 인덱스 2개는 마이그레이션
안에만 존재하며, 각 엔티티에는 향후 `migration:generate`가 이 인덱스들을 (잘못) 지우자고
제안할 것이라는 경고 주석을 남겨 두었다 — 이 프로젝트 관행이 이미 매 `generate` 리뷰마다
손으로 걸러내는 것과 같은 종류의 허위 노이즈다.

### D4 — 파일 저장소 디스크 상한: 절대 상한이 아니라 사용률 모니터링

`file/upload`에 절대 바이트 상한을 두지 않는다. `k8s/helm/values.yaml`의 `resources: {}`는
이 포트폴리오 규모 프로젝트의 컨테이너/PVC 크기가 한 번도 실측된 적 없다는 것을 이미
기록해 두었다 — 지금 절대 용량 임계값을 정하면 이 작업 전체가 막으려는 바로 그 "측정 근거
없는" 패턴이 된다. 대신: 디스크 사용량은 `kube-prometheus-stack`이 이미 설치하는
`node-exporter` 컴포넌트([ADR 0047](0047-observability-prometheus-grafana.md) D2)를 통해
확인한다 — 노드/PVC 마운트의 `node_filesystem_avail_bytes` / `node_filesystem_size_bytes` —
새 애플리케이션 코드나 지표가 전혀 필요 없다. `TEMP_SWEEP_TTL_HOURS`(기본 24시간,
[ADR 0018](0018-orphan-temp-file-cleanup.md))와 기존 페이지네이션 상한(`take` 1~100,
[ADR 0021](0021-list-query-search-filter-sort.md))은 검토했지만 그대로 유지한다 — 이번
작업의 어떤 측정도 둘 중 하나를 조정해야 할 근거를 내놓지 않았다.

## Consequences

- 스키마: `file_entity`/`post_entity`에 걸쳐 새 인덱스 6개(`AddPerformanceIndexes1788180660994`)
  와 `pg_trgm` 확장 추가. 컬럼 변경도 데이터 마이그레이션도 없다. `test/e2e-utils.ts`의
  `MIGRATIONS` 목록에 이 마이그레이션이 추가됐다(`TABLES` 목록은 새 테이블이 없으므로 영향
  없음).
- 새 devDependency: `autocannon`(MIT). 새 도구 디렉터리 `perf/`(`perf-db.js`, `seed.js`,
  `explain.js`, `load-test.js`) — 향후 회귀가 의심될 때 이 기준선을 재측정하는 데 재사용
  가능하다; CI에는 절대 연결하지 않는다(자동 실행되는 `.claude/hooks/`가 아니라 손으로
  실행하는 `.claude/scripts/`의 관행을 따른다).
- 이 ADR이 바로 ROADMAP Stage 4가 요구한 성능/용량 기준선이다: 앞으로의 회귀는 감이 아니라
  D1 목표와 D3 표를 기준으로 판단한다.
- 남겨둔 한계(의도적으로 수용): 이번 작업 자체의 제약대로 측정은 로컬/도커 Postgres에서만
  했다 — 라이브 AWS 배포는 검증 사이클마다 파기되며(ROADMAP §9) 이번 범위 밖이었다.
  `STORAGE_DRIVER=s3`에서의 `GET /file/:id/content`(서명 URL 리다이렉트 경로, ADR 0036)는
  벤치마크하지 않았다 — 로컬/도커 측정 환경이 실제로 실행해 볼 수 있는 `local` 스트리밍
  경로만 측정했다.
