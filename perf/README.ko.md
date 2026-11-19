# perf/

> English: [README.md](README.md)

손으로 실행하는 측정 도구 모음이다. CI에는 하나도 연결하지 않았고, 여기 있는 어떤 것도 dev DB, compose
볼륨, 저장소의 `file/` 디렉터리를 건드리면 안 된다.

| 파일 | 하는 일 | 결정 |
|---|---|---|
| `perf-db.js` | 일회용 perf DB 접속 헬퍼 | [ADR 0049](../docs/ADR/0049-performance-capacity-criteria.ko.md) |
| `seed.js` | 사용자 50명, 파일 1만 건, 게시글 1만 건, 콘텐츠 파일 2개, 그리고 k6 계정(`perf-vu-0..2000`, `perf-partner-1..2000`)과 VU마다 private 1KB 파일 하나 | ADR 0049, [ADR 0069](../docs/ADR/0069-k6-load-testing.ko.md) |
| `explain.js` | 목록 쿼리 6개에 `EXPLAIN (ANALYZE, BUFFERS)` | ADR 0049 |
| `load-test.js` | 고정 엔드포인트 8개에 autocannon을 걸어 ADR 0049 D1과 비교 | ADR 0049 |
| `k6/load.js` | 사용자·관리자 기능을 섞은 부하를 VU 수준 하나로 걸고, 설계된 거절과 실패를 나눠 센다 | ADR 0069 |
| `k6/throttle.js` | 5/분과 100/분 throttle 경계 확인 | ADR 0069 |

## 환경

모든 실행은 저장소 밖 샌드박스 디렉터리에서 한다(예시에서는 `$SB`). 앱, migration, seed 모두 `.env`,
`file/temp`, `file/upload`를 현재 디렉터리 기준으로 찾기 때문에, `$SB`에서 실행하면 저장소의 `.env`와
`file/`가 끼어들지 않는다.

1. 일회용 컨테이너. 복구할 데이터는 없다.

   ```bash
   docker run -d --name sharenpo-perf-db -e POSTGRES_USER=perf -e POSTGRES_PASSWORD=perf \
     -e POSTGRES_DB=perf -p 5436:5432 postgres:16
   docker run -d --name sharenpo-perf-clamav -p 3311:3310 clamav/clamav:stable  # 시그니처를 받느라 몇 분 걸린다
   ```

2. `$SB/perf.env`를 만들고, 아래 명령을 실행할 때마다 먼저 export한다. 토큰 시크릿 두 개는 매번 새로
   만든다(32자 이상, 소문자·대문자·숫자·기호 포함). 저장소의 `.env`를 베끼지 않는다.

   ```bash
   export ENV=dev DB_TYPE=postgres DB_HOST=127.0.0.1 DB_PORT=5436 DB_USERNAME=perf \
     DB_PASSWORD=perf DB_DATABASE=perf PERF_DB_DATABASE=perf HASH_ROUNDS=10 \
     ACCESS_TOKEN_SECRET=... REFRESH_TOKEN_SECRET=... \
     ACCESS_TOKEN_SECRET_EXPIRES_IN=180 REFRESH_TOKEN_SECRET_EXPIRES_IN=86400 \
     STORAGE_DRIVER=local CLAMD_HOST=127.0.0.1 CLAMD_PORT=3311 \
     TEMP_SWEEP_ENABLED=false GRANTED_SWEEP_ENABLED=false THROTTLE_ENABLED=false
   ```

   `ENV=dev`여야 한다. `prod`면 refresh 쿠키에 `Secure`가 붙어 http로는 전송되지 않는다.

3. 스키마, seed, 앱을 `$SB`에서 띄운다. `R`은 저장소 루트다. 컴파일된 `dist/`를 쓰므로 백엔드가
   바뀌었으면 먼저 빌드한다.

   ```bash
   cd "$SB" && source perf.env && mkdir -p file/temp
   node "$R/node_modules/typeorm/cli.js" migration:run -d "$R/dist/data-source.js"
   node "$R/perf/seed.js"
   node "$R/dist/main.js" > app.log 2>&1 &
   ```

## k6

k6는 `grafana/k6:2.3.0` 이미지로 실행한다(AGPL-3.0이며, 별도 프로세스로만 돌리고 pnpm 의존성으로는
넣지 않는다). `load.js`가 `backend/common/error-code.ts`를 읽으므로 저장소를 읽기 전용으로 마운트하고,
결과는 `$SB/results`에 쌓는다. Git Bash에서는 명령 앞에 `MSYS_NO_PATHCONV=1`을 붙인다.

```bash
docker run --rm -v "$R:/repo:ro" -v "$SB/results:/results" \
  -e TARGET_VUS=10 -e RAMP=10s -e HOLD=2m -e LABEL=smoke \
  grafana/k6:2.3.0 run --quiet /repo/perf/k6/load.js
```

- 한 번 실행에 수준 하나다. `TARGET_VUS`, `RAMP`, `HOLD`(수준당 3m)를 정하고, `LABEL`이 결과 파일
  이름이 된다. VU `n`은 `perf-vu-n`을 쓰므로 `TARGET_VUS`는 시드한 2000을 넘을 수 없다.
- 부하 실행 직후 회복 측정: `-e TARGET_VUS=10 -e RAMP=0s -e HOLD=60s -e LABEL=<level>-recovery -e BASELINE=/results/smoke.json`.
  p95가 스모크 p95의 2배 이하면 요약에 PASS가 찍힌다.
- `unexpected_failure`와 `unplanned_response`가 둘 다 0이어야 통과다. 아니면 k6가 99로 끝난다.
  `designed_rejection` 건수는 나오는 게 정상이다.
- throttle 확인: 앱을 `THROTTLE_ENABLED=true`로 다시 띄우고, 같은 마운트로
  `grafana/k6:2.3.0 run --quiet /repo/perf/k6/throttle.js`를 실행한다. 다음 부하 실행 전에 `false`로
  되돌려 다시 띄운다.

수준 사이에 DB를 초기화하지 않는다. 각 수준은 앞 수준이 남긴 데이터 위에서 돈다.

## autocannon

```bash
cd "$SB" && source perf.env && node "$R/perf/load-test.js"
```

`perf-seed-0@example.test`로 로그인하고, 지연 목표를 지키면서 `non2xx`, `errors`, `timeouts`가 모두
0일 때만 `PASS`를 찍는다.

## 정리

```bash
docker rm -f -v sharenpo-perf-db sharenpo-perf-clamav
```

그다음 앱을 멈추고(`netstat -ano | grep :3000`으로 PID를 확인한 뒤 그 PID만 종료한다) `$SB`를 지운다.
