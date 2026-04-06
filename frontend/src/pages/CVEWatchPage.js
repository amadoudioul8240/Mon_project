import React, { useEffect, useState } from 'react';
import axios from 'axios';

const backendUrl = process.env.REACT_APP_BACKEND_URL;
const severityOptions = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const severityClass = (sev) => {
  const value = (sev || '').toUpperCase();
  if (value === 'CRITICAL') return 'bg-red-100 text-red-700 border-red-300';
  if (value === 'HIGH') return 'bg-orange-100 text-orange-700 border-orange-300';
  if (value === 'MEDIUM') return 'bg-yellow-100 text-yellow-700 border-yellow-300';
  if (value === 'LOW') return 'bg-blue-100 text-blue-700 border-blue-300';
  return 'bg-gray-100 text-gray-700 border-gray-300';
};

export default function CVEWatchPage() {
  const [data, setData] = useState({
    generated_at: '',
    source: '',
    total_recent_cves: 0,
    matched_count: 0,
    items: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hours, setHours] = useState(24);
  const [severityFilter, setSeverityFilter] = useState('ALL');

  const normalizeText = (value) => {
    return (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const extractSoftwareNames = async () => {
    const res = await axios.get(`${backendUrl}/software`);
    const names = new Set();
    (res.data || []).forEach((item) => {
      const n = normalizeText(item?.name || '');
      if (n && n !== 'inventaire logiciel en attente' && n.length >= 4) {
        names.add(n);
      }
    });
    return Array.from(names);
  };

  const mapSeverity = (value) => {
    const s = String(value || '').toLowerCase();
    if (s.includes('critical')) return 'CRITICAL';
    if (s.includes('high')) return 'HIGH';
    if (s.includes('medium')) return 'MEDIUM';
    if (s.includes('low')) return 'LOW';
    return 'N/A';
  };

  const fetchFromInternationalCveApi = async () => {
    // Source internationale CVE récupérée directement via Axios côté JS.
    const [softwareNames, cveRes] = await Promise.all([
      extractSoftwareNames(),
      axios.get('https://cve.circl.lu/api/last'),
    ]);

    const cves = Array.isArray(cveRes.data) ? cveRes.data : [];
    const matchedItems = [];

    cves.forEach((cve) => {
      const cveId = cve?.id || cve?.cve || '';
      if (!cveId) return;

      const description = cve?.summary || cve?.description || '';
      const haystack = normalizeText(description);
      if (!haystack) return;

      const matchedSoftware = softwareNames.filter((name) => haystack.includes(name)).slice(0, 5);
      if (matchedSoftware.length === 0) return;

      matchedItems.push({
        cve_id: cveId,
        description: description.slice(0, 500),
        published: cve?.Published || cve?.published || null,
        last_modified: cve?.Modified || cve?.last_modified || null,
        score: cve?.cvss ?? null,
        severity: mapSeverity(cve?.cvss_severity || cve?.severity),
        matched_software: matchedSoftware,
        source_url: `https://nvd.nist.gov/vuln/detail/${cveId}`,
      });
    });

    matchedItems.sort((a, b) => (b.score || 0) - (a.score || 0));

    return {
      generated_at: new Date().toISOString(),
      source: 'International CVE Feed (Axios JS)',
      total_recent_cves: cves.length,
      matched_count: matchedItems.length,
      items: matchedItems,
    };
  };

  const fetchFromBackend = async (forceRefresh) => {
    const endpoint = forceRefresh ? '/cve-watch/refresh' : '/cve-watch';
    const method = forceRefresh ? 'post' : 'get';
    const res = await axios({
      method,
      url: `${backendUrl}${endpoint}`,
      params: { hours },
    });
    return res.data || { items: [] };
  };

  const fetchWatch = async (forceRefresh = false) => {
    setLoading(true);
    setError('');
    try {
      // Priorité au fetch JavaScript (Axios) vers une base CVE internationale.
      // Si indisponible (CORS/réseau), fallback automatique vers l'API backend.
      try {
        const directData = await fetchFromInternationalCveApi();
        setData(directData);
      } catch (directErr) {
        const backendData = await fetchFromBackend(forceRefresh);
        setData(backendData);
      }
    } catch (err) {
      setError(err?.response?.data?.detail || 'Impossible de charger la veille CVE.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatch(false);
    const interval = setInterval(() => fetchWatch(false), 60000);
    return () => clearInterval(interval);
  }, [hours]);

  const filteredItems = (data.items || []).filter((item) => {
    if (severityFilter === 'ALL') return true;
    return (item.severity || '').toUpperCase() === severityFilter;
  });

  return (
    <div className="container mx-auto space-y-6 px-3 py-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Veille CVE temps réel</h1>
          <p className="text-gray-600">Corrélation automatique entre vos logiciels inventoriés et les nouvelles CVE.</p>
        </div>
        <div className="flex gap-2">
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
            onClick={() => fetchWatch(true)}
            disabled={loading}
          >
            {loading ? 'Rafraîchissement...' : 'Rafraîchir maintenant'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded shadow p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <div className="text-sm text-gray-500">Source</div>
          <div className="font-semibold">{data.source || '-'}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">CVE récentes analysées</div>
          <div className="text-2xl font-bold">{data.total_recent_cves || 0}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">CVE corrélées à votre parc</div>
          <div className="text-2xl font-bold text-red-600">{data.matched_count || 0}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Dernière mise à jour</div>
          <div className="font-semibold">{data.generated_at ? new Date(data.generated_at).toLocaleString() : '-'}</div>
        </div>
      </div>

      <div className="bg-white rounded shadow p-4 flex flex-col md:flex-row gap-3 md:items-end">
        <div>
          <label className="block text-sm font-medium mb-1">Fenêtre de veille (heures)</label>
          <input
            type="number"
            min="1"
            max="168"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value || 24))}
            className="border rounded px-3 py-2 w-40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Filtre sévérité</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="border rounded px-3 py-2 w-52"
          >
            {severityOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded shadow p-4 overflow-auto">
        {error && <div className="text-red-600 mb-4">{error}</div>}
        <table className="min-w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="py-2 px-3 text-left">CVE</th>
              <th className="py-2 px-3 text-left">Sévérité</th>
              <th className="py-2 px-3 text-left">Score</th>
              <th className="py-2 px-3 text-left">Logiciel corrélé</th>
              <th className="py-2 px-3 text-left">Description</th>
              <th className="py-2 px-3 text-left">Publié</th>
              <th className="py-2 px-3 text-left">Lien</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filteredItems.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 px-3 text-gray-500">
                  Aucune CVE corrélée sur la période sélectionnée.
                </td>
              </tr>
            )}
            {filteredItems.map((item) => (
              <tr key={item.cve_id} className="border-t align-top">
                <td className="py-2 px-3 font-semibold">{item.cve_id}</td>
                <td className="py-2 px-3">
                  <span className={`inline-block px-3 py-1 rounded-full border text-sm font-semibold ${severityClass(item.severity)}`}>
                    {(item.severity || 'N/A').toUpperCase()}
                  </span>
                </td>
                <td className="py-2 px-3">{item.score ?? '-'}</td>
                <td className="py-2 px-3">{(item.matched_software || []).join(', ') || '-'}</td>
                <td className="py-2 px-3 max-w-xl">{item.description || '-'}</td>
                <td className="py-2 px-3">{item.published ? new Date(item.published).toLocaleString() : '-'}</td>
                <td className="py-2 px-3">
                  <a href={item.source_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                    Détail NVD
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
