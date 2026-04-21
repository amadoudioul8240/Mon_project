# Windows Agent Legacy

Ce dossier regroupe les scripts historiques de collecte pour Windows.

## Contenu

- `../powershell/agent-windows/agent_collecte.ps1` : agent Windows principal en PowerShell.
- `../powershell/agent-windows/agent_auth_collect.ps1` : agent Windows dedie aux seules authentifications.
- `../powershell/agent-windows/install_auth_service.ps1` : installation du service Windows auth-only.
- `../powershell/agent-windows/uninstall_auth_service.ps1` : suppression du service Windows auth-only.
- `../python/agent-windows/agent_collecte.py` : variante Python de l'agent Windows legacy.
- `scan_payload.json` : exemple de payload collecte.

## Usage

PowerShell:

```powershell
Set-Location powershell\agent-windows
.\agent_collecte.ps1
```

PowerShell auth-only:

```powershell
Set-Location powershell\agent-windows
.\agent_auth_collect.ps1 -VerboseOutput
```

Installation du service auth-only:

```powershell
Set-Location powershell\agent-windows
.\install_auth_service.ps1 -AuthUrl http://192.168.196.134:8000/siem/auth-events
```

Desinstallation du service auth-only:

```powershell
Set-Location powershell\agent-windows
.\uninstall_auth_service.ps1
```

Python:

```powershell
Set-Location python\agent-windows
python .\agent_collecte.py
```

## Variable d'environnement

- `ASSET_BACKEND_URL` permet de surcharger l'URL backend cible.
- `AUTH_EVENTS_URL` permet de surcharger l'URL cible pour l'agent auth-only.
