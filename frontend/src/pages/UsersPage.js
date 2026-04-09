import React, { useEffect, useState } from 'react';
import axios from 'axios';

// Page d'administration dédiée à la gestion des utilisateurs du parc.
import { backendUrl } from '../config/api';

export default function UsersPage() {
  // On stocke à la fois la liste déjà créée et l'état courant du formulaire d'ajout.
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: '', firstname: '', email: '' });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', firstname: '', email: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adConfig, setAdConfig] = useState({
    server: '',
    port: 636,
    use_ssl: true,
    bind_user: '',
    bind_password: '',
    base_dn: '',
    users_dn: '',
    computers_dn: '',
    user_filter: '(&(objectCategory=person)(objectClass=user))',
    computer_filter: '(&(objectCategory=computer)(objectClass=computer))',
    auto_sync_enabled: false,
    sync_interval_minutes: 60,
    last_auto_sync_at: null,
    last_sync_users_at: null,
    last_sync_computers_at: null,
    last_sync_status: '',
    last_sync_message: '',
  });
  const [adConfigOpen, setAdConfigOpen] = useState(false);
  const [adMessage, setAdMessage] = useState('');

  const fetchUsers = async () => {
    // Recharge la liste des utilisateurs pour refléter immédiatement les créations.
    try {
      const res = await axios.get(`${backendUrl}/users`);
      setUsers(res.data);
    } catch (err) {
      setUsers([]);
    }
  };

  useEffect(() => {
    // Chargement initial des utilisateurs au montage de la page.
    fetchUsers();
    fetchAdConfig();
  }, []);

  const fetchAdConfig = async () => {
    // Lit la configuration AD courante pour préremplir le formulaire.
    try {
      const res = await axios.get(`${backendUrl}/ad/config`);
      setAdConfig(prev => ({
        ...prev,
        ...res.data,
        bind_password: '',
      }));
    } catch (err) {
      // Pas bloquant : l'utilisateur peut remplir le formulaire manuellement.
    }
  };

  const handleChange = e => {
    // Met à jour une propriété précise du formulaire selon le champ saisi.
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async e => {
    // Crée un utilisateur puis recharge la table pour montrer le résultat.
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await axios.post(`${backendUrl}/users`, form);
      setForm({ name: '', firstname: '', email: '' });
      fetchUsers();
    } catch (err) {
      setError("Erreur lors de l'ajout de l'utilisateur.");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (user) => {
    // Passe la ligne en mode édition avec les valeurs courantes.
    setEditingUserId(user.id);
    setEditForm({
      name: user.name || '',
      firstname: user.firstname || '',
      email: user.email || '',
    });
    setError('');
  };

  const cancelEdit = () => {
    // Ferme le mode édition sans enregistrer.
    setEditingUserId(null);
    setEditForm({ name: '', firstname: '', email: '' });
  };

  const handleEditChange = (e) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  const handleAdConfigChange = (e) => {
    const { name, value, type, checked } = e.target;
    setAdConfig({
      ...adConfig,
      [name]: type === 'checkbox' ? checked : value,
    });
  };

  const saveAdConfig = async (e) => {
    // Enregistre les paramètres AD saisis dans l'application.
    e.preventDefault();
    setLoading(true);
    setAdMessage('');
    try {
      const payload = {
        ...adConfig,
        port: Number(adConfig.port || 636),
        sync_interval_minutes: Number(adConfig.sync_interval_minutes || 60),
      };
      const res = await axios.put(`${backendUrl}/ad/config`, payload);
      setAdConfig(prev => ({ ...prev, ...res.data, bind_password: '' }));
      setAdMessage('Configuration Active Directory enregistrée.');
    } catch (err) {
      setAdMessage(err?.response?.data?.detail || 'Erreur lors de la sauvegarde de la configuration AD.');
    } finally {
      setLoading(false);
    }
  };

  const testAdConnection = async () => {
    // Teste la connexion AD avec la configuration enregistrée.
    setLoading(true);
    setAdMessage('');
    try {
      const res = await axios.get(`${backendUrl}/ad/status`);
      setAdMessage(res.data.message || 'Connexion AD OK');
    } catch (err) {
      setAdMessage(err?.response?.data?.detail || 'Connexion AD impossible.');
    } finally {
      setLoading(false);
    }
  };

  const saveEdit = async (userId) => {
    // Enregistre les modifications de l'utilisateur puis recharge la table.
    setLoading(true);
    setError('');
    try {
      await axios.put(`${backendUrl}/users/${userId}`, editForm);
      cancelEdit();
      fetchUsers();
    } catch (err) {
      setError("Erreur lors de la modification de l'utilisateur.");
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (userId) => {
    // Supprime un utilisateur après confirmation.
    if (!window.confirm('Voulez-vous vraiment supprimer cet utilisateur ?')) return;
    setLoading(true);
    setError('');
    try {
      await axios.delete(`${backendUrl}/users/${userId}`);
      if (editingUserId === userId) {
        cancelEdit();
      }
      fetchUsers();
    } catch (err) {
      setError("Erreur lors de la suppression de l'utilisateur.");
    } finally {
      setLoading(false);
    }
  };

  const syncAdUsers = async () => {
    // Lance une synchronisation des utilisateurs depuis Active Directory.
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${backendUrl}/ad/sync/users`);
      await fetchUsers();
      alert(`Sync AD utilisateurs terminée. Créés: ${res.data.created}, Mis à jour: ${res.data.updated}, Ignorés: ${res.data.skipped}`);
    } catch (err) {
      setError(err?.response?.data?.detail || "Erreur lors de la synchronisation AD des utilisateurs.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Utilisateurs</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="bg-slate-600 text-white px-4 py-2 rounded hover:bg-slate-700 disabled:opacity-50"
            onClick={() => setAdConfigOpen(!adConfigOpen)}
            disabled={loading}
          >
            {adConfigOpen ? 'Masquer config AD' : 'Configurer AD'}
          </button>
          <button
            type="button"
            className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
            onClick={syncAdUsers}
            disabled={loading}
          >
            {loading ? 'Sync...' : 'Synchroniser AD'}
          </button>
        </div>
      </div>

      {adConfigOpen && (
        <form onSubmit={saveAdConfig} className="bg-white border rounded shadow p-4 mb-6 space-y-3">
          <h2 className="text-lg font-semibold">Configuration Active Directory</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text"
              name="server"
              placeholder="AD Server (ex: dc01.mondomaine.local)"
              value={adConfig.server}
              onChange={handleAdConfigChange}
              className="border rounded px-3 py-2"
              required
            />
            <input
              type="number"
              name="port"
              placeholder="Port"
              value={adConfig.port}
              onChange={handleAdConfigChange}
              className="border rounded px-3 py-2"
              required
            />
            <input
              type="text"
              name="bind_user"
              placeholder="Bind user (ex: DOMAINE\\svc_account)"
              value={adConfig.bind_user}
              onChange={handleAdConfigChange}
              className="border rounded px-3 py-2"
              required
            />
            <input
              type="password"
              name="bind_password"
              placeholder="Bind password (laisser vide pour conserver)"
              value={adConfig.bind_password}
              onChange={handleAdConfigChange}
              className="border rounded px-3 py-2"
            />
            <input
              type="text"
              name="base_dn"
              placeholder="Base DN (ex: DC=mondomaine,DC=local)"
              value={adConfig.base_dn}
              onChange={handleAdConfigChange}
              className="border rounded px-3 py-2 md:col-span-2"
              required
            />
            <input
              type="text"
              name="users_dn"
              placeholder="Users DN (optionnel)"
              value={adConfig.users_dn}
              onChange={handleAdConfigChange}
              className="border rounded px-3 py-2"
            />
            <input
              type="text"
              name="computers_dn"
              placeholder="Computers DN (optionnel)"
              value={adConfig.computers_dn}
              onChange={handleAdConfigChange}
              className="border rounded px-3 py-2"
            />
            <input
              type="text"
              name="user_filter"
              placeholder="LDAP user filter"
              value={adConfig.user_filter}
              onChange={handleAdConfigChange}
              className="border rounded px-3 py-2"
            />
            <input
              type="text"
              name="computer_filter"
              placeholder="LDAP computer filter"
              value={adConfig.computer_filter}
              onChange={handleAdConfigChange}
              className="border rounded px-3 py-2"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="use_ssl"
              checked={adConfig.use_ssl}
              onChange={handleAdConfigChange}
            />
            Utiliser SSL (LDAPS)
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="auto_sync_enabled"
                checked={!!adConfig.auto_sync_enabled}
                onChange={handleAdConfigChange}
              />
              Synchronisation AD automatique persistante
            </label>
            <input
              type="number"
              min="5"
              name="sync_interval_minutes"
              placeholder="Intervalle auto sync (minutes)"
              value={adConfig.sync_interval_minutes}
              onChange={handleAdConfigChange}
              className="border rounded px-3 py-2"
            />
          </div>

          <div className="text-sm text-slate-600 space-y-1">
            <div>Dernière auto-sync: {adConfig.last_auto_sync_at ? new Date(adConfig.last_auto_sync_at).toLocaleString() : '-'}</div>
            <div>Dernière sync utilisateurs: {adConfig.last_sync_users_at ? new Date(adConfig.last_sync_users_at).toLocaleString() : '-'}</div>
            <div>Dernière sync ordinateurs: {adConfig.last_sync_computers_at ? new Date(adConfig.last_sync_computers_at).toLocaleString() : '-'}</div>
            <div>Statut: {adConfig.last_sync_status || '-'}</div>
            <div>Message: {adConfig.last_sync_message || '-'}</div>
          </div>

          {adMessage && <div className="text-sm text-slate-700">{adMessage}</div>}

          <div className="flex gap-2">
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Enregistrement...' : 'Enregistrer configuration AD'}
            </button>
            <button
              type="button"
              className="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700 disabled:opacity-50"
              onClick={testAdConnection}
              disabled={loading}
            >
              Tester connexion AD
            </button>
          </div>
        </form>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-2 mb-6">
        <input
          type="text"
          name="name"
          placeholder="Nom"
          value={form.name}
          onChange={handleChange}
          className="border rounded px-3 py-2 flex-1"
          required
        />
        <input
          type="text"
          name="firstname"
          placeholder="Prénom"
          value={form.firstname}
          onChange={handleChange}
          className="border rounded px-3 py-2 flex-1"
        />
        <input
          type="email"
          name="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          className="border rounded px-3 py-2 flex-1"
          required
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
      <table className="min-w-full bg-white border rounded shadow">
        {/* Le tableau affiche tous les utilisateurs qui peuvent être assignés à un équipement. */}
        <thead>
          <tr>
            <th className="py-2 px-4 border-b">Nom</th>
            <th className="py-2 px-4 border-b">Prénom</th>
            <th className="py-2 px-4 border-b">Email</th>
            <th className="py-2 px-4 border-b">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.id} className="hover:bg-gray-100">
              {editingUserId === user.id ? (
                <>
                  <td className="py-2 px-4 border-b">
                    <input
                      type="text"
                      name="name"
                      value={editForm.name}
                      onChange={handleEditChange}
                      className="border rounded px-2 py-1 w-full"
                      required
                    />
                  </td>
                  <td className="py-2 px-4 border-b">
                    <input
                      type="text"
                      name="firstname"
                      value={editForm.firstname}
                      onChange={handleEditChange}
                      className="border rounded px-2 py-1 w-full"
                    />
                  </td>
                  <td className="py-2 px-4 border-b">
                    <input
                      type="email"
                      name="email"
                      value={editForm.email}
                      onChange={handleEditChange}
                      className="border rounded px-2 py-1 w-full"
                      required
                    />
                  </td>
                  <td className="py-2 px-4 border-b">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                        onClick={() => saveEdit(user.id)}
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
                  <td className="py-2 px-4 border-b">{user.name}</td>
                  <td className="py-2 px-4 border-b">{user.firstname || ''}</td>
                  <td className="py-2 px-4 border-b">{user.email}</td>
                  <td className="py-2 px-4 border-b">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600 disabled:opacity-50"
                        onClick={() => startEdit(user)}
                        disabled={loading}
                      >
                        Éditer
                      </button>
                      <button
                        type="button"
                        className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 disabled:opacity-50"
                        onClick={() => deleteUser(user.id)}
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
  );
}
