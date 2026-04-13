import platform
import socket
import uuid
import requests
import subprocess
import json
import os

# Point d'entrée de l'agent local chargé de remonter l'inventaire d'une machine.

# URL du backend qui reçoit les données collectées. Une variable d'environnement
# permet de rediriger l'agent sans toucher au code.
BACKEND_URL = os.environ.get('ASSET_BACKEND_URL', 'http://192.168.196.134:8000/assets/scan')

# Structure centrale contenant les informations système qui seront enrichies puis envoyées.
info = {
    'hostname': socket.gethostname(),
    'os': platform.system(),
    'os_version': platform.version(),
    'ip': socket.gethostbyname(socket.gethostname()),
    'serial_number': '',
    'model': '',
    'mac': ':'.join(['{:02x}'.format((uuid.getnode() >> ele) & 0xff) for ele in range(0,8*6,8)][::-1]),
    'software': []
}

def get_serial_and_model():
    # Cette fonction interroge l'OS pour récupérer l'identifiant matériel
    # et le modèle de la machine selon la plateforme détectée.
    try:
        if info['os'] == 'Windows':
            sn = subprocess.check_output(['wmic', 'bios', 'get', 'serialnumber']).decode().split('\n')[1].strip()
            model = subprocess.check_output(['wmic', 'computersystem', 'get', 'model']).decode().split('\n')[1].strip()
            return sn, model
        elif info['os'] == 'Linux':
            sn = subprocess.check_output(['cat', '/sys/class/dmi/id/product_serial']).decode().strip()
            model = subprocess.check_output(['cat', '/sys/class/dmi/id/product_name']).decode().strip()
            return sn, model
    except Exception:
        return '', ''
    return '', ''

# On complète l'objet global avec les informations d'identification de la machine.
info['serial_number'], info['model'] = get_serial_and_model()

def get_software():
    # Cette fonction recense les logiciels installés. Le mécanisme varie
    # selon l'OS et peut cumuler plusieurs sources sous Linux.
    sw = []
    try:
        if info['os'] == 'Windows':
            output = subprocess.check_output(['wmic', 'product', 'get', 'name,version'], stderr=subprocess.DEVNULL).decode(errors='ignore')
            for line in output.split('\n')[1:]:
                parts = line.strip().split('  ')
                if len(parts) >= 2:
                    name = parts[0].strip()
                    version = parts[-1].strip()
                    if name:
                        sw.append({'name': name, 'version': version})
        elif info['os'] == 'Linux':
            try:
                output = subprocess.check_output(['dpkg-query', '-W', '-f=${Package} ${Version}\n']).decode()
                for line in output.split('\n'):
                    if line:
                        name, version = line.split(' ', 1)
                        sw.append({'name': name, 'version': version})
            except Exception:
                pass
            try:
                output = subprocess.check_output(['rpm', '-qa', '--qf', '%{NAME} %{VERSION}\n']).decode()
                for line in output.split('\n'):
                    if line:
                        name, version = line.split(' ', 1)
                        sw.append({'name': name, 'version': version})
            except Exception:
                pass
    except Exception:
        pass
    return sw


# La liste des logiciels est injectée avant l'envoi du payload au serveur.
info['software'] = get_software()

# --- Ajout collecte et envoi événements d'authentification ---
import re

def collect_auth_events():
    events = []
    if info['os'] == 'Windows':
        try:
            output = subprocess.check_output([
                'wevtutil', 'qe', 'Security', '/q:*[System[(EventID=4624 or EventID=4625 or EventID=4740)]]', '/f:text', '/c:10'
            ], stderr=subprocess.DEVNULL).decode(errors='ignore')
            for entry in output.split('\n\n'):
                if 'Event ID:' in entry:
                    evt_type = 'auth.unknown'
                    if 'Event ID: 4624' in entry:
                        evt_type = 'auth.login'
                    elif 'Event ID: 4625' in entry:
                        evt_type = 'auth.login_failed'
                    elif 'Event ID: 4740' in entry:
                        evt_type = 'auth.lockout'
                    user = ''
                    m = re.search(r'Account Name:\s*(\S+)', entry)
                    if m:
                        user = m.group(1)
                    events.append({
                        'event_type': evt_type,
                        'user': user,
                        'hostname': info['hostname'],
                        'os': info['os'],
                    })
        except Exception:
            pass
    elif info['os'] == 'Linux':
        try:
            with open('/var/log/auth.log', 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()[-20:]
            for line in lines:
                evt_type = None
                if 'session opened for user' in line:
                    evt_type = 'auth.login'
                elif 'authentication failure' in line:
                    evt_type = 'auth.login_failed'
                elif 'user locked' in line:
                    evt_type = 'auth.lockout'
                if evt_type:
                    m = re.search(r'user(?:name)?[ =]([\w-]+)', line)
                    user = m.group(1) if m else ''
                    events.append({
                        'event_type': evt_type,
                        'user': user,
                        'hostname': info['hostname'],
                        'os': info['os'],
                    })
        except Exception:
            pass
    return events

# Envoi inventaire classique
try:
    resp = requests.post(BACKEND_URL, json=info, timeout=10)
    print('Envoi inventaire réussi:', resp.status_code)
except Exception as e:
    print('Erreur lors de l\'envoi inventaire:', e)

# Envoi événements d'authentification
AUTH_EVENTS_URL = os.environ.get('AUTH_EVENTS_URL', 'http://192.168.196.134:8000/siem/auth-events')
auth_events = collect_auth_events()
for evt in auth_events:
    try:
        resp = requests.post(AUTH_EVENTS_URL, json=evt, timeout=10)
        print(f"Envoi event {evt['event_type']} pour {evt.get('user','')} :", resp.status_code)
    except Exception as e:
        print('Erreur envoi event:', e)
