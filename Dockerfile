FROM node:22-alpine

RUN apk add --no-cache git
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json ./
RUN pnpm install --no-frozen-lockfile

COPY src/ ./src/

EXPOSE 22

ENV PORT=22

CMD ["node", "--import=tsx/esm", "src/server.ts"]
