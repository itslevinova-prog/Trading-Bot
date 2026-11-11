FROM node:22-bookworm AS build
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
ENV DOCKER=true
ENV PORT=3000
EXPOSE 3000
CMD ["node","apps/server/dist/index.js"]
