import React, { useEffect, useState } from 'react';
import MaintenanceLogs from './MaintenanceLogs';
import { backendUrl } from '../config/api';

export default function Inventaire() {
  // La page d'inventaire garde la liste des équipements et l'identifiant
  // de la ligne actuellement dépliée pour afficher son historique de maintenance.
  const [assets, setAssets] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState(null);

  useEffect(() => {
    // Chargement unique de l'inventaire au montage du composant.
    fetch(`${backendUrl}/assets`)
      .then(res => res.json())
      .then(data => setAssets(data));
  }, []);

  return (
    <div className="container mx-auto px-3 py-4 md:p-8">
      <h1 className="text-2xl font-bold mb-6">Inventaire Matériel</h1>
      <div className="bg-white shadow-md rounded-lg p-6">
        <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="py-3 px-6 text-left">Numéro de série</th>
              <th className="py-3 px-6 text-left">Modèle</th>
              <th className="py-3 px-6 text-left">Type</th>
              <th className="py-3 px-6 text-left">Alimentation</th>
              <th className="py-3 px-6 text-left">Utilisateur</th>
              <th className="py-3 px-6 text-left">Date d'achat</th>
              <th className="py-3 px-6 text-left">Fin garantie</th>
              <th className="py-3 px-6 text-left">Prix (€)</th>
              <th className="py-3 px-6 text-left">Statut</th>
              <th className="py-3 px-6 text-left">Maintenance</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset, idx) => (
              <React.Fragment key={asset.id}>
                {/* Chaque ligne représente un équipement ; une seconde ligne optionnelle
                    peut s'ouvrir juste en dessous pour afficher ses logs. */}
                <tr className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="py-2 px-6">{asset.serial_number}</td>
                  <td className="py-2 px-6">{asset.model}</td>
                  <td className="py-2 px-6">{asset.type_label}</td>
                  <td className="py-2 px-6">
                    {asset.power_status === 'sous_tension' ? (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                        Sous tension
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-700 border border-red-200">
                        Hors tension
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-6">{asset.owner_name}</td>
                  <td className="py-2 px-6">{asset.purchase_date}</td>
                  <td className="py-2 px-6">{asset.warranty_expiry}</td>
                  <td className="py-2 px-6">{asset.price}</td>
                  <td className="py-2 px-6">{asset.status}</td>
                  <td className="py-2 px-6">
                    <button
                      className="bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-700"
                      onClick={() => setSelectedAssetId(selectedAssetId === asset.id ? null : asset.id)}
                    >
                      {selectedAssetId === asset.id ? 'Fermer' : 'Voir'}
                    </button>
                  </td>
                </tr>
                {selectedAssetId === asset.id && (
                  <tr>
                    <td colSpan={10}>
                      <MaintenanceLogs assetId={asset.id} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
