import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

const backendUrl = process.env.REACT_APP_BACKEND_URL;

export default function NetworkPortsLogsPage() {
  const [data, setData] = useState({ generated_at: '', total_hosts: 0, hosts_with_open_ports: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectedSerial, setSelectedSerial] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${backendUrl}/network/ports-logs`);
      setData(res.data || { items: [] });
    } catch (err) {
      setError('Impossible de charger les ports ouverts et logs réseau.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const filteredItems = useMemo(() => {
    const items = data.items || [];
    if (sourceFilter === 'all') return items;
    return items.filter((item) => item.source === sourceFilter);
  }, [data.items, sourceFilter]);

  const chartData = filteredItems
    .map((item) => ({ name: item.hostname, open_ports_count: (item.open_ports || []).length }))
    .sort((a, b) => b.open_ports_count - a.open_ports_count)
    .slice(0, 20);

  const wiresharkCandidates = useMemo(
    () => filteredItems.filter((item) => (item.open_ports || []).length > 0),
    [filteredItems]
  );

  useEffect(() => {
    if (!wiresharkCandidates.length) {
      setSelectedSerial('');
      return;
    }
    const alreadyExists = wiresharkCandidates.some((item) => item.serial_number === selectedSerial);
    if (!alreadyExists) {
      setSelectedSerial(wiresharkCandidates[0].serial_number);
    }
  }, [wiresharkCandidates, selectedSerial]);

  const selectedHost = useMemo(
    () => wiresharkCandidates.find((item) => item.serial_number === selectedSerial) || null,
    [wiresharkCandidates, selectedSerial]
  );

  const captureFilter = useMemo(() => {
    if (!selectedHost) {
      return '';
    }
    const ports = (selectedHost.open_ports || []).filter((p) => Number.isInteger(Number(p)));
    const portsExpr = ports.length > 0 ? `(${ports.map((p) => `port ${p}`).join(' or ')})` : '';

    if (selectedHost.ip_address && portsExpr) {
      return `host ${selectedHost.ip_address} and ${portsExpr}`;
    }
    if (selectedHost.ip_address) {
      return `host ${selectedHost.ip_address}`;
    }
    if (portsExpr) {
      return portsExpr;
    }
    return '';
  }, [selectedHost]);

  const wiresharkCommand = useMemo(() => {
    if (!captureFilter) {
      return '';
    }
    return `& \"C:\\Program Files\\Wireshark\\Wireshark.exe\" -k -f \"${captureFilter}\"`;
  }, [captureFilter]);

  const copyText = async (text, successMessage) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(successMessage);
      setTimeout(() => setCopyFeedback(''), 1800);
    } catch (e) {
      setCopyFeedback('Copie impossible depuis ce navigateur.');
      setTimeout(() => setCopyFeedback(''), 2200);
    }
  };

  return (
    <div className="container mx-auto space-y-6 px-3 py-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Ports Ouverts & Logs LAN</h1>
          <p className="text-gray-600">Suivi défensif des ports ouverts et logs de sonde pour les équipements du LAN.</p>
        </div>
        <button onClick={fetchData} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          Rafraîchir
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-blue-600">
          <div className="text-sm text-gray-500">Hôtes monitorés</div>
          <div className="text-2xl font-bold">{data.total_hosts}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-red-600">
          <div className="text-sm text-gray-500">Hôtes avec ports ouverts</div>
          <div className="text-2xl font-bold text-red-600">{data.hosts_with_open_ports}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-green-600">
          <div className="text-sm text-gray-500">Dernière MAJ</div>
          <div className="font-semibold">{data.generated_at ? new Date(data.generated_at).toLocaleString() : '-'}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-indigo-600">
          <div className="text-sm text-gray-500 mb-1">Filtre source</div>
          <select
            className="border rounded px-2 py-1 w-full"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">Toutes les sources</option>
            <option value="local_agent">Agent local</option>
            <option value="lan_probe">Sonde LAN</option>
            <option value="ad_sync">Sync AD</option>
          </select>
        </div>
      </div>

      {error && <div className="text-red-600">{error}</div>}

      <div className="bg-white rounded shadow p-4 border-l-4 border-l-cyan-600">
        <h2 className="text-lg font-semibold mb-2">Intégration Wireshark</h2>
        <p className="text-sm text-gray-600 mb-4">
          Sélectionne un hôte avec ports ouverts pour générer un filtre de capture prêt à coller dans Wireshark.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Hôte cible</label>
            <select
              className="border rounded px-3 py-2 w-full"
              value={selectedSerial}
              onChange={(e) => setSelectedSerial(e.target.value)}
              disabled={wiresharkCandidates.length === 0}
            >
              {wiresharkCandidates.length === 0 && <option value="">Aucun hôte avec ports ouverts</option>}
              {wiresharkCandidates.map((item) => (
                <option key={item.serial_number} value={item.serial_number}>
                  {item.hostname} ({item.ip_address || 'IP inconnue'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Filtre capture (BPF)</label>
            <input
              className="border rounded px-3 py-2 w-full bg-gray-50 text-sm"
              value={captureFilter || 'Aucun filtre disponible'}
              readOnly
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="text-sm font-semibold text-gray-700 mb-1 block">Commande PowerShell</label>
          <textarea
            className="border rounded px-3 py-2 w-full bg-gray-50 text-xs font-mono"
            rows={2}
            value={wiresharkCommand || 'Aucune commande disponible tant qu\'aucun hôte n\'est sélectionné.'}
            readOnly
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="bg-cyan-700 text-white px-4 py-2 rounded hover:bg-cyan-800 disabled:bg-gray-300"
            disabled={!captureFilter}
            onClick={() => copyText(captureFilter, 'Filtre Wireshark copié.')}
          >
            Copier filtre
          </button>
          <button
            className="bg-slate-700 text-white px-4 py-2 rounded hover:bg-slate-800 disabled:bg-gray-300"
            disabled={!wiresharkCommand}
            onClick={() => copyText(wiresharkCommand, 'Commande Wireshark copiée.')}
          >
            Copier commande
          </button>
          {copyFeedback && <span className="text-sm text-emerald-700 self-center">{copyFeedback}</span>}
        </div>
      </div>

      <div className="bg-white rounded shadow p-4" style={{ height: 380 }}>
        <h2 className="text-lg font-semibold mb-3">Top hôtes par nombre de ports ouverts</h2>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} height={80} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="open_ports_count" name="Ports ouverts" fill="#ef4444" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded shadow p-4 overflow-auto">
        <h2 className="text-lg font-semibold mb-3">Détail ports/logs par équipement</h2>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="py-2 px-3 text-left">Hôte</th>
              <th className="py-2 px-3 text-left">IP</th>
              <th className="py-2 px-3 text-left">Source</th>
              <th className="py-2 px-3 text-left">Statut</th>
              <th className="py-2 px-3 text-left">Ports ouverts</th>
              <th className="py-2 px-3 text-left">Logs</th>
              <th className="py-2 px-3 text-left">Dernière activité</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filteredItems.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 px-3 text-gray-500">Aucune donnée réseau disponible.</td>
              </tr>
            )}
            {filteredItems.map((item, idx) => (
              <tr key={`${item.serial_number}-${idx}`} className="border-t align-top">
                <td className="py-2 px-3 font-semibold">{item.hostname}</td>
                <td className="py-2 px-3">{item.ip_address || '-'}</td>
                <td className="py-2 px-3">{item.source}</td>
                <td className="py-2 px-3">
                  {item.status === 'pending' ? (
                    <span className="inline-flex px-2 py-1 rounded bg-amber-100 text-amber-700 border border-amber-300">En attente</span>
                  ) : (
                    <span className="inline-flex px-2 py-1 rounded bg-green-100 text-green-700 border border-green-300">Actif</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  {(item.open_ports || []).length === 0 ? (
                    <span className="text-green-700">Aucun détecté</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {item.open_ports.map((p) => (
                        <span key={`${item.serial_number}-${p}`} className="px-2 py-1 rounded bg-red-100 text-red-700 border border-red-300">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2 px-3 max-w-xl">
                  {(item.logs || []).length === 0 ? (
                    <span className="text-gray-500">-</span>
                  ) : (
                    <ul className="list-disc list-inside space-y-1">
                      {item.logs.slice(0, 5).map((log, i) => (
                        <li key={`${item.serial_number}-log-${i}`} className="text-xs">{log}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-2 px-3">{item.last_seen ? new Date(item.last_seen).toLocaleString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
