#!/bin/bash

# Docker build command
docker buildx build --platform linux/amd64,linux/arm64 -t bluecode1775/sharenpo -f ./Dockerfile --target production .

# Docker push command
docker push bluecode1775/sharenpo:latest
