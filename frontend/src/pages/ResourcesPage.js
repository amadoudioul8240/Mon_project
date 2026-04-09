import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

import { backendUrl } from '../config/api';

const pct = (used, total) => {
  if (!total || total <= 0 || used === null || used === undefined) return null;
  return Math.round((used / total) * 100);
};

export default function ResourcesPage() {
  const [data, setData] = useState({
    generated_at: '',
    total_devices: 0,
    reporting_devices: 0,
    pending_devices: 0,
    items: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchMetrics = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${backendUrl}/metrics/resources`);
      setData(res.data || { items: [] });
    } catch (err) {
      setError('Impossible de charger la supervision des ressources.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 15000);
    return () => clearInterval(interval);
  }, []);

  const chartData = (data.items || []).map((item) => ({
    name: item.hostname,
    cpu: item.cpu_percent ?? 0,
    ram_pct: pct(item.ram_used_gb, item.ram_total_gb) ?? 0,
    disk_pct: pct(item.disk_used_gb, item.disk_total_gb) ?? 0,
    status: item.status,
  }));

  return (
    <div className="container mx-auto space-y-6 px-3 py-4 md:p-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Supervision Ressources</h1>
          <p className="text-gray-600">Suivi CPU, RAM et stockage pour les équipements remontés par agent et AD.</p>
        </div>
        <button
          onClick={fetchMetrics}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Rafraîchir
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-blue-600">
          <div className="text-sm text-gray-500">Total équipements</div>
          <div className="text-2xl font-bold">{data.total_devices}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-green-600">
          <div className="text-sm text-gray-500">Reporting actif</div>
          <div className="text-2xl font-bold text-green-600">{data.reporting_devices}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-orange-600">
          <div className="text-sm text-gray-500">En attente métriques</div>
          <div className="text-2xl font-bold text-orange-600">{data.pending_devices}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-indigo-600">
          <div className="text-sm text-gray-500">Dernière mise à jour</div>
          <div className="font-semibold">{data.generated_at ? new Date(data.generated_at).toLocaleString() : '-'}</div>
        </div>
      </div>

      {error && <div className="text-red-600">{error}</div>}

      <div className="bg-white rounded shadow p-4" style={{ height: 420 }}>
        <h2 className="text-lg font-semibold mb-3">Graphique d'utilisation (%)</h2>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-20} textAnchor="end" interval={0} height={70} />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Legend />
            <Bar dataKey="cpu" name="CPU %" fill="#ef4444" />
            <Bar dataKey="ram_pct" name="RAM %" fill="#3b82f6" />
            <Bar dataKey="disk_pct" name="Stockage %" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded shadow p-4 overflow-auto">
        <h2 className="text-lg font-semibold mb-3">Détail par équipement</h2>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="py-2 px-3 text-left">Équipement</th>
              <th className="py-2 px-3 text-left">Source</th>
              <th className="py-2 px-3 text-left">CPU %</th>
              <th className="py-2 px-3 text-left">RAM (utilisée / totale)</th>
              <th className="py-2 px-3 text-left">Stockage (utilisé / total)</th>
              <th className="py-2 px-3 text-left">Statut</th>
              <th className="py-2 px-3 text-left">Dernière remontée</th>
            </tr>
          </thead>
          <tbody>
            {!loading && (data.items || []).length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 px-3 text-gray-500">Aucune donnée de supervision disponible.</td>
              </tr>
            )}
            {(data.items || []).map((item, idx) => (
              <tr key={`${item.serial_number}-${idx}`} className="border-t">
                <td className="py-2 px-3">{item.hostname} ({item.serial_number})</td>
                <td className="py-2 px-3">{item.source}</td>
                <td className="py-2 px-3">{item.cpu_percent ?? '-'}</td>
                <td className="py-2 px-3">{item.ram_used_gb ?? '-'} / {item.ram_total_gb ?? '-'} GB</td>
                <td className="py-2 px-3">{item.disk_used_gb ?? '-'} / {item.disk_total_gb ?? '-'} GB</td>
                <td className="py-2 px-3">
                  {item.status === 'reporting' ? (
                    <span className="inline-block px-2 py-1 rounded bg-green-100 text-green-700 border border-green-300">Actif</span>
                  ) : (
                    <span className="inline-block px-2 py-1 rounded bg-orange-100 text-orange-700 border border-orange-300">En attente</span>
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
