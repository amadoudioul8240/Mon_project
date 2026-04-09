import React, { useEffect, useState } from 'react';
import { backendUrl } from '../config/api';

export default function MaintenanceLogs({ assetId }) {
  // Ce composant encapsule l'historique de maintenance d'un équipement
  // ainsi que le formulaire d'ajout d'une nouvelle intervention.
  const [logs, setLogs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    maintenance_date: '',
    description: '',
    cost: '',
    performed_by: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // À chaque changement d'équipement sélectionné, on recharge ses logs depuis l'API.
    if (assetId) {
      fetch(`${backendUrl}/maintenance_logs/${assetId}`)
        .then(res => res.json())
        .then(data => setLogs(data));
    }
  }, [assetId]);

  const handleChange = e => {
    // Formulaire contrôlé : chaque saisie met à jour la propriété correspondante.
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async e => {
    // La soumission crée un log puis relit la liste pour afficher l'état à jour.
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl}/maintenance_logs/${assetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, asset_id: assetId })
      });
      if (!res.ok) throw new Error('Erreur lors de l\'ajout');
      setForm({ maintenance_date: '', description: '', cost: '', performed_by: '' });
      setShowForm(false);
      // Refresh logs
      const logsRes = await fetch(`${backendUrl}/maintenance_logs/${assetId}`);
      setLogs(await logsRes.json());
    } catch (err) {
      setError("Erreur lors de l'ajout du log.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-2">Logs de maintenance</h3>
      <button
        className="mb-2 bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
        onClick={() => setShowForm(!showForm)}
      >
        {showForm ? 'Annuler' : 'Ajouter un log'}
      </button>
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 space-y-2">
          <input type="date" name="maintenance_date" value={form.maintenance_date} onChange={handleChange} required className="border rounded px-2 py-1 w-full" />
          <input type="text" name="performed_by" value={form.performed_by} onChange={handleChange} placeholder="Effectué par" className="border rounded px-2 py-1 w-full" />
          <input type="number" name="cost" value={form.cost} onChange={handleChange} placeholder="Coût (€)" className="border rounded px-2 py-1 w-full" />
          <textarea name="description" value={form.description} onChange={handleChange} placeholder="Description" required className="border rounded px-2 py-1 w-full" />
          {error && <div className="text-red-500 text-sm">{error}</div>}
          <button type="submit" className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700" disabled={loading}>
            {loading ? 'Ajout...' : 'Ajouter'}
          </button>
        </form>
      )}
      <table className="min-w-full bg-white rounded shadow">
        <thead className="bg-gray-100">
          <tr>
            <th className="py-2 px-4 text-left">Date</th>
            <th className="py-2 px-4 text-left">Effectué par</th>
            <th className="py-2 px-4 text-left">Coût (€)</th>
            <th className="py-2 px-4 text-left">Description</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => (
            // Chaque ligne correspond à une intervention historisée pour cet équipement.
            <tr key={log.id}>
              <td className="py-1 px-4">{log.maintenance_date}</td>
              <td className="py-1 px-4">{log.performed_by}</td>
              <td className="py-1 px-4">{log.cost}</td>
              <td className="py-1 px-4">{log.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
