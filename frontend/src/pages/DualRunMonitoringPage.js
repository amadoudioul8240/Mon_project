import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const backendUrl = process.env.REACT_APP_BACKEND_URL;

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function getMachineHealthLevel(item) {
  if (!item.ps1_recent && !item.go_recent) return 'critical';
  if (item.ps1_recent && item.go_recent) return 'ok';
  return 'warning';
}

function getMachineHealthBadge(item) {
  const level = getMachineHealthLevel(item);
  if (level === 'ok') {
    return { label: 'OK (PS1 + Go)', className: 'bg-emerald-100 text-emerald-700 border-emerald-300' };
  }
  if (level === 'warning') {
    return { label: 'Partiel', className: 'bg-amber-100 text-amber-700 border-amber-300' };
  }
  return { label: 'Alerte', className: 'bg-rose-100 text-rose-700 border-rose-300' };
}

export default function DualRunMonitoringPage() {
  const [health, setHealth] = useState(null);
  const [compare, setCompare] = useState(null);
  const [selectedSerial, setSelectedSerial] = useState('');
  const [activeMinutes, setActiveMinutes] = useState(60);
  const [statusFilter, setStatusFilter] = useState('all');
  const [serialSearch, setSerialSearch] = useState('');
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [error, setError] = useState('');

  const fetchHealth = async () => {
    setLoadingHealth(true);
    setError('');
    try {
      const res = await axios.get(`${backendUrl}/agents/dual-run/health`, {
        params: { active_minutes: activeMinutes },
      });
      setHealth(res.data);
    } catch (err) {
      setError('Impossible de charger la santé dual-run.');
    } finally {
      setLoadingHealth(false);
    }
  };

  const fetchCompare = async (serial) => {
    if (!serial) return;
    setLoadingCompare(true);
    setError('');
    try {
      const res = await axios.get(`${backendUrl}/agents/dual-run/compare/${encodeURIComponent(serial)}`);
      setCompare(res.data);
    } catch (err) {
      setError('Impossible de charger la comparaison PS1 vs Go.');
      setCompare(null);
    } finally {
      setLoadingCompare(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchHealth();
    }, 30000);
    return () => clearInterval(timer);
  }, [activeMinutes]);

  useEffect(() => {
    if (!health || !Array.isArray(health.items) || health.items.length === 0) {
      setSelectedSerial('');
      setCompare(null);
      return;
    }
    if (!selectedSerial || !health.items.some((item) => item.serial_number === selectedSerial)) {
      const first = health.items[0].serial_number;
      setSelectedSerial(first);
      fetchCompare(first);
    }
  }, [health]);

  const sortedItems = useMemo(() => {
    const raw = health?.items || [];
    return [...raw].sort((a, b) => {
      const rank = (item) => {
        const level = getMachineHealthLevel(item);
        if (level === 'critical') return 0;
        if (level === 'warning') return 1;
        return 2;
      };

      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;

      const tsA = Math.max(
        a.last_ps1 ? new Date(a.last_ps1).getTime() : 0,
        a.last_go ? new Date(a.last_go).getTime() : 0
      );
      const tsB = Math.max(
        b.last_ps1 ? new Date(b.last_ps1).getTime() : 0,
        b.last_go ? new Date(b.last_go).getTime() : 0
      );

      return tsA - tsB;
    });
  }, [health]);

  const items = useMemo(() => {
    const search = serialSearch.trim().toLowerCase();
    return sortedItems.filter((item) => {
      const level = getMachineHealthLevel(item);
      const statusOk = statusFilter === 'all' || statusFilter === level;
      const searchOk = !search || (item.serial_number || '').toLowerCase().includes(search);
      return statusOk && searchOk;
    });
  }, [sortedItems, statusFilter, serialSearch]);

  const freshness = useMemo(() => {
    const generatedAt = health?.generated_at;
    if (!generatedAt) {
      return {
        label: 'Aucune donnée',
        className: 'bg-slate-100 text-slate-700 border-slate-300',
      };
    }

    const ts = new Date(generatedAt).getTime();
    if (Number.isNaN(ts)) {
      return {
        label: 'Horodatage invalide',
        className: 'bg-rose-100 text-rose-700 border-rose-300',
      };
    }

    const ageSec = Math.floor((Date.now() - ts) / 1000);
    if (ageSec <= 90) {
      return {
        label: `Données fraîches (${ageSec}s)`,
        className: 'bg-emerald-100 text-emerald-700 border-emerald-300',
      };
    }

    return {
      label: `Données obsolètes (${ageSec}s)`,
      className: 'bg-amber-100 text-amber-700 border-amber-300',
    };
  }, [health]);

  const exportCsv = () => {
    const headers = [
      'serial_number',
      'status_level',
      'status_label',
      'active_source',
      'last_ps1',
      'last_go',
      'ps1_recent',
      'go_recent',
    ];

    const rows = items.map((item) => {
      const badge = getMachineHealthBadge(item);
      const level = getMachineHealthLevel(item);
      return [
        item.serial_number || '',
        level,
        badge.label,
        item.active_source || '',
        formatDateTime(item.last_ps1),
        formatDateTime(item.last_go),
        item.ps1_recent ? 'true' : 'false',
        item.go_recent ? 'true' : 'false',
      ];
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dual-run-health-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const selectSerial = (serial) => {
    setSelectedSerial(serial);
    fetchCompare(serial);
  };

  return (
    <div className="container mx-auto space-y-6 px-3 py-4 md:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dual-Run Monitoring</h1>
          <p className="text-gray-600">Comparaison et santé des agents PS1 et Go en parallèle.</p>
          <div className="mt-2 flex items-center gap-2">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${freshness.className}`}>
              {freshness.label}
            </span>
            <span className="text-xs text-slate-500">Auto-refresh: 30s</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700">Fenêtre active (min)</label>
          <input
            type="number"
            min={1}
            max={1440}
            value={activeMinutes}
            onChange={(e) => setActiveMinutes(Number(e.target.value) || 60)}
            className="w-24 rounded border px-2 py-1"
          />
          <button
            onClick={fetchHealth}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            disabled={loadingHealth}
          >
            {loadingHealth ? 'Chargement...' : 'Rafraîchir'}
          </button>
        </div>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="rounded bg-white p-4 shadow border-l-4 border-l-slate-600">
          <div className="text-sm text-gray-500">Total hôtes</div>
          <div className="text-2xl font-bold">{health?.total_hosts ?? 0}</div>
        </div>
        <div className="rounded bg-white p-4 shadow border-l-4 border-l-emerald-600">
          <div className="text-sm text-gray-500">PS1 + Go actifs</div>
          <div className="text-2xl font-bold text-emerald-700">{health?.both_active ?? 0}</div>
        </div>
        <div className="rounded bg-white p-4 shadow border-l-4 border-l-amber-500">
          <div className="text-sm text-gray-500">PS1 uniquement</div>
          <div className="text-2xl font-bold text-amber-700">{health?.ps1_only ?? 0}</div>
        </div>
        <div className="rounded bg-white p-4 shadow border-l-4 border-l-cyan-600">
          <div className="text-sm text-gray-500">Go uniquement</div>
          <div className="text-2xl font-bold text-cyan-700">{health?.go_only ?? 0}</div>
        </div>
        <div className="rounded bg-white p-4 shadow border-l-4 border-l-rose-600">
          <div className="text-sm text-gray-500">Aucun récent</div>
          <div className="text-2xl font-bold text-rose-700">{health?.none_recent ?? 0}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded bg-white p-4 shadow">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-semibold">Santé par machine</h2>
            <button
              type="button"
              onClick={exportCsv}
              className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Export CSV
            </button>
          </div>

          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded px-3 py-1 text-xs font-semibold ${statusFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                Tous
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('critical')}
                className={`rounded px-3 py-1 text-xs font-semibold ${statusFilter === 'critical' ? 'bg-rose-700 text-white' : 'bg-rose-100 text-rose-700 hover:bg-rose-200'}`}
              >
                Alerte
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('warning')}
                className={`rounded px-3 py-1 text-xs font-semibold ${statusFilter === 'warning' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
              >
                Partiel
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ok')}
                className={`rounded px-3 py-1 text-xs font-semibold ${statusFilter === 'ok' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
              >
                OK
              </button>
            </div>
            <input
              type="text"
              value={serialSearch}
              onChange={(e) => setSerialSearch(e.target.value)}
              placeholder="Recherche par serial"
              className="w-full rounded border px-3 py-1.5 text-sm lg:ml-auto lg:max-w-xs"
            />
          </div>

          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Machine</th>
                  <th className="px-3 py-2 text-left">Dernier PS1</th>
                  <th className="px-3 py-2 text-left">Dernier Go</th>
                  <th className="px-3 py-2 text-left">Source active</th>
                  <th className="px-3 py-2 text-left">État</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.serial_number}
                    className={`cursor-pointer border-t ${selectedSerial === item.serial_number ? 'bg-cyan-50' : 'hover:bg-gray-50'}`}
                    onClick={() => selectSerial(item.serial_number)}
                  >
                    <td className="px-3 py-2 font-medium">{item.serial_number}</td>
                    <td className="px-3 py-2">{formatDateTime(item.last_ps1)}</td>
                    <td className="px-3 py-2">{formatDateTime(item.last_go)}</td>
                    <td className="px-3 py-2">{item.active_source || '-'}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        const badge = getMachineHealthBadge(item);
                        return (
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${badge.className}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-gray-500">Aucune donnée dual-run.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded bg-white p-4 shadow">
          <h2 className="mb-3 text-lg font-semibold">Comparaison PS1 vs Go</h2>
          {!selectedSerial && <div className="text-sm text-gray-500">Sélectionne une machine.</div>}
          {selectedSerial && (
            <>
              <div className="mb-3 text-sm text-gray-700">Machine: <strong>{selectedSerial}</strong></div>
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left">Métrique</th>
                      <th className="px-3 py-2 text-left">PS1</th>
                      <th className="px-3 py-2 text-left">Go</th>
                      <th className="px-3 py-2 text-left">Winner</th>
                      <th className="px-3 py-2 text-left">Écarts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(compare?.items || []).map((item) => (
                      <tr key={item.metric_type} className="border-t">
                        <td className="px-3 py-2">{item.metric_type}</td>
                        <td className="px-3 py-2">{formatDateTime(item.ps1_received_at)}</td>
                        <td className="px-3 py-2">{formatDateTime(item.go_received_at)}</td>
                        <td className="px-3 py-2">{item.winner || '-'}</td>
                        <td className="px-3 py-2">
                          {item.mismatched_fields > 0
                            ? `${item.mismatched_fields} (${(item.mismatch_keys || []).slice(0, 3).join(', ')})`
                            : '0'}
                        </td>
                      </tr>
                    ))}
                    {!loadingCompare && (compare?.items || []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-3 text-gray-500">Pas de comparaison disponible.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {loadingCompare && <div className="mt-2 text-sm text-gray-500">Chargement comparaison...</div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
