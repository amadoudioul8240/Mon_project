# Agent Go - Signature des scripts et binaire (AD CS)

## Objectif
Signer les scripts PowerShell et les binaires `it-agent.exe` et `it-auth-agent.exe` pour:
- eviter les erreurs `ExecutionPolicy` en environnement enterprise,
- garantir l'integrite des artefacts deployes.

Le script fourni est:
- `powershell/agent-go/deploy/sign_all.ps1`

## 1. Prerequis
- Un certificat `Code Signing` avec cle privee dans:
  - `Cert:\CurrentUser\My` ou
  - `Cert:\LocalMachine\My`
- EKU present: `Code Signing (1.3.6.1.5.5.7.3.3)`
- Poste de build avec les fichiers de `agent-go`.

## 2. Recuperer le thumbprint

```powershell
Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3' } |
  Select-Object Subject, Thumbprint, NotAfter
```

Si le certificat est en machine:

```powershell
Get-ChildItem Cert:\LocalMachine\My |
  Where-Object { $_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3' } |
  Select-Object Subject, Thumbprint, NotAfter
```

## 3. Signer tous les artefacts

Depuis le dossier `powershell/agent-go/deploy`:

```powershell
Set-Location D:\projet-dev\It-monutoring\powershell\agent-go\deploy
.\sign_all.ps1 -CertThumbprint '<THUMBPRINT>' -StoreLocation CurrentUser
```

Si certificat en magasin machine:

```powershell
.\sign_all.ps1 -CertThumbprint '<THUMBPRINT>' -StoreLocation LocalMachine
```

## 4. Verifier la signature

```powershell
Get-AuthenticodeSignature .\install_service.ps1 | Format-List Status, StatusMessage, SignerCertificate
Get-AuthenticodeSignature D:\projet-dev\It-monutoring\agent-go\deploy\it-agent.exe | Format-List Status, StatusMessage, SignerCertificate
Get-AuthenticodeSignature D:\projet-dev\It-monutoring\agent-go\deploy\it-auth-agent.exe | Format-List Status, StatusMessage, SignerCertificate
```

## 5. Politique d'execution recommandee

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy AllSigned -Force
```

En entreprise, deploiement via GPO recommande:
- Trusted Root Certification Authorities,
- Trusted Publishers,
- PowerShell Execution Policy sur `AllSigned` ou `RemoteSigned` selon votre standard.

## 6. Sequence de build recommandee

```powershell
Set-Location D:\projet-dev\It-monutoring\powershell\agent-go
.\build_agent.ps1
Set-Location .\deploy
.\sign_all.ps1 -CertThumbprint '<THUMBPRINT>' -StoreLocation CurrentUser
Set-Location ..
.\make_package.ps1
```
