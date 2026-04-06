import React, { useEffect, useState } from 'react';
import axios from 'axios';

const backendUrl = process.env.REACT_APP_BACKEND_URL;

const severityOptions = ['Faible', 'Moyenne', 'Élevée', 'Critique'];
const statusOptions = ['Ouverte', 'En cours', 'Corrigée'];
const targetOptions = ['LAN', 'Serveur', 'Poste client'];

export default function SecurityPage() {
  const [summary, setSummary] = useState({
    total_findings: 0,
    critical_findings: 0,
    open_findings: 0,
    monitored_endpoints: 0,
  });
  const [findings, setFindings] = useState([]);
  const [posture, setPosture] = useState([]);
  const [unknownDevices, setUnknownDevices] = useState([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    severity: 'Moyenne',
    status: 'Ouverte',
    target_type: 'Poste client',
    target_name: '',
    cve: '',
    source: '',
    recommendation: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [policySaving, setPolicySaving] = useState(false);
  const [policy, setPolicy] = useState({
    stale_endpoint_hours: 72,
    unmanaged_lan_severity: 'Moyenne',
    stale_endpoint_severity: 'Moyenne',
  });


  const fetchData = async () => {
    try {
      const [summaryRes, findingsRes, postureRes, unknownRes] = await Promise.all([
        axios.get(`${backendUrl}/security/summary`),
        axios.get(`${backendUrl}/security/findings`),
        axios.get(`${backendUrl}/security/posture`),
        axios.get(`${backendUrl}/network/unknown-devices?active_minutes=5`),
      ]);
      setSummary(summaryRes.data);
      setFindings(findingsRes.data || []);
      setPosture(postureRes.data || []);
      setUnknownDevices(unknownRes.data || []);
    } catch (err) {
      setError('Impossible de charger les données de sécurité.');
    }
  };

  useEffect(() => {
    fetchData();
    fetchPolicy();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchPolicy = async () => {
    try {
      const res = await axios.get(`${backendUrl}/security/policy`);
      setPolicy(res.data);
    } catch (err) {
      setError('Impossible de charger la politique de sécurité.');
    }
  };

  const savePolicy = async () => {
    setPolicySaving(true);
    setError('');
    try {
      await axios.put(`${backendUrl}/security/policy`, policy);
      await fetchData();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Erreur lors de la sauvegarde de la politique.');
    } finally {
      setPolicySaving(false);
    }
  };

  const recalculateAutoFindings = async () => {
    setError('');
    try {
      await axios.post(`${backendUrl}/security/recalculate`);
      await fetchData();
    } catch (err) {
      setError('Erreur lors du recalcul automatique des constats.');
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await axios.post(`${backendUrl}/security/findings`, form);
      setForm({
        title: '',
        description: '',
        severity: 'Moyenne',
        status: 'Ouverte',
        target_type: 'Poste client',
        target_name: '',
        cve: '',
        source: '',
        recommendation: '',
      });
      await fetchData();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Erreur lors de l\'ajout du constat de sécurité.');
    } finally {
      setLoading(false);
    }
  };

  const updateFindingStatus = async (findingId, newStatus) => {
    try {
      await axios.put(`${backendUrl}/security/findings/${findingId}?status=${newStatus}`);
      await fetchData();
    } catch (err) {
      setError('Erreur lors de la mise à jour du constat.');
    }
  };

  const deleteFinding = async (findingId) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer ce constat ?')) return;
    try {
      await axios.delete(`${backendUrl}/security/findings/${findingId}`);
      await fetchData();
    } catch (err) {
      setError('Erreur lors de la suppression du constat.');
    }
  };

  const badgeClass = (severity) => {
    if (severity === 'Critique') return 'bg-red-100 text-red-700 border-red-300 border-l-4 border-l-red-700';
    if (severity === 'Élevée') return 'bg-orange-100 text-orange-700 border-orange-300 border-l-4 border-l-orange-700';
    if (severity === 'Moyenne') return 'bg-yellow-100 text-yellow-700 border-yellow-300 border-l-4 border-l-yellow-700';
    return 'bg-blue-100 text-blue-700 border-blue-300 border-l-4 border-l-blue-700';
  };

  const statusColorClass = (status) => {
    if (status === 'Corrigée') return 'bg-green-100 text-green-700';
    if (status === 'En cours') return 'bg-blue-100 text-blue-700';
    return 'bg-red-100 text-red-700';
  };

  const postureIconClass = (enabled) => {
    return enabled ? '✓ text-green-600 font-bold' : '✗ text-red-600 font-bold';
  };

  const filteredFindings = findings.filter(f => {
    const severityMatch = !filterSeverity || f.severity === filterSeverity;
    const statusMatch = !filterStatus || f.status === filterStatus;
    return severityMatch && statusMatch;
  });

  return (
    <div className="container mx-auto space-y-6 px-3 py-4 md:p-8">
      <div>
        <h1 className="text-2xl font-bold mb-2">Centre de sécurité</h1>
        <p className="text-gray-600">Gestion défensive des vulnérabilités et posture de sécurité des endpoints.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-blue-600">
          <div className="text-sm text-gray-500">Constats</div>
          <div className="text-2xl font-bold">{summary.total_findings}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-red-600">
          <div className="text-sm text-gray-500">Critiques</div>
          <div className="text-2xl font-bold text-red-600">{summary.critical_findings}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-orange-600">
          <div className="text-sm text-gray-500">Ouverts</div>
          <div className="text-2xl font-bold text-orange-600">{summary.open_findings}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-green-600">
          <div className="text-sm text-gray-500">Endpoints monitorés</div>
          <div className="text-2xl font-bold text-green-600">{summary.monitored_endpoints}</div>
        </div>
      </div>

      <div className={`rounded shadow p-4 border-l-4 ${unknownDevices.length > 0 ? 'bg-red-50 border-l-red-600' : 'bg-green-50 border-l-green-600'}`}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">
            Détection immédiate appareils non inventoriés ({unknownDevices.length})
          </h2>
          <button
            onClick={fetchData}
            className="text-sm bg-gray-700 text-white px-3 py-1 rounded hover:bg-gray-800"
          >
            Rafraîchir
          </button>
        </div>
        {unknownDevices.length === 0 ? (
          <p className="text-green-700">Aucun appareil inconnu actif détecté sur les 5 dernières minutes.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-red-100">
                <tr>
                  <th className="py-2 px-3 text-left">Hostname</th>
                  <th className="py-2 px-3 text-left">IP</th>
                  <th className="py-2 px-3 text-left">Source</th>
                  <th className="py-2 px-3 text-left">Vu pour la première fois</th>
                  <th className="py-2 px-3 text-left">Dernière activité</th>
                </tr>
              </thead>
              <tbody>
                {unknownDevices.map((dev) => (
                  <tr key={`${dev.serial_number}-${dev.last_seen}`} className="border-t">
                    <td className="py-2 px-3 font-semibold">{dev.hostname || dev.serial_number}</td>
                    <td className="py-2 px-3">{dev.ip_address || '-'}</td>
                    <td className="py-2 px-3">{dev.source || '-'}</td>
                    <td className="py-2 px-3">{dev.first_seen ? new Date(dev.first_seen).toLocaleString() : '-'}</td>
                    <td className="py-2 px-3">{dev.last_seen ? new Date(dev.last_seen).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded shadow p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-sm font-medium mb-1">Seuil endpoint non vu (heures)</label>
          <input
            type="number"
            min="1"
            max="720"
            value={policy.stale_endpoint_hours}
            onChange={(e) => setPolicy({ ...policy, stale_endpoint_hours: Number(e.target.value || 72) })}
            className="border rounded px-3 py-2 w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Sévérité hôte LAN non rattaché</label>
          <select
            value={policy.unmanaged_lan_severity}
            onChange={(e) => setPolicy({ ...policy, unmanaged_lan_severity: e.target.value })}
            className="border rounded px-3 py-2 w-full"
          >
            {severityOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Sévérité endpoint non vu</label>
          <select
            value={policy.stale_endpoint_severity}
            onChange={(e) => setPolicy({ ...policy, stale_endpoint_severity: e.target.value })}
            className="border rounded px-3 py-2 w-full"
          >
            {severityOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={savePolicy}
            disabled={policySaving}
            className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {policySaving ? 'Sauvegarde...' : 'Enregistrer seuils'}
          </button>
          <button
            onClick={recalculateAutoFindings}
            className="bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-800"
          >
            Recalculer constats auto
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded shadow p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <input name="title" value={form.title} onChange={handleChange} placeholder="Titre" className="border rounded px-3 py-2" required />
        <input name="target_name" value={form.target_name} onChange={handleChange} placeholder="Cible (nom machine, IP, serveur, VLAN...)" className="border rounded px-3 py-2" required />
        <select name="target_type" value={form.target_type} onChange={handleChange} className="border rounded px-3 py-2">
          {targetOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <select name="severity" value={form.severity} onChange={handleChange} className="border rounded px-3 py-2">
          {severityOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <select name="status" value={form.status} onChange={handleChange} className="border rounded px-3 py-2">
          {statusOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <input name="cve" value={form.cve} onChange={handleChange} placeholder="CVE (optionnel)" className="border rounded px-3 py-2" />
        <input name="source" value={form.source} onChange={handleChange} placeholder="Source (scanner, audit, agent...)" className="border rounded px-3 py-2" />
        <input name="recommendation" value={form.recommendation} onChange={handleChange} placeholder="Recommandation" className="border rounded px-3 py-2" />
        <textarea name="description" value={form.description} onChange={handleChange} placeholder="Description détaillée" className="border rounded px-3 py-2 md:col-span-2" rows={3} required />
        {error && <div className="text-red-500 md:col-span-2">{error}</div>}
        <div className="md:col-span-2">
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50" disabled={loading}>
            {loading ? 'Enregistrement...' : 'Ajouter un constat'}
          </button>
        </div>
      </form>

      <div className="bg-white rounded shadow p-4 overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Vulnérabilités / faiblesses ({filteredFindings.length})</h2>
          <div className="flex gap-3">
            <select 
              value={filterSeverity} 
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="border rounded px-3 py-1 text-sm"
            >
              <option value="">Toutes les sévérités</option>
              {severityOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            <select 
              value={filterStatus} 
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border rounded px-3 py-1 text-sm"
            >
              <option value="">Tous les statuts</option>
              {statusOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        </div>
        <table className="min-w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="py-2 px-3 text-left">Titre</th>
              <th className="py-2 px-3 text-left">Cible</th>
              <th className="py-2 px-3 text-left">Sévérité</th>
              <th className="py-2 px-3 text-left">Statut</th>
              <th className="py-2 px-3 text-left">Source</th>
              <th className="py-2 px-3 text-left">Recommandation</th>
              <th className="py-2 px-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredFindings.map((item) => (
              <tr key={item.id} className={`border-t hover:bg-gray-50 ${item.severity === 'Critique' ? 'bg-red-50' : ''}`}>
                <td className="py-2 px-3 font-semibold">{item.title}</td>
                <td className="py-2 px-3">{item.target_name}</td>
                <td className="py-2 px-3">
                  <span className={`inline-block px-3 py-1 rounded-full border text-sm font-semibold ${badgeClass(item.severity)}`}>
                    {item.severity}
                  </span>
                </td>
                <td className="py-2 px-3">
                  <span className={`inline-block px-3 py-1 rounded text-sm font-semibold ${statusColorClass(item.status)}`}>
                    {item.status}
                  </span>
                </td>
                <td className="py-2 px-3 text-sm">{item.source || '-'}</td>
                <td className="py-2 px-3 text-sm max-w-xs truncate">{item.recommendation || '-'}</td>
                <td className="py-2 px-3">
                  <div className="flex gap-2">
                    {item.status !== 'Corrigée' && (
                      <button
                        onClick={() => updateFindingStatus(item.id, 'En cours')}
                        title="Marquer en cours"
                        className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                      >
                        En cours
                      </button>
                    )}
                    {item.status !== 'Corrigée' && (
                      <button
                        onClick={() => updateFindingStatus(item.id, 'Corrigée')}
                        title="Marquer corrigée"
                        className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                      >
                        Corriger
                      </button>
                    )}
                    <button
                      onClick={() => deleteFinding(item.id)}
                      title="Supprimer"
                      className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
              {filteredFindings.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  {findings.length === 0 ? 'Aucun constat enregistré' : 'Aucun constat correspondant aux filtres'}
                </div>
              )}
      </div>

      <div className="bg-white rounded shadow p-4 overflow-auto">
        <h2 className="text-lg font-semibold mb-3">Posture de sécurité des postes / serveurs ({posture.length})</h2>
        <table className="min-w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="py-2 px-3 text-left">Hostname</th>
              <th className="py-2 px-3 text-left">Serial</th>
              <th className="py-2 px-3 text-left">OS</th>
              <th className="py-2 px-3 text-left">Firewall</th>
              <th className="py-2 px-3 text-left">Defender</th>
              <th className="py-2 px-3 text-left">Temps réel</th>
              <th className="py-2 px-3 text-left">BitLocker</th>
              <th className="py-2 px-3 text-left">Reboot</th>
            </tr>
          </thead>
          <tbody>
            {posture.map((item) => (
              <tr key={item.id} className="border-t hover:bg-gray-50">
                <td className="py-2 px-3 font-semibold">{item.hostname}</td>
                <td className="py-2 px-3">{item.serial_number}</td>
                <td className="py-2 px-3">{item.os || '-'}</td>
                <td className={`py-2 px-3 ${postureIconClass(item.firewall_enabled)}`}>{item.firewall_enabled ? 'Oui' : 'Non'}</td>
                <td className={`py-2 px-3 ${postureIconClass(item.defender_enabled)}`}>{item.defender_enabled ? 'Oui' : 'Non'}</td>
                <td className={`py-2 px-3 ${postureIconClass(item.realtime_protection_enabled)}`}>{item.realtime_protection_enabled ? 'Oui' : 'Non'}</td>
                <td className={`py-2 px-3 ${postureIconClass(item.bitlocker_enabled)}`}>{item.bitlocker_enabled ? 'Oui' : 'Non'}</td>
                <td className={`py-2 px-3 ${postureIconClass(!item.pending_reboot)}`}>{item.pending_reboot ? 'Oui ⚠️' : 'Non'}</td>
                      {posture.length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                          Aucune posture recordée
                        </div>
                      )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
