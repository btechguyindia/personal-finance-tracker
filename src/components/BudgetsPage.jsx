import React, { useState } from 'react';
import { CATEGORIES, formatINR } from '../services/analyticsService.js';
import { api } from '../services/api.js';

export default function BudgetsPage({ budgets, onChanged }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = draft || budgets;

  const set = (cat, val) => setDraft({ ...current, [cat]: val });

  const save = async () => {
    setError('');
    setBusy(true);
    try {
      const payload = {};
      for (const [k, v] of Object.entries(current)) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) payload[k] = n;
      }
      const saved = await api.saveBudgets(payload);
      setDraft(null);
      onChanged(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card wide">
      <div className="card-head"><h3>Monthly budgets</h3>
        <div className="row">
          {draft && <button className="btn" onClick={() => setDraft(null)}>Reset</button>}
          <button className="btn primary" onClick={save} disabled={busy || !draft}>{busy ? 'Saving…' : 'Save budgets'}</button>
        </div>
      </div>
      <p className="muted small">Used by Analytics → Budget vs actual. Amounts in ₹ per month.</p>
      {error && <div className="error">{error}</div>}
      <div className="form-grid">
        {CATEGORIES.map((c) => (
          <label key={c}>{c} ({formatINR(budgets[c] || 0)})
            <input className="input" type="number" min="0" step="100"
              value={current[c] ?? 0} onChange={(e) => set(c, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}
