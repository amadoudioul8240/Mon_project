import React, { useState, useEffect } from 'react';
import axios from 'axios';

// La modale de modification réutilise la même source backend que l'ajout.
import { backendUrl } from '../config/api';

// Les statuts autorisés sont alignés sur ceux du backend.
const statusOptions = [
  { value: 'En service', label: 'En service' },
  { value: 'En maintenance', label: 'En maintenance' },
  { value: 'Stock', label: 'Stock' },
];

// Types partagés : pas d'utilisateur attribué, une description à la place.
const SHARED_TYPES = ['serveur', 'ecran', 'imprimante', 'imprimente', 'switch', 'routeur'];

function normalizeLabel(label = '') {
  return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function isSharedType(label) {
  return SHARED_TYPES.includes(normalizeLabel(label));
}

export default function EditAssetModal({ isOpen, onClose, asset, onAssetUpdated }) {
  // Les états sont initialisés à partir de l'équipement reçu afin de préremplir le formulaire.
  const [serialNumber, setSerialNumber] = useState(asset?.serial_number || '');
  const [model, setModel] = useState(asset?.model || '');
  const [status, setStatus] = useState(asset?.status || statusOptions[0].value);
  const [locationId, setLocationId] = useState(asset?.location_id || '');
  const [typeId, setTypeId] = useState(asset?.type_id || '');
  const [locations, setLocations] = useState([]);
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(asset?.owner_id || '');
  const [description, setDescription] = useState(asset?.description || '');
  const [types, setTypes] = useState([]);
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchase_date || '');
  const [warrantyExpiry, setWarrantyExpiry] = useState(asset?.warranty_expiry || '');
  const [price, setPrice] = useState(asset?.price || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // À l'ouverture, on recharge les listes de référence utilisées dans les sélecteurs.
    if (isOpen) {
      axios.get(`${backendUrl}/asset_types`).then(res => setTypes(res.data)).catch(() => setTypes([]));
      axios.get(`${backendUrl}/locations`).then(res => setLocations(res.data)).catch(() => setLocations([]));
      axios.get(`${backendUrl}/users`).then(res => setUsers(res.data)).catch(() => setUsers([]));
    }
  }, [isOpen]);

  useEffect(() => {
    // Quand un autre équipement est sélectionné, le formulaire se resynchronise avec ses données.
    if (asset) {
      setSerialNumber(asset.serial_number || '');
      setModel(asset.model || '');
      setStatus(asset.status || statusOptions[0].value);
      setLocationId(asset.location_id || '');
      setTypeId(asset.type_id || '');
      setUserId(asset.owner_id || '');
      setDescription(asset.description || '');
      setPurchaseDate(asset.purchase_date || '');
      setWarrantyExpiry(asset.warranty_expiry || '');
      setPrice(asset.price || '');
    }
  }, [asset]);

  const handleSubmit = async (e) => {
    // La requête PUT remplace les informations de l'équipement existant.
    e.preventDefault();
    setLoading(true);
    setError('');
    const selectedType = types.find(t => String(t.id) === String(typeId));
    const shared = selectedType ? isSharedType(selectedType.label) : false;
    try {
      await axios.put(`${backendUrl}/assets/${asset.id}`, {
        serial_number: serialNumber,
        model: model,
        status: status,
        type_id: typeId,
        location_id: locationId,
        owner_id: shared ? null : userId,
        description: shared ? description : null,
        purchase_date: purchaseDate,
        warranty_expiry: warrantyExpiry,
        price: price,
      });
      if (onAssetUpdated) onAssetUpdated();
      onClose();
    } catch (err) {
      setError("Erreur lors de la modification de l'équipement.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
        <button
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
          onClick={onClose}
        >
          ×
        </button>
        <h2 className="text-xl font-semibold mb-4">Modifier l'équipement</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Le formulaire réplique les champs de création, mais avec des valeurs initiales. */}
          <div>
            <label className="block text-sm font-medium mb-1">Numéro de série</label>
            <input
              type="text"
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              value={serialNumber}
              onChange={e => setSerialNumber(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Modèle</label>
            <input
              type="text"
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              value={model}
              onChange={e => setModel(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type d'équipement</label>
            <select
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              value={typeId}
              onChange={e => setTypeId(e.target.value)}
              required
            >
              <option value="">Sélectionner un type</option>
              {types.map(type => (
                <option key={type.id} value={type.id}>{type.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Statut</label>
            <select
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              value={status}
              onChange={e => setStatus(e.target.value)}
              required
            >
              {statusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {/* Affiche l'utilisateur ou la description selon le type sélectionné. */}
          {(() => {
            const selectedType = types.find(t => String(t.id) === String(typeId));
            const shared = selectedType ? isSharedType(selectedType.label) : false;
            return shared ? (
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Exémplaire n°X, localisation spécifique, utilité..."
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1">Utilisateur</label>
                <select
                  className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
                  value={userId}
                  onChange={e => setUserId(e.target.value)}
                  required
                >
                  <option value="">Sélectionner un utilisateur</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.firstname ? user.firstname + ' ' : ''}{user.name} ({user.email})</option>
                  ))}
                </select>
              </div>
            );
          })()}
          <div>
            <label className="block text-sm font-medium mb-1">Bureau</label>
            <select
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
              required
            >
              <option value="">Sélectionner un bureau</option>
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {`${loc.building || ''}${loc.building ? ' - ' : ''}${loc.floor ? 'Étage ' + loc.floor + ' - ' : ''}${loc.office ? 'Bureau ' + loc.office : ''}`.replace(/ - $/, '') || loc.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Date d'achat</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              value={purchaseDate}
              onChange={e => setPurchaseDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Fin de garantie</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              value={warrantyExpiry}
              onChange={e => setWarrantyExpiry(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Prix (€)</label>
            <input
              type="number"
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              value={price}
              onChange={e => setPrice(e.target.value)}
              min="0"
              step="0.01"
            />
          </div>
          {error && <div className="text-red-500 text-sm">{error}</div>}
          <div className="flex justify-end">
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Modification...' : 'Modifier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
