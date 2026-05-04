FROM node:latest AS base
WORKDIR /app

# Claude Code is invoked by the inline watch classifier (classify-post.ts)
# via `claude -p`. Pinned for reproducibility — bump deliberately when the
# host CLI is upgraded.
RUN npm install -g @anthropic-ai/claude-code@2.1.126

# Quieten the per-invocation auto-update check on a daemon process.
ENV DISABLE_AUTOUPDATER=1

COPY package*.json ./
COPY tsconfig.json ./
COPY *.ts ./
COPY watch-classifier ./watch-classifier
RUN npm install
ENTRYPOINT ["npm", "start"]