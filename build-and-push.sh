#!/bin/bash

# Docker 빌드 명령
docker buildx build --platform linux/amd64,linux/arm64 -t bluecode1775/sharenpo:latest -f ./Dockerfile --target production .

# push는 Docker Hub의 공개 :latest 태그를 덮어쓰므로 사람이 한 번 확인한다(deploy.sh와 같은 방식).
# read 실패(입력 없음)는 빈 답으로 보고 중단한다.
read -r -p "bluecode1775/sharenpo:latest 를 Docker Hub에 push할까요? [y/N] " answer || answer=""
if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
  echo "push 단계에서 중단했습니다." >&2
  exit 1
fi

# Docker push 명령
docker push bluecode1775/sharenpo:latest
