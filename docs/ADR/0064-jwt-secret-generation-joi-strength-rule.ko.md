# ADR 0064: Terraform이 만드는 JWT 시크릿은 앱의 Joi 강도 규칙을 만족해야 한다

- Status: Accepted — 구현됨(`f322972`). 2026-09-26 라이브 검증: 다시 apply한 뒤 백엔드가 부팅했고 로그인이 됐다
- Date: 2026-09-26
- Extends: [ADR 0043](0043-terraform-project-adaptation.ko.md) (D7은 네 시크릿을 Terraform이 `random_password`로 생성하게 했지만 그 값에 무엇이 들어가야 하는지는 정하지 않았다)
- Relates to: [ADR 0057](0057-terraform-state-backend-s3-native-lock.ko.md) (생성된 값은 state에 평문으로 남는다), [ADR 0063](0063-alb-dns-externaldns-and-delegation-set.ko.md) (전체 `apply`/`destroy` 반복이 예상되는 사용 방식이다)
- English: [0064-jwt-secret-generation-joi-strength-rule.md](0064-jwt-secret-generation-joi-strength-rule.md)

## Context

백엔드의 Joi 스키마(`backend/app.module.ts`)는 `ACCESS_TOKEN_SECRET`과 `REFRESH_TOKEN_SECRET`이 32자
이상이고 소문자, 대문자, 숫자, 기호(`[^A-Za-z0-9]`)를 모두 포함하지 않으면 부팅을 거부한다. 이 규칙은
2026-09-11에 들어갔다. 보안 점검에서 값이 있는지만 검사한다는 점이 발견됐기 때문이다(`CLAUDE.md`의
Known gaps). 같은 변경이 *테스트용* 시크릿이 있는 곳, 즉 CI의 더미 시크릿과 `.env.example`은 고쳤지만,
실제 시크릿을 만드는 곳과는 아무것도 이어 주지 않았다.

그곳이 `app-infra/main.tf`다. [ADR 0043](0043-terraform-project-adaptation.ko.md) D7은 Helm 차트의
`secrets.existingSecret`이 필요로 하는 네 값을 Terraform이 `random_password`로 생성하게 해서, 시크릿을 손으로
입력하거나 커밋하는 일이 없게 했다. 두 토큰 시크릿은 `length = 48, special = false`였다. 즉 영숫자 48자이고
기호가 없다. (`special = false`는 기호가 접속 문자열이나 셸 인용을 깨뜨릴 수 있는 DB 비밀번호를 위해 쓴
값인데, 토큰 시크릿은 둘 어디에도 쓰이지 않으면서 그것을 따라 썼다.) D7은 값이 어디서 오는지를 정했을
뿐 무엇이 들어가는지는 정하지 않았기 때문에, 앱의 규칙을 만족해야 한다는 것이 어디에도 기록돼 있지 않았다.

이 불일치는 규칙이 생긴 뒤의 첫 라이브 실행(2026-09-26)에서 드러났다(그 전의 라이브 배포,
2026-08-25~27은 규칙보다 앞선다). 스택은 문제없이 apply됐고 마이그레이션 Job도 성공했는데, 백엔드 파드는
부팅 중에 크래시 루프에 빠졌다 — 18분 동안 8번 재시작 — 나머지 워크로드 셋은 Ready였다. 개발자가 값을
가려서 읽은 부팅 로그는 `Config validation error: "ACCESS_TOKEN_SECRET" with value "<redacted>" fails to
match the required pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/`로 끝났다. 리프레시
시크릿도 같은 방식으로 생성되므로 같은 검사에서 걸린다. 세션은 로그를 직접 읽지 않았다. Joi가 문제의 값을
그대로 출력하기 때문이다.

## Decision

### D1 — 규칙을 낮추지 않고 생성 쪽이 앱의 규칙을 만족하게 한다

`random_password.access_token_secret`과 `random_password.refresh_token_secret` 둘 다 `special = true`,
`override_special = "-_"`, `min_lower = min_upper = min_numeric = min_special = 1`로 바꾸고 `length`는
48 그대로 둔다. `min_*` 값은 어떤 문자 종류가 빠지는 일을 드물게가 아니라 불가능하게 만든다. 기호가 64자
풀에 두 개뿐이라 48자를 뽑으면 기호가 하나도 없을 확률이 다섯 번에 한 번꼴(`(62/64)^48 ≈ 0.22`)이라서
`min_special = 1`은 선택이 아니다. `-_`는 URL, 셸, YAML 어디서도 이스케이프가 필요 없고, 규칙은 기호 하나만
요구하므로 더 넓은 집합은 규칙이 검사하는 것에는 보탬이 없이 위험만 더한다.

### D2 — DB 비밀번호는 그대로 둔다

`random_password.db`는 `special = false`를 유지한다. 그 이유(접속 문자열, 셸 인용)는 여전히 유효하고, 앱에는
DB 비밀번호에 대해 값이 있어야 한다는 것 외의 강도 규칙이 없다.

