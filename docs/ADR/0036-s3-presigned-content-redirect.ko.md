# ADR 0036: `GET /file/:id/content`의 S3 presigned 리다이렉트

- 상태: 채택됨 — 2026-08-13 구현 완료
- 날짜: 2026-08-13
- 개정 대상: [ADR 0025](0025-file-visibility-and-media-expansion.ko.md) /
  [ADR 0026](0026-file-visibility-implementation.ko.md) (`GET /file/:id/content`가
  강제하는 접근 검사 계약 자체는 그대로다 — 검사를 통과한 *이후*의 동작만 바뀐다),
  그리고 [ADR 0029](0029-storage-port-adapter.ko.md)의 `FileStorage` 포트에 메서드
  하나를 추가로 확장한다
- English: [0036-s3-presigned-content-redirect.md](0036-s3-presigned-content-redirect.md)

## 배경

ADR 0029는 `S3Storage.createReadStream()`을 `LocalDiskStorage.createReadStream()`과
동일한 형태로 만들었다 — 둘 다 `FileContentController`에 `Readable`을 넘기고,
컨트롤러가 그것을 그대로 HTTP 응답에 파이프한다. 이 대칭은 ADR 0029의 범위(순수한
어댑터 교체, 동작 변경 없음) 안에서는 옳은 선택이었지만, 결과적으로
`STORAGE_DRIVER=s3`에서도 승인된 파일의 모든 바이트가 여전히 Node 프로세스를 통과한다 —
앱 서버가 `GetObjectCommand`를 보내 S3 응답 본문을 받은 뒤 그것을 다시 클라이언트로
스트리밍하는 구조다. S3를 도입한 이유 중 하나는 스토리지 대역폭을 앱 계층에서
분리하는 것이었는데(ROADMAP.md §4, 프로덕션 DevOps 스택), 현재의 프록시 구조는 그
목표를 달성하지 못한다 — 비디오/오디오/이미지를 읽을 때마다 CPU와 대역폭이 API
레플리카 수만큼 그대로 앱 계층에 몰리는 것은 로컬 디스크 시절의 비용 구조와 다를 게
없다. ROADMAP.md의 컴포넌트 상태표에서 `S3` 행은 남은 작업을 "실버킷 컷오버"로만
기록하고 있는데, 이 ADR은 그 컷오버가 행의 원래 동기(대역폭 이전)를 실제로 달성한
상태가 되기 전에 거쳐야 할 설계 관문이다.

이전 세션에서 논의하고 이번 작업에서 확정한 방향: `resolveContentAccess`
(`FileService`, ADR 0025 D1/D2)가 요청을 통과시킨 뒤 — `public` 하나만이 아니라
**세 가시성 전부**에 대해 — 콘텐츠 엔드포인트는 직접 바이트를 프록시하는 대신
수명이 짧은 S3 서명 URL을 발급해 302로 리다이렉트한다. 이후 브라우저(또는
`<video>`/`<audio>` 요소)가 S3에서 직접 바이트를 가져간다. `LocalDiskStorage`에는
이에 대응하는 개념이 없으므로 `STORAGE_DRIVER=local`은 오늘의 프록시 스트리밍
동작을 한 글자도 바꾸지 않는다 — 이 ADR은 `s3`에서만 추가되는 동작이다.

## 결정

### D1 — `FileStorage`에 메서드 하나 추가: `getSignedReadUrl`

```typescript
getSignedReadUrl(key: string, contentType: string): Promise<string | null>;
```

- `LocalDiskStorage.getSignedReadUrl`은 항상 `null`을 반환한다 — 로컬 디스크에는
  서명 URL이라는 개념 자체가 없다. 예외를 던지지 않고 `null`을 돌려주는 것은
  "이 어댑터는 이 기능을 지원하지 않는다"를 나타내는 이미 확립된 패턴이다
  (`existsTemp`의 boolean 계약과 같은 성격).
