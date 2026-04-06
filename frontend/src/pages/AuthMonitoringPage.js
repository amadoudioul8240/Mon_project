import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const backendUrl = process.env.REACT_APP_BACKEND_URL;

function barWidth(value, max) {
  if (!max || max <= 0) return '0%';
  return `${Math.max(2, Math.round((value / max) * 100))}%`;
}

export default function AuthMonitoringPage() {
  const [hours, setHours] = useState(24);
  const [hostSerial, setHostSerial] = useState('');
  const [outcome, setOutcome] = useState('');
  const [summary, setSummary] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const summaryParams = { hours };
      if (hostSerial.trim()) summaryParams.host_serial = hostSerial.trim();

      const eventParams = { limit: 200, hours };
      if (hostSerial.trim()) eventParams.host_serial = hostSerial.trim();
      if (outcome) eventParams.outcome = outcome;

      const [summaryRes, eventsRes] = await Promise.all([
        axios.get(`${backendUrl}/siem/auth-summary`, { params: summaryParams }),
        axios.get(`${backendUrl}/siem/auth-events`, { params: eventParams }),
      ]);

      setSummary(summaryRes.data);
      setEvents(eventsRes.data || []);
    } catch (err) {
      setError('Impossible de charger le monitoring authentification.');
      setSummary(null);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const trendMax = useMemo(() => {
    if (!summary || !summary.hourly || summary.hourly.length === 0) return 0;
    let maxValue = 0;
    for (const h of summary.hourly) {
      maxValue = Math.max(maxValue, h.success + h.failure + h.lockout);
    }
    return maxValue;
  }, [summary]);

  return (
    <div className="container mx-auto space-y-6 px-3 py-4 md:p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Auth Monitoring</h1>
        <p className="text-gray-600">Suivi des tentatives de connexion, echecs, lockouts et sources suspectes.</p>
      </div>

      <div className="rounded bg-white p-4 shadow">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            type="text"
            value={hostSerial}
            onChange={(e) => setHostSerial(e.target.value)}
            placeholder="Host serial (optionnel)"
            className="rounded border px-3 py-2"
          />
          <select
            value={String(hours)}
            onChange={(e) => setHours(Number(e.target.value || 24))}
            className="rounded border px-3 py-2"
          >
            <option value="6">6h</option>
            <option value="12">12h</option>
            <option value="24">24h</option>
            <option value="48">48h</option>
            <option value="72">72h</option>
          </select>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="rounded border px-3 py-2"
          >
            <option value="">Tous outcomes</option>
            <option value="success">success</option>
            <option value="failure">failure</option>
            <option value="lockout">lockout</option>
          </select>
          <button
            type="button"
            onClick={loadData}
            className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          >
            Actualiser
          </button>
        </div>
      </div>

      {loading && <div className="rounded border border-slate-300 bg-slate-50 p-3 text-sm">Chargement...</div>}
      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {summary && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded border-l-4 border-l-blue-600 bg-white p-4 shadow">
              <div className="text-sm text-gray-500">Total events</div>
              <div className="text-2xl font-bold">{summary.total_events}</div>
            </div>
            <div className="rounded border-l-4 border-l-green-600 bg-white p-4 shadow">
              <div className="text-sm text-gray-500">Succes</div>
              <div className="text-2xl font-bold text-green-700">{summary.success_events}</div>
            </div>
            <div className="rounded border-l-4 border-l-orange-600 bg-white p-4 shadow">
              <div className="text-sm text-gray-500">Echecs</div>
              <div className="text-2xl font-bold text-orange-700">{summary.failure_events}</div>
            </div>
            <div className="rounded border-l-4 border-l-red-600 bg-white p-4 shadow">
              <div className="text-sm text-gray-500">Lockouts</div>
              <div className="text-2xl font-bold text-red-700">{summary.lockout_events}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded bg-white p-4 shadow">
              <h2 className="mb-3 text-lg font-semibold">Top utilisateurs en echec</h2>
              <div className="space-y-2">
                {(summary.top_failed_users || []).map((item) => (
                  <div key={item.key}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{item.key}</span>
                      <span className="font-semibold">{item.count}</span>
                    </div>
                    <div className="h-2 rounded bg-slate-100">
                      <div className="h-2 rounded bg-orange-500" style={{ width: barWidth(item.count, (summary.top_failed_users[0] || {}).count || 0) }} />
                    </div>
                  </div>
                ))}
                {(summary.top_failed_users || []).length === 0 && <div className="text-sm text-slate-500">Aucune donnee.</div>}
              </div>
            </div>

            <div className="rounded bg-white p-4 shadow">
              <h2 className="mb-3 text-lg font-semibold">Top IP sources en echec</h2>
              <div className="space-y-2">
                {(summary.top_failed_source_ips || []).map((item) => (
                  <div key={item.key}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{item.key}</span>
                      <span className="font-semibold">{item.count}</span>
                    </div>
                    <div className="h-2 rounded bg-slate-100">
                      <div className="h-2 rounded bg-red-500" style={{ width: barWidth(item.count, (summary.top_failed_source_ips[0] || {}).count || 0) }} />
                    </div>
                  </div>
                ))}
                {(summary.top_failed_source_ips || []).length === 0 && <div className="text-sm text-slate-500">Aucune donnee.</div>}
              </div>
            </div>
          </div>

          <div className="rounded bg-white p-4 shadow">
            <h2 className="mb-3 text-lg font-semibold">Tendance horaire ({summary.hours}h)</h2>
            <div className="space-y-2">
              {(summary.hourly || []).map((h) => {
                const total = h.success + h.failure + h.lockout;
                return (
                  <div key={h.hour} className="grid grid-cols-1 items-center gap-2 md:grid-cols-[180px_1fr_90px]">
                    <div className="text-xs text-slate-600">{new Date(h.hour).toLocaleString()}</div>
                    <div className="h-3 rounded bg-slate-100">
                      <div className="h-3 rounded bg-indigo-500" style={{ width: barWidth(total, trendMax) }} />
                    </div>
                    <div className="text-xs font-semibold text-slate-700">S:{h.success} E:{h.failure} L:{h.lockout}</div>
                  </div>
                );
              })}
              {(summary.hourly || []).length === 0 && <div className="text-sm text-slate-500">Aucune donnee.</div>}
            </div>
          </div>
        </>
      )}

      <div className="rounded bg-white p-4 shadow">
        <h2 className="mb-3 text-lg font-semibold">Evenements auth recents ({events.length})</h2>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">User</th>
                <th className="px-3 py-2 text-left">Host</th>
                <th className="px-3 py-2 text-left">Outcome</th>
                <th className="px-3 py-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const payload = ev.payload_json || {};
                return (
                  <tr key={ev.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(ev.timestamp).toLocaleString()}</td>
                    <td className="px-3 py-2">{ev.event_type}</td>
                    <td className="px-3 py-2">{ev.user_name || payload.user_name || '-'}</td>
                    <td className="px-3 py-2">{ev.host_name || ev.host_serial || '-'}</td>
                    <td className="px-3 py-2">{ev.outcome || payload.outcome || '-'}</td>
                    <td className="px-3 py-2">{payload.source_ip || '-'}</td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={6}>Aucun evenement auth pour les filtres courants.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
