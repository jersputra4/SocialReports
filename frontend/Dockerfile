FROM node:22-bookworm-slim AS build
WORKDIR /app

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Nilai Vite dibakar ke dalam bundel saat build, bukan dibaca saat kontainer
# berjalan. Karena itu ia harus masuk sebagai build arg; mengisinya lewat
# `environment` di compose tidak akan berpengaruh apa pun.
ARG VITE_WHATSAPP_NUMBER=
ENV VITE_WHATSAPP_NUMBER=$VITE_WHATSAPP_NUMBER
ARG VITE_WHATSAPP_MESSAGE=
ENV VITE_WHATSAPP_MESSAGE=$VITE_WHATSAPP_MESSAGE

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
