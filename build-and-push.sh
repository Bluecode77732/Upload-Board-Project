#!/bin/bash

# Docker 빌드 명령
docker buildx build --platform linux/amd64,linux/arm64 -t bluecode1775/sharenpo:latest -f ./Dockerfile --target production .

# Docker push 명령
docker push bluecode1775/sharenpo:latest
