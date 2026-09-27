// Data Portability Center — export, versioned backups, validation, restore
// preview and safe restore (merge / replace). Destructive actions always need
// an explicit confirmation step; replace additionally needs the account
// password + confirmation phrase and a pre-restore backup download.
import React, { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../services/api.js';
import { formatINR } from '../services/analyticsService.js';

const fmtPaise = (p) => formatINR((Number(p) || 0) / 100);
const shortHash = (v) => (v ? `${String(v).slice(0, 12)}…` : '—');

function CountsLine({ counts }) {
  if (!counts) return null;
  return (
    <p className="muted small">
      {Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}
    </p>
  );
}

export default function PortabilityPage() {
  const [accounts, setAccounts] = useState([]);
  const [csvAccount, setCsvAccount] = useState('');
  const [history, setHistory] = useState([]);
  const [backupInfo, setBackupInfo] = useState(null);
  const [file, setFile] = useState(null);
  const [backup, setBackup] = useState(null);
  const [validation, setValidation] = useState(null);
  const [mode, setMode] = useState('merge');
  const [preview, setPreview] = useState(null);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [report, setReport] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    api.getAccounts().then(setAccounts).catch(() => {});
    api.getPortabilityHistory().then(setHistory).catch(() => {});
  }, []);

  const refreshHistory = () => api.getPortabilityHistory().then(setHistory).catch(() => {});

  const readFile = async () => {
    if (!file) throw new Error('Choose a backup file first.');
    const text = await file.text();
    try { return JSON.parse(text); } catch { throw new Error('File is not valid JSON.'); }
  };

  const downloadBackup = async () => {
    setError(''); setMsg(''); setBusy('backup');
    try {
      const data = await api.downloadBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fintrack-backup-v${data.version || 1}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setBackupInfo({
        exportedAt: data.exportedAt, version: data.version,
        counts: data.manifest?.counts, integrity: data.manifest?.integrity?.value,
        appVersion: data.manifest?.appVersion
      });
      setMsg('Versioned backup downloaded — store it somewhere safe. Your downloads ARE your backups.');
      refreshHistory();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const downloadCsv = async () => {
    setError(''); setMsg('');
    if (!csvAccount) { setError('Pick an account first.'); return; }
    setBusy('csv');
    try {
      const token = getToken();
      const res = await fetch(`/api/portability/export.csv?account=${encodeURIComponent(csvAccount)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fintrack-${csvAccount.replace(/[^\w\-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(`CSV for ${csvAccount} downloaded.`);
      refreshHistory();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const runValidation = async () => {
    setError(''); setMsg(''); setValidation(null); setPreview(null); setReport(null);
    setBusy('validate');
    try {
      const parsed = await readFile();
      setBackup(parsed);
      const v = await api.validatePortability(parsed);
      setValidation({ ...v, fileName: file.name });
      setMsg(v.valid ? 'Backup is valid — preview a restore below.' : 'Backup has problems — fix them before restoring.');
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const runPreview = async () => {
    setError(''); setMsg(''); setPreview(null);
    if (!backup) { setError('Validate a backup first.'); return; }
    setBusy('preview');
    try {
      const p = await api.previewPortability(backup, mode);
      setPreview(p);
      setMsg('Preview ready — nothing was written. Review, then restore if happy.');
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const downloadPreRestore = async () => {
    const data = await api.downloadBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fintrack-PRE-RESTORE-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const applyRestore = async () => {
    setError(''); setMsg('');
    if (!backup || !preview) { setError('Run validation + preview first.'); return; }
    if (mode === 'replace') {
      if (!password) { setError('Enter your current password to re-authenticate a replace.'); return; }
      if (phrase !== 'REPLACE ALL MY DATA') { setError('Type REPLACE ALL MY DATA exactly to confirm.'); return; }
    }
    if (!window.confirm(mode === 'replace'
      ? 'REPLACE all your data with this backup? A pre-restore backup will download first.'
      : 'Merge this backup into your data? Existing records are kept; only new ones are added.')) return;
    setBusy('restore');
    try {
      await downloadPreRestore();
      const out = await api.restoreBackup(backup, { dryRun: false, mode, confirmation: phrase, password: password || undefined });
      setReport(out);
      setPassword(''); setPhrase('');
      setMsg(`Restore applied (${out.mode}). Balances rebuild from the ledger automatically.`);
      refreshHistory();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const per = preview?.diff || {};
  const order = ['transactions', 'accounts', 'budgets', 'categories', 'upiIds', 'goals', 'contributions', 'recurring', 'imports', 'autopilotRules', 'autopilotRuns', 'notifications'];

  return (
    <div>
      {error && <div className="card"><div className="error">{error}</div></div>}
      {msg && <div className="card"><div className="success">{msg}</div></div>}

      <div className="card wide">
        <div className="card-head"><h3>Backup &amp; export</h3></div>
        <p className="muted small">Versioned JSON backup (transactions, opening balances, budgets, goals, contributions, recurring, imports, autopilot, notifications, preferences). Passwords, sessions and security history are never exported.</p>
        <div className="row">
          <button className="btn primary" disabled={busy === 'backup'} onClick={downloadBackup}>
            {busy === 'backup' ? 'Preparing…' : '⬇ Download backup (v1)'}
          </button>
        </div>
        {backupInfo && (
          <div className="muted small" style={{ marginTop: 8 }}>
            Exported {backupInfo.exportedAt} · v{backupInfo.version} · app {backupInfo.appVersion} ·
            integrity <code>{shortHash(backupInfo.integrity)}</code>
            <CountsLine counts={backupInfo.counts} />
          </div>
        )}
        <h4>Per-account CSV</h4>
        <div className="row">
          <select value={csvAccount} onChange={(e) => setCsvAccount(e.target.value)}>
            <option value="">Select account…</option>
            {accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <button className="btn" disabled={busy === 'csv' || !csvAccount} onClick={downloadCsv}>
            {busy === 'csv' ? 'Preparing…' : '⬇ Export CSV'}
          </button>
        </div>
      </div>

      <div className="card wide">
        <div className="card-head"><h3>Format &amp; compatibility</h3></div>
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Format <code>fintrack-backup</code> · schema <code>v1</code> · money in <b>INR rupees</b> at the boundary (integer paise internally, rounded).</li>
          <li>Every backup carries a manifest: record counts, SHA-256 integrity hash, currency conventions, app version.</li>
          <li>Legacy <code>/api/export</code> files are accepted and normalized on restore.</li>
          <li>Max backup: 8 MB / 10,000 transactions. Restores over ~4.5 MB must run against a local server (Vercel request cap).</li>
          <li>History below is a <b>metadata-only registry</b> (audit log). There is no server-side backup storage — your downloaded files ARE your backups. No paid storage is used.</li>
          <li>Replace-mode restores are wipe-then-insert (not atomic on the single-document store) — always keep the pre-restore download.</li>
        </ul>
      </div>

      <div className="card wide">
        <div className="card-head"><h3>Backup history (registry)</h3></div>
        {history.length === 0 ? (
          <div className="empty">No backup activity yet. Downloads, restores and imports are recorded here (what + when — never file contents).</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>When (UTC)</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id}><td>{h.at}</td><td><span className="pill completed">{h.action}</span></td><td>{h.detail || `${h.entity || ''}`}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="card wide">
        <div className="card-head"><h3>1 · Validate a backup</h3></div>
        <div className="row">
          <input type="file" accept=".json,application/json" ref={fileRef}
            onChange={(e) => { setFile(e.target.files?.[0] || null); setValidation(null); setPreview(null); setReport(null); }} />
          <button className="btn primary" disabled={busy === 'validate' || !file} onClick={runValidation}>
            {busy === 'validate' ? 'Checking…' : 'Validate (read-only)'}
          </button>
        </div>
        {validation && (
          <div style={{ marginTop: 10 }}>
            <p className="muted small"><b>{validation.fileName}</b> — supports <code>{validation.compatibility?.supported}</code></p>
            <CountsLine counts={validation.counts} />
            {validation.manifest && !validation.manifest.ok && !validation.manifest.skipped && (
              <div className="error" style={{ marginTop: 8 }}>Integrity: {validation.manifest.error}</div>
            )}
            {validation.manifest?.ok && <div className="success" style={{ marginTop: 8 }}>Integrity hash matches — file is unchanged since export.</div>}
            {(validation.errors || []).length > 0 && (
              <div className="error" style={{ marginTop: 8 }}>
                {(validation.errors || []).slice(0, 10).map((e, i) => <div key={i}>{e}</div>)}
                {validation.errors.length > 10 && <div>…and {validation.errors.length - 10} more</div>}
              </div>
            )}
            {(validation.warnings || []).length > 0 && (
              <div className="muted small" style={{ marginTop: 8 }}>
                <b>Warnings ({validation.warnings.length}):</b>
                {validation.warnings.slice(0, 8).map((w, i) => <div key={i}>• {w}</div>)}
                {validation.warnings.length > 8 && <div>…and {validation.warnings.length - 8} more</div>}
              </div>
            )}
            {validation.valid && <div className="success" style={{ marginTop: 8 }}>All records valid — safe to preview.</div>}
          </div>
        )}
      </div>

      <div className="card wide">
        <div className="card-head"><h3>2 · Preview restore</h3></div>
        <div className="row">
          <label>Mode <select value={mode} onChange={(e) => { setMode(e.target.value); setPreview(null); }}>
            <option value="merge">Merge (keep mine, add new)</option>
            <option value="replace">Replace (wipe mine first)</option>
          </select></label>
          <button className="btn primary" disabled={busy === 'preview' || !backup} onClick={runPreview}>
            {busy === 'preview' ? 'Previewing…' : 'Preview (read-only)'}
          </button>
        </div>
        {preview && (
          <div style={{ marginTop: 10 }}>
            <div className="table-wrap"><table>
              <thead><tr><th>Collection</th><th>Live</th><th>Incoming</th><th>Added</th><th>Replaced</th><th>Removed</th><th>Conflicts</th></tr></thead>
              <tbody>{order.filter((k) => per[k]).map((k) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{preview.liveCounts?.[k] ?? '—'}</td>
                  <td>{preview.incomingCounts?.[k] ?? '—'}</td>
                  <td>{per[k].added}</td><td>{per[k].replaced}</td><td>{per[k].removed}</td>
                  <td>{per[k].conflictCount > 0 ? <span className="pill scheduled">{per[k].conflictCount} skipped</span> : '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
            {preview.balanceEffect && (
              <p className="muted small" style={{ marginTop: 8 }}>
                Balance effect — income {fmtPaise(preview.balanceEffect.live.incomePaise)} → {fmtPaise(preview.balanceEffect.scenario.incomePaise)} ·
                expenses {fmtPaise(preview.balanceEffect.live.expensePaise)} → {fmtPaise(preview.balanceEffect.scenario.expensePaise)}
              </p>
            )}
            {(preview.dangling || []).length > 0 && (
              <div className="muted small" style={{ marginTop: 8 }}><b>References needing attention:</b>
                {preview.dangling.slice(0, 6).map((d, i) => <div key={i}>• {d}</div>)}
              </div>
            )}
            {preview.invalidSkipped > 0 && <div className="error" style={{ marginTop: 8 }}>{preview.invalidSkipped} invalid record(s) will be skipped.</div>}
            {mode === 'replace' && <div className="error" style={{ marginTop: 8 }}>{preview.replaceWipeNote}</div>}
          </div>
        )}
      </div>

      <div className="card wide">
        <div className="card-head"><h3>3 · Apply restore</h3></div>
        {mode === 'replace' && (
          <div className="row">
            <label>Current password<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Re-authenticate" autoComplete="current-password" /></label>
            <label>Type REPLACE ALL MY DATA<input className="input" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="REPLACE ALL MY DATA" /></label>
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={busy === 'restore' || !preview} onClick={applyRestore}>
            {busy === 'restore' ? 'Restoring…' : preview ? `Apply ${mode} restore` : 'Preview first, then apply'}
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Rollback: a pre-restore backup downloads automatically before anything is applied.
          To undo, restore that file back. Merge never overwrites an existing record —
          colliding IDs are listed as conflicts and skipped.
        </p>
        {report && (
          <div style={{ marginTop: 10 }}>
            <div className="success">Restore complete ({report.mode}). Inserted: {JSON.stringify(report.inserted)} · Skipped: {JSON.stringify(report.skipped)}</div>
            {report.conflicts && Object.keys(report.conflicts).length > 0 && (
              <div className="muted small" style={{ marginTop: 8 }}><b>Conflicting IDs (kept existing, skipped incoming):</b>
                {Object.entries(report.conflicts).map(([k, ids]) => <div key={k}>{k}: {ids.join(', ')}{ids.length >= 20 ? '…' : ''}</div>)}
              </div>
            )}
            <p className="muted small">Post-restore counts: {Object.entries(report.afterCounts || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
