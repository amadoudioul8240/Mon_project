import React, { useEffect, useState } from 'react';
import axios from 'axios';

// Page simple de gestion des lieux physiques du parc informatique.
const backendUrl = process.env.REACT_APP_BACKEND_URL;

export default function LocationsPage() {
  // Le formulaire ajoute un lieu, tandis que la liste montre les emplacements existants.
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({ name: '', building: '', floor: '', office: '' });
  const [editingLocationId, setEditingLocationId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', building: '', floor: '', office: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchLocations = async () => {
    // Synchronise l'interface avec la liste courante des lieux en base.
    try {
      const res = await axios.get(`${backendUrl}/locations`);
      setLocations(res.data);
    } catch (err) {
      setLocations([]);
    }
  };

  useEffect(() => {
    // Premier chargement au montage du composant.
    fetchLocations();
  }, []);

  const handleChange = e => {
    // Mise à jour générique du formulaire contrôlé.
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async e => {
    // Envoie les données du formulaire puis réinitialise l'écran si l'appel réussit.
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await axios.post(`${backendUrl}/locations`, form);
      setForm({ name: '', building: '', floor: '', office: '' });
      fetchLocations();
    } catch (err) {
      setError("Erreur lors de l'ajout du lieu.");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (loc) => {
    // Active le mode édition pour la carte sélectionnée.
    setEditingLocationId(loc.id);
    setEditForm({
      name: loc.name || '',
      building: loc.building || '',
      floor: loc.floor || '',
      office: loc.office || '',
    });
    setError('');
  };

  const cancelEdit = () => {
    setEditingLocationId(null);
    setEditForm({ name: '', building: '', floor: '', office: '' });
  };

  const handleEditChange = (e) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  const saveEdit = async (locationId) => {
    // Enregistre les changements d'un lieu.
    setLoading(true);
    setError('');
    try {
      await axios.put(`${backendUrl}/locations/${locationId}`, editForm);
      cancelEdit();
      fetchLocations();
    } catch (err) {
      setError("Erreur lors de la modification du lieu.");
    } finally {
      setLoading(false);
    }
  };

  const deleteLocation = async (locationId) => {
    // Supprime le lieu après confirmation utilisateur.
    if (!window.confirm('Voulez-vous vraiment supprimer ce lieu ?')) return;
    setLoading(true);
    setError('');
    try {
      await axios.delete(`${backendUrl}/locations/${locationId}`);
      if (editingLocationId === locationId) {
        cancelEdit();
      }
      fetchLocations();
    } catch (err) {
      setError("Erreur lors de la suppression du lieu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Lieux</h1>
      <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-2 mb-6">
        <input
          type="text"
          name="name"
          placeholder="Nom du lieu"
          value={form.name}
          onChange={handleChange}
          className="border rounded px-3 py-2 flex-1"
          required
        />
        <input
          type="text"
          name="building"
          placeholder="Bâtiment"
          value={form.building}
          onChange={handleChange}
          className="border rounded px-3 py-2 flex-1"
        />
        <input
          type="text"
          name="floor"
          placeholder="Étage"
          value={form.floor}
          onChange={handleChange}
          className="border rounded px-3 py-2 flex-1"
        />
        <input
          type="text"
          name="office"
          placeholder="Numéro de bureau"
          value={form.office}
          onChange={handleChange}
          className="border rounded px-3 py-2 flex-1"
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'Ajout...' : 'Ajouter'}
        </button>
      </form>
      {error && <div className="text-red-500 mb-2">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {locations.map(loc => (
          // Chaque carte synthétise un emplacement réutilisable dans l'affectation d'actifs.
          <div key={loc.id} className="bg-white border rounded shadow p-4">
            {editingLocationId === loc.id ? (
              <>
                <input
                  type="text"
                  name="name"
                  value={editForm.name}
                  onChange={handleEditChange}
                  className="border rounded px-2 py-1 w-full mb-2"
                  placeholder="Nom du lieu"
                  required
                />
                <input
                  type="text"
                  name="building"
                  value={editForm.building}
                  onChange={handleEditChange}
                  className="border rounded px-2 py-1 w-full mb-2"
                  placeholder="Bâtiment"
                />
                <input
                  type="text"
                  name="floor"
                  value={editForm.floor}
                  onChange={handleEditChange}
                  className="border rounded px-2 py-1 w-full mb-2"
                  placeholder="Étage"
                />
                <input
                  type="text"
                  name="office"
                  value={editForm.office}
                  onChange={handleEditChange}
                  className="border rounded px-2 py-1 w-full mb-3"
                  placeholder="Numéro de bureau"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                    onClick={() => saveEdit(loc.id)}
                    disabled={loading}
                  >
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    className="bg-gray-400 text-white px-3 py-1 rounded hover:bg-gray-500 disabled:opacity-50"
                    onClick={cancelEdit}
                    disabled={loading}
                  >
                    Annuler
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-semibold text-lg mb-1">{loc.name}</h2>
                <div className="text-sm text-gray-600">Bâtiment : {loc.building || '-'}</div>
                <div className="text-sm text-gray-600">Étage : {loc.floor || '-'}</div>
                <div className="text-sm text-gray-600">Bureau : {loc.office || '-'}</div>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    className="bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600 disabled:opacity-50"
                    onClick={() => startEdit(loc)}
                    disabled={loading}
                  >
                    Éditer
                  </button>
                  <button
                    type="button"
                    className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 disabled:opacity-50"
                    onClick={() => deleteLocation(loc.id)}
                    disabled={loading}
                  >
                    Supprimer
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
