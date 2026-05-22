FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY apps/frontend/package*.json ./apps/frontend/

RUN npm install

COPY apps/frontend ./apps/frontend

RUN npm run build -w frontend

WORKDIR /app/apps/frontend

EXPOSE 3000

CMD ["npm", "run", "start"]
