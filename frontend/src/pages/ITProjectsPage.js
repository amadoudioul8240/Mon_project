import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import html2canvas from 'html2canvas';

import { backendUrl } from '../config/api';

const statusColumns = [
  { key: 'A faire', label: 'A faire', color: 'border-slate-400' },
  { key: 'En cours', label: 'En cours', color: 'border-amber-500' },
  { key: 'Termine', label: 'Termine', color: 'border-emerald-500' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_WINDOW_DAYS = 7;
const ganttColorByStatus = {
  'A faire': 'bg-slate-500',
  'En cours': 'bg-amber-500',
  Termine: 'bg-emerald-500',
};
const stepSegmentColors = ['bg-cyan-600', 'bg-fuchsia-600', 'bg-lime-600', 'bg-orange-500', 'bg-sky-700'];

const zoomOptions = [
  { key: 'week', label: 'Semaine', pxPerDay: 42, tickStepDays: 1 },
  { key: 'month', label: 'Mois', pxPerDay: 18, tickStepDays: 7 },
  { key: 'quarter', label: 'Trimestre', pxPerDay: 9, tickStepDays: 14 },
];

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(dateValue, days) {
  return new Date(dateValue.getTime() + (days * DAY_MS));
}

function startOfDay(dateValue) {
  const next = new Date(dateValue);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(dateValue) {
  const next = new Date(dateValue);
  next.setHours(23, 59, 59, 999);
  return next;
}

function diffDays(fromDate, toDate) {
  return Math.ceil((startOfDay(toDate) - startOfDay(fromDate)) / DAY_MS);
}

function formatDate(value) {
  const parsed = parseDateSafe(value);
  if (!parsed) return '-';
  return parsed.toLocaleDateString('fr-FR');
}

function formatTickLabel(dateValue, zoomKey) {
  if (zoomKey === 'week') {
    return dateValue.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }
  if (zoomKey === 'month') {
    return dateValue.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }
  return dateValue.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

function getProjectProgress(project, referenceDate = new Date()) {
  if (project.status === 'Termine') return 100;

  const datedSteps = (project.steps || [])
    .map((step) => ({
      start: parseDateSafe(step.start_date),
      end: parseDateSafe(step.end_date),
    }))
    .filter((step) => step.start && step.end);

  if (datedSteps.length === 0) {
    return project.status === 'En cours' ? 50 : 0;
  }

  let completedWeight = 0;
  for (const step of datedSteps) {
    if (startOfDay(referenceDate) > endOfDay(step.end)) {
      completedWeight += 1;
    } else if (referenceDate >= startOfDay(step.start) && referenceDate <= endOfDay(step.end)) {
      completedWeight += 0.5;
    }
  }

  const rawProgress = Math.round((completedWeight / datedSteps.length) * 100);
  if (project.status === 'En cours') return Math.max(rawProgress, 10);
  return Math.min(rawProgress, 95);
}

function getProjectTimelineState(project, referenceDate = new Date()) {
  const dueDate = parseDateSafe(project.due_date);
  if (project.status === 'Termine') {
    return {
      label: 'Termine',
      detail: 'Projet cloture',
      tone: 'emerald',
      isOverdue: false,
      isDueSoon: false,
    };
  }

  if (!dueDate) {
    return {
      label: 'Sans echeance',
      detail: 'Aucune date cible definie',
      tone: 'slate',
      isOverdue: false,
      isDueSoon: false,
    };
  }

  const daysUntilDue = diffDays(referenceDate, dueDate);
  if (daysUntilDue < 0) {
    return {
      label: 'En retard',
      detail: `${Math.abs(daysUntilDue)} jour(s) de retard`,
      tone: 'red',
      isOverdue: true,
      isDueSoon: false,
    };
  }

  if (daysUntilDue <= ALERT_WINDOW_DAYS) {
    return {
      label: 'Echeance proche',
      detail: `J-${daysUntilDue}`,
      tone: 'amber',
      isOverdue: false,
      isDueSoon: true,
    };
  }

  return {
    label: 'Dans les temps',
    detail: `${daysUntilDue} jour(s) restants`,
    tone: 'emerald',
    isOverdue: false,
    isDueSoon: false,
  };
}

function getTimelineBadgeClasses(tone) {
  if (tone === 'red') return 'bg-red-100 text-red-700';
  if (tone === 'amber') return 'bg-amber-100 text-amber-700';
  if (tone === 'emerald') return 'bg-emerald-100 text-emerald-700';
  return 'bg-slate-100 text-slate-700';
}

function parseInlineDocColors(text, keyPrefix) {
  const regex = /\[(red|blue|green)\]([\s\S]*?)\[\/\1\]/gi;
  const parts = [];
  let lastIndex = 0;
  let match;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const colorClass =
      match[1].toLowerCase() === 'red'
        ? 'text-red-700'
        : match[1].toLowerCase() === 'blue'
          ? 'text-blue-700'
          : 'text-green-700';

    parts.push(
      <span key={`${keyPrefix}-c-${idx}`} className={`${colorClass} font-semibold`}>
        {match[2]}
      </span>
    );
    idx += 1;
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function renderDocumentationBlock(docText) {
  const lines = (docText || '').split('\n');
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <div key={`doc-empty-${idx}`} className="h-2" />;
    }

    const h1Match = trimmed.match(/^\[h1\]([\s\S]*)\[\/h1\]$/i);
    if (h1Match) {
      return (
        <div key={`doc-h1-${idx}`} className="text-lg font-bold text-slate-900">
          {parseInlineDocColors(h1Match[1], `h1-${idx}`)}
        </div>
      );
    }

    const h2Match = trimmed.match(/^\[h2\]([\s\S]*)\[\/h2\]$/i);
    if (h2Match) {
      return (
        <div key={`doc-h2-${idx}`} className="text-base font-bold text-slate-900">
          {parseInlineDocColors(h2Match[1], `h2-${idx}`)}
        </div>
      );
    }

    const h3Match = trimmed.match(/^\[h3\]([\s\S]*)\[\/h3\]$/i);
    if (h3Match) {
      return (
        <div key={`doc-h3-${idx}`} className="text-sm font-bold text-slate-800 uppercase tracking-wide">
          {parseInlineDocColors(h3Match[1], `h3-${idx}`)}
        </div>
      );
    }

    return (
      <div key={`doc-p-${idx}`} className="text-xs text-slate-700">
        {parseInlineDocColors(line, `p-${idx}`)}
      </div>
    );
  });
}

const emptyForm = {
  title: '',
  status: 'A faire',
  owner: '',
  due_date: '',
  description: '',
  documentation: '',
  steps: [],
};

export default function ITProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [ganttZoom, setGanttZoom] = useState('month');
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const ganttExportRef = useRef(null);
  const documentationRef = useRef(null);

  const fetchProjects = async () => {
    try {
      const res = await axios.get(`${backendUrl}/it-projects`);
      setProjects(res.data || []);
    } catch (err) {
      setError('Impossible de charger les projets IT.');
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter((project) => {
      const haystack = [
        project.title || '',
        project.owner || '',
        project.status || '',
        project.description || '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [projects, search]);

  const enrichedProjects = useMemo(() => {
    const now = new Date();
    return filteredProjects.map((project) => ({
      ...project,
      progress: getProjectProgress(project, now),
      timelineState: getProjectTimelineState(project, now),
    }));
  }, [filteredProjects]);

  const groupedProjects = useMemo(() => {
    const grouped = { 'A faire': [], 'En cours': [], Termine: [] };
    for (const project of enrichedProjects) {
      const key = grouped[project.status] ? project.status : 'A faire';
      grouped[key].push(project);
    }
    return grouped;
  }, [enrichedProjects]);

  const ganttItems = useMemo(() => {
    return enrichedProjects
      .map((project) => {
        const datedSteps = (project.steps || [])
          .map((step) => ({
            label: step.label,
            start: parseDateSafe(step.start_date),
            end: parseDateSafe(step.end_date),
          }))
          .filter((step) => step.start && step.end);

        const startFromSteps = datedSteps.length > 0
          ? new Date(Math.min(...datedSteps.map((step) => step.start.getTime())))
          : null;
        const start = startFromSteps || parseDateSafe(project.created_at);
        if (!start) return null;

        const due = parseDateSafe(project.due_date);
        const updated = parseDateSafe(project.updated_at);
        const endFromSteps = datedSteps.length > 0
          ? new Date(Math.max(...datedSteps.map((step) => step.end.getTime())))
          : null;
        const rawEnd = endFromSteps || due || updated || addDays(start, 7);
        const end = rawEnd < start ? start : rawEnd;

        return {
          id: project.id,
          title: project.title,
          owner: project.owner || '-',
          status: project.status || 'A faire',
          start,
          end,
          stepSegments: datedSteps,
          stepsCount: datedSteps.length,
          dueDate: due,
          dueDateLabel: project.due_date ? formatDate(project.due_date) : 'Non définie',
          hasDueDate: !!project.due_date,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);
  }, [enrichedProjects]);

  const ganttBounds = useMemo(() => {
    if (ganttItems.length === 0) return null;
    const minStart = new Date(Math.min(...ganttItems.map((item) => item.start.getTime())));
    const maxEnd = new Date(Math.max(...ganttItems.map((item) => item.end.getTime())));
    const totalDays = Math.max(1, Math.ceil((maxEnd - minStart) / DAY_MS) + 1);
    return { minStart, maxEnd, totalDays };
  }, [ganttItems]);

  const zoomConfig = useMemo(
    () => zoomOptions.find((option) => option.key === ganttZoom) || zoomOptions[1],
    [ganttZoom]
  );

  const ganttTimelineWidth = useMemo(() => {
    if (!ganttBounds) return 900;
    return Math.max(900, ganttBounds.totalDays * zoomConfig.pxPerDay);
  }, [ganttBounds, zoomConfig]);

  const ganttTicks = useMemo(() => {
    if (!ganttBounds) return [];
    const ticks = [];
    let cursor = new Date(ganttBounds.minStart);
    while (cursor <= ganttBounds.maxEnd) {
      ticks.push(new Date(cursor));
      cursor = addDays(cursor, zoomConfig.tickStepDays);
    }
    return ticks;
  }, [ganttBounds, zoomConfig]);

  const stats = useMemo(() => {
    const now = new Date();
    const total = projects.length;
    const todo = projects.filter((p) => p.status === 'A faire').length;
    const inProgress = projects.filter((p) => p.status === 'En cours').length;
    const done = projects.filter((p) => p.status === 'Termine').length;
    const overdue = projects.filter((p) => getProjectTimelineState(p, now).isOverdue).length;
    const dueSoon = projects.filter((p) => getProjectTimelineState(p, now).isDueSoon).length;
    return { total, todo, inProgress, done, overdue, dueSoon };
  }, [projects]);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const submitForm = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        description: form.description.trim(),
        documentation: form.documentation.trim(),
        owner: form.owner.trim(),
        due_date: form.due_date || null,
        steps: (form.steps || [])
          .map((step) => ({
            label: (step.label || '').trim(),
            start_date: step.start_date || null,
            end_date: step.end_date || null,
          }))
          .filter((step) => step.label && step.start_date && step.end_date),
      };

      if (!payload.title || !payload.description) {
        throw new Error('Titre et description sont obligatoires.');
      }

      if (editingId) {
        await axios.put(`${backendUrl}/it-projects/${editingId}`, payload);
      } else {
        await axios.post(`${backendUrl}/it-projects`, payload);
      }

      await fetchProjects();
      resetForm();
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Erreur lors de lenregistrement du projet.');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (project) => {
    setEditingId(project.id);
    setForm({
      title: project.title || '',
      status: project.status || 'A faire',
      owner: project.owner || '',
      due_date: project.due_date || '',
      description: project.description || '',
      documentation: project.documentation || '',
      steps: (project.steps || []).map((step) => ({
        label: step.label || '',
        start_date: step.start_date || '',
        end_date: step.end_date || '',
      })),
    });
  };

  const removeProject = async (id) => {
    if (!window.confirm('Supprimer ce projet IT ?')) return;
    setLoading(true);
    setError('');
    try {
      await axios.delete(`${backendUrl}/it-projects/${id}`);
      await fetchProjects();
      if (editingId === id) {
        resetForm();
      }
    } catch (err) {
      setError(err?.response?.data?.detail || 'Erreur lors de la suppression du projet.');
    } finally {
      setLoading(false);
    }
  };

  const addStepRow = () => {
    setForm((prev) => ({
      ...prev,
      steps: [...(prev.steps || []), { label: '', start_date: '', end_date: '' }],
    }));
  };

  const updateStepRow = (index, field, value) => {
    setForm((prev) => {
      const nextSteps = [...(prev.steps || [])];
      nextSteps[index] = { ...nextSteps[index], [field]: value };
      return { ...prev, steps: nextSteps };
    });
  };

  const removeStepRow = (index) => {
    setForm((prev) => ({
      ...prev,
      steps: (prev.steps || []).filter((_, idx) => idx !== index),
    }));
  };

  const insertDocumentationTag = (openTag, closeTag, placeholder) => {
    const current = form.documentation || '';
    const textarea = documentationRef.current;

    if (!textarea) {
      setForm((prev) => ({ ...prev, documentation: `${prev.documentation || ''}${openTag}${placeholder}${closeTag}` }));
      return;
    }

    const selectionStart = textarea.selectionStart ?? current.length;
    const selectionEnd = textarea.selectionEnd ?? current.length;
    const selectedText = current.slice(selectionStart, selectionEnd) || placeholder;
    const nextValue =
      current.slice(0, selectionStart) +
      openTag +
      selectedText +
      closeTag +
      current.slice(selectionEnd);

    setForm((prev) => ({ ...prev, documentation: nextValue }));

    requestAnimationFrame(() => {
      if (!documentationRef.current) return;
      documentationRef.current.focus();
      const start = selectionStart + openTag.length;
      documentationRef.current.setSelectionRange(start, start + selectedText.length);
    });
  };

  const printGantt = () => {
    const node = ganttExportRef.current;
    if (!node) return;

    const popup = window.open('', '_blank', 'width=1400,height=900');
    if (!popup) {
      setExportNotice('Impossible d ouvrir la fenêtre d impression.');
      return;
    }

    popup.document.write(`
      <html>
        <head>
          <title>Gantt Board Projets IT</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 16px; color: #0f172a; }
            h1 { margin: 0 0 12px; font-size: 20px; }
            .hint { margin-bottom: 12px; color: #475569; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>Gantt Board Projets IT</h1>
          <div class="hint">Imprimé le ${new Date().toLocaleString('fr-FR')}</div>
          <div>${node.innerHTML}</div>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const exportGanttPng = async () => {
    const node = ganttExportRef.current;
    if (!node) return;

    setExporting(true);
    setExportNotice('');
    try {
      const canvas = await html2canvas(node, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        windowWidth: node.scrollWidth,
        windowHeight: node.scrollHeight,
      });

      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `gantt-projets-it-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      setExportNotice('Export PNG terminé.');
    } catch (e) {
      setExportNotice('Échec export PNG.');
    } finally {
      setExporting(false);
      setTimeout(() => setExportNotice(''), 2500);
    }
  };

  return (
    <div className="container mx-auto space-y-6 px-3 py-4 md:p-8">
      <div>
        <h1 className="text-2xl font-bold">Gestion des projets IT</h1>
        <p className="text-gray-600">Centralise les projets avec statut, description detaillee et documentation.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-slate-500">
          <div className="text-sm text-gray-500">Total projets</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-slate-400">
          <div className="text-sm text-gray-500">A faire</div>
          <div className="text-2xl font-bold">{stats.todo}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-amber-500">
          <div className="text-sm text-gray-500">En cours</div>
          <div className="text-2xl font-bold text-amber-700">{stats.inProgress}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-emerald-500">
          <div className="text-sm text-gray-500">Termines</div>
          <div className="text-2xl font-bold text-emerald-700">{stats.done}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-red-500">
          <div className="text-sm text-gray-500">En retard</div>
          <div className="text-2xl font-bold text-red-700">{stats.overdue}</div>
        </div>
        <div className="bg-white rounded shadow p-4 border-l-4 border-l-amber-500">
          <div className="text-sm text-gray-500">Echeance proche</div>
          <div className="text-2xl font-bold text-amber-700">{stats.dueSoon}</div>
        </div>
      </div>

      <div className="bg-white rounded shadow p-4">
        <label className="block text-sm font-semibold mb-2">Recherche</label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filtrer par titre, responsable, statut ou description"
          className="w-full border rounded px-3 py-2"
        />
      </div>

      <form onSubmit={submitForm} className="bg-white rounded shadow p-5 space-y-3">
        <h2 className="text-lg font-semibold">{editingId ? 'Editer un projet' : 'Nouveau projet'}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            type="text"
            name="title"
            placeholder="Titre du projet"
            value={form.title}
            onChange={handleChange}
            className="border rounded px-3 py-2"
            required
          />
          <select
            name="status"
            value={form.status}
            onChange={handleChange}
            className="border rounded px-3 py-2"
          >
            {statusColumns.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <input
            type="text"
            name="owner"
            placeholder="Responsable (optionnel)"
            value={form.owner}
            onChange={handleChange}
            className="border rounded px-3 py-2"
          />
          <input
            type="date"
            name="due_date"
            value={form.due_date}
            onChange={handleChange}
            className="border rounded px-3 py-2"
          />
        </div>

        <textarea
          name="description"
          placeholder="Description detaillee du projet"
          value={form.description}
          onChange={handleChange}
          className="border rounded px-3 py-2 w-full min-h-[110px]"
          required
        />

        <div className="rounded border border-slate-200 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">Outils Documentation:</span>
            <button type="button" className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold text-white" onClick={() => insertDocumentationTag('[h1]', '[/h1]', 'Titre principal')}>Titre XL</button>
            <button type="button" className="rounded bg-slate-600 px-2 py-1 text-xs font-semibold text-white" onClick={() => insertDocumentationTag('[h2]', '[/h2]', 'Sous-titre')}>Titre L</button>
            <button type="button" className="rounded bg-slate-500 px-2 py-1 text-xs font-semibold text-white" onClick={() => insertDocumentationTag('[h3]', '[/h3]', 'Section')}>Titre M</button>
            <button type="button" className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white" onClick={() => insertDocumentationTag('[red]', '[/red]', 'Texte rouge')}>Rouge</button>
            <button type="button" className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white" onClick={() => insertDocumentationTag('[blue]', '[/blue]', 'Texte bleu')}>Bleu</button>
            <button type="button" className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white" onClick={() => insertDocumentationTag('[green]', '[/green]', 'Texte vert')}>Vert</button>
          </div>

          <textarea
            ref={documentationRef}
          name="documentation"
          placeholder="Documentation (lien, process, notes techniques, etc.)"
          value={form.documentation}
          onChange={handleChange}
          className="border rounded px-3 py-2 w-full min-h-[120px]"
          />
        </div>

        <div className="rounded border border-slate-200 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Etapes du projet (datées)</h3>
            <button
              type="button"
              onClick={addStepRow}
              className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
            >
              + Ajouter une étape
            </button>
          </div>

          {(form.steps || []).length === 0 && (
            <div className="text-xs text-slate-500">
              Aucune étape pour le moment. Exemple: Analyse des besoins, début 31/03/2026, fin 02/04/2026.
            </div>
          )}

          {(form.steps || []).map((step, index) => (
            <div key={`step-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px_180px_auto] md:items-end">
              <input
                type="text"
                placeholder="Nom de l'étape"
                value={step.label || ''}
                onChange={(e) => updateStepRow(index, 'label', e.target.value)}
                className="border rounded px-3 py-2"
              />
              <input
                type="date"
                value={step.start_date || ''}
                onChange={(e) => updateStepRow(index, 'start_date', e.target.value)}
                className="border rounded px-3 py-2"
              />
              <input
                type="date"
                value={step.end_date || ''}
                onChange={(e) => updateStepRow(index, 'end_date', e.target.value)}
                className="border rounded px-3 py-2"
              />
              <button
                type="button"
                onClick={() => removeStepRow(index)}
                className="rounded bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                Retirer
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700" disabled={loading}>
            {loading ? 'Enregistrement...' : editingId ? 'Mettre a jour' : 'Creer le projet'}
          </button>
          {editingId && (
            <button type="button" className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600" onClick={resetForm}>
              Annuler
            </button>
          )}
        </div>

        {error && <div className="text-red-600 text-sm">{error}</div>}
      </form>

      <section className="bg-white rounded shadow p-5 space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h2 className="text-lg font-semibold">Gantt Board des Projets</h2>
          <div className="flex flex-wrap items-center gap-2">
            {zoomOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`rounded px-3 py-1 text-xs font-semibold ${ganttZoom === option.key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                onClick={() => setGanttZoom(option.key)}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
              onClick={printGantt}
            >
              Imprimer
            </button>
            <button
              type="button"
              className="rounded bg-cyan-700 px-3 py-1 text-xs font-semibold text-white hover:bg-cyan-800 disabled:bg-gray-300"
              onClick={exportGanttPng}
              disabled={exporting}
            >
              {exporting ? 'Export...' : 'Exporter PNG'}
            </button>
          </div>
        </div>

        {exportNotice && (
          <div className="text-xs font-semibold text-emerald-700">{exportNotice}</div>
        )}

        {ganttBounds && (
          <p className="text-xs text-gray-600">
            Période: {ganttBounds.minStart.toLocaleDateString('fr-FR')} {'->'} {ganttBounds.maxEnd.toLocaleDateString('fr-FR')}
          </p>
        )}

        {ganttItems.length === 0 && (
          <div className="text-sm text-gray-500 border border-dashed rounded p-3">
            Aucun projet disponible pour construire le diagramme de Gantt.
          </div>
        )}

        {ganttItems.length > 0 && ganttBounds && (
          <div ref={ganttExportRef} className="space-y-3 overflow-x-auto pb-1 bg-white">
            <div className="flex" style={{ width: `${260 + ganttTimelineWidth}px` }}>
              <div className="w-[260px] shrink-0" />
              <div className="relative h-7" style={{ width: `${ganttTimelineWidth}px` }}>
                {ganttTicks.map((tick, idx) => {
                  const daysFromStart = Math.floor((tick - ganttBounds.minStart) / DAY_MS);
                  const left = (daysFromStart / ganttBounds.totalDays) * 100;
                  return (
                    <div key={`${tick.toISOString()}-${idx}`} className="absolute top-0 bottom-0" style={{ left: `${left}%` }}>
                      <div className="h-full border-l border-slate-200" />
                      <span className="absolute top-0 ml-1 text-[10px] text-slate-500 whitespace-nowrap">
                        {formatTickLabel(tick, ganttZoom)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {ganttItems.map((item) => {
              const offsetDays = Math.max(0, Math.floor((item.start - ganttBounds.minStart) / DAY_MS));
              const durationDays = Math.max(1, Math.ceil((item.end - item.start) / DAY_MS) + 1);
              const left = (offsetDays / ganttBounds.totalDays) * 100;
              const width = Math.max((durationDays / ganttBounds.totalDays) * 100, 2.5);
              const barColor = ganttColorByStatus[item.status] || 'bg-slate-500';
              const dueOffsetDays = item.dueDate ? Math.floor((item.dueDate - ganttBounds.minStart) / DAY_MS) : null;
              const dueLeft = dueOffsetDays !== null ? (dueOffsetDays / ganttBounds.totalDays) * 100 : null;

              return (
                <div key={item.id} className="flex gap-4" style={{ width: `${260 + ganttTimelineWidth}px` }}>
                  <div className="w-[260px] shrink-0 text-sm">
                    <div className="font-semibold text-slate-800 truncate">{item.title}</div>
                    <div className="text-xs text-slate-600">Responsable: {item.owner}</div>
                    <div className="text-xs text-slate-600">Début: {item.start.toLocaleDateString('fr-FR')} | Échéance: {item.dueDateLabel}</div>
                    <div className="text-xs text-slate-500">Etapes datées: {item.stepsCount}</div>
                  </div>

                  <div className="relative h-8 rounded bg-slate-100 overflow-hidden" style={{ width: `${ganttTimelineWidth}px` }}>
                    <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'repeating-linear-gradient(to right, rgba(148,163,184,.28), rgba(148,163,184,.28) 1px, transparent 1px, transparent 24px)' }} />
                    {item.stepSegments.length > 0 ? (
                      <>
                        <div
                          className={`absolute top-1 bottom-1 rounded ${barColor} opacity-30`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${item.title} (${item.status})`}
                        />
                        {item.stepSegments.map((step, stepIndex) => {
                          const stepOffsetDays = Math.max(0, Math.floor((step.start - ganttBounds.minStart) / DAY_MS));
                          const stepDurationDays = Math.max(1, Math.ceil((step.end - step.start) / DAY_MS) + 1);
                          const stepLeft = (stepOffsetDays / ganttBounds.totalDays) * 100;
                          const stepWidth = Math.max((stepDurationDays / ganttBounds.totalDays) * 100, 1.4);
                          const stepColor = stepSegmentColors[stepIndex % stepSegmentColors.length];
                          return (
                            <div
                              key={`${item.id}-seg-${stepIndex}`}
                              className={`absolute top-1 bottom-1 rounded ${stepColor} shadow-sm`}
                              style={{ left: `${stepLeft}%`, width: `${stepWidth}%` }}
                              title={`${step.label}: ${step.start.toLocaleDateString('fr-FR')} -> ${step.end.toLocaleDateString('fr-FR')}`}
                            />
                          );
                        })}
                      </>
                    ) : (
                      <div
                        className={`absolute top-1 bottom-1 rounded ${barColor} shadow-sm`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${item.title} (${item.status})`}
                      />
                    )}
                    {dueLeft !== null && dueLeft >= 0 && dueLeft <= 100 && (
                      <div className="absolute top-0 bottom-0 z-10" style={{ left: `${dueLeft}%` }} title={`Jalon échéance: ${item.dueDateLabel}`}>
                        <div className="h-full border-l border-rose-500" />
                        <div className="absolute -top-1.5 -ml-1.5 h-3 w-3 rotate-45 bg-rose-500" />
                      </div>
                    )}
                    {!item.hasDueDate && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-500">
                        Échéance non définie
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {statusColumns.map((column) => (
          <section key={column.key} className={`bg-white rounded shadow p-4 border-t-4 ${column.color}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">{column.label}</h3>
              <span className="text-sm text-gray-500">{groupedProjects[column.key]?.length || 0}</span>
            </div>

            <div className="space-y-3">
              {(groupedProjects[column.key] || []).map((project) => (
                <article key={project.id} className="border rounded p-3 bg-gray-50 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold">{project.title}</div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${getTimelineBadgeClasses(project.timelineState.tone)}`}>
                      {project.timelineState.label}
                    </span>
                  </div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap">{project.description}</div>
                  <div className="text-xs text-gray-600">
                    Responsable: {project.owner || '-'} | Echeance: {project.due_date || '-'}
                  </div>
                  <div className="space-y-1 rounded border bg-white p-2">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>Progression</span>
                      <span className="font-semibold text-slate-800">{project.progress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${project.status === 'Termine' ? 'bg-emerald-500' : project.status === 'En cours' ? 'bg-amber-500' : 'bg-slate-500'}`}
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-slate-500">{project.timelineState.detail}</div>
                  </div>
                  <div className="text-xs text-slate-700 bg-white border rounded p-2 space-y-1">
                    <strong>Documentation:</strong>
                    {project.documentation ? renderDocumentationBlock(project.documentation) : <div>Aucune documentation</div>}
                  </div>
                  <div className="text-xs text-slate-700 bg-white border rounded p-2 space-y-1">
                    <strong>Etapes:</strong>
                    {(project.steps || []).length === 0 && <div>Aucune étape datée.</div>}
                    {(project.steps || []).map((step, idx) => (
                      <div key={`${project.id}-step-${idx}`}>
                        {step.label}: début {formatDate(step.start_date)} fin {formatDate(step.end_date)}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button className="text-sm bg-amber-500 text-white px-3 py-1 rounded hover:bg-amber-600" onClick={() => startEdit(project)}>
                      Editer
                    </button>
                    <button className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700" onClick={() => removeProject(project.id)}>
                      Supprimer
                    </button>
                  </div>
                </article>
              ))}

              {(groupedProjects[column.key] || []).length === 0 && (
                <div className="text-sm text-gray-500 border border-dashed rounded p-3">Aucun projet dans cette colonne (avec le filtre actuel).</div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