- `S3Storage.getSignedReadUrl`은 `@aws-sdk/s3-request-presigner`(신규 의존성, D4)의
  `getSignedUrl`을 `GetObjectCommand`에 대해 호출하며, `ResponseContentType:
  contentType`을 실어 보낸다 — 리다이렉트된 응답이 컨트롤러가 오늘도
  `CONTENT_TYPE_BY_EXTENSION`으로 확장자에서 뽑아내는 `Content-Type`을 그대로
  유지하도록 하기 위해서다. S3 오브젝트는 `PutObjectCommand`(`S3Storage.saveTemp`)
  시점에 명시적 `ContentType`을 지정하지 않고 저장되므로, 이렇게 하지 않으면
  "콘텐츠 타입은 확장자로 판정한다"는 컨트롤러의 기존 동작이 저장 시점에 우연히
  결정된 값에 의존하는 쪽으로 바뀌어 버린다.
- 서명 발급은 로컬 SigV4 연산이지 네트워크 왕복이 아니다 — 서명 URL을 만드는 데
  별도의 S3 요청이 들지 않으므로, 이 변경이 지금 `stat()` 호출이 지불하는
  `HeadObjectCommand` 비용을 다시 얹는 일은 없다(D2 참고: 서명 URL을 발급하는
  경로에서는 `stat()`/`createReadStream()` 자체를 아예 건너뛴다).
- TTL은 이 메서드의 매개변수가 **아니다**. `S3Storage`는 생성 시점에 `ConfigService`로
  한 번만 읽는다(D3) — `AWS_REGION`/`S3_BUCKET`을 읽는 것과 같은 자리(ADR 0029 D3).
  호출자(컨트롤러)는 TTL 값을 보지도, 고르지도 않는다 — 그 설정 세부사항을
  어댑터 내부 관심사로 가둬 두는 편(정보 은닉)을 택했다.

### D2 — 컨트롤러 흐름: 먼저 서명하고 리다이렉트, `null`이면 기존 스트리밍으로 폴백

`FileContentController.getContent`는 `resolveContentAccess`가 파일을 반환하고
컨트롤러가 `contentType`을 뽑아낸 직후(기존과 동일) — `storage.stat()`을 호출하기
**전에** — `storage.getSignedReadUrl(file.filePath, contentType)`을 호출한다.

- `null`이 아니면 → `res.redirect(302, signedUrl)` 후 종료. `stat()`과
  `createReadStream()`은 전혀 호출되지 않는다 — S3가 자체 `Content-Length`를
  주고 클라이언트가 서명 URL에 직접 보내는 `Range` 헤더도 S3가 직접 처리하므로,
  컨트롤러의 기존 Range/206/416 로직은 이 경로에서 전혀 실행되지 않는다.
- `null`(`LocalDiskStorage`에서는 항상 이 값) → 오늘의 `stat()` + Range 파싱 +
  `createReadStream()` 흐름이 그대로, 변경 없이 실행된다.

접근 게이트(`resolveContentAccess`)는 오늘과 마찬가지로 항상 먼저 실행된다 — 이
ADR은 "누가 서명-또는-스트리밍 분기까지 도달할 수 있는가"는 전혀 바꾸지 않고,
통과한 뒤에 일어나는 일만 바꾼다.

### D3 — TTL: `CONTENT_SIGNED_URL_TTL_SECONDS = 300`, 신규 환경변수

이번 작업을 위해 사용자에게 직접 확인해 확정했다(Documentation Authoring Protocol >
질문 단계): 세 가시성 등급 전체에 균일하게 적용하는 5분 고정 TTL이다 — 등급별로
다른 만료시간(예: private을 더 짧게)은 요청되지도, 설계되지도 않았다. 검토한
대안과 트레이드오프:

| TTL | 트레이드오프 |
|---|---|
| 60초 | 유출 노출 시간은 가장 짧지만, 1분만 지나도 탐색(seek)이나 새로고침마다 거의 매번 재서명이 일어난다 — `resolveContentAccess` 왕복이 늘어난다. |
| **300초 (채택)** | 보통의 한 번 시청 세션을 재서명 없이 커버하면서도 유출 노출 시간은 짧게 유지한다. 이 저장소의 다른 단기 토큰들과 자릿수가 같다. |
| 900초 | 느린 재생·일시정지에 여유가 있지만 유출 노출 시간이 더 길어진다. |
| 3600초 | 재서명을 거의 없애지만, 유출된 private 파일 URL이 철회 수단 없이 한 시간 동안 그대로 유효하다. |

