import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Inventaire from './components/Inventaire';
import Logiciels from './components/Logiciels';
import UsersPage from './pages/UsersPage';
import LocationsPage from './pages/LocationsPage';
import IncidentsPage from './pages/IncidentsPage';
import SecurityPage from './pages/SecurityPage';
import SecurityJobsPage from './pages/SecurityJobsPage';
import CVEWatchPage from './pages/CVEWatchPage';
import ResourcesPage from './pages/ResourcesPage';
import NetworkPortsLogsPage from './pages/NetworkPortsLogsPage';
import PasswordGeneratorPage from './pages/PasswordGeneratorPage';
import ITProjectsPage from './pages/ITProjectsPage';
import DualRunMonitoringPage from './pages/DualRunMonitoringPage';
import SiemPage from './pages/SiemPage';
import SiemTimelinePage from './pages/SiemTimelinePage';
import AuthMonitoringPage from './pages/AuthMonitoringPage';



function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Le routeur encapsule toute l'application et affiche la bonne page
  // en fonction de l'URL sélectionnée dans la barre latérale.
  return (
    <Router>
      <div className="flex min-h-screen">
        {/* La navigation reste visible en permanence à gauche sur desktop. */}
        <Sidebar isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
        <div className="min-w-0 flex-1 min-h-screen px-3 py-4 md:px-6 md:py-6">
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 shadow-sm md:hidden">
            <div>
              <p className="text-sm text-slate-500">IT Monitoring</p>
              <p className="text-lg font-semibold text-slate-800">Navigation</p>
            </div>
            <button
              type="button"
              className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-white"
              onClick={() => setMobileMenuOpen(true)}
            >
              Menu
            </button>
          </div>
          {/* Chaque route charge un écran métier différent. */}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventaire" element={<Inventaire />} />
            <Route path="/logiciels" element={<Logiciels />} />
            <Route path="/utilisateurs" element={<UsersPage />} />
            <Route path="/bureaux" element={<LocationsPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/securite" element={<SecurityPage />} />
            <Route path="/securite/jobs" element={<SecurityJobsPage />} />
            <Route path="/veille-cve" element={<CVEWatchPage />} />
            <Route path="/supervision" element={<ResourcesPage />} />
            <Route path="/ports-logs" element={<NetworkPortsLogsPage />} />
            <Route path="/dual-run" element={<DualRunMonitoringPage />} />
            <Route path="/siem" element={<SiemPage />} />
            <Route path="/siem/timeline" element={<SiemTimelinePage />} />
            <Route path="/siem/auth" element={<AuthMonitoringPage />} />
            <Route path="/generateur-mdp" element={<PasswordGeneratorPage />} />
            <Route path="/projets-it" element={<ITProjectsPage />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
