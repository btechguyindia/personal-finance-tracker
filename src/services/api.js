// API client for the persistent backend (server.js). Token stored in localStorage.
const TOKEN_KEY = 'fintrack_token';
const THEME_KEY = 'fintrack_theme';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; }
}
export function setTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
}

// Conflict contract (Milestone 2): a 409 VERSION_CONFLICT means another writer
// committed first and NOTHING was written. Callers must refresh the relevant
// data and ask the user to retry deliberately — never auto-retry a request
// that could move money twice (use idempotencyKey for safe client retries).
async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    if (data && data.code) err.code = data.code;
    throw err;
  }
  return data;
}

export const api = {
  signup: (email, password, name) =>
    request('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  login: (email, password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  changePassword: (current, next) =>
    request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current, next }) }),
  forgotPassword: (email) =>
    request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (email, code, newPassword) =>
    request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, code, newPassword }) }),
  updateProfile: (patch) =>
    request('/api/auth/profile', { method: 'PUT', body: JSON.stringify(patch) }).then((d) => d.user),

  listTransactions: async () => (await request('/api/transactions')).transactions,
  createTransaction: async (tx) => (await request('/api/transactions', { method: 'POST', body: JSON.stringify(tx) })).transaction,
  updateTransaction: async (id, tx) =>
    (await request(`/api/transactions/${id}`, { method: 'PUT', body: JSON.stringify(tx) })).transaction,
  deleteTransaction: (id) => request(`/api/transactions/${id}`, { method: 'DELETE' }),

  previewImport: (rows) =>
    request('/api/import/preview', { method: 'POST', body: JSON.stringify({ rows }) }),
  confirmImport: (rows, key) =>
    request('/api/import/confirm', { method: 'POST', body: JSON.stringify({ rows, key }) }),

  getBudgets: async () => (await request('/api/budgets')).budgets,
  saveBudgets: async (budgets) =>
    (await request('/api/budgets', { method: 'PUT', body: JSON.stringify({ budgets }) })).budgets,

  getAccounts: async () => (await request('/api/accounts')).accounts,
  createAccount: async (a) => (await request('/api/accounts', { method: 'POST', body: JSON.stringify(a) })).account,
  updateAccount: async (id, a) => (await request(`/api/accounts/${id}`, { method: 'PUT', body: JSON.stringify(a) })).account,
  deleteAccount: (id) => request(`/api/accounts/${id}`, { method: 'DELETE' }),

  getCategories: async () => (await request('/api/categories')).categories,
  createCategory: async (c) => (await request('/api/categories', { method: 'POST', body: JSON.stringify(c) })).category,
  deleteCategory: (id) => request(`/api/categories/${id}`, { method: 'DELETE' }),

  getUpiIds: async () => (await request('/api/upi')).upiIds,
  addUpiId: async (upiId, accountId) =>
    (await request('/api/upi', { method: 'POST', body: JSON.stringify({ upiId, accountId }) })).upi,
  deleteUpiId: (id) => request(`/api/upi/${id}`, { method: 'DELETE' }),

  getGoals: async () => (await request('/api/goals')).goals,
  createGoal: async (g) => (await request('/api/goals', { method: 'POST', body: JSON.stringify(g) })).goal,
  updateGoal: async (id, g) =>
    (await request(`/api/goals/${id}`, { method: 'PUT', body: JSON.stringify(g) })).goal,
  getGoalActivity: async (id) => request(`/api/goals/${id}/transactions`),
  contributeGoal: (id, c) =>
    request(`/api/goals/${id}/contribute`, { method: 'POST', body: JSON.stringify(c) }),
  deleteGoal: (id) => request(`/api/goals/${id}`, { method: 'DELETE' }),

  getRecurring: async () => (await request('/api/recurring')).recurring,
  createRecurring: async (r) => request('/api/recurring', { method: 'POST', body: JSON.stringify(r) }),
  setRecurringStatus: async (id, status) =>
    (await request(`/api/recurring/${id}`, { method: 'PUT', body: JSON.stringify({ status }) })).rule,
  setRecurringAuto: async (id, autoCreate) =>
    (await request(`/api/recurring/${id}`, { method: 'PUT', body: JSON.stringify({ autoCreate }) })).rule,
  runRecurringDue: async () => request('/api/recurring/run-due', { method: 'POST', body: JSON.stringify({}) }),
  postRecurringNow: async (id) =>
    (await request(`/api/recurring/${id}/post-now`, { method: 'POST', body: JSON.stringify({}) })),
  deleteRecurring: (id) => request(`/api/recurring/${id}`, { method: 'DELETE' }),

  getAutopilotRules: async () => (await request('/api/autopilot/rules')).rules,
  createAutopilotRule: async (r) => (await request('/api/autopilot/rules', { method: 'POST', body: JSON.stringify(r) })).rule,
  updateAutopilotRule: async (id, patch) =>
    (await request(`/api/autopilot/rules/${id}`, { method: 'PUT', body: JSON.stringify(patch) })).rule,
  deleteAutopilotRule: (id) => request(`/api/autopilot/rules/${id}`, { method: 'DELETE' }),
  evaluateAutopilot: (trigger, month) =>
    request('/api/autopilot/evaluate', { method: 'POST', body: JSON.stringify({ trigger, month }) }),
  getAutopilotRuns: async (limit) => (await request(`/api/autopilot/runs?limit=${limit || 50}`)).runs,
  getNotifications: () => request('/api/notifications'),
  markNotificationRead: (id) => request(`/api/notifications/${id}/read`, { method: 'POST' }),
  approveDraft: (id) => request(`/api/autopilot/approve/${id}`, { method: 'POST' }),

  listAssets: async () => (await request('/api/assets')).assets,
  createAsset: async (a) => (await request('/api/assets', { method: 'POST', body: JSON.stringify(a) })).asset,
  updateAsset: async (id, a) => (await request(`/api/assets/${id}`, { method: 'PUT', body: JSON.stringify(a) })).asset,
  deleteAsset: (id) => request(`/api/assets/${id}`, { method: 'DELETE' }),
  addValuation: async (id, v) => (await request(`/api/assets/${id}/valuations`, { method: 'POST', body: JSON.stringify(v) })).asset,
  listLiabilities: async () => (await request('/api/liabilities')).liabilities,
  createLiability: async (l) => (await request('/api/liabilities', { method: 'POST', body: JSON.stringify(l) })).liability,
  updateLiability: async (id, l) => (await request(`/api/liabilities/${id}`, { method: 'PUT', body: JSON.stringify(l) })).liability,
  deleteLiability: (id) => request(`/api/liabilities/${id}`, { method: 'DELETE' }),
  recordLoanPayment: (id, p) => request(`/api/liabilities/${id}/payments`, { method: 'POST', body: JSON.stringify(p) }),

  getPreferences: async () => (await request('/api/preferences')).preferences,
  savePreferences: async (p) =>
    (await request('/api/preferences', { method: 'PUT', body: JSON.stringify(p) })).preferences,

  exportAll: () => request('/api/export'),
  wipeData: () => request('/api/account/data', { method: 'DELETE' }),

  downloadBackup: () => request('/api/portability/backup'),
  validatePortability: (backup) =>
    request('/api/portability/validate', { method: 'POST', body: JSON.stringify({ backup }) }),
  previewPortability: (backup, mode) =>
    request('/api/portability/preview', { method: 'POST', body: JSON.stringify({ backup, mode }) }),
  restoreBackup: (backup, opts = {}) =>
    request('/api/portability/restore', { method: 'POST', body: JSON.stringify({ backup, ...opts }) }),
  getPortabilityHistory: async () => (await request('/api/portability/history')).history,

  getSecuritySessions: async () => (await request('/api/security/sessions')).sessions,
  revokeSecuritySession: (id) => request(`/api/security/sessions/${id}/revoke`, { method: 'POST' }),
  revokeOtherSessions: () => request('/api/security/sessions/revoke-others', { method: 'POST' }),
  getSecurityEvents: async (limit) => (await request(`/api/security/events?limit=${limit || 50}`)).events,
  getSecurityOverview: () => request('/api/security/overview'),
  deleteAccount: (password, confirmation) =>
    request('/api/security/delete-account', { method: 'POST', body: JSON.stringify({ password, confirmation }) }),
};