기존 `TEMP_SWEEP_TTL_HOURS` 관례(ADR 0018)를 그대로 따른다: Joi 스키마에
`Joi.number().default(300)` 항목과 `.env.example` 줄을 이 ADR을 구현하는 같은
변경에서 함께 추가한다. `STORAGE_DRIVER=s3` 조건부로 게이트하지는 않는다 — 로컬
어댑터는 이 값을 아예 읽지 않으므로 쓰이지 않는 숫자 기본값이 있어도 무해하다.

### D4 — 신규 런타임 의존성: `@aws-sdk/s3-request-presigner`

공식 AWS SDK v3 패키지이며, 이미 `dependencies`에 있는 `@aws-sdk/client-s3`(ADR
0029 결과)와 같은 라이선스 계열(Apache-2.0)이라 새로운 카피레프트 우려는 없다.
범위 준수 원칙에 따라 이를 추가하는 것은 구현 시점 작업이며 `pnpm add` +
`pnpm audit` 확인을 별도로 거친다 — 이 문서 자체에서 미리 가정하지 않는다.

### D5 — 리다이렉트 상태 코드: `301`이 아니라 `302 Found`

서명 URL은 용도가 단일하고 시간이 정해진 자격증명이다 — 리다이렉트 매핑을
캐시하면(`301`이 중간 프록시/CDN에게 캐시하라고 유도하는 것처럼) TTL이 지난 뒤에는
쓸모가 없어질 뿐 아니라, 이 앱이 통제할 수 없는 어딘가에 자격증명이 실린 URL을
불필요하게 남기는 셈이 된다. `302`는 "이 특정 매핑을 캐시하지 말라"는 신호이며,
실제로 발급하는 것의 수명과 정확히 맞는다.

### D6 — 이 ADR이 명시적으로 다루지 않는 것

- **리다이렉트를 거친 뒤 `frontend/`·`admin/`의 미디어 소비자 쪽 Range 요청 동작.**
  S3는 presigned `GetObject` URL에 대해서도 `Range` 헤더를 처리하며,
  `<video>`/`<audio>` 요소는 302를 따라간 뒤 서명 URL에 대해 자체적으로 Range
  요청을 다시 보낼 것으로 예상된다. 두 프런트엔드가 돌아가는 모든
  브라우저/OS 조합이 리다이렉트 경계를 넘나드는 Range 탐색 재생 미디어 요소를
  동일하게 처리하는지(특히 탐색할 때마다 원래의 `GET /file/:id/content` URL을
  다시 요청하는 방식이 과거 일부 플레이어/리다이렉트 조합에서 일관되지 않았던
  전례가 있다)는 **미검증**이다 — 이 ADR은 설계와 위험을 기록할 뿐 검증하지는
  않는다. 검증과 필요시 소비자 쪽 대응은 `frontend/`/`admin/`에서 별도로 명시
  요청되어야 하는 작업이며, 이 백엔드 작업의 범위 밖이다.
- **`STORAGE_DRIVER=local` 동작.** 완전히 그대로다 — `getSignedReadUrl`은 항상
  `null`을 반환하므로 로컬 디스크의 기존 테스트와 동작(Range, 206, 416, 커밋
  이후 unlink)은 전혀 건드리지 않는다.
- **버킷 앞단 CDN(CloudFront).** 여기서 설계하지 않는다 — 서명 URL은 버킷을
  직접 가리킨다. CDN 계층은 추진하게 되더라도 별도의, 아직 일정에 없는 Stage 4
  작업이다.
- **`FileResponseDto.fileUrl` / `FileService.toResponse()`.** 변경 없음. `fileUrl`은
  여전히 `GET /file/:id/content`를 가리키고 — 리다이렉트는 그 엔드포인트의 핸들러
  내부에서만 일어난다. 이 ADR은 `file.service.ts`를 전혀 건드리지 않는다.
