# Scripts PowerShell

Ce dossier centralise les scripts PowerShell autonomes du projet.

## Sous-dossiers

- `agent-go/` : build, signature et deploiement de l'agent Go.
- `agent-windows/` : agent Windows legacy en PowerShell.
- `docs/` : utilitaires PowerShell lies a la documentation.

## Exemples

```powershell
Set-Location powershell\agent-go
.\build_agent.ps1
```

```powershell
Set-Location powershell\agent-windows
.\agent_collecte.ps1
```
