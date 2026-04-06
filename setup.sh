#!/bin/bash
set -e

# Script d'orchestration local : il construit les images, démarre la stack
# puis injecte les données SQL d'initialisation dans PostgreSQL.

echo "[1/3] Construction des images Docker..."
docker compose build

echo "[2/3] Démarrage des conteneurs..."
docker compose up -d

# La boucle attend que PostgreSQL accepte les connexions avant d'exécuter le SQL.
until docker exec parc_db pg_isready -U parc_admin > /dev/null 2>&1; do
  echo "En attente de PostgreSQL..."
  sleep 2
done

echo "[3/3] Exécution du script d'initialisation SQL..."
# Le script SQL est copié dans le conteneur puis exécuté avec psql.
docker cp init.sql parc_db:/init.sql
docker exec parc_db psql -U parc_admin -d parc_db -f /init.sql

echo "✅ Déploiement terminé !"
echo "Frontend : http://localhost:3000"
echo "Backend  : http://localhost:8000"
