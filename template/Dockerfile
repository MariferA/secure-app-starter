FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate
WORKDIR /app
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY .husky/install.mjs .husky/install.mjs
RUN HUSKY=0 pnpm install --frozen-lockfile
FROM dependencies AS api-build
COPY apps/api apps/api
RUN pnpm --filter api build
FROM base AS api
ENV NODE_ENV=production
COPY --from=api-build /app/node_modules ./node_modules
COPY --from=api-build /app/apps/api ./apps/api
WORKDIR /app/apps/api
USER 1000:1000
CMD ["node", "--import", "tsx", "src/server.ts"]
FROM dependencies AS web-build
COPY apps/web apps/web
COPY scripts/public-config.* scripts/
COPY scripts/render-nginx.mjs scripts/
COPY nginx.conf ./
COPY app.config.json ./
ARG API_BASE_URL
ENV API_BASE_URL=$API_BASE_URL
RUN pnpm --filter web build && node scripts/render-nginx.mjs
FROM nginx:1.30.7-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY --from=web-build /tmp/app-nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i '/^user /d; s@/var/run/nginx.pid@/tmp/nginx.pid@; s@/run/nginx.pid@/tmp/nginx.pid@' /etc/nginx/nginx.conf
USER nginx
ENTRYPOINT ["nginx", "-g", "daemon off;"]
