# Builds the landing page from the monorepo and serves it with nginx.
# Build from the repo root so the desktop kit and shared package are in the context:
#   docker build -f apps/web/Dockerfile -t standbye-web .
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @crew/web... --ignore-scripts
COPY packages/shared packages/shared
COPY packages/supervisor/src/templates.ts packages/supervisor/src/templates.ts
COPY apps/desktop/src/renderer/ui apps/desktop/src/renderer/ui
COPY apps/desktop/src/renderer/styles.css apps/desktop/src/renderer/styles.css
COPY apps/web apps/web
RUN pnpm --filter @crew/shared build && pnpm --filter @crew/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
