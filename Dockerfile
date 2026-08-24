FROM node:24.12-alpine@sha256:c921b97d4b74f51744057454b306b418cf693865e73b8100559189605f6955b8 AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime

WORKDIR /app
RUN apk upgrade --no-cache \
  && apk add --no-cache chromium ffmpeg tesseract-ocr \
  && mkdir -p /var/lib/doonce/artifacts /var/lib/doonce/videos \
  && chown -R node:node /var/lib/doonce \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx
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

FROM runtime AS migrator
COPY --from=build /app/database/migrations ./database/migrations
CMD ["node", "dist/database/migrate.js"]

FROM runtime AS runner
CMD ["node", "dist/index.js"]
