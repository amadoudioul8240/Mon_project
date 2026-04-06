import React, { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import AddAssetModal from './AddAssetModal';
import EditAssetModal from './EditAssetModal';

const backendUrl = process.env.REACT_APP_BACKEND_URL;

// Couleur unique par famille d'équipement (normalisée pour gérer accents/variantes).
const TYPE_COLORS = {
  'ordinateur portable': '#0D6EFD',
  'laptop': '#0D6EFD',
  'ordinateur fixe': '#7B2CBF',
  'fixe': '#7B2CBF',
  'desktop': '#7B2CBF',
  'serveur': '#F4A261',
  'imprimante': '#E63946',
  'routeur': '#FF6699',
  'switch': '#00B4D8',
  'ecran': '#2A9D8F',
  'autre': '#6C757D',
};
const DEFAULT_COLORS = ['#264653', '#1D3557', '#8D99AE', '#B56576', '#6D597A', '#3D5A80'];

function normalizeTypeLabel(label = '') {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getTypeColor(label, index = 0) {
  const normalized = normalizeTypeLabel(label);
  if (TYPE_COLORS[normalized]) {
    return TYPE_COLORS[normalized];
  }
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function Dashboard() {
  // États principaux : liste des équipements, statistiques et affichage des modales.
  const [assets, setAssets] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editAsset, setEditAsset] = useState(null);
  const [stats, setStats] = useState([]);
  const [deleteId, setDeleteId] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const chartData = useMemo(() => {
    const parsed = (stats || [])
      .map((item) => ({
        name: item.name,
        value: Number(item.value) || 0,
      }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);

    if (parsed.length <= 7) {
      return parsed;
    }

    const top = parsed.slice(0, 7);
    const othersValue = parsed.slice(7).reduce((sum, item) => sum + item.value, 0);
    return [...top, { name: 'Autres', value: othersValue }];
  }, [stats]);

  const fetchAssets = () => {
    // Charge la liste complète des équipements pour remplir le tableau principal.
    fetch(`${backendUrl}/assets`)
      .then((res) => res.json())
      .then((data) => setAssets(data));
  };
  const fetchStats = () => {
    // Charge les agrégats par type utilisés dans le graphique circulaire.
    fetch(`${backendUrl}/stats/assets-by-type`)
      .then((res) => res.json())
      .then((data) => setStats(data));
  };
  useEffect(() => {
    // Au chargement initial de l'écran, on récupère à la fois le tableau et les stats.
    fetchAssets();
    fetchStats();
  }, []);

  // Association simple entre statut métier et style visuel affiché dans l'interface.
  const statusColors = {
    'En service': 'bg-green-500',
    'en service': 'bg-green-500',
    'En maintenance': 'bg-orange-400',
    'en maintenance': 'bg-orange-400',
    'Stock': 'bg-gray-400',
    'stock': 'bg-gray-400',
  };

  const handleAssetAdded = () => {
    // Après un ajout, on recharge les données pour garder l'écran synchronisé.
    fetchAssets();
    fetchStats();
  };

  const handleAssetUpdated = () => {
    // Même principe après une modification existante.
    fetchAssets();
    fetchStats();
  };

  const handleEditClick = (asset) => {
    // Prépare l'équipement à éditer puis ouvre la modale correspondante.
    setEditAsset(asset);
    setShowEditModal(true);
  };

  const handleDeleteClick = (id) => {
    // Le clic ne supprime pas immédiatement : il ouvre d'abord la confirmation.
    setDeleteId(id);
  };

  const confirmDelete = async () => {
    // La suppression réelle n'a lieu qu'après validation dans la modale.
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await fetch(`${backendUrl}/assets/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null);
      fetchAssets();
      fetchStats();
    } catch (e) {
      alert("Erreur lors de la suppression.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleChange = (e) => {
    // Cette fonction est pensée pour un formulaire contrôlé centralisé.
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    // Soumission d'un équipement via une requête POST simple.
    e.preventDefault();
    fetch(`${backendUrl}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
      .then((res) => res.json())
      .then((newAsset) => {
        setAssets([...assets, newAsset]);
        setShowModal(false);
        setForm({ numero_serie: '', modele: '', statut: '' });
      });
  };

  return (
    <div className="fade-up mx-auto max-w-[1700px] p-3 md:p-6">
      <div className="mb-6 rounded-3xl border border-slate-200/70 bg-gradient-to-r from-slate-900 via-cyan-900 to-slate-800 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold md:text-4xl">Tableau de bord du parc</h1>
            <p className="mt-1 text-sm text-cyan-100/90 md:text-base">
              Vue globale du materiel, des statuts et des capacites en temps reel.
            </p>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-3 text-sm text-cyan-100/90 backdrop-blur-sm">
            Derniere mise a jour: {new Date().toLocaleString()}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        <div className="w-full">
          {/* Bloc gauche : actions et tableau détaillé des équipements. */}
          <div className="mb-6 flex flex-wrap gap-3">
            <button
              className="rounded-xl bg-cyan-700 px-5 py-2.5 font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-cyan-800"
              onClick={() => setShowModal(true)}
            >
              + Ajouter un matériel
            </button>
            <button
              className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 font-bold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50"
              onClick={async () => {
                try {
                  const res = await fetch(`${backendUrl}/ad/sync/computers`, { method: 'POST' });
                  const data = await res.json();
                  if (!res.ok) {
                    throw new Error(data.detail || 'Erreur sync AD ordinateurs');
                  }
                  alert(`Sync AD ordinateurs terminée. Créés: ${data.created}, Mis à jour: ${data.updated}, Ignorés: ${data.skipped}`);
                  fetchAssets();
                  fetchStats();
                } catch (e) {
                  alert(e.message || 'Erreur lors de la synchronisation AD des ordinateurs.');
                }
              }}
            >
              Importer ordinateurs AD
            </button>
          </div>

          <div className="mb-6 grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-md">
              <div className="flex items-center gap-4">
              <span className="rounded-full bg-cyan-700 p-2 text-xl text-white">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2a2 2 0 002 2h6a2 2 0 002-2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 11a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              </span>
              <div>
                <div className="text-3xl font-bold text-slate-900">{assets.length}</div>
                <div className="text-sm text-slate-600">Total Matériel</div>
              </div>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-md">
              <div className="flex items-center gap-4">
              <span className="rounded-full bg-emerald-500 p-2 text-xl text-white">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </span>
              <div>
                <div className="text-3xl font-bold text-slate-900">{assets.filter(a => (a.statut || a.status || '').toLowerCase() === 'en service').length}</div>
                <div className="text-sm text-slate-600">En Service</div>
              </div>
              </div>
            </div>

            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 shadow-md">
              <div className="flex items-center gap-4">
              <span className="rounded-full bg-orange-400 p-2 text-xl text-white">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z" /></svg>
              </span>
              <div>
                <div className="text-3xl font-bold text-slate-900">{assets.filter(a => (a.statut || a.status || '').toLowerCase() === 'en maintenance').length}</div>
                <div className="text-sm text-slate-600">Maintenance</div>
              </div>
              </div>
            </div>
          </div>

          <h2 className="mb-3 w-full text-left text-xl font-semibold text-slate-800">Répartition par type</h2>
          <div className="glass-panel mb-6 rounded-3xl p-5 shadow-lg">
            <ResponsiveContainer width="100%" height={380}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="46%"
                  innerRadius={66}
                  outerRadius={130}
                  fill="#8884d8"
                  label={false}
                >
                  {chartData.map((entry, index) => (
                    // Chaque portion récupère une couleur dédiée selon le type ou une couleur de secours.
                    <Cell
                      key={`cell-${index}`}
                      fill={getTypeColor(entry.name, index)}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>

            <div className="mt-4 grid grid-cols-1 gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
              {chartData.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2">
                  <span
                    className="h-3 w-3 rounded-sm"
                    style={{ backgroundColor: getTypeColor(item.name, index) }}
                  />
                  <span className="truncate">{item.name}</span>
                  <span className="ml-auto font-semibold">{item.value}</span>
                </div>
              ))}
              {chartData.length === 0 && (
                <div className="text-slate-500">Aucune donnée pour le graphique.</div>
              )}
            </div>
          </div>

          <div className="glass-panel overflow-hidden rounded-3xl p-3 shadow-lg md:p-5">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-6 py-3 text-left">Numéro de série</th>
                  <th className="px-6 py-3 text-left">Modèle</th>
                  <th className="px-6 py-3 text-left">Type</th>
                  <th className="px-6 py-3 text-left">Alimentation</th>
                  <th className="px-6 py-3 text-left">Utilisateur / Description</th>
                  <th className="px-6 py-3 text-left">Date d'achat</th>
                  <th className="px-6 py-3 text-left">Fin garantie</th>
                  <th className="px-6 py-3 text-left">Prix (€)</th>
                  <th className="px-6 py-3 text-left">Statut</th>
                  <th className="px-6 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset, idx) => (
                  <tr
                    key={asset.id}
                    className={
                      (idx % 2 === 0 ? 'bg-white/90' : 'bg-slate-50/80') +
                      ' border-b border-slate-100 transition hover:bg-cyan-50/70'
                    }
                  >
                    <td className="px-6 py-3 font-medium text-slate-800">{asset.serial_number}</td>
                    <td className="px-6 py-3">{asset.model}</td>
                    <td className="px-6 py-3">{asset.type?.label || asset.type_label || ''}</td>
                    <td className="px-6 py-3">
                      {asset.power_status === 'sous_tension' ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                            Sous tension
                          </span>
                          <div className="text-xs text-gray-500">
                            Dernière activité: {asset.last_activity_at ? new Date(asset.last_activity_at).toLocaleString() : '-'}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-700 border border-red-200">
                            Hors tension
                          </span>
                          <div className="text-xs text-gray-500">
                            Dernière activité: {asset.last_activity_at ? new Date(asset.last_activity_at).toLocaleString() : '-'}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3">{asset.description || asset.owner_name || ''}</td>
                    <td className="px-6 py-3">{asset.purchase_date || ''}</td>
                    <td className="px-6 py-3">{asset.warranty_expiry || ''}</td>
                    <td className="px-6 py-3">{asset.price || ''}</td>
                    <td className="px-6 py-3">
                      {(() => {
                        // Le statut est normalisé en minuscules pour gérer plusieurs variantes.
                        const status = (asset.status || '').toLowerCase();
                        if (status === 'en service') {
                          return (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-700 border border-green-200">
                              En service
                            </span>
                          );
                        } else if (status === 'en maintenance') {
                          return (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-orange-100 text-orange-700 border border-orange-200">
                              En maintenance
                            </span>
                          );
                        } else if (status === 'stock') {
                          return (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-200 text-gray-700 border border-gray-300">
                              Stock
                            </span>
                          );
                        } else {
                          return (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                              {asset.status}
                            </span>
                          );
                        }
                      })()}
                    </td>
                    <td className="flex gap-2 px-6 py-3">
                      <button
                        className="rounded-lg bg-amber-400 px-3 py-1 font-medium text-white transition hover:bg-amber-500"
                        onClick={() => handleEditClick(asset)}
                      >
                        Éditer
                      </button>
                      <button
                        className="rounded-lg bg-red-500 px-3 py-1 font-medium text-white transition hover:bg-red-600"
                        onClick={() => handleDeleteClick(asset.id)}
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>
      <AddAssetModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onAssetAdded={handleAssetAdded}
      />
      <EditAssetModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        asset={editAsset}
        onAssetUpdated={handleAssetUpdated}
      />
      {/* La suppression utilise une seconde modale pour éviter les clics accidentels. */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-6 relative">
            <h2 className="text-lg font-semibold mb-4">Confirmer la suppression</h2>
            <p className="mb-4">Voulez-vous vraiment supprimer cet équipement ?</p>
            <div className="flex justify-end gap-2">
              <button
                className="bg-gray-300 px-4 py-2 rounded"
                onClick={() => setDeleteId(null)}
                disabled={deleteLoading}
              >Annuler</button>
              <button
                className="bg-red-500 text-white px-4 py-2 rounded"
                onClick={confirmDelete}
                disabled={deleteLoading}
              >{deleteLoading ? 'Suppression...' : 'Supprimer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