### D3 — 차트나 이미지 변경 없이 라이브 스택에 반영한다

`app-infra/`를 다시 apply해서 두 `random_password`와 시크릿 버전을 교체하고, External Secrets가 새 값을
즉시 가져오도록 `ExternalSecret`에 `force-sync` 어노테이션을 달고(새로고침 주기는 1시간이다), 파드가 바뀐
`Secret`을 읽도록 백엔드 Deployment를 재시작한다.

## Alternatives rejected

각 항목은 대안이 무엇을 더 잘했는지를 적는다. 그것이 감수한 트레이드오프이기 때문이다. 개발자가 비교표를 보고
세 안 중에서 골랐다.

- **Joi 규칙을 낮춘다**(기호 요구를 뺀다). 다시 apply할 것이 없고, 잘못된 것이 규칙이라는 시각이다. 택하지
  않았다: 2주 전에 정한 보안 결정을 배포가 불편하다는 이유로 되돌리는 것이고(Never Do Group 3, 편의보다
  우선한다), 고위험 파일인 `app.module.ts`를 고쳐야 하며, 배포하려면 이미지를 다시 빌드하고 `main`에
  병합해야 한다. 이 안은 별도의 결정으로 열려 있다: 무작위 영숫자 48자 시크릿은 약 285비트라서 문자 종류 규칙은
  사람이 고른 시크릿을 위한 대용 기준이고, 생성된 시크릿에는 길이나 엔트로피 규칙으로 바꾸는 것이 정책
  변경이라 배포 수정이 아니라 자체 ADR로 다뤄야 한다.
- **Secrets Manager의 값을 손으로 바꾼다**(`put-secret-value`). 코드 변경이 없어 가장 빠르다. 택하지 않았다:
  생성 규칙이 그대로라서 이후의 모든 apply가 — 전체 apply/destroy 반복이 예상되는 사용 방식이다
  ([ADR 0063](0063-alb-dns-externaldns-and-delegation-set.ko.md)) — 앱이 거부하는 시크릿을 만들고, 손으로 넣은
  값이 state와 어긋나며, 시크릿이 개발자의 셸을 거친다.

## Consequences

- **apply 전에 확인한 것:** `terraform fmt -check`와 `terraform validate`가 통과한다. 규칙의 정규식을 새 생성
  규칙이 허용하는 최악의 조합(문자 종류마다 하나씩이고 나머지는 소문자)으로 만든 샘플에 돌리면 통과하고,
  옛 모양(영숫자 48자)에 돌리면 실패해서 라이브 오류가 재현된다.
- **라이브에서 관찰한 것(2026-09-26, 모든 명령은 개발자가 실행했고 세션은 AWS와 클러스터를 읽기 전용으로
  조회했다):** `app-infra/` plan은 `3 to add, 0 to change, 3 to destroy`였다. 세션은 시크릿 버전이 제자리에서
  갱신될 것이라 보고 `2 to add / 1 to change / 2 to destroy`를 예상했는데 틀렸다. 세 번째로 교체된 리소스는
  `aws_secretsmanager_secret_version.app`으로 추정한다(plan 줄은 세션에 보이지 않았다): Secrets Manager에
  16:06Z에 만들어진 새 `AWSCURRENT` 버전이 있고 이전 버전은 `AWSPREVIOUS`로 내려갔으며, RDS 인스턴스, ACM
  인증서, IAM 역할, S3 버킷은 생성 시각이 그대로이고 Route53 zone도 id가 그대로였다. `force-sync`와
  재시작 뒤 백엔드는 `1/1 Running`이고 `/health/live`와 `/health/ready`가 `200`이었으며, `POST /auth/signin`이
  액세스 토큰(179자, JWT 접두어 `eyJ`)을 돌려줬다. 앱이 새 시크릿으로 부팅하고 서명한다는 뜻이다.
- **감수한 것:** 시크릿을 바꾸면 옛 시크릿으로 발급된 토큰이 무효가 되는데, 백엔드가 한 번도 부팅하지 못했으므로
  발급된 토큰이 없었다. 옛 값은 state 버킷의 이전 버전에 평문으로 남아 있고([ADR 0057](0057-terraform-state-backend-s3-native-lock.ko.md)),
  Secrets Manager의 이전 버전에도 시크릿이 삭제될 때까지 남는다(철거는 `recovery_window_in_days = 0`이라 즉시
  지운다).
- **닫지 못한 것:** 생성 규칙과 Joi 규칙을 자동으로 이어 주는 것이 없어서 규칙을 다시 강화하면 다음 라이브
  부팅에서 같은 방식으로 실패한다. CI 검사는 새 도구라 여기서는 넣지 않았다(범위 준수). `app-infra/main.tf`의
  두 리소스 위 주석이 규칙을 밝히고 있어서, 생성 규칙을 고치는 사람은 그 제약을 볼 수 있다.
