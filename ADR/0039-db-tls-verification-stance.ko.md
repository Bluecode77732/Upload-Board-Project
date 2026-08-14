# ADR 0039: 프로덕션 DB TLS — `rejectUnauthorized: false` 제거, 실제 대상이 생기면 정식 CA로 검증

- 상태: 승인됨
- 날짜: 2026-08-15
- 개정 대상: 커밋 `41c8c2c` (이 ADR이 제거하는 설정을 도입한 커밋)
- English: [0039-db-tls-verification-stance.md](0039-db-tls-verification-stance.md)

## 배경

커밋 `41c8c2c`("Modified: app.module; Switched SSL validation on for
uploading images on DB...")가 `backend/app.module.ts`의
`TypeOrmModule.forRootAsync` 팩토리에 이걸 추가했다:

```ts
...(configService.getOrThrow('NODE_ENV') === 'production' && {
  ssl: { rejectUnauthorized: false },
}),
```

커밋 메시지와 달리 `rejectUnauthorized: false`는 DB 연결의 TLS 인증서
검증을 **끄는** 설정이다 — "SSL validation on"이라는 서술과 정반대다.
개발자에게 확인한 결과: 구현 당시 AWS에 호스팅된 Postgres 연결을 수동으로
검증하기 위해 의도적으로 넣은 것이었다.

지금도 필요한지 조사한 결과:

- 같은 커밋이 `k8s/infra/terraform/main.tf`/`versions.tf`도 건드렸는데,
  diff를 따로 떼어 보면 Helm provider 문법 갱신(`kubernetes { }` →
  `kubernetes = { }`)과 Terraform/provider 버전 상향뿐이다. **이 저장소의
  Terraform 어디에도 RDS나 다른 관리형 데이터베이스 리소스는 그 전후로
  전혀 선언돼 있지 않다.**
- `NODE_ENV=production`으로 실제 DB에 붙는 CI 잡이 없다: `e2e` 잡은
  `ENV: dev`로 평범한 `postgres:16` 서비스 컨테이너에 붙고,
  `docker-publish`는 이미지를 빌드·게시만 할 뿐 실행하지 않는다.
- ROADMAP.md의 Stage 4 컴포넌트 상태표는 [ADR 0038](0038-terraform-iac-scaffold.ko.md)
  기준으로 여전히 **AWS**를 🆕(미착수)로 표시하고 있다.

즉 이 저장소에서 추적되는 것 중 이 설정에 의존하는 건 아무것도 없다. 다만
완전히 죽은 코드는 아니다 — `Dockerfile:53`이 프로덕션 스테이지에
`ENV NODE_ENV=production`을 고정해뒀으므로, 이 이미지가 TLS가 켜진
Postgres(실제 관리형 DB라면 거의 확실히 그럴 것)에 연결되는 순간 이 설정이
활성화되어 어떤 인증서든 조용히 받아들인다 — 지금 보호하고 있는 실제 대상이
없는 상태로 살아있는 MITM 노출이다.

같은 조사 도중 독립적인 두 번째 결함도 드러났다: 이 설정은 `NODE_ENV`로
분기하는데, `NODE_ENV`는 Joi 검증 스키마(`app.module.ts`의
`ConfigModule.forRoot`)에 선언돼 있지 않고 이 프로젝트의 확립된 환경 분기
관례도 아니다. 이미 검증된 `ENV`(`'dev' | 'prod'`)가 정확히 이런 프로덕션
전용 분기 용도로 쓰이고 있다 — 예: `auth.controller.ts:164`의 refresh 쿠키
`Secure` 플래그: `this.configService.getOrThrow<string>('ENV') === 'prod'`.
SSL 블록은 기존 스위치를 재사용하는 대신 검증되지 않고 프로젝트와 맞지 않는
두 번째 환경 스위치를 새로 만들었다.

## 결정

- **`rejectUnauthorized: false`를 지금 제거한다.** 현재 이걸 실행하는 경로가
  전혀 없으므로, 제거해도 dev·CI·게시된 이미지의 부팅 시퀀스 중 관찰 가능한
  동작은 전혀 바뀌지 않는다 — 휴면 상태의 위험 요소만 없앤다.
- **`ENV === 'prod'`로 게이팅한 스텁으로 대체하지 않는다.** 아직 구체적인
  프로덕션 데이터베이스 대상이 없다(Terraform은 여전히 미적응 스캐폴딩,
  [ADR 0038](0038-terraform-iac-scaffold.ko.md)) — 존재하지 않는 대상을 위한
  설정을 미리 만드는 건 투기적이고(Scope Discipline / YAGNI), 실제 요구사항을
  알기 전에 잘못된 형태(CA 파일 하나? 환경별 CA? `sslmode=verify-full`
  의미론?)를 추측할 위험이 있다.
- **실제 대상이 생겼을 때의 정석 패턴을 기록해둔다** — 다음 세션이 시간에
  쫓겨 다시 `rejectUnauthorized: false`를 넣는 대신 이걸 찾아 쓰도록: DB가
  제시하는 실제 CA 인증서를 `ssl: { ca: <인증서 내용> }`으로 넘긴다(AWS
  RDS라면 AWS가 모든 리전을 아우르는 공개 CA 번들을 제공한다). 새 선택적 env
  var(예: `DB_SSL_CA`)로 `ConfigService`를 통해 읽되, 그 var를 도입하는
  같은 변경에서 Joi 스키마와 `.env.example`에 함께 선언한다 — 이 프로젝트의
  기존 Config 관례(Architecture Decisions > Config)를 따른다. 게이팅은
  새 `NODE_ENV` 분기가 아니라 기존 `ENV === 'prod'` 체크를 쓴다.

## 기각한 대안

- **`rejectUnauthorized: false`는 유지하고 `NODE_ENV`→`ENV` 불일치만
  고친다** — 기각: 분기 변수만 고치고 인증서 검증은 계속 꺼둔 채로 두면
  더 작고 겉보기 문제만 고치고 실제 보안 문제는 그대로 남긴다.
- **지금 바로 `DB_SSL_CA`/`ssl.ca` 구현까지 완성한다** — 기각: 아직 검증할
  데이터베이스 자체가 없고, 구체적인 형태는 Stage 4가 아직 결정하지 않은
  배포 대상(RDS냐 자체 관리 Postgres냐 다른 것이냐) 선택에 달려 있다. 검증
  불가능한 설정 코드를 지금 쓰면 실제 대상이 정해진 뒤 다시 써야 할 위험이
  크다 — [ADR 0037](0037-helm-chart-scaffold.ko.md)/[ADR 0038](0038-terraform-iac-scaffold.ko.md)이
  Helm/Terraform 적응 자체를 미룬 것과 같은 이유다.

## 결과

- `backend/app.module.ts`의 `TypeOrmModule.forRootAsync` 팩토리가 `41c8c2c`
  이전 형태로 돌아간다 — 어떤 환경에서도 `ssl` 옵션 없음.
- dev, CI, Docker 이미지의 부팅 시퀀스 전부 영향 없음: 그 어느 것도 지금
  TLS가 켜진 Postgres 대상을 갖추고 있지 않았으므로, 제거된 분기를 어느
  쪽도 실행한 적이 없었다.
- 후속 작업(별도 작업으로 일정화하지는 않음; [ADR 0038](0038-terraform-iac-scaffold.ko.md)이
  추적하는 Terraform 적응 작업과 자연스럽게 함께 진행): 실제 프로덕션
  데이터베이스 대상이 정해지면 위 결정대로 `DB_SSL_CA`(Joi 스키마 +
  `.env.example`)를 추가하고 `ENV === 'prod'`로 게이팅한
  `ssl: { ca: ... }`를 연결한다.
- 스키마·엔티티·API 표면 변경 없음.
