# ADR 0040: 재생 태그 선택을 위한 영속 `mediaType` 컬럼

- 상태: 채택됨
- 날짜: 2026-08-16
- 확장 대상: [ADR 0025](0025-file-visibility-and-media-expansion.ko.md) D4/D5와
  [ADR 0027](0027-media-type-expansion-implementation.ko.md) (두 ADR은
  `POST /upload/attach`가 어떤 확장자/mimetype을 받아들일지를 결정했고, 이 ADR은
  그 결과로 분류된 종류를 영속화하고 소비 측이 그로부터 재생 태그를 어떻게
  고르는지를 결정한다) — 어느 쪽도 개정하지 않으며 기존 결정을 바꾸지 않는다
- English: [0040-persisted-media-type-for-playback.md](0040-persisted-media-type-for-playback.md)

## 배경

ADR 0025 D4/D5와 ADR 0027은 `POST /upload/attach`를 확장해 `image`/`audio`/`video`
세 개의 타입별 멀티파트 필드를 받도록 했고, 각각 자체 확장자/mimetype 허용목록을
가졌다. 하지만 그 작업은 업로드된 파일이 어느 종류에 속하는지를 저장하지는
않았다 — `FileEntity`와 `FileResponseDto`는 `filePath`(그리고 암묵적으로 그
확장자)만 갖고 있을 뿐이다. `frontend/src/features/files/FileDetailPage.tsx`와
`frontend/src/features/posts/PostDetailPage.tsx` 둘 다 분기할 필드가 없으므로
파일 콘텐츠를 무조건 `<video controls>`로만 렌더링한다. 업로드된 jpg나 mp3는
`GET /file/:id/content`(ADR 0025/0026)를 통해 완전히 접근 가능하다 — 버그는
순전히 표현 계층의 문제다: `<video>` 요소는 이미지를 표시할 수 없고, 일부
브라우저가 `<video>` 태그로 mp3를 디코딩할 수는 있어도 사용자가 "재생 중"이라고
알아볼 만한 컨트롤 없이 빈 화면만 보여준다.

## 결정

### D1 — 새 컬럼: `FileEntity.mediaType`, 새 `FileMediaType` enum 기반

```typescript
export enum FileMediaType {
  image = 'image',
  audio = 'audio',
  video = 'video',
}
```

`backend/file/entity/file-media-type.enum.ts`에 위치하며, 기존 `FileVisibility`
관례를 그대로 따른다(varchar 기반 TS 문자열 enum, 동일한 파일 헤더 형식).
`FileEntity.mediaType`은 `@Column({ type: 'varchar' })`이며 **nullable이 아니다**
(기존 행 전부가 실제 값을 갖게 되는 방법은 D3에서 다룬다).

### D2 — 서버가 확장자로 값을 판정한다 — 클라이언트가 보내는 값은 없다

`FileService.uploadFile()`이 저장 경로의 확장자를 세 종류 중 하나로 스스로
매핑한다. 이때 쓰는 세 확장자 그룹은 `TEMP_FILENAME_PATTERN`
(`backend/file/dto/create-uploadFile.dto.ts`)이 이미 나열해 둔 것과 동일하다.
`UploadFileDto`에 새 필드가 추가되지 않고, `POST /upload/attach`의 응답 모양도
바뀌지 않으며, `upload.controller.ts`/`upload.service.ts`는 전혀 손대지 않는다
— 전달은 전적으로 이미 insert를 소유한 쓰기 경로 내부에서 끝난다.

기각된 대안: `POST /upload/attach`가 `{ filename, mediaType }`을 반환하고
클라이언트가 그 `mediaType`을 `POST /file` 본문에 그대로 되돌려 보내는 방식.
서버가 이미 같은 사실을 아무 신뢰 표면 추가 없이 스스로 판정할 수 있다는 점에서
기각했다 — 확장자는 이 시점 이전에 이미 서버가 발급하고 정규식으로 검증한
값이므로(`TEMP_FILENAME_PATTERN`), 서버가 스스로 계산할 수 있는 값을 굳이
클라이언트에게 되돌려 받는 것은 DTO 필드 하나, 손대야 할 파일 두 개, 그리고
검증해야 할 클라이언트 입력 한 곳을 추가로 늘릴 뿐 아무 이득도 없다.

### D3 — 마이그레이션: nullable 추가 → 확장자 기반 백필 → `NOT NULL`

`migration:generate`는 엔티티 모양을 살아있는 스키마와 비교해 diff만 낼 뿐이다
— `ADD COLUMN "mediaType" varchar`는 내놓지만, 이미 데이터가 있는 테이블에
`NOT NULL` 제약을 걸려면 먼저 백필이 필요하다는 사실은 알지 못한다. 마이그레이션은
한 파일 안에 검토를 거친 세 문장으로 구성된다:

```sql
ALTER TABLE file_entity ADD COLUMN "mediaType" varchar;

UPDATE file_entity SET "mediaType" = CASE
  WHEN "filePath" ~* '\.(jpg|jpeg|png|webp)$' THEN 'image'
  WHEN "filePath" ~* '\.mp3$' THEN 'audio'
  ELSE 'video'
END;

ALTER TABLE file_entity ALTER COLUMN "mediaType" SET NOT NULL;
```

