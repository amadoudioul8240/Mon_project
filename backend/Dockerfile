# Image d'exécution minimale pour l'API FastAPI.
FROM python:3.11-slim

# Répertoire de travail dans lequel seront copiés le code et les dépendances.
WORKDIR /app

# Installation des dépendances Python avant de copier le reste, ce qui améliore le cache Docker.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copie du code backend dans l'image finale.
COPY . .

# Lance l'API sur toutes les interfaces réseau du conteneur.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
