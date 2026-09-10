FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim

# Linux containers use native tools; MSYS2 is only for the Windows desktop build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash rsync openssh-client sshpass git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN command -v bash \
    && command -v rsync \
    && command -v ssh \
    && command -v sshpass \
    && command -v git

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=49173 \
    SYNC_CONFIG=/data/sync-config.json

COPY --from=build /app ./
RUN mkdir -p /data /sync

EXPOSE 49173
CMD ["npm", "start"]
