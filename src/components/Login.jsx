import React, { useState } from 'react';
import { api, setToken } from '../services/api.js';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('prathmesh.nakate@ssg.com');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';

  const switchMode = (m) => {
    setMode(m);
    setError('');
    setPassword('');
    setConfirm('');
    if (m === 'signup' && email === 'prathmesh.nakate@ssg.com') setEmail('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (isSignup) {
      if (!name.trim()) { setError('Please enter your name'); return; }
      if (String(password).length < 8) { setError('Password must be at least 8 characters'); return; }
      if (password !== confirm) { setError('Passwords do not match'); return; }
    }
    setBusy(true);
    try {
      const data = isSignup
        ? await api.signup(email.trim(), password, name.trim())
        : await api.login(email.trim(), password);
      setToken(data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-hero">
        <div>
          <div className="brand big" style={{ color: '#fff' }}><span className="mark">₹</span> FinTrack</div>
          <h1>Every rupee, accounted for.</h1>
          <p>Your personal finance wallet — balances, budgets, UPI tracking, goals and analytics, all derived from your own ledger. No demo data, ever.</p>
          <ul className="hero-points">
            <li><span className="tick">✓</span> Ledger-accurate balances across cash, bank, UPI &amp; cards</li>
            <li><span className="tick">✓</span> Transfers never counted as income or expenses</li>
            <li><span className="tick">✓</span> CSV import with duplicate detection — HDFC / SBI / ICICI presets</li>
            <li><span className="tick">✓</span> Budgets, savings goals &amp; auto-posted recurring payments</li>
          </ul>
        </div>
        <div className="muted small" style={{ color: '#8fa0ba' }}>Asia/Kolkata · ₹ INR · Your data stays in your database</div>
      </div>
      <div className="login-form-side">
        <form className="card login-card" onSubmit={submit}>
          <div className="brand big"><span className="mark">₹</span> FinTrack</div>
          <h2>{isSignup ? 'Create your account' : 'Welcome back'}</h2>
          <p className="muted small" style={{ margin: '0 0 4px' }}>
            {isSignup ? 'Sign up for your private finance workspace.' : 'Log in to your private finance workspace.'}
          </p>
          {isSignup && (
            <label>Full name
              <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="Your name" maxLength={80} />
            </label>
          )}
          <label>Email address
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" placeholder="you@example.com" />
          </label>
          <label>Password
            <span className="pw-wrap">
              <input className="input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder="••••••••" minLength={isSignup ? 8 : undefined} />
              <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
            </span>
          </label>
          {isSignup && (
            <label>Confirm password
              <input className="input" type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" placeholder="••••••••" />
            </label>
          )}
          {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
          <button className="btn primary" style={{ width: '100%', marginTop: 16, padding: '11px' }} type="submit" disabled={busy}>
            {busy ? (isSignup ? 'Creating account…' : 'Logging in…') : (isSignup ? 'Sign up →' : 'Log in →')}
          </button>
          <p className="muted small" style={{ textAlign: 'center' }}>
            {isSignup ? (
              <>Already have an account? <button type="button" className="pw-toggle" style={{ display: 'inline', padding: 0 }} onClick={() => switchMode('login')}>Log in</button></>
            ) : (
              <>New to FinTrack? <button type="button" className="pw-toggle" style={{ display: 'inline', padding: 0 }} onClick={() => switchMode('signup')}>Create an account</button></>
            )}
          </p>
          <p className="muted small" style={{ textAlign: 'center' }}>Protected by rate-limited auth &amp; scrypt password hashing.</p>
        </form>
      </div>
    </div>
  );
}
