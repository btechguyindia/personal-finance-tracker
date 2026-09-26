import React, { useState } from 'react';
import { api, setToken } from '../services/api.js';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('prathmesh.nakate@ssg.com');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';

  // Forgot-password flow state (self-hosted: reset code shown in-app).
  const [fStep, setFStep] = useState(1);
  const [fEmail, setFEmail] = useState('');
  const [fCode, setFCode] = useState('');
  const [fSentCode, setFSentCode] = useState('');
  const [fNew, setFNew] = useState('');
  const [fConfirm, setFConfirm] = useState('');
  const [fDone, setFDone] = useState(false);
  const [notice, setNotice] = useState('');

  const switchMode = (m) => {
    setMode(m);
    setError('');
    setNotice('');
    setPassword('');
    setConfirm('');
    setFStep(1); setFCode(''); setFSentCode(''); setFNew(''); setFConfirm(''); setFDone(false);
    if (m === 'signup' && email === 'prathmesh.nakate@ssg.com') setEmail('');
    if (m === 'forgot' && !fEmail) setFEmail(email === 'prathmesh.nakate@ssg.com' ? '' : email);
  };

  const submitForgotRequest = async (e) => {
    e.preventDefault();
    setError(''); setNotice('');
    setBusy(true);
    try {
      const data = await api.forgotPassword(fEmail.trim());
      setFSentCode(data.resetCode || '');
      setFStep(2);
      setNotice('Reset code issued — valid for 15 minutes.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError(''); setNotice('');
    if (String(fNew).length < 8) { setError('New password must be at least 8 characters'); return; }
    if (fNew !== fConfirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    try {
      await api.resetPassword(fEmail.trim(), fCode.trim(), fNew);
      setFDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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
        {isForgot ? (
          <div className="card login-card">
            <div className="brand big"><span className="mark">₹</span> FinTrack</div>
            <h2>Reset password</h2>
            {fDone ? (
              <div>
                <p>Your password has been reset. All other sessions were logged out.</p>
                <button className="btn primary" style={{ width: '100%', padding: '11px' }} onClick={() => { setEmail(fEmail); switchMode('login'); }}>
                  Back to log in →
                </button>
              </div>
            ) : fStep === 1 ? (
              <form onSubmit={submitForgotRequest}>
                <p className="muted small" style={{ margin: '0 0 4px' }}>Enter your account email — we will issue a 6-digit reset code.</p>
                <label>Email address
                  <input className="input" type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} required autoComplete="username" placeholder="you@example.com" />
                </label>
                {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
                {notice && <div className="success" style={{ marginTop: 12 }}>{notice}</div>}
                <button className="btn primary" style={{ width: '100%', marginTop: 16, padding: '11px' }} type="submit" disabled={busy}>
                  {busy ? 'Issuing code…' : 'Send reset code →'}
                </button>
              </form>
            ) : (
              <form onSubmit={submitReset}>
                <p className="muted small" style={{ margin: '0 0 4px' }}>Code sent for <b>{fEmail}</b>. It expires in 15 minutes.</p>
                {fSentCode && (
                  <div className="success" style={{ marginTop: 8 }}>
                    Your reset code: <b style={{ fontSize: 18, letterSpacing: 2 }}>{fSentCode}</b>
                    <div className="muted small">No email service is configured, so the code is shown here instead.</div>
                  </div>
                )}
                <label>6-digit code
                  <input className="input" type="text" inputMode="numeric" value={fCode} onChange={(e) => setFCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required placeholder="123456" />
                </label>
                <label>New password
                  <input className="input" type={show ? 'text' : 'password'} value={fNew} onChange={(e) => setFNew(e.target.value)} required autoComplete="new-password" placeholder="••••••••" minLength={8} />
                </label>
                <label>Confirm new password
                  <input className="input" type={show ? 'text' : 'password'} value={fConfirm} onChange={(e) => setFConfirm(e.target.value)} required autoComplete="new-password" placeholder="••••••••" />
                </label>
                {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
                <button className="btn primary" style={{ width: '100%', marginTop: 16, padding: '11px' }} type="submit" disabled={busy}>
                  {busy ? 'Resetting…' : 'Reset password →'}
                </button>
                <p className="muted small" style={{ textAlign: 'center' }}>
                  <button type="button" className="link-btn" onClick={() => { setFStep(1); setError(''); }}>← Use a different email</button>
                </p>
              </form>
            )}
            <p className="muted small" style={{ textAlign: 'center' }}>
              <button type="button" className="link-btn" onClick={() => switchMode('login')}>Back to log in</button>
            </p>
          </div>
        ) : (
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
              <>Already have an account? <button type="button" className="link-btn" onClick={() => switchMode('login')}>Log in</button></>
            ) : (
              <>New to FinTrack? <button type="button" className="link-btn" onClick={() => switchMode('signup')}>Create an account</button></>
            )}
          </p>
          {!isSignup && (
            <p className="muted small" style={{ textAlign: 'center' }}>
              <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>Forgot password?</button>
            </p>
          )}
          <p className="muted small" style={{ textAlign: 'center' }}>Protected by rate-limited auth &amp; scrypt password hashing.</p>
        </form>
        )}
      </div>
    </div>
  );
}