- **이미 발급된 서명 URL의 조기 철회.** SigV4 presigned URL로는 불가능하다 —
  이로 인한 트레이드오프는 아래 결과 절에서 다룬다.

## 결과

- **`STORAGE_DRIVER=s3`에 한해, private/unlisted 콘텐츠의 보안 모델이 바뀐다.**
  오늘은 `GET /file/:id/content`에 대한 모든 개별 바이트-범위 요청이
  `resolveContentAccess`를 매번 다시 통과한다(요청마다 JWT/공유 토큰을 새로
  검사). 이 변경 이후에는 *첫* 요청만 그렇게 검사하고, 그 결과로 받은 서명
  URL은 이후 `CONTENT_SIGNED_URL_TTL_SECONDS`(300초) 동안 **그것을 손에 넣은
  누구나**(브라우저 네트워크 탭, 프록시 로그, 복사된 링크) 추가 검사 없이,
  조기에 철회할 방법도 없이 접근할 수 있게 된다. private 콘텐츠에 대해 지금과는
  분명히 다른 신뢰 모델이며, TTL을 짧게 잡았다는 점(D3)과 이 ADR의 목적 자체가
  앱 계층 프록시 비용을 없애는 것이라는 점을 근거로 여기서 받아들인다 — 나중에
  발견되는 조용한 퇴행이 아니라, 알고 선택한 트레이드오프로 지금 기록해 둔다.
- 이 변경이 반영되면 `STORAGE_DRIVER=s3`에서 승인된 파일을 읽을 때 앱 서버의
  대역폭·CPU 비용이 거의 0으로 떨어진다 — 리다이렉트 경로에서는
  `GetObjectCommand` 프록시도, `stat()`을 위한 `HeadObjectCommand`도 일어나지
  않는다. 이것이 이 변경의 본래 동기다.
- `local-disk.storage.spec.ts`와 `s3.storage.spec.ts`는 같은 변경에서 각각
  `getSignedReadUrl` 테스트 케이스를 얻었다(각각 `null` 반환과 서명 URL 호출
  형태를 검증) — 두 파일 모두 이미 존재하며 각자의 SDK/`fs/promises`를 모킹하고
  있다(CLAUDE.md > 테스트). `pnpm lint` 클린, 단위 테스트 211개 전부 통과.
- `file-content.controller.ts`에는 `*.spec.ts`가 없다 — 컨트롤러는 커버리지
  측정 대상 계층 밖이라(CLAUDE.md > 테스트) 새 단위 테스트 의무는 없지만,
  리다이렉트 분기는 아직 `pnpm test:e2e`로 검증되지 않는다 — e2e 스위트가
  로컬 어댑터로만 돌고 CI에서 `STORAGE_DRIVER=s3`를 실행하지 않기 때문이다.
  잔여 사항일 뿐 막는 요소는 아니다 — ADR 0029 이후 `S3Storage`의 다른
  메서드들과 같은 상태다.
- ROADMAP.md의 S3 컴포넌트 상태 행, `ADR/README.md`, `README.md`의
  `GET /file/:id/content` 설명 모두 같은 변경에서 이 ADR을 인용하고 반영된
  리다이렉트를 반영하도록 갱신했다(EN+KO).
- 신규 런타임 의존성 추가: `@aws-sdk/s3-request-presigner@^3.1109.0`
  (Apache-2.0, `pnpm audit --prod` 결과 새로운 취약점 없음 — 기존 5건 전부
  `aws-sdk`/`@nestjs/swagger`/`typeorm` 경로이며 이 패키지를 거치지 않음).
- 스키마 변경 없음, `FileEntity` 변경 없음, DTO 변경 없음.

### 추가 기록 (2026-08-15) — 리다이렉트 분기는 더 이상 "미검증"이 아니라, 검증했더니 한 티어에서 실패한다