기존의 모든 `granted_` 행은 이미 `filePath`에 실제 확장자를 갖고 있다(2단계
업로드 계약, ADR 0003은 애초에 확장자 없는 `filePath`를 허용한 적이 없다) —
그래서 이 `UPDATE`는 추측이 아니라 결정적 재분류다. D2와 동일한 세 확장자
그룹을 TypeScript 대신 SQL로 표현했을 뿐이다. 기각된 대안: 백필 없는 nullable
컬럼. 그렇게 하면 이 변경 이전에 업로드된 모든 행이 영원히 `null`로 남는다는
뜻이고, 이는 이 ADR이 고치려는 바로 그 버그(`FileDetailPage.tsx`가 무조건
`<video>`를 렌더링하는 것)가 기존 파일 전부에 대해 영원히 남는다는 뜻이므로
ADR 자체의 목적과 정면으로 어긋난다. 바로 그 이유로 `NOT NULL` + 백필로
확정했다(문서 작성 프로토콜 > 질문 단계에서 이 ADR을 쓰기 전에 개발자와 확인함).

### D4 — `FileResponseDto`에 `mediaType` 추가, `toResponse()`가 그대로 복사

DTO 계층에 판정 로직을 중복하지 않는다 — 컬럼이 이미 분류된 값을 갖고 있으므로
`toResponse()`(`file.service.ts`)는 오늘 `file.visibility`를 읽는 것과 같은
방식으로 `file.mediaType`을 읽는다.

### D5 — 프런트엔드: visibility가 아니라 mediaType으로 재생 태그를 분기한다

`FileDetailPage.tsx`와 `PostDetailPage.tsx` 둘 다 기존의 visibility 기반 재생
*소스* 로직은 그대로 둔다(private → 인증된 blob fetch + `objectURL`;
public/unlisted → 직접 `src`, ADR 0025/0026) — 각 분기가 렌더링하는 **태그**만
`file.mediaType`에 따라 조건부가 된다: `image` → `<img>`, `audio` →
`<audio controls>`, `video` → `<video controls>`. 두 축(visibility → 바이트를
어떻게 가져오는가; mediaType → 어떤 태그로 재생하는가)은 서로 직교하며, 하나의
분기로 합쳐지지 않고 나란히 구성된다.

### D6 — 범위 밖 / 여기서 결정하지 않은 것

- **확장자→종류 매핑 중복 제거.** 이제 세 곳에 서로 다른 목적으로 존재한다 —
  `TEMP_FILENAME_PATTERN`의 정규식 대체(업로드 검증), `CONTENT_TYPE_BY_EXTENSION`
  (`file-content.controller.ts`, HTTP `Content-Type` 헤더), 그리고 이 ADR이
  `file.service.ts`에 추가하는 새 판정(영속 분류). 이는 `CONTENT_TYPE_BY_EXTENSION`이
  `TEMP_FILENAME_PATTERN`과 이미 공유되지 않는 병렬 매핑으로 존재해 온 기존
  패턴과 일치한다 — Scope Discipline(요청 없이 새 공유 추상화를 만들지 않는다)에
  부합. 여기서 해결하지 않은 잔여 위험: 네 번째로 허용되는 확장자가 생기면 세
  곳 모두를 함께 갱신해야 한다.
- **`admin/`의 파일 뷰.** `admin/`은 루트 툴링 밖의 별도 프런트엔드다
  (CLAUDE.md > Project Overview) — 파일 콘텐츠를 어디선가 렌더링하더라도 이
  ADR은 건드리지 않는다.
- **생성 이후 `filePath`가 바뀐 행에 대한 `mediaType` 재판정**
  (`PATCH /file/:id { filePath }`). 그 경로는 이미 `filePath`를 동일한 확장자
  집합을 가진 `granted_` 접두사 값으로만 제한하지만, 그 쓰기에서 `mediaType`을
  다시 판정하는 문제는 여기서 다루지 않으며, 그 경로가 파일의 실제 종류를
  바꾸는 데 쓰인다면 남는 잔여 격차다.

## 결과

- 스키마 변경: 새 `NOT NULL` 컬럼 하나와 1회성 데이터 백필 — Scope Discipline에
  따라 `migration:run` 전에 줄 단위로 검토했다.
- 새로운 클라이언트 신뢰 표면 없음: `mediaType`은 전적으로 서버가 판정하므로
  (D2), 클라이언트가 되돌려주는 값처럼 실제 업로드된 파일과 어긋날 수 없다.
- `FileResponseDto`는 필드가 추가될 뿐이다 — 기존 필드의 이름 변경이나 삭제가
  없으므로 ADR 0011의 에러 코드/응답 계약 아래에서 이는 breaking change가
  아니다.
- `frontend/src/api/types.ts`의 `FileResponse`도 같은 변경 안에서 `mediaType`을
  추가해 백엔드 DTO와 동기화한다(`frontend/CLAUDE.md` > API & Error Handling).
- visibility, 접근 제어, `GET /file/:id/content` 게이트에는 아무 변경이 없다 —
  이 ADR이 개정하지 않는 ADR 0025/0026과는 직교한다.
- `file.service.spec.ts`의 `mockFileEntity`는 이제 필수가 된 `FileEntity` 모양을
  만족시키기 위해 `mediaType` 필드를 얻고, `uploadFile`의 insert-values
  단언에도 `mediaType` 기대값이 추가된다.
