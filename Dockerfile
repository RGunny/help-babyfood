# syntax=docker/dockerfile:1

# engines.node가 >=24이고 운영은 그 하한을 쓴다(ADR 0001).
FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
# package.json의 packageManager가 고정한 pnpm을 이미지에 미리 받아 둔다.
# 런타임에서도 preDeployCommand가 pnpm db:deploy를 부르므로 두 단계가 이 층을 공유한다.
COPY package.json ./
RUN corepack enable && corepack install

FROM base AS build
# 의존성 파일만 먼저 복사한다. 소스가 바뀌어도 설치 층이 재사용된다.
# pnpm-workspace.yaml에 minimumReleaseAge와 allowBuilds가 있어 빠지면 설치 동작이 로컬과 달라진다.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Prisma 7은 migrate도 build도 generate를 부르지 않는다. 빠지면 src/generated가 없어 빌드가 깨진다.
RUN pnpm prisma:generate
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
# 마이그레이션은 Railway의 preDeployCommand(pnpm db:deploy)가 이 이미지에서 돌린다.
COPY prisma ./prisma
COPY prisma7.config.ts ./
# allowBuilds가 @prisma/engines의 postinstall을 막아 두어 CLI는 schema engine을 처음 쓸 때 받는다.
# 그 시점이 preDeployCommand면 매 배포가 외부 다운로드에 기대고, USER node는 node_modules에 쓸 수 없다.
# 이미지를 만들 때 root로 한 번 받아 둔다.
RUN pnpm exec prisma version
# dist/generated/prisma가 런타임에 필요하므로 dist 전체를 넣는다.
COPY --from=build /app/dist ./dist
USER node
# PORT는 Railway가 환경 변수로 준다. src/main.ts가 없으면 3000을 쓴다. EXPOSE는 문서 목적이다.
EXPOSE 3000
CMD ["node", "dist/main"]