위 항목은 리다이렉트 분기를 "CI가 안 돌려서 미검증"이라고만 적었다. 어느
로컬 세션이 `.env`의 `STORAGE_DRIVER=s3`(CI 설정이 아니라 상시 켜둔 "로컬
브라우저 테스트 세션" 오버라이드) 상태에서 `pnpm test:e2e`를 직접 돌려봤다 —
단위 테스트 목이 아니라 실제로 S3 드라이버 아래서 이 분기가 실행된 첫
사례다. 결과: 22개 중 21개 통과, 실패한 1건은
`frontend/e2e/detail.spec.ts:73`("a private file plays for its owner via an
authenticated blob fetch…")다 — `expect(contentResponse.status()).toBe(200)`가
`200`이 아니라 `302`를 받는다.

원인을 끝까지 추적하면:

- `FileDetailPage.tsx`의 **private** 티어 재생 경로는 `<video src>`를 쓰지
  않고 직접 콘텐츠를 fetch한다 — `<video>` 요소는 `Bearer` 헤더를 실어 보낼
  수 없기 때문이다. `frontend/src/api/client.ts:100-121`의
  `requestBlob()`/`api.getBlob()` 참고.
- `STORAGE_DRIVER=s3`에서는 이 `fetch()`가 이제 이 ADR이 만든 `302`를
  받아 교차 출처(S3) URL로 리다이렉트된다. 브라우저는 리다이렉트를 자동으로
  따라가지만, 교차 출처 응답의 *본문*을 JS에 넘겨주려면(`response.blob()`)
  S3 응답에 CORS 헤더가 있어야 하는데 버킷에는 그게 없다. 이것은
  2026-08-14 프론트엔드 스타일 개편 UI 점검에서 별도로 표시했던 "S3 CORS
  문제"(`frontend/docs/STYLE-PLAN.md` > "범위 밖이지만 관련된 사항")와 같은
  현상이다 — 별개의 두 번째 결함이 아니라, 같은 문제를 두 번 관찰한 것이다.
- `public`/`unlisted` 재생은 영향받지 않는다: 이 두 티어는 평범한
  `<video src="/file/:id/content">`로 스트리밍하고(`detail.spec.ts:112`,
  `:142` 둘 다 통과) — 인라인 미디어 로드는 *재생*에 CORS가 필요 없고 JS가
  바이트를 읽을 때만 필요하므로, 교차 출처 리다이렉트가 blob-fetch 경로처럼
  막히지 않는다.
- 별개로, CORS를 고치더라도 `detail.spec.ts:95`의 단언은 갱신이 필요하다:
  Playwright의 `waitForResponse` 조건은 URL에 `/file/${id}/content`
  부분 문자열이 포함되는지로 매칭하는데, 이는 리다이렉트의 *첫* 홉(`302`
  자체)에만 매칭되고 — 최종 S3 응답은 URL이 달라서 매칭되지 않는다. 이
  단언은 바이트가 실제로 도착하는지와 무관하게 체인의 잘못된 구간을 검사하고
  있다.

정리하면: D6의 "미검증" 서술은 private 파일 경로에 한해 **갱신됐다** — 그
경로는 이제 검증됐고, `STORAGE_DRIVER=s3`에서 실패한다. `public`/`unlisted`는
검증됐고 통과한다.

여기서 결정하지 않은 것(후보 해결책 두 가지, 둘 다 필요할 수도 있음 — 이
기록은 발견 사실만 남기며 해결책을 정하지 않는다):

1. S3 버킷의 CORS 정책을 프론트엔드/admin origin에 대해 `GetObject` 응답에
   허용하도록 설정 — 이것 없이는 테스트가 무엇을 단언하든 상관없이
   `STORAGE_DRIVER=s3`에서 private 파일 blob-fetch가 동작할 수 없다.
2. `detail.spec.ts:73`의 단언을 리다이렉트의 실제 모양에 맞게 갱신하거나,
   `public`/`unlisted`의 직접 스트리밍 태그와 달리 *private* 티어의
   blob-fetch 경로에는 리다이렉트가 애초에 맞는 답인지 재검토 — 이 ADR도,
   이 추가 기록도 내리지 않은 판단이다.

### 추가 기록 (2026-08-16) — 후보 해결책 두 가지 모두 적용·검증 완료

위의 후보 해결책 1은 해결됐다. 버킷 설정을 조회해 보니(`GetBucketCorsCommand`)
`NoSuchCORSConfiguration`이 나왔다 — 규칙이 잘못 설정된 게 아니라 아예 없었다.
`PutBucketCorsCommand`로 규칙 하나를 적용했다(이 프로젝트에 이미 있는
`@aws-sdk/client-s3` 의존성을 쓴 임시 스크립트 — 신규 의존성 없음, 소스 코드
변경 없음, 스크립트 자체도 커밋하지 않았다):

```json
{
  "AllowedOrigins": ["http://localhost:5173", "http://localhost:5174"],
  "AllowedMethods": ["GET"],
  "AllowedHeaders": ["*"],
  "MaxAgeSeconds": 300
}
```

두 origin은 이 백엔드 자체의 `CORS_ORIGIN`(`.env`)과 정확히 같다 — 프런트엔드와
admin 개발 서버뿐, 그 이상으로 넓히지 않았다. `GET`만 허용한 이유는, presigned
`GetObject` 응답을 읽는 것이 이 프로젝트의 어떤 소비자든 만드는 유일한 교차 출처
읽기이기 때문이다. 아직 프로덕션 origin은 없다 — 배포는 여전히 ROADMAP.md의
번호 없는 마지막 미착수 항목이다 — 그러니 배포가 착지하면 그때 프로덕션
origin을 추가할 것이며, 지금 도메인을 추측해 넣지 않는다.

단순히 HTTP 상태만 다시 확인한 게 아니라 실제로 재검증했다: 실제 Chromium
세션(Playwright)에서 새로 올린 private 영상을 소유자 본인이 끝까지 재생했다.
`<video>` 요소가 `readyState: 4`(`HAVE_ENOUGH_DATA`)에 도달했고
`videoWidth`/`videoHeight`도 0이 아닌 실제 값이었으며, CORS 콘솔 에러도
"Network error" 메시지도 없었다 — 상태 코드만 정상인 게 아니라 실제로 재생됐다.
`public`/`unlisted` 재생은 원래부터 영향받지 않았고 지금도 그렇다.

후보 해결책 2는 이 추가 기록이 처음 작성될 당시엔 미해결로 남아 있었다. CORS를
고친 뒤 `detail.spec.ts`를 다시 돌려보면 5개 중 4개는 통과했지만, 여전히
`detail.spec.ts:73`의 `expect(contentResponse.status()).toBe(200)`이 실패했다 —
이유도 위에서 기록한 그대로다: 이 단언은 리다이렉트의 *첫* 홉(`302` 자체, 이
ADR 아래서는 정상)에만 매칭되고 최종 응답에는 매칭되지 않으므로, 재생이
실제로 되는지와 무관하게 통과할 수 없는 단언이었다. 별도의, 커밋하지 않은
임시 Playwright 점검으로 단언 실패와 별개로 실제 재생은 성공함을 확인했다.

**후보 해결책 2도 같은 날 처리됐다**: 단언을
`expect([200, 302]).toContain(contentResponse.status())`로 완화했다(드라이버에
따라 둘 다 올바른 첫 홉이다). 그리고 이미 있던 `video[src^="blob:"]` 단언 —
브라우저가 실제로 리다이렉트를 따라가 정상 CORS 헤더 아래서 S3 응답 본문을
읽고 `FileDetailPage`가 그것을 objectURL로 바꿔야만 통과할 수 있는 단언 — 이
실제 성공의 진짜 증거 역할을 하도록 남겨두고, "Network error" 메시지가 없다는
단언을 추가로 더했다. `STORAGE_DRIVER=local`과 `STORAGE_DRIVER=s3` **양쪽
모두**에서 5/5 통과를 확인했다(`.env` 오버라이드를 전환하고 백엔드를 재기동해
테스트한 뒤, 다시 원래대로 되돌리고 재기동함 — 환경은 발견했을 때와 정확히
같은 상태로 남겨뒀다). 이로써 이 추가 기록은 마무리된다 — 두 후보 해결책 중
남은 것이 없다.
