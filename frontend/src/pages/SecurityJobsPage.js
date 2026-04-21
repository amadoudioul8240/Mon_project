import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';

import { backendUrl } from '../config/api';

const statusBadgeClass = {
  queued: 'bg-slate-100 text-slate-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-amber-100 text-amber-700',
};

const defaultForm = {
  job_type: '',
  requested_by: 'admin.local',
  target_scope: '',
  active_minutes: 15,
  replace_existing: true,
};

function buildFormFromJob(job) {
  const parameters = job?.parameters_json || {};
  return {
    job_type: job?.job_type || '',
    requested_by: job?.requested_by || 'admin.local',
    target_scope: job?.target_scope || '',
    active_minutes: String(parameters.active_minutes ?? 15),
    replace_existing: parameters.replace_existing ?? true,
  };
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('fr-FR');
}

function formatDuration(job) {
  if (!job.started_at) return '-';
  const start = new Date(job.started_at).getTime();
  const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export default function SecurityJobsPage() {
  const formRef = useRef(null);
  const [summary, setSummary] = useState({
    total_jobs: 0,
    queued_jobs: 0,
    running_jobs: 0,
    failed_jobs: 0,
    completed_jobs: 0,
  });
  const [catalog, setCatalog] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchData = async (preserveSelection = true) => {
    setLoading(true);
    try {
      const params = { limit: 50 };
      if (filterStatus) params.status = filterStatus;

      const [summaryRes, catalogRes, jobsRes] = await Promise.all([
        axios.get(`${backendUrl}/security/jobs/summary`),
        axios.get(`${backendUrl}/security/jobs/catalog`),
        axios.get(`${backendUrl}/security/jobs`, { params }),
      ]);

      const nextCatalog = catalogRes.data || [];
      const nextJobs = jobsRes.data || [];

      setSummary(summaryRes.data || {});
      setCatalog(nextCatalog);
      setJobs(nextJobs);

      if (!form.job_type && nextCatalog.length > 0) {
        setForm((prev) => ({ ...prev, job_type: nextCatalog[0].job_type }));
      }

      const nextSelectedId = preserveSelection ? selectedJobId : null;
      const fallbackId = nextSelectedId || (nextJobs[0] ? nextJobs[0].id : null);
      setSelectedJobId(fallbackId);
    } catch (err) {
      setError('Impossible de charger le moteur de jobs de sécurité.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(false);
  }, [filterStatus]);

  useEffect(() => {
    const interval = setInterval(() => fetchData(true), 5000);
    return () => clearInterval(interval);
  }, [filterStatus, selectedJobId, form.job_type]);

  useEffect(() => {
    const loadJob = async () => {
      if (!selectedJobId) {
        setSelectedJob(null);
        return;
      }
      try {
        const res = await axios.get(`${backendUrl}/security/jobs/${selectedJobId}`);
        setSelectedJob(res.data || null);
      } catch {
        setSelectedJob(null);
      }
    };
    loadJob();
  }, [selectedJobId, jobs]);

  const selectedCatalogItem = useMemo(
    () => catalog.find((item) => item.job_type === form.job_type) || null,
    [catalog, form.job_type]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const parameters_json = {};
      if (form.job_type === 'unknown_devices_snapshot') {
        parameters_json.active_minutes = Number(form.active_minutes || 15);
      }
      if (form.job_type === 'network_exposure_review') {
        parameters_json.replace_existing = !!form.replace_existing;
      }

      const payload = {
        job_type: form.job_type,
        requested_by: form.requested_by.trim() || null,
        target_scope: selectedCatalogItem?.supports_target_scope ? (form.target_scope.trim() || null) : null,
        parameters_json,
      };

      const res = await axios.post(`${backendUrl}/security/jobs`, payload);
      setSelectedJobId(res.data.id);
      setMessage(`Job #${res.data.id} ajouté à la file.`);
      await fetchData(true);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Erreur lors de la création du job.');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelSelectedJob = async () => {
    if (!selectedJob || !['queued', 'running'].includes(selectedJob.status)) return;
    setError('');
    setMessage('');
    try {
      const res = await axios.patch(`${backendUrl}/security/jobs/${selectedJob.id}/cancel`);
      setSelectedJob(res.data || null);
      setMessage(
        selectedJob.status === 'queued'
          ? `Job #${selectedJob.id} annulé.`
          : `Demande d'arrêt envoyée pour le job #${selectedJob.id}.`
      );
      await fetchData(true);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Impossible d annuler ce job.');
    }
  };

  const exportJobsHistory = async (format) => {
    setError('');
    try {
      const response = await axios.get(`${backendUrl}/security/jobs/export`, {
        params: { format, status: filterStatus || undefined, limit: 500 },
        responseType: format === 'csv' ? 'blob' : 'json',
      });

      const suffix = filterStatus ? `-${filterStatus}` : '';
      if (format === 'json') {
        downloadBlob(
          new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' }),
          `security-jobs-history${suffix}.json`
        );
        return;
      }

      downloadBlob(response.data, `security-jobs-history${suffix}.csv`);
    } catch {
      setError('Impossible d exporter l historique global.');
    }
  };

  const exportSelectedJob = async (format) => {
    if (!selectedJob) return;
    setError('');
    try {
      const response = await axios.get(`${backendUrl}/security/jobs/${selectedJob.id}/export`, {
        params: { format },
        responseType: format === 'csv' ? 'blob' : 'json',
      });

      if (format === 'json') {
        downloadBlob(
          new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' }),
          `security-job-${selectedJob.id}.json`
        );
        return;
      }

      downloadBlob(response.data, `security-job-${selectedJob.id}.csv`);
    } catch {
      setError('Impossible d exporter ce job.');
    }
  };

  const rerunSelectedJob = async () => {
    if (!selectedJob) return;
    setRestarting(true);
    setError('');
    setMessage('');
    try {
      const response = await axios.post(`${backendUrl}/security/jobs/${selectedJob.id}/rerun`);
      setSelectedJobId(response.data.id);
      setMessage(`Job #${response.data.id} relancé depuis l'historique.`);
      await fetchData(true);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Impossible de relancer ce job.');
    } finally {
      setRestarting(false);
    }
  };

  const prepareSelectedJobEdit = () => {
    if (!selectedJob) return;
    setError('');
    setMessage(`Formulaire prérempli depuis le job #${selectedJob.id}. Modifiez les paramètres puis relancez.`);
    setForm(buildFormFromJob(selectedJob));
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="container mx-auto space-y-6 px-3 py-4 md:p-8">
      <div>
        <h1 className="text-2xl font-bold">Security Jobs Engine</h1>
        <p className="text-gray-600">Orchestration défensive asynchrone pour recalculs sécurité, snapshots réseau et corrélation interne.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="rounded border-l-4 border-l-slate-600 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Total jobs</div>
          <div className="text-2xl font-bold">{summary.total_jobs || 0}</div>
        </div>
        <div className="rounded border-l-4 border-l-slate-400 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">En file</div>
          <div className="text-2xl font-bold">{summary.queued_jobs || 0}</div>
        </div>
        <div className="rounded border-l-4 border-l-blue-500 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">En cours</div>
          <div className="text-2xl font-bold text-blue-700">{summary.running_jobs || 0}</div>
        </div>
        <div className="rounded border-l-4 border-l-emerald-500 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">Terminés</div>
          <div className="text-2xl font-bold text-emerald-700">{summary.completed_jobs || 0}</div>
        </div>
        <div className="rounded border-l-4 border-l-red-500 bg-white p-4 shadow">
          <div className="text-sm text-gray-500">En échec</div>
          <div className="text-2xl font-bold text-red-700">{summary.failed_jobs || 0}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-4">
          <form ref={formRef} onSubmit={handleSubmit} className="rounded bg-white p-5 shadow space-y-3">
            <h2 className="text-lg font-semibold">Nouveau job</h2>

            <div>
              <label className="mb-1 block text-sm font-medium">Type de job</label>
              <select
                value={form.job_type}
                onChange={(e) => setForm((prev) => ({ ...prev, job_type: e.target.value }))}
                className="w-full rounded border px-3 py-2"
              >
                {catalog.map((item) => (
                  <option key={item.job_type} value={item.job_type}>{item.label}</option>
                ))}
              </select>
            </div>

            {selectedCatalogItem && (
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-semibold text-slate-800">{selectedCatalogItem.label}</div>
                <div>{selectedCatalogItem.description}</div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium">Demandé par</label>
              <input
                type="text"
                value={form.requested_by}
                onChange={(e) => setForm((prev) => ({ ...prev, requested_by: e.target.value }))}
                className="w-full rounded border px-3 py-2"
                placeholder="admin.local"
              />
            </div>

            {selectedCatalogItem?.supports_target_scope && (
              <div>
                <label className="mb-1 block text-sm font-medium">Cible</label>
                <input
                  type="text"
                  value={form.target_scope}
                  onChange={(e) => setForm((prev) => ({ ...prev, target_scope: e.target.value }))}
                  className="w-full rounded border px-3 py-2"
                  placeholder="hostname ou serial partiel"
                />
              </div>
            )}

            {form.job_type === 'unknown_devices_snapshot' && (
              <div>
                <label className="mb-1 block text-sm font-medium">Fenêtre active (minutes)</label>
                <input
                  type="number"
                  min="1"
                  max="240"
                  value={form.active_minutes}
                  onChange={(e) => setForm((prev) => ({ ...prev, active_minutes: e.target.value }))}
                  className="w-full rounded border px-3 py-2"
                />
              </div>
            )}

            {form.job_type === 'network_exposure_review' && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={!!form.replace_existing}
                  onChange={(e) => setForm((prev) => ({ ...prev, replace_existing: e.target.checked }))}
                />
                Remplacer les constats automatiques existants sur cette revue
              </label>
            )}

            {error && <div className="text-sm text-red-600">{error}</div>}
            {message && <div className="text-sm text-emerald-700">{message}</div>}

            <div className="flex gap-2">
              <button type="submit" disabled={submitting || !form.job_type} className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
                {submitting ? 'Création...' : 'Lancer le job'}
              </button>
              <button type="button" onClick={() => fetchData(true)} className="rounded bg-slate-700 px-4 py-2 text-white hover:bg-slate-800">
                Rafraîchir
              </button>
            </div>
          </form>

          <div className="rounded bg-white p-5 shadow">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Historique</h2>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => exportJobsHistory('json')}
                  className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  Export historique JSON
                </button>
                <button
                  type="button"
                  onClick={() => exportJobsHistory('csv')}
                  className="rounded bg-cyan-700 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-800"
                >
                  Export historique CSV
                </button>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded border px-3 py-2 text-sm">
                  <option value="">Tous les statuts</option>
                  <option value="queued">queued</option>
                  <option value="running">running</option>
                  <option value="completed">completed</option>
                  <option value="failed">failed</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className={`w-full rounded border p-3 text-left transition ${selectedJobId === job.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                >
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <div className="font-semibold text-slate-800">#{job.id} {job.job_type}</div>
                    <div className="flex items-center gap-2">
                      {job.cancel_requested && job.status === 'running' && (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                          arrêt demandé
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClass[job.status] || statusBadgeClass.queued}`}>
                        {job.status}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-slate-600">Créé: {formatDateTime(job.created_at)} | Durée: {formatDuration(job)}</div>
                  {job.target_scope && <div className="text-xs text-slate-500">Cible: {job.target_scope}</div>}
                </button>
              ))}

              {jobs.length === 0 && (
                <div className="rounded border border-dashed p-4 text-sm text-slate-500">Aucun job trouvé pour ce filtre.</div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded bg-white p-5 shadow">
          <h2 className="mb-4 text-lg font-semibold">Détail d'exécution</h2>
          {!selectedJob && (
            <div className="rounded border border-dashed p-6 text-sm text-slate-500">
              {loading ? 'Chargement...' : 'Sélectionnez un job pour voir ses détails.'}
            </div>
          )}

          {selectedJob && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={prepareSelectedJobEdit}
                  className="rounded bg-slate-600 px-4 py-2 text-white hover:bg-slate-700"
                >
                  Relancer avec modification
                </button>
                <button
                  type="button"
                  onClick={rerunSelectedJob}
                  disabled={restarting}
                  className="rounded bg-violet-700 px-4 py-2 text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {restarting ? 'Relance...' : 'Relancer ce job'}
                </button>
                <button
                  type="button"
                  onClick={cancelSelectedJob}
                  disabled={!['queued', 'running'].includes(selectedJob.status) || selectedJob.cancel_requested}
                  className="rounded bg-amber-600 px-4 py-2 text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {selectedJob.status === 'running' ? 'Demander l arrêt' : 'Annuler le job'}
                </button>
                <button
                  type="button"
                  onClick={() => exportSelectedJob('json')}
                  className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => exportSelectedJob('csv')}
                  className="rounded bg-cyan-700 px-4 py-2 text-white hover:bg-cyan-800"
                >
                  Export CSV
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Statut</div>
                  <div className="mt-1 font-semibold text-slate-800">
                    {selectedJob.status}
                    {selectedJob.cancel_requested && selectedJob.status === 'running' ? ' • arrêt demandé' : ''}
                  </div>
                </div>
                <div className="rounded bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Demandé par</div>
                  <div className="mt-1 font-semibold text-slate-800">{selectedJob.requested_by || '-'}</div>
                </div>
                <div className="rounded bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Début</div>
                  <div className="mt-1 font-semibold text-slate-800">{formatDateTime(selectedJob.started_at)}</div>
                </div>
                <div className="rounded bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Fin</div>
                  <div className="mt-1 font-semibold text-slate-800">{formatDateTime(selectedJob.completed_at)}</div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-800">Paramètres</h3>
                <pre className="overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(selectedJob.parameters_json || {}, null, 2)}</pre>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-800">Résultat</h3>
                <pre className="overflow-auto rounded bg-slate-950 p-4 text-xs text-emerald-100">{JSON.stringify(selectedJob.result_json || {}, null, 2)}</pre>
              </div>

              {selectedJob.error_message && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <div className="font-semibold">Erreur</div>
                  <div>{selectedJob.error_message}</div>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-800">Journal</h3>
                <div className="space-y-2">
                  {(selectedJob.logs_json || []).map((log, index) => (
                    <div key={`${log.timestamp}-${index}`} className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-slate-800">{log.message}</span>
                        <span className="text-xs text-slate-500">{formatDateTime(log.timestamp)}</span>
                      </div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">{log.level}</div>
                      {log.data && (
                        <pre className="mt-2 overflow-auto rounded bg-white p-3 text-xs text-slate-700">{JSON.stringify(log.data, null, 2)}</pre>
                      )}
                    </div>
                  ))}
                  {(selectedJob.logs_json || []).length === 0 && <div className="text-sm text-slate-500">Aucun log disponible.</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}