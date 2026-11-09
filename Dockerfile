FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:shared

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4174 COOKIE_SECURE=1
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY src/economy/points.ts ./src/economy/points.ts
USER node
EXPOSE 4174
CMD ["node","--experimental-strip-types","server/index.mjs"]

FROM nginx:1.27-alpine AS web
COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
