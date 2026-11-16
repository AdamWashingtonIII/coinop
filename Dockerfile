# COINOP production image — works on Fly.io, Railway, Render, any VPS, or local Docker.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/public ./public
# Embedded Postgres data lives here — mount a volume at /app/.data on hosts
# without a hosted Postgres, or point the app at one (see DEPLOY.md).
VOLUME ["/app/.data"]
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
