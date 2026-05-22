FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY apps/bff/package*.json ./apps/bff/

RUN npm install

COPY apps/bff ./apps/bff

RUN npm run build -w bff

WORKDIR /app/apps/bff

EXPOSE 4000

CMD ["npm", "run", "start"]
