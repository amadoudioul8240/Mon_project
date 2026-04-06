import React, { useMemo, useState } from 'react';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';
const AMBIGUOUS = 'Il1O0';

function randomInt(max) {
  const buffer = new Uint32Array(1);
  window.crypto.getRandomValues(buffer);
  return buffer[0] % max;
}

function buildCharacterPool(options) {
  let pool = '';
  if (options.includeLower) pool += LOWER;
  if (options.includeUpper) pool += UPPER;
  if (options.includeDigits) pool += DIGITS;
  if (options.includeSymbols) pool += SYMBOLS;

  if (options.excludeAmbiguous) {
    pool = pool
      .split('')
      .filter((ch) => !AMBIGUOUS.includes(ch))
      .join('');
  }

  return pool;
}

function evaluateStrength(password) {
  const lengthScore = password.length >= 20 ? 3 : password.length >= 14 ? 2 : password.length >= 10 ? 1 : 0;
  const diversityScore = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].reduce(
    (score, regex) => score + (regex.test(password) ? 1 : 0),
    0
  );
  const total = lengthScore + diversityScore;

  if (total >= 6) return { label: 'Tres fort', color: 'text-emerald-700 bg-emerald-100 border-emerald-300' };
  if (total >= 4) return { label: 'Fort', color: 'text-blue-700 bg-blue-100 border-blue-300' };
  if (total >= 3) return { label: 'Moyen', color: 'text-amber-700 bg-amber-100 border-amber-300' };
  return { label: 'Faible', color: 'text-red-700 bg-red-100 border-red-300' };
}

export default function PasswordGeneratorPage() {
  const [length, setLength] = useState(16);
  const [includeLower, setIncludeLower] = useState(true);
  const [includeUpper, setIncludeUpper] = useState(true);
  const [includeDigits, setIncludeDigits] = useState(true);
  const [includeSymbols, setIncludeSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const options = { includeLower, includeUpper, includeDigits, includeSymbols, excludeAmbiguous };

  const strength = useMemo(() => evaluateStrength(password), [password]);

  const generatePassword = () => {
    setMessage('');
    const pool = buildCharacterPool(options);
    if (!pool.length) {
      setPassword('');
      setMessage('Selectionne au moins un type de caracteres.');
      return;
    }

    let result = '';
    for (let i = 0; i < length; i += 1) {
      result += pool[randomInt(pool.length)];
    }
    setPassword(result);
  };

  const copyPassword = async () => {
    if (!password) {
      setMessage('Genere un mot de passe avant de copier.');
      return;
    }
    try {
      await navigator.clipboard.writeText(password);
      setMessage('Mot de passe copie dans le presse-papier.');
    } catch (err) {
      setMessage('Copie impossible sur ce navigateur.');
    }
  };

  return (
    <div className="container mx-auto max-w-3xl px-3 py-4 md:p-8">
      <h1 className="text-2xl font-bold mb-2">Generateur de mot de passe</h1>
      <p className="text-gray-600 mb-6">Genere un mot de passe fort pour les comptes applicatifs, AD ou locaux.</p>

      <div className="bg-white rounded-lg shadow p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold mb-2">Longueur: {length}</label>
          <input
            type="range"
            min="8"
            max="64"
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={includeLower} onChange={(e) => setIncludeLower(e.target.checked)} />
            Lettres minuscules
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={includeUpper} onChange={(e) => setIncludeUpper(e.target.checked)} />
            Lettres majuscules
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={includeDigits} onChange={(e) => setIncludeDigits(e.target.checked)} />
            Chiffres
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={includeSymbols} onChange={(e) => setIncludeSymbols(e.target.checked)} />
            Symboles
          </label>
          <label className="inline-flex items-center gap-2 md:col-span-2">
            <input type="checkbox" checked={excludeAmbiguous} onChange={(e) => setExcludeAmbiguous(e.target.checked)} />
            Exclure les caracteres ambigus (I, l, 1, O, 0)
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={generatePassword}
            className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
          >
            Generer
          </button>
          <button
            type="button"
            onClick={copyPassword}
            className="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700"
          >
            Copier
          </button>
        </div>

        <div className="border rounded p-4 bg-gray-50">
          <div className="text-sm text-gray-500 mb-1">Mot de passe genere</div>
          <div className="font-mono break-all text-base">{password || '-'}</div>
        </div>

        <div>
          <span className={`inline-flex px-3 py-1 rounded border text-sm font-semibold ${strength.color}`}>
            Robustesse: {password ? strength.label : 'Non evaluee'}
          </span>
        </div>

        {message && <div className="text-sm text-slate-700">{message}</div>}
      </div>
    </div>
  );
}
