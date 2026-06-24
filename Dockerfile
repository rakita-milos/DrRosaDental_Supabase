FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend ./backend
COPY src ./src
COPY index.html README.md BACKEND_SETUP.md ./

WORKDIR /app/backend

EXPOSE 3000

CMD ["node", "server.js"]
