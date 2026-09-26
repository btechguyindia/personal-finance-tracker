// buckets.js — P1 #6 Money buckets (virtual envelopes). Pure ESM + localStorage helpers.
export const DEFAULT_BUCKETS = [
  { id: 'emergency', name: 'Emergency fund', target: 100000, color: '#ef4444' },
  { id: 'monthly', name: 'Monthly expenses', target: 40000, color: '#3b82f6' },
  { id: 'education', name: 'Education & exams', target: 50000, color: '#8b5cf6' },
  { id: 'personal', name: 'Personal spending', target: 15000, color: '#f59e0b' },
  { id: 'business', name: 'Future business', target: 200000, color: '#10b981' },
  { id: 'major', name: 'Major purchases', target: 80000, color: '#ec4899' },
];

const LS_KEY = 'fintrack_buckets_v1';
const ALLOC_KEY = 'fintrack_bucket_alloc_v1';

export function loadBuckets() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULT_BUCKETS.map((b) => ({ ...b, balance: 0 }));
}
export function saveBuckets(rows) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(rows)); } catch { /* ignore */ }
}
export function loadAllocLog() {
  try { return JSON.parse(localStorage.getItem(ALLOC_KEY) || '[]'); } catch { return []; }
}
export function saveAllocLog(rows) {
  try { localStorage.setItem(ALLOC_KEY, JSON.stringify(rows.slice(-200))); } catch { /* ignore */ }
}

// Simulate distribution of an income amount across buckets by pct or fixed rules.
// rules: [{bucketId, pct?, fixed?}] — pct of remainder or fixed ₹. Returns plan, never posts.
export function simulateAllocation(amount, rules, buckets) {
  const total = Number(amount || 0);
  const plan = [];
  let assigned = 0;
  for (const r of rules || []) {
    const b = (buckets || []).find((x) => x.id === r.bucketId);
    if (!b) continue;
    let amt = 0;
    if (Number(r.fixed) > 0) amt = Math.min(Number(r.fixed), total - assigned);
    else if (Number(r.pct) > 0) amt = Math.round(((total - assigned) * Number(r.pct)) / 100 * 100) / 100;
    amt = Math.max(0, Math.min(amt, total - assigned));
    assigned += amt;
    plan.push({ bucketId: r.bucketId, name: b.name, amount: amt });
  }
  return { total, assigned: Math.round(assigned * 100) / 100, unassigned: Math.round((total - assigned) * 100) / 100, plan };
}

// Apply plan (requires explicit confirmation by caller) → returns updated buckets + log entry.
export function applyAllocation(buckets, plan, sourceLabel = 'income') {
  const next = (buckets || []).map((b) => {
    const p = (plan || []).find((x) => x.bucketId === b.id);
    return { ...b, balance: Math.round(((Number(b.balance || 0) + (p ? Number(p.amount || 0) : 0)) * 100)) / 100 };
  });
  const entry = { at: new Date().toISOString(), source: sourceLabel, plan };
  return { buckets: next, entry };
}
