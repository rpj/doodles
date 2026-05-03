FROM node:latest AS base
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY *.ts ./
COPY watch-classifier ./watch-classifier
RUN npm install
ENTRYPOINT ["npm", "start"]