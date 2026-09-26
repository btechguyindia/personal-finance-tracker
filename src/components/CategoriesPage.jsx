import React, { useMemo, useState } from 'react';
import { CATEGORIES, SUBCATEGORIES, CATEGORY_COLORS } from '../services/analyticsService.js';
import { api } from '../services/api.js';
import { formatINR } from '../services/finance.js';

const KIND_DEFAULTS = {
  expense: CATEGORIES.map((c) => ({ name: c, builtIn: true })),
  income: ['Salary', 'Freelance', 'Business income', 'Interest', 'Dividends', 'Refunds', 'Gifts received', 'Other income'].map((c) => ({ name: c, builtIn: true }))
};

export default function CategoriesPage({ customCats, transactions, onChanged }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('expense');
  const [color, setColor] = useState('#3b82f6');
  const [error, setError] = useState('');

  const spending = useMemo(() => {
    const m = {};
    for (const t of transactions) {
      if (t.status && t.status !== 'completed') continue;
      if (t.type === 'expense') m[t.category] = (m[t.category] || 0) + Number(t.amount);
      else if (t.type === 'refund') m[t.category] = (m[t.category] || 0) - Number(t.amount);
    }
    return m;
  }, [transactions]);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createCategory({ name: name.trim(), kind, color });
      setName('');
      onChanged();
    } catch (err) { setError(err.message); }
  };

  const remove = async (id, n) => {
    if (!window.confirm(`Delete category "${n}"?`)) return;
    try { await api.deleteCategory(id); onChanged(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div>
      <div className="card">
        <div className="card-head"><h3>Add custom category</h3></div>
        <form onSubmit={add} className="form-grid">
          <label>Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Pets" /></label>
          <label>Kind<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></label>
          <label>Color<input className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 38 }} /></label>
        </form>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={add}>Add category</button>
        </div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {['expense', 'income'].map((k) => (
        <div className="card wide" key={k}>
          <div className="card-head"><h3>{k === 'expense' ? 'Expense categories' : 'Income categories'}</h3></div>
          {KIND_DEFAULTS[k].concat((customCats || []).filter((c) => c.kind === k).map((c) => ({ ...c, custom: true }))).map((c) => (
            <div className="acct-card" key={c.id || c.name}>
              <div className="row">
                <span className="dot" style={{ background: c.color || CATEGORY_COLORS[c.name] || '#9ca3af', width: 14, height: 14 }} />
                <div>
                  <b>{c.name}</b>
                  <div className="muted small">
                    {(SUBCATEGORIES[c.name] || []).slice(0, 5).join(' · ') || (c.custom ? 'Custom category' : 'Default')}
                    {k === 'expense' && spending[c.name] ? ` · Spent ${formatINR(spending[c.name])}` : ''}
                  </div>
                </div>
              </div>
              {c.custom
                ? <button className="btn danger" onClick={() => remove(c.id, c.name)}>Delete</button>
                : <span className="muted small">built-in</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
