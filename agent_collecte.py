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

# Dernière étape : publication des données collectées vers l'API centrale.
try:
    resp = requests.post(BACKEND_URL, json=info, timeout=10)
    print('Envoi réussi:', resp.status_code)
except Exception as e:
    print('Erreur lors de l\'envoi:', e)
