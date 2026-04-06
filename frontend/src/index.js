import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// React 18 crée ici la racine de rendu de l'application dans la page HTML.
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  // StrictMode aide à détecter certains comportements problématiques en développement.
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
