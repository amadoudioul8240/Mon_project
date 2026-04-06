import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts';
import html2canvas from 'html2canvas';

const backendUrl = process.env.REACT_APP_BACKEND_URL;

const alertStatuses = ['Nouvelle', 'En cours', 'Résolue', 'Faux positif'];
const chartPalette = ['#2563eb', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#14b8a6', '#f97316'];

function normalizeVulnSeverity(value) {
  const key = (value || '').toLowerCase();
  if (key.includes('crit')) return 'Critique';
  if (key.includes('high') || key.includes('elev')) return 'Elevee';
  if (key.includes('med') || key.includes('moy')) return 'Moyenne';
  if (key.includes('low') || key.includes('faible')) return 'Faible';
  return 'Inconnue';
}

function severityBadgeClass(severity) {
  const key = (severity || '').toLowerCase();
  if (key.includes('crit')) return 'bg-red-100 text-red-700 border-red-300';
  if (key.includes('elev') || key.includes('high')) return 'bg-orange-100 text-orange-700 border-orange-300';
  if (key.includes('moy') || key.includes('med')) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
  return 'bg-blue-100 text-blue-700 border-blue-300';
}

function riskBadgeClass(level) {
  if (level === 'high') return 'bg-red-100 text-red-700 border-red-300';
  if (level === 'medium') return 'bg-yellow-100 text-yellow-700 border-yellow-300';
  return 'bg-green-100 text-green-700 border-green-300';
}

function computeRiskLevel(value, mediumThreshold, highThreshold) {
  if (value >= highThreshold) return 'high';
  if (value >= mediumThreshold) return 'medium';
  return 'low';
}

export default function SiemPage() {
  const navigate = useNavigate();
  const chartsRef = useRef(null);
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [authSummary, setAuthSummary] = useState(null);
  const [securitySummary, setSecuritySummary] = useState(null);
  const [cveWatch, setCveWatch] = useState(null);
  const [networkOverview, setNetworkOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [eventSeverity, setEventSeverity] = useState('');
  const [eventHost, setEventHost] = useState('');
  const [alertStatus, setAlertStatus] = useState('');
  const [alertSeverity, setAlertSeverity] = useState('');
  const [periodHours, setPeriodHours] = useState(24);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const eventParams = { limit: 250 };
      if (eventSeverity) eventParams.severity = eventSeverity;
      if (eventHost) eventParams.host_serial = eventHost;

      const alertParams = {};
      if (alertStatus) alertParams.status = alertStatus;
      if (alertSeverity) alertParams.severity = alertSeverity;

      const [eventsRes, alertsRes, authSummaryRes, securitySummaryRes, cveWatchRes, networkOverviewRes] = await Promise.all([
        axios.get(`${backendUrl}/siem/events`, { params: eventParams }),
        axios.get(`${backendUrl}/siem/alerts`, { params: alertParams }),
        axios.get(`${backendUrl}/siem/auth-summary`, { params: { hours: periodHours } }),
        axios.get(`${backendUrl}/security/summary`),
        axios.get(`${backendUrl}/cve-watch`, { params: { hours: periodHours } }),
        axios.get(`${backendUrl}/network/ports-logs`),
      ]);

      setEvents(eventsRes.data || []);
      setAlerts(alertsRes.data || []);
      setAuthSummary(authSummaryRes.data || null);
      setSecuritySummary(securitySummaryRes.data || null);
      setCveWatch(cveWatchRes.data || null);
      setNetworkOverview(networkOverviewRes.data || null);
    } catch (err) {
      setError('Impossible de charger les donnees SIEM.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [eventSeverity, eventHost, alertStatus, alertSeverity, periodHours]);

  const periodStart = useMemo(() => {
    return new Date(Date.now() - periodHours * 60 * 60 * 1000);
  }, [periodHours]);

  const filteredEvents = useMemo(() => {
    return (events || []).filter((ev) => {
      if (!ev.timestamp) return false;
      return new Date(ev.timestamp) >= periodStart;
    });
  }, [events, periodStart]);

  const filteredAlerts = useMemo(() => {
    return (alerts || []).filter((a) => {
      if (!a.created_at) return false;
      return new Date(a.created_at) >= periodStart;
    });
  }, [alerts, periodStart]);

  const openAlertsCount = useMemo(() => (
    (filteredAlerts || []).filter((a) => a.status === 'Nouvelle' || a.status === 'En cours').length
  ), [filteredAlerts]);

  const eventsByTypeData = useMemo(() => {
    const counts = {};
    for (const ev of filteredEvents || []) {
      const key = ev.event_type || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filteredEvents]);

  const alertsByStatusData = useMemo(() => {
    const counts = {};
    for (const al of filteredAlerts || []) {
      const key = al.status || 'Inconnu';
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredAlerts]);

  const authOutcomeData = useMemo(() => {
    if (!authSummary) return [];
    return [
      { name: 'Succes', value: authSummary.success_events || 0 },
      { name: 'Echec', value: authSummary.failure_events || 0 },
      { name: 'Lockout', value: authSummary.lockout_events || 0 },
    ];
  }, [authSummary]);

  const vulnerabilitiesBySeverityData = useMemo(() => {
    const items = (cveWatch && cveWatch.items) ? cveWatch.items : [];
    const counts = { Critique: 0, Elevee: 0, Moyenne: 0, Faible: 0, Inconnue: 0 };
    for (const item of items) {
      const normalized = normalizeVulnSeverity(item.severity);
      counts[normalized] = (counts[normalized] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .filter((x) => x.value > 0);
  }, [cveWatch]);

  const logsBySourceData = useMemo(() => {
    const items = (networkOverview && networkOverview.items) ? networkOverview.items : [];
    const counts = {};
    for (const host of items) {
      const source = host.source || 'unknown';
      const logCount = Array.isArray(host.logs) ? host.logs.length : 0;
      counts[source] = (counts[source] || 0) + logCount;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [networkOverview]);

  const authTotal = useMemo(() => {
    return authOutcomeData.reduce((acc, cur) => acc + (cur.value || 0), 0);
  }, [authOutcomeData]);

  const vulnTotal = useMemo(() => {
    return vulnerabilitiesBySeverityData.reduce((acc, cur) => acc + (cur.value || 0), 0);
  }, [vulnerabilitiesBySeverityData]);

  const logsTotal = useMemo(() => {
    return logsBySourceData.reduce((acc, cur) => acc + (cur.value || 0), 0);
  }, [logsBySourceData]);

  const alertsRiskLevel = useMemo(() => computeRiskLevel(openAlertsCount, 5, 12), [openAlertsCount]);
  const authRiskLevel = useMemo(() => computeRiskLevel(authTotal, 20, 60), [authTotal]);
  const vulnRiskLevel = useMemo(() => computeRiskLevel(vulnTotal, 10, 30), [vulnTotal]);

  const exportChartsToPng = async () => {
    if (!chartsRef.current) return;
    try {
      const canvas = await html2canvas(chartsRef.current, { backgroundColor: '#ffffff', scale: 2 });
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = url;
      link.download = `supervision-synthese-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
      link.click();
    } catch (e) {
      setError('Impossible d exporter les graphiques en PNG.');
    }
  };

  const exportChartsToPdf = async () => {
    if (!chartsRef.current) return;
    try {
      const canvas = await html2canvas(chartsRef.current, { backgroundColor: '#ffffff', scale: 2 });
      const url = canvas.toDataURL('image/png');
      const win = window.open('', '_blank');
      if (!win) {
        setError('Popup bloquee: autorisez les popups pour exporter en PDF.');
        return;
      }
      win.document.write(`<html><head><title>Supervision Synthese</title></head><body style="margin:0"><img src="${url}" style="width:100%" /></body></html>`);
      win.document.close();
      win.focus();
      win.print();
    } catch (e) {
      setError('Impossible d exporter les graphiques en PDF.');
    }
  };

  const runRules = async () => {
    setMessage('');
    setError('');
    try {
      const res = await axios.post(`${backendUrl}/siem/rules/run`);
      setMessage(`Regles executees. Hotes analyses: ${res.data.hosts_evaluated}, alertes ouvertes: ${res.data.open_alerts}`);
      await fetchData();
    } catch (err) {
      setError('Erreur lors de l execution des regles SIEM.');
    }
  };

  const updateAlertStatus = async (alertId, status) => {
    setError('');
    try {
      await axios.patch(`${backendUrl}/siem/alerts/${alertId}`, { status });
      await fetchData();
    } catch (err) {
      setError('Erreur lors de la mise a jour du statut d alerte.');
    }
  };

  return (
    <div className="container mx-auto space-y-6 px-3 py-4 md:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">SIEM interne</h1>
          <p className="text-gray-600">Evenements normalises, regles de correlation et gestion d alertes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={String(periodHours)}
            onChange={(e) => setPeriodHours(Number(e.target.value || 24))}
            className="rounded border px-3 py-2"
          >
            <option value="6">6h</option>
            <option value="24">24h</option>
            <option value="72">72h</option>
          </select>
          <button
            type="button"
            onClick={exportChartsToPng}
            className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
          >
            Export PNG
          </button>
          <button
            type="button"
            onClick={exportChartsToPdf}
            className="rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
          >
            Export PDF
          </button>
          <button
            type="button"
            onClick={runRules}
            className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          >
            Executer les regles
          </button>
          <button
            type="button"
            onClick={fetchData}
            className="rounded bg-slate-700 px-4 py-2 text-white hover:bg-slate-800"
          >
            Rafraichir
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded border-l-4 border-l-blue-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Evenements recents ({periodHours}h)</div>
          <div className="text-2xl font-bold">{filteredEvents.length}</div>
        </div>
        <div className="rounded border-l-4 border-l-red-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Alertes ouvertes ({periodHours}h)</div>
          <div className="text-2xl font-bold text-red-600">{openAlertsCount}</div>
          <span className={`mt-1 inline-block rounded border px-2 py-1 text-xs font-semibold ${riskBadgeClass(alertsRiskLevel)}`}>
            Risque {alertsRiskLevel}
          </span>
        </div>
        <div className="rounded border-l-4 border-l-amber-500 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Total alertes ({periodHours}h)</div>
          <div className="text-2xl font-bold text-amber-600">{filteredAlerts.length}</div>
        </div>
        <div className="rounded border-l-4 border-l-green-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Etat</div>
          <div className="text-lg font-semibold text-green-700">{loading ? 'Chargement...' : 'Actif'}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded border-l-4 border-l-indigo-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Authentifications ({periodHours}h)</div>
          <div className="text-2xl font-bold text-indigo-700">{authTotal}</div>
          <span className={`mt-1 inline-block rounded border px-2 py-1 text-xs font-semibold ${riskBadgeClass(authRiskLevel)}`}>
            Risque {authRiskLevel}
          </span>
        </div>
        <div className="rounded border-l-4 border-l-rose-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Vulnerabilites corrigeables</div>
          <div className="text-2xl font-bold text-rose-700">{vulnTotal}</div>
          <span className={`mt-1 inline-block rounded border px-2 py-1 text-xs font-semibold ${riskBadgeClass(vulnRiskLevel)}`}>
            Risque {vulnRiskLevel}
          </span>
          <div className="text-xs text-gray-500 mt-1">Findings ouverts: {securitySummary ? securitySummary.open_findings : 0}</div>
        </div>
        <div className="rounded border-l-4 border-l-teal-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Logs LAN remontes</div>
          <div className="text-2xl font-bold text-teal-700">{logsTotal}</div>
        </div>
      </div>

      <div ref={chartsRef} className="rounded bg-white p-4 shadow">
        <h2 className="mb-3 text-lg font-semibold">Synthese graphique supervision agents</h2>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Evenements par type</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={eventsByTypeData} margin={{ top: 10, right: 20, left: 0, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} height={70} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" name="Evenements" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Alertes par statut</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={alertsByStatusData} dataKey="value" nameKey="name" outerRadius={100} label>
                    {alertsByStatusData.map((entry, idx) => (
                      <Cell key={entry.name} fill={chartPalette[idx % chartPalette.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Authentifications ({periodHours}h)</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={authOutcomeData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" name="Volume" fill="#7c3aed" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Vulnerabilites par severite</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={vulnerabilitiesBySeverityData} dataKey="value" nameKey="name" outerRadius={100} label>
                    {vulnerabilitiesBySeverityData.map((entry, idx) => (
                      <Cell key={entry.name} fill={chartPalette[idx % chartPalette.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="xl:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Logs remontes par source</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={logsBySourceData} margin={{ top: 10, right: 20, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" name="Nb logs" fill="#0d9488" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {message && <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">{message}</div>}
      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="rounded bg-white p-4 shadow">
        <h2 className="mb-3 text-lg font-semibold">Filtres</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            type="text"
            value={eventHost}
            onChange={(e) => setEventHost(e.target.value)}
            placeholder="Filtre host serial (events)"
            className="rounded border px-3 py-2"
          />
          <input
            type="text"
            value={eventSeverity}
            onChange={(e) => setEventSeverity(e.target.value)}
            placeholder="Filtre severite event"
            className="rounded border px-3 py-2"
          />
          <select
            value={alertStatus}
            onChange={(e) => setAlertStatus(e.target.value)}
            className="rounded border px-3 py-2"
          >
            <option value="">Tous statuts alertes</option>
            {alertStatuses.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <input
            type="text"
            value={alertSeverity}
            onChange={(e) => setAlertSeverity(e.target.value)}
            placeholder="Filtre severite alerte"
            className="rounded border px-3 py-2"
          />
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              const host = (eventHost || '').trim();
              if (!host) {
                setError('Renseignez un host serial pour ouvrir la timeline.');
                return;
              }
              navigate(`/siem/timeline?host=${encodeURIComponent(host)}`);
            }}
            className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
          >
            Ouvrir timeline de l hote
          </button>
        </div>
      </div>

      <div className="rounded bg-white p-4 shadow">
        <h2 className="mb-3 text-lg font-semibold">Alertes ({filteredAlerts.length})</h2>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Regle</th>
                <th className="px-3 py-2 text-left">Host</th>
                <th className="px-3 py-2 text-left">Severite</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((a) => (
                <tr key={a.id} className="border-t align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{a.created_at ? new Date(a.created_at).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{a.title}</div>
                    <div className="text-xs text-gray-500">{a.rule_id}</div>
                    <div className="text-xs text-gray-600 mt-1">{a.description}</div>
                  </td>
                  <td className="px-3 py-2">{a.host_name || a.host_serial || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded border px-2 py-1 text-xs font-semibold ${severityBadgeClass(a.severity)}`}>
                      {a.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2">{a.status}</td>
                  <td className="px-3 py-2">
                    <select
                      value={a.status}
                      onChange={(e) => updateAlertStatus(a.id, e.target.value)}
                      className="rounded border px-2 py-1"
                    >
                      {alertStatuses.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {filteredAlerts.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-500" colSpan={6}>Aucune alerte pour les filtres courants.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded bg-white p-4 shadow">
        <h2 className="mb-3 text-lg font-semibold">Evenements recents ({filteredEvents.length})</h2>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Host</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-left">Severite</th>
                <th className="px-3 py-2 text-left">Message</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((ev) => (
                <tr key={ev.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2">{ev.event_type}</td>
                  <td className="px-3 py-2">{ev.host_name || ev.host_serial || '-'}</td>
                  <td className="px-3 py-2">{ev.source}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded border px-2 py-1 text-xs font-semibold ${severityBadgeClass(ev.severity)}`}>
                      {ev.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2">{ev.message || '-'}</td>
                </tr>
              ))}
              {filteredEvents.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-500" colSpan={6}>Aucun evenement pour les filtres courants.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
