# Image de build puis de service pour l'application React.
FROM node:20-alpine

# Répertoire de travail contenant le frontend pendant la construction.
WORKDIR /app

# Installation des dépendances Node.js à partir du manifeste et du lockfile.
COPY package.json package-lock.json ./
RUN npm install

# Copie de tout le code source frontend.
COPY . .

# Le fichier .env est optionnel selon l'environnement de build.
COPY .env* ./

# Génère la version statique optimisée de l'application.
RUN npm run build

# Le paquet serve sert les fichiers générés de manière simple en production légère.
RUN npm install -g serve
CMD ["serve", "-s", "build", "-l", "3000"]
