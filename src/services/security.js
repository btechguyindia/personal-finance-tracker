// Security helpers — pure functions shared by server.js and tests.
// Token hashing itself uses Node crypto and lives in server.js; everything
// here is dependency-free and safe to import anywhere.
export const SECURITY_EVENT_CAP = 300;

// Keep newest `cap` entries (input oldest-first) — used for security events,
// and the same shape works for any per-user capped log.
export function capList(list, cap = SECURITY_EVENT_CAP) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length <= cap) return arr;
  return arr.slice(arr.length - cap);
}

// Coarse, honest device label from a User-Agent string. Never guesses
// location or precise identity; unknown input → 'Unknown device'.
export function coarseDevice(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  const lower = s.toLowerCase();
  let browser = null;
  if (lower.includes('edg/') || lower.includes('edge/')) browser = 'Edge';
  else if (lower.includes('opr/') || lower.includes('opera')) browser = 'Opera';
  else if (lower.includes('firefox/') || lower.includes('fxios/')) browser = 'Firefox';
  else if (lower.includes('crios/')) browser = 'Chrome (iOS)';
  else if (lower.includes('chrome/')) browser = 'Chrome';
  else if (lower.includes('safari/') && lower.includes('version/')) browser = 'Safari';
  else if (lower.includes('safari/')) browser = 'Safari (in-app/webview)';
  let os = null;
  if (lower.includes('iphone') || lower.includes('ipad')) os = 'iOS';
  else if (lower.includes('android')) os = 'Android';
  else if (lower.includes('windows nt')) os = 'Windows';
  else if (lower.includes('mac os x') || lower.includes('macintosh')) os = 'macOS';
  else if (lower.includes('linux')) os = 'Linux';
  if (browser && os) return `${browser} · ${os}`;
  if (browser) return browser;
  if (/^[a-z0-9 .;/()_+-]{1,120}$/i.test(s)) return `Other · ${s.slice(0, 40)}`;
  return 'Unknown device';
}

export const SECURITY_EVENT_KINDS = [
  'login', 'login_failed', 'logout', 'password_changed', 'password_reset',
  'session_revoked', 'sessions_revoked_others', 'deletion_failed', 'data_wiped'
];
