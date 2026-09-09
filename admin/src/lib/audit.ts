// 목적: AuditLog 형태와 action-to-badge-color 매핑을 공유한다.
// 사용처: audit-log 레코드를 렌더링하는 dashboard-page.tsx, logs-page.tsx, users-page.tsx
// 어디에서든 import한다.
// 근거: 동일한 인터페이스와 색상 매핑이 세 페이지에 그대로 중복되어 있었고,
// users-page.tsx의 새 "Recent activity" 패널이 추가되면 네 번째 복사본이 될 상황이었다.

export interface AuditLog {
    id: number;
    actorId: number;
    targetId: number | null;
    // 다형적인 `targetId`를 구분하는 값이다 (backend ADR 0045). 모든 레코드에 존재하며
    // — GET /audit-log가 엔티티를 그대로 반환하기 때문 — nullable인 이유도 `targetId`와
    // 같다: 백엔드의 불변식은 `targetType IS NULL` ⟺ `targetId IS NULL`이다.
    targetType: string | null;
    action: string;
    detail: string | null;
    createdAt: string;
}

// 대상 종류별로 출력할 명사. `action`이 아니라 서버의 `targetType`을 키로 쓴다:
// 기존 TARGET_NOUN 맵은 action을 키로 써서 클라이언트 쪽에서 대상 종류를 다시 유추해야
// 했는데, 이는 백엔드가 이미 행 자체에 저장해 둔 정보를 중복으로 들고 있는 셈이었다
// (ADR 0045 D2 — 읽기 경로는 의도적으로 action -> target-kind 매핑을 갖지 않는다).
// 서버에 여섯 번째 action이 추가되어도 여기는 변경 없이 올바르게 라벨링된다.
const TARGET_LABEL: Record<string, string> = {
    user: 'User',
    file: 'File',
    post: 'Post',
    comment: 'Comment',
};

// audit 행의 대상을 화면에 표시하기 위해 렌더링한다. 예전에는 모든 행이 "User {targetId}"로
// 표시되어, 대상이 file/post/comment인 세 action에서는 잘못된 표시였다 — 운영자가
// "FILE_DELETE ... User 313"을 보면 실제로는 file 313을 봐야 하는데 user 313을 탓하게 된다.
// 이제는 `action`에서 유추하지 않고 서버의 `targetType`을 그대로 읽는다. 타입이 없거나
// 인식되지 않으면 명사를 추측하는 대신 그냥 "#id"로 표시한다 — 이 분기에 도달하는 유일한
// 경우는 마이그레이션 이후에도 ADR 0045 이전 백엔드 코드가 작성한 행뿐이다.
export function targetLabel(targetType: string | null, targetId: number | null): string {
    if (targetId === null) return '—';
    const noun = targetType === null ? undefined : TARGET_LABEL[targetType];
    return noun ? `${noun} ${targetId}` : `#${targetId}`;
}

// backend/audit-log/dto/audit-log-query.dto.ts의 AUDIT_ACTIONS를 그대로 반영한다. 각 색상
// 쌍은 dark: variant(900번대 배경, 200번대 텍스트)를 함께 가져서, theme.store.ts가
// documentElement에 `dark` 클래스를 추가해도 배지가 계속 읽히도록 한다.
export function actionColor(action: string): string {
    if (action === 'ROLE_CHANGE') return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200';
    if (action === 'USER_DELETE') return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200';
    if (action === 'FILE_DELETE') return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200';
    if (action === 'POST_DELETE') return 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200';
    if (action === 'COMMENT_DELETE') return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
}
