FROM node:24.12-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:24.12-alpine AS runner

WORKDIR /app
RUN apk upgrade --no-cache \
  && apk add --no-cache chromium ffmpeg tesseract-ocr \
  && mkdir -p /var/lib/doonce/artifacts /var/lib/doonce/videos \
  && chown -R node:node /var/lib/doonce
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV ARTIFACT_STORAGE_PATH=/var/lib/doonce/artifacts
ENV VIDEO_STORAGE_PATH=/var/lib/doonce/videos
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 4000
VOLUME ["/var/lib/doonce"]
USER node
CMD ["node", "dist/index.js"]
