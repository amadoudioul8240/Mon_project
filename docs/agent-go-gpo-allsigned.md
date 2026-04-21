# Agent Go - Deploiement domaine GPO AllSigned

## Objectif
Mettre en place un deploiement domaine de l'agent Go avec:
- scripts signes,
- strategie PowerShell `AllSigned`,
- verification du signer via thumbprint.

Scripts fournis:
- `powershell/agent-go/deploy/gpo_startup_install_allsigned.ps1`
- `powershell/agent-go/deploy/gpo_startup_uninstall_allsigned.ps1`
- `powershell/agent-go/deploy/sign_all.ps1`

## 1. Preparer les artefacts signes

```powershell
Set-Location D:\projet-dev\It-monutoring\powershell\agent-go
.\build_agent.ps1
Set-Location .\deploy
.\sign_all.ps1 -CertThumbprint '<THUMBPRINT>' -StoreLocation CurrentUser
```

## 2. Preparer le partage SYSVOL/UNC
Exemple: `\\contoso.local\SYSVOL\contoso.local\scripts\it-agent-go`

Copier dans ce partage:
- `it-agent.exe`
- `it-auth-agent.exe`
- `config.json`
- `gpo_startup_install_allsigned.ps1`
- `gpo_startup_uninstall_allsigned.ps1` (rollback)

## 3. GPO - certificats de confiance
Dans la GPO cible:
- Computer Configuration > Policies > Windows Settings > Security Settings > Public Key Policies
- Importer le certificat de signature (public) dans:
  - Trusted Root Certification Authorities
  - Trusted Publishers

## 4. GPO - politique PowerShell
Dans la GPO cible:
- Computer Configuration > Policies > Administrative Templates > Windows Components > Windows PowerShell
- Activer `Turn on Script Execution`
- Choisir `Allow only signed scripts` (AllSigned)

## 5. GPO - script de demarrage (install)
Dans la GPO cible:
- Computer Configuration > Policies > Windows Settings > Scripts (Startup/Shutdown) > Startup
- Ajouter le script UNC:

```text
\\contoso.local\SYSVOL\contoso.local\scripts\it-agent-go\gpo_startup_install_allsigned.ps1
```

Arguments exemple:

```text
-SourceSharePath "\\contoso.local\SYSVOL\contoso.local\scripts\it-agent-go" -TrustedSignerThumbprint "<THUMBPRINT>" -BackendUrl "https://itm-api.contoso.local"
```

## 6. Rollback GPO (uninstall)
Si besoin, remplacer le startup script par:

```text
\\contoso.local\SYSVOL\contoso.local\scripts\it-agent-go\gpo_startup_uninstall_allsigned.ps1
```

Arguments exemple:

```text
-TrustedSignerThumbprint "<THUMBPRINT>"
```

Pour conserver les fichiers locaux en rollback:

```text
-TrustedSignerThumbprint "<THUMBPRINT>" -KeepFiles
```

## 7. Verification poste client

```powershell
Get-Service ITMonitoringGoAgent
Get-AuthenticodeSignature "C:\ProgramData\ITMonitoringAgent\it-agent.exe" | Format-List Status, SignerCertificate
Get-Content "C:\ProgramData\ITMonitoringAgent\gpo-startup-allsigned.log" -Tail 30
```

## 8. Bonnes pratiques
- Utiliser un certificat Code Signing d'entreprise (pas auto-signe en prod).
- Renouveler le certificat avant expiration et signer a nouveau les artefacts.
- En cas de rotation de certificat, mettre a jour le thumbprint dans la GPO.
