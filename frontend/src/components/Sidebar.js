import React from 'react';
import { NavLink } from 'react-router-dom';

// La barre latérale centralise les liens de navigation de l'application.
const Sidebar = ({ isOpen, onClose }) => (
  <>
    <div
      className={`fixed inset-0 z-40 bg-slate-900/45 transition-opacity md:hidden ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      onClick={onClose}
      aria-hidden="true"
    />
    <aside className={`fixed left-0 top-0 z-50 h-full w-72 shrink-0 p-3 transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0 md:p-4 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="glass-panel fade-up h-full overflow-y-auto rounded-3xl bg-gradient-to-b from-slate-900 via-cyan-900 to-slate-900 p-6 text-slate-100 shadow-2xl md:h-[calc(100vh-2rem)] md:sticky md:top-4">
      <div className="mb-4 flex items-center justify-between md:hidden">
        <span className="text-sm font-semibold text-cyan-100/90">Navigation</span>
        <button
          type="button"
          className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-semibold"
          onClick={onClose}
        >
          Fermer
        </button>
      </div>
      <h2 className="mb-1 text-2xl font-bold tracking-tight">IT Parc</h2>
      <p className="mb-8 text-sm text-cyan-100/80">Centre de pilotage infrastructure</p>
      <nav className="flex flex-col gap-2">
      {/* NavLink applique automatiquement le style actif selon la route courante. */}
      <NavLink to="/" end onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Dashboard (Vue générale)
      </NavLink>
      <NavLink to="/inventaire" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Inventaire Matériel
      </NavLink>
      <NavLink to="/logiciels" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Licences & Logiciels
      </NavLink>
      <NavLink to="/utilisateurs" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Utilisateurs
      </NavLink>
      <NavLink to="/bureaux" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Bureaux
      </NavLink>
      <NavLink to="/incidents" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Incidents
      </NavLink>
      <NavLink to="/securite" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Sécurité
      </NavLink>
      <NavLink to="/securite/jobs" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Security Jobs
      </NavLink>
      <NavLink to="/supervision" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Supervision Ressources
      </NavLink>
      <NavLink to="/ports-logs" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Ports & Logs LAN
      </NavLink>
      <NavLink to="/dual-run" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Dual-Run Monitoring
      </NavLink>
      <NavLink to="/siem" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        SIEM interne
      </NavLink>
      <NavLink to="/siem/timeline" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Timeline investigation
      </NavLink>
      <NavLink to="/siem/auth" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Auth Monitoring
      </NavLink>
      <NavLink to="/generateur-mdp" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Generateur MDP
      </NavLink>
      <NavLink to="/projets-it" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Projets IT
      </NavLink>
      <NavLink to="/veille-cve" onClick={onClose} className={({ isActive }) => isActive ? 'rounded-xl bg-white/20 px-3 py-2 font-bold text-white shadow' : 'rounded-xl px-3 py-2 text-cyan-100/90 transition hover:bg-white/10 hover:text-white'}>
        Veille CVE
      </NavLink>
      </nav>
    </div>
  </aside>
  </>
);

export default Sidebar;
