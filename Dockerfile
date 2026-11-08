# Wanxiang Deck (万象卡域) — static web build served by nginx.
# Container listens on 3000 (Cloady maps it to 443 outside), same pattern
# as the xray app in this workspace. No AI services, no backend, no secrets.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . ./
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
