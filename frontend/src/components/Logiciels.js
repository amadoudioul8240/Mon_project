import React, { useEffect, useState } from 'react';
import axios from 'axios';

import { backendUrl } from '../config/api';

export default function Logiciels() {
  // La page affiche désormais l'inventaire réel remonté par le script de scan.
  const [software, setSoftware] = useState([]);
  const [selectedMachine, setSelectedMachine] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchSoftware = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await axios.get(`${backendUrl}/software`);
        setSoftware(res.data || []);
      } catch (err) {
        setSoftware([]);
        setError('Impossible de charger les logiciels installés.');
      } finally {
        setLoading(false);
      }
    };

    fetchSoftware();
  }, []);

  const machineOptions = Array.from(
    new Set(software.map((sw) => `${sw.asset_serial_number} - ${sw.asset_model}`))
  ).sort((a, b) => a.localeCompare(b));

  const filteredSoftware = selectedMachine === 'all'
    ? software
    : software.filter((sw) => `${sw.asset_serial_number} - ${sw.asset_model}` === selectedMachine);

  return (
    <div className="container mx-auto px-3 py-4 md:p-8">
      <h1 className="text-2xl font-bold mb-6">Gestion des licences logicielles</h1>
      <div className="bg-white shadow-md rounded-lg p-6">
        <div className="mb-4 flex flex-col md:flex-row md:items-center gap-3">
          <label className="text-sm font-semibold text-gray-700">Filtrer par machine</label>
          <select
            className="border rounded px-3 py-2 md:w-96"
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
          >
            <option value="all">Toutes les machines</option>
            {machineOptions.map((machine) => (
              <option key={machine} value={machine}>{machine}</option>
            ))}
          </select>
          <span className="text-sm text-gray-500">{filteredSoftware.length} entrée(s)</span>
        </div>

        {loading && <div className="text-gray-600 mb-4">Chargement des logiciels...</div>}
        {error && <div className="text-red-500 mb-4">{error}</div>}
        <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="py-3 px-6 text-left">Nom du logiciel</th>
              <th className="py-3 px-6 text-left">Version</th>
              <th className="py-3 px-6 text-left">Éditeur</th>
              <th className="py-3 px-6 text-left">Machine</th>
              <th className="py-3 px-6 text-left">Clé de licence</th>
              <th className="py-3 px-6 text-left">Date d'installation</th>
              <th className="py-3 px-6 text-left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filteredSoftware.length === 0 && (
              <tr>
                <td className="py-4 px-6 text-gray-500" colSpan={7}>
                  Aucune donnée logicielle disponible. Les machines AD sans agent apparaissent avec le statut En attente.
                </td>
              </tr>
            )}
            {filteredSoftware.map((sw, idx) => (
              <tr key={`${sw.asset_id}-${sw.name}-${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="py-2 px-6">{sw.name}</td>
                <td className="py-2 px-6">{sw.version || '-'}</td>
                <td className="py-2 px-6">{sw.publisher || '-'}</td>
                <td className="py-2 px-6">{`${sw.asset_serial_number} - ${sw.asset_model}`}</td>
                <td className="py-2 px-6 font-mono">{sw.license_key || '-'}</td>
                <td className="py-2 px-6">{sw.install_date || '-'}</td>
                <td className="py-2 px-6">
                  {sw.collection_status === 'pending' ? (
                    <span className="inline-block px-3 py-1 rounded-full bg-orange-100 text-orange-700 font-semibold border border-orange-300">
                      En attente
                    </span>
                  ) : (
                    <span className="inline-block px-3 py-1 rounded-full bg-green-100 text-green-700 font-semibold border border-green-300">
                      Détecté
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
