import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';

const backendUrl = process.env.REACT_APP_BACKEND_URL;
const SESSION_WINDOW_MINUTES = 15;

function severityBadgeClass(severity) {
  const key = (severity || '').toLowerCase();
  if (key.includes('crit')) return 'bg-red-100 text-red-700 border-red-300';
  if (key.includes('elev') || key.includes('high')) return 'bg-orange-100 text-orange-700 border-orange-300';
  if (key.includes('moy') || key.includes('med')) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
  return 'bg-blue-100 text-blue-700 border-blue-300';
}

function asDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function downloadBlob(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  if (value === null || value === undefined) return '""';
  const escaped = String(value).replace(/"/g, '""');
  return `"${escaped}"`;
}

export default function SiemTimelinePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialHost = searchParams.get('host') || '';
  const [host, setHost] = useState(initialHost);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedData, setExpandedData] = useState({});
  const [viewMode, setViewMode] = useState('session');
  const [itemTypeFilter, setItemTypeFilter] = useState('');
  const [ruleFilter, setRuleFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');

  const fetchTimeline = async (targetHost) => {
    const serial = (targetHost || '').trim();
    if (!serial) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${backendUrl}/siem/timeline/${encodeURIComponent(serial)}`, {
        params: { limit: 500 },
      });
      setItems(res.data.items || []);
      setExpandedData({});
      setSearchParams({ host: serial });
    } catch (err) {
      setError('Impossible de charger la timeline SIEM pour cet hote.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialHost) {
      fetchTimeline(initialHost);
    }
  }, []);

  const filteredItems = useMemo(() => {
    return (items || []).filter((item) => {
      const typeOk = !itemTypeFilter || item.item_type === itemTypeFilter;
      const ruleOk = !ruleFilter || ((item.rule_id || '').toLowerCase().includes(ruleFilter.toLowerCase()));
      const sevOk = !severityFilter || ((item.severity || '').toLowerCase().includes(severityFilter.toLowerCase()));
      return typeOk && ruleOk && sevOk;
    });
  }, [items, itemTypeFilter, ruleFilter, severityFilter]);

  const summary = useMemo(() => {
    const alerts = filteredItems.filter((i) => i.item_type === 'alert').length;
    const events = filteredItems.filter((i) => i.item_type === 'event').length;
    return { alerts, events };
  }, [filteredItems]);

  const sessions = useMemo(() => {
    const windowMs = SESSION_WINDOW_MINUTES * 60 * 1000;
    const sorted = [...filteredItems].sort((a, b) => {
      const da = asDate(a.timestamp);
      const db = asDate(b.timestamp);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });

    const byWindow = new Map();
    for (const item of sorted) {
      const d = asDate(item.timestamp);
      if (!d) {
        continue;
      }
      const startMs = Math.floor(d.getTime() / windowMs) * windowMs;
      const key = String(startMs);
      if (!byWindow.has(key)) {
        byWindow.set(key, {
          start: new Date(startMs),
          end: new Date(startMs + windowMs - 1),
          items: [],
        });
      }
      byWindow.get(key).items.push(item);
    }

    return Array.from(byWindow.values()).sort((a, b) => b.start.getTime() - a.start.getTime());
  }, [filteredItems]);

  const toggleData = (key) => {
    setExpandedData((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const exportJson = () => {
    const safeHost = (host || 'timeline').replace(/[^a-zA-Z0-9._-]/g, '_');
    const payload = {
      host_serial: (host || '').trim(),
      exported_at: new Date().toISOString(),
      total_items: filteredItems.length,
      items: filteredItems,
    };
    downloadBlob(`${safeHost}-timeline.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  };

  const exportCsv = () => {
    const safeHost = (host || 'timeline').replace(/[^a-zA-Z0-9._-]/g, '_');
    const headers = [
      'timestamp',
      'item_type',
      'severity',
      'status',
      'title',
      'description',
      'source',
      'event_type',
      'rule_id',
      'data_json',
    ];

    const lines = [headers.map(csvValue).join(',')];
    for (const item of filteredItems) {
      const row = [
        item.timestamp,
        item.item_type,
        item.severity,
        item.status || '',
        item.title,
        item.description,
        item.source || '',
        item.event_type || '',
        item.rule_id || '',
        JSON.stringify(item.data || {}),
      ];
      lines.push(row.map(csvValue).join(','));
    }

    downloadBlob(`${safeHost}-timeline.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
  };

  const availableRules = useMemo(() => {
    const values = new Set();
    for (const item of items || []) {
      if (item.rule_id) {
        values.add(item.rule_id);
      }
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const availableSeverities = useMemo(() => {
    const values = new Set();
    for (const item of items || []) {
      if (item.severity) {
        values.add(String(item.severity));
      }
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const renderTimelineItem = (item, idx, keyPrefix = 'flat') => {
    const key = `${keyPrefix}-${item.item_type}-${item.timestamp}-${idx}`;
    const hasData = item.data && Object.keys(item.data).length > 0;
    const isExpanded = !!expandedData[key];

    return (
      <div key={key} className="rounded border border-slate-200 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-700">{item.item_type}</span>
          <span className={`rounded border px-2 py-1 text-xs font-semibold ${severityBadgeClass(item.severity)}`}>{item.severity}</span>
          {item.status && <span className="rounded bg-cyan-100 px-2 py-1 text-xs font-semibold text-cyan-800">{item.status}</span>}
          <span className="ml-auto text-xs text-slate-500">{item.timestamp ? new Date(item.timestamp).toLocaleString() : '-'}</span>
        </div>
        <div className="font-semibold text-slate-800">{item.title}</div>
        <div className="text-sm text-slate-600">{item.description}</div>
        <div className="mt-2 text-xs text-slate-500">
          {item.source ? `source: ${item.source}` : ''}
          {item.rule_id ? ` | rule: ${item.rule_id}` : ''}
          {item.event_type ? ` | event: ${item.event_type}` : ''}
        </div>
        {hasData && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => toggleData(key)}
              className="rounded bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            >
              {isExpanded ? 'Masquer preuves JSON' : 'Afficher preuves JSON'}
            </button>
            {isExpanded && (
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(item.data, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto space-y-6 px-3 py-4 md:p-8">
      <div>
        <h1 className="text-2xl font-bold">Timeline d investigation SIEM</h1>
        <p className="text-gray-600">Vue chronologique unifiee des evenements et alertes pour une machine.</p>
      </div>

      <div className="rounded bg-white p-4 shadow">
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="Ex: pc-client.siramada.local"
            className="w-full rounded border px-3 py-2 md:max-w-lg"
          />
          <button
            type="button"
            onClick={() => fetchTimeline(host)}
            className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          >
            Charger la timeline
          </button>
          <button
            type="button"
            onClick={exportJson}
            className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
            disabled={items.length === 0}
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded bg-teal-600 px-4 py-2 text-white hover:bg-teal-700"
            disabled={filteredItems.length === 0}
          >
            Export CSV
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <select
            value={itemTypeFilter}
            onChange={(e) => setItemTypeFilter(e.target.value)}
            className="rounded border px-3 py-2"
          >
            <option value="">Tous types</option>
            <option value="event">Event</option>
            <option value="alert">Alert</option>
          </select>
          <select
            value={ruleFilter}
            onChange={(e) => setRuleFilter(e.target.value)}
            className="rounded border px-3 py-2"
          >
            <option value="">Toutes regles</option>
            {availableRules.map((rule) => (
              <option key={rule} value={rule}>{rule}</option>
            ))}
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded border px-3 py-2"
          >
            <option value="">Toutes severites</option>
            {availableSeverities.map((sev) => (
              <option key={sev} value={sev}>{sev}</option>
            ))}
          </select>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={() => { setItemTypeFilter(''); setRuleFilter(''); setSeverityFilter(''); }}
            className="rounded bg-slate-100 px-3 py-2 text-slate-700 hover:bg-slate-200"
          >
            Reinitialiser filtres
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setViewMode('session')}
            className={`rounded px-3 py-1 text-sm font-semibold ${viewMode === 'session' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}
          >
            Vue sessions 15 min
          </button>
          <button
            type="button"
            onClick={() => setViewMode('flat')}
            className={`rounded px-3 py-1 text-sm font-semibold ${viewMode === 'flat' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}
          >
            Vue chronologique
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded border-l-4 border-l-blue-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Items timeline</div>
          <div className="text-2xl font-bold">{filteredItems.length}</div>
        </div>
        <div className="rounded border-l-4 border-l-red-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Alertes</div>
          <div className="text-2xl font-bold text-red-600">{summary.alerts}</div>
        </div>
        <div className="rounded border-l-4 border-l-green-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Evenements</div>
          <div className="text-2xl font-bold text-green-700">{summary.events}</div>
        </div>
        <div className="rounded border-l-4 border-l-purple-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Sessions (15 min)</div>
          <div className="text-2xl font-bold text-purple-700">{sessions.length}</div>
        </div>
      </div>

      {loading && <div className="rounded border border-slate-300 bg-slate-50 p-3 text-sm">Chargement...</div>}
      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="rounded bg-white p-4 shadow">
        <h2 className="mb-3 text-lg font-semibold">
          {viewMode === 'session' ? `Sessions (15 min) (${sessions.length})` : `Chronologie (${filteredItems.length})`}
        </h2>
        {viewMode === 'session' ? (
          <div className="space-y-4">
            {sessions.map((session, sessionIdx) => (
              <div key={`session-${session.start.toISOString()}`} className="rounded border border-slate-300 bg-slate-50 p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-purple-100 px-2 py-1 text-xs font-semibold text-purple-700">Session {sessionIdx + 1}</span>
                  <span className="text-xs text-slate-600">
                    {session.start.toLocaleString()} - {session.end.toLocaleTimeString()}
                  </span>
                  <span className="ml-auto rounded bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
                    {session.items.length} item(s)
                  </span>
                </div>
                <div className="space-y-3">
                  {session.items.map((item, idx) => renderTimelineItem(item, idx, `session-${sessionIdx}`))}
                </div>
              </div>
            ))}
            {sessions.length === 0 && !loading && <div className="text-sm text-slate-500">Aucune donnee a afficher pour cet hote.</div>}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item, idx) => renderTimelineItem(item, idx))}
            {filteredItems.length === 0 && !loading && <div className="text-sm text-slate-500">Aucune donnee a afficher pour les filtres courants.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
