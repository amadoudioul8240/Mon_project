import React, { useEffect, useState } from 'react';
import axios from 'axios';

// Page de gestion des incidents (création, suivi, modification, suppression).
const backendUrl = process.env.REACT_APP_BACKEND_URL;

const statusOptions = ['Ouvert', 'En cours', 'Résolu'];
const priorityOptions = ['Basse', 'Moyenne', 'Haute', 'Critique'];

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState([]);
  const [assets, setAssets] = useState([]);
  const [users, setUsers] = useState([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'Ouvert',
    priority: 'Moyenne',
    asset_id: '',
    reported_by_user_id: '',
  });

  const [editingIncidentId, setEditingIncidentId] = useState(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    status: 'Ouvert',
    priority: 'Moyenne',
    asset_id: '',
    reported_by_user_id: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchIncidents = async () => {
    try {
      const res = await axios.get(`${backendUrl}/incidents`);
      setIncidents(res.data);
    } catch (err) {
      setIncidents([]);
    }
  };

  const fetchReferences = async () => {
    try {
      const [assetsRes, usersRes] = await Promise.all([
        axios.get(`${backendUrl}/assets`),
        axios.get(`${backendUrl}/users`),
      ]);
      setAssets(assetsRes.data || []);
      setUsers(usersRes.data || []);
    } catch (err) {
      setAssets([]);
      setUsers([]);
    }
  };

  useEffect(() => {
    fetchIncidents();
    fetchReferences();
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleEditChange = (e) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  const normalizePayload = (data) => ({
    ...data,
    asset_id: data.asset_id ? Number(data.asset_id) : null,
    reported_by_user_id: data.reported_by_user_id ? Number(data.reported_by_user_id) : null,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await axios.post(`${backendUrl}/incidents`, normalizePayload(form));
      setForm({
        title: '',
        description: '',
        status: 'Ouvert',
        priority: 'Moyenne',
        asset_id: '',
        reported_by_user_id: '',
      });
      fetchIncidents();
    } catch (err) {
      setError("Erreur lors de l'ajout de l'incident.");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (incident) => {
    setEditingIncidentId(incident.id);
    setEditForm({
      title: incident.title || '',
      description: incident.description || '',
      status: incident.status || 'Ouvert',
      priority: incident.priority || 'Moyenne',
      asset_id: incident.asset_id || '',
      reported_by_user_id: incident.reported_by_user_id || '',
    });
    setError('');
  };

  const cancelEdit = () => {
    setEditingIncidentId(null);
    setEditForm({
      title: '',
      description: '',
      status: 'Ouvert',
      priority: 'Moyenne',
      asset_id: '',
      reported_by_user_id: '',
    });
  };

  const saveEdit = async (incidentId) => {
    setLoading(true);
    setError('');
    try {
      await axios.put(`${backendUrl}/incidents/${incidentId}`, normalizePayload(editForm));
      cancelEdit();
      fetchIncidents();
    } catch (err) {
      setError("Erreur lors de la modification de l'incident.");
    } finally {
      setLoading(false);
    }
  };

  const deleteIncident = async (incidentId) => {
    if (!window.confirm('Voulez-vous vraiment supprimer cet incident ?')) return;
    setLoading(true);
    setError('');
    try {
      await axios.delete(`${backendUrl}/incidents/${incidentId}`);
      if (editingIncidentId === incidentId) {
        cancelEdit();
      }
      fetchIncidents();
    } catch (err) {
      setError("Erreur lors de la suppression de l'incident.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Gestion des incidents</h1>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 bg-white border rounded shadow p-4">
        <input
          type="text"
          name="title"
          placeholder="Titre de l'incident"
          value={form.title}
          onChange={handleChange}
          className="border rounded px-3 py-2"
          required
        />
        <select
          name="status"
          value={form.status}
          onChange={handleChange}
          className="border rounded px-3 py-2"
          required
        >
          {statusOptions.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        <select
          name="priority"
          value={form.priority}
          onChange={handleChange}
          className="border rounded px-3 py-2"
          required
        >
          {priorityOptions.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        <select
          name="asset_id"
          value={form.asset_id}
          onChange={handleChange}
          className="border rounded px-3 py-2"
        >
          <option value="">Matériel lié (optionnel)</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {`${asset.serial_number} - ${asset.model}`}
            </option>
          ))}
        </select>
        <select
          name="reported_by_user_id"
          value={form.reported_by_user_id}
          onChange={handleChange}
          className="border rounded px-3 py-2"
        >
          <option value="">Déclaré par (optionnel)</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {`${user.firstname ? `${user.firstname} ` : ''}${user.name}`}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'Ajout...' : 'Ajouter incident'}
        </button>
        <textarea
          name="description"
          placeholder="Description détaillée"
          value={form.description}
          onChange={handleChange}
          className="border rounded px-3 py-2 md:col-span-2"
          rows={3}
          required
        />
      </form>

      {error && <div className="text-red-500 mb-2">{error}</div>}

      <div className="overflow-auto bg-white border rounded shadow">
        <table className="min-w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="py-2 px-3 text-left">Titre</th>
              <th className="py-2 px-3 text-left">Statut</th>
              <th className="py-2 px-3 text-left">Priorité</th>
              <th className="py-2 px-3 text-left">Matériel</th>
              <th className="py-2 px-3 text-left">Déclarant</th>
              <th className="py-2 px-3 text-left">Description</th>
              <th className="py-2 px-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((incident) => (
              <tr key={incident.id} className="border-t hover:bg-gray-50">
                {editingIncidentId === incident.id ? (
                  <>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        name="title"
                        value={editForm.title}
                        onChange={handleEditChange}
                        className="border rounded px-2 py-1 w-full"
                        required
                      />
                    </td>
                    <td className="py-2 px-3">
                      <select
                        name="status"
                        value={editForm.status}
                        onChange={handleEditChange}
                        className="border rounded px-2 py-1 w-full"
                      >
                        {statusOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select
                        name="priority"
                        value={editForm.priority}
                        onChange={handleEditChange}
                        className="border rounded px-2 py-1 w-full"
                      >
                        {priorityOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select
                        name="asset_id"
                        value={editForm.asset_id}
                        onChange={handleEditChange}
                        className="border rounded px-2 py-1 w-full"
                      >
                        <option value="">Aucun</option>
                        {assets.map((asset) => (
                          <option key={asset.id} value={asset.id}>{`${asset.serial_number} - ${asset.model}`}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select
                        name="reported_by_user_id"
                        value={editForm.reported_by_user_id}
                        onChange={handleEditChange}
                        className="border rounded px-2 py-1 w-full"
                      >
                        <option value="">Aucun</option>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>{`${user.firstname ? `${user.firstname} ` : ''}${user.name}`}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <textarea
                        name="description"
                        value={editForm.description}
                        onChange={handleEditChange}
                        className="border rounded px-2 py-1 w-full"
                        rows={2}
                        required
                      />
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                          onClick={() => saveEdit(incident.id)}
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
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-2 px-3">{incident.title}</td>
                    <td className="py-2 px-3">{incident.status}</td>
                    <td className="py-2 px-3">{incident.priority}</td>
                    <td className="py-2 px-3">{incident.asset_label || '-'}</td>
                    <td className="py-2 px-3">{incident.reporter_name || '-'}</td>
                    <td className="py-2 px-3 max-w-sm">{incident.description}</td>
                    <td className="py-2 px-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600 disabled:opacity-50"
                          onClick={() => startEdit(incident)}
                          disabled={loading}
                        >
                          Éditer
                        </button>
                        <button
                          type="button"
                          className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 disabled:opacity-50"
                          onClick={() => deleteIncident(incident.id)}
                          disabled={loading}
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
