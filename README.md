# IT Monitoring

Projet de supervision et d'inventaire IT avec backend, frontend et plusieurs agents de collecte.

## Structure

- `agent-go/` : code et artefacts de l'agent Windows en Go.
- `powershell/` : scripts PowerShell de build, deploiement et agents Windows legacy.
- `python/` : scripts Python autonomes (agents et generation documentaire).
- `agent-linux/` : scripts shell d'installation Linux et documentation associee.
- `agent-windows/` : documentation et exemples pour l'agent Windows legacy.
- `backend/` : API et modele de donnees.
- `frontend/` : interface web React.
- `scripts/` : scripts utilitaires d'exploitation du projet.
- `docs/` : documentation de deploiement et de runbook.

## Points d'entree utiles

- Agent Go : voir `agent-go/` et `powershell/agent-go/`.
- Agent Go auth-only : voir `agent-go/cmd/it-auth-agent/` et `powershell/agent-go/deploy/install_auth_service.ps1`.
- Agent Linux : voir `agent-linux/README.md`.
- Agent Windows legacy : voir `agent-windows/README.md`.
- Orchestration locale Docker : `bash scripts/setup.sh`.

## Note

Le depot a ete recompose pour separer clairement les scripts PowerShell, les scripts Python et les sources Go.
