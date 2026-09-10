# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D1/D2 — addons는
# 세 상태 중 apply 순서가 가장 마지막이라(D2), 그 출력을 remote_state로 읽어가는
# 다른 상태가 없다. 그래서 이 파일에는 현재 output 블록이 없다 — D4가 각
# 디렉터리에 outputs.tf를 두기로 한 것은 있어야 할 output이 실제로 생기면 바로
# 채울 자리를 남겨두는 것이지, 지금 당장 뭔가를 내보내야 한다는 뜻은 아니다.
