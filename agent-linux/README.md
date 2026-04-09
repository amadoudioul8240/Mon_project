# Linux Agent - IT Monitoring

Cet agent est dedie aux systemes Linux et envoie les donnees vers le backend IT Monitoring.

## Fonctions

- Inventaire machine et logiciels (`/assets/scan`)
- Posture securite de base (`/security/posture`)
- Metriques CPU/RAM/disque (`/metrics/resources`)
- Telemetrie reseau locale (`/network/telemetry`)

URL backend par defaut:

- `http://192.168.196.134:8000/assets/scan`

## Execution ponctuelle

```bash
python3 agent_linux_collect.py --verbose
```

## Execution en boucle

```bash
python3 agent_linux_collect.py --loop --interval 300 --verbose
```

## Installation comme service systemd

Depuis le dossier `agent-linux`:

```bash
sudo bash install_linux_agent.sh http://192.168.196.134:8000/assets/scan
```

Verifier le service:

```bash
systemctl status it-monitoring-linux-agent.service
journalctl -u it-monitoring-linux-agent.service -n 100 --no-pager
```

## Notes

- La variable d'environnement `ASSET_BACKEND_URL` peut surcharger l'URL backend.
- Le script ne depend que de Python standard (pas de pip requis).
