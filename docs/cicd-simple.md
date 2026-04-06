# Pipeline CI/CD simple (build, test, deploy)

Ce document explique la pipeline GitHub Actions definie dans `.github/workflows/ci-cd.yml`.

## Objectif

A chaque changement:
- Verifier que le backend et le frontend se construisent.
- Executer les tests disponibles.
- Deployer automatiquement en production apres validation (sur `main`).

## Declencheurs

- `pull_request` vers `main`: execute seulement le job CI.
- `push` sur `main`: execute CI puis deploy.
- `workflow_dispatch`: execution manuelle depuis GitHub Actions.

## Etape CI

Le job `ci` fait:

1. **Backend (Python/FastAPI)**
- Installe Python 3.11
- Installe les dependances (`backend/requirements.txt`) + `pytest`
- Lance les tests si un dossier `backend/tests` existe

2. **Frontend (React)**
- Installe Node 20
- Installe les dependances (`npm ci`)
- Lance les tests (`npm test`) en mode CI
- Build la version production (`npm run build`)

3. **Validation Docker**
- Build l'image Docker backend
- Build l'image Docker frontend

Le build Docker permet de detecter rapidement des erreurs de Dockerfile/dependances avant mise en prod.

## Etape Deploy

Le job `deploy` s'execute seulement si:
- evenement = `push`
- branche = `main`
- le job `ci` est au vert

Deploy via SSH:
- connexion au serveur
- `cd /opt/it-monitoring`
- `git pull origin main`
- `docker compose down`
- `docker compose up -d --build`
- nettoyage d'images inutilisees

## Secrets GitHub a configurer

Dans **Settings > Secrets and variables > Actions** du repo:

- `SSH_HOST`: IP ou DNS du serveur prod
- `SSH_USER`: utilisateur SSH (ex: `deploy`)
- `SSH_PRIVATE_KEY`: cle privee SSH (format OpenSSH)
- `SSH_PORT`: optionnel (22 par defaut)

## Prerequis cote serveur

Sur le serveur de production:

1. Le projet est clone dans `/opt/it-monitoring`
2. Docker + Docker Compose installes
3. Un fichier `.env` de production est present (non versionne)
4. Les ports necessaires sont ouverts (idealement 80/443 via reverse proxy)
5. L'utilisateur SSH a les droits pour executer Docker

## Bonne pratique recommandee

- Creer une branche `staging` avec un deploy vers environnement de pre-prod.
- Ajouter des tests backend (API) et frontend (composants/pages) pour durcir la qualite.
- Remplacer `docker compose down && up` par `docker compose up -d --build` si tu veux reduire l'interruption de service.
- Ajouter une sauvegarde PostgreSQL quotidienne avant deploy.
