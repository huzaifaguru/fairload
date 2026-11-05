export const num = v => Math.round(v).toLocaleString('en-US');
export const pct = (v, d = 1) => (v * 100).toFixed(d) + '%';
export const signed = (v, f = num) => {
  const t = f(Math.abs(v));
  if (/^[0.]*$/.test(t)) return t; // no sign on a value that rounds to zero
  return (v > 0 ? '+' : '−') + t;
};
export const BINS = [
  { max: 0.5, color: '#C8401A', label: 'Below 50%' },
  { max: 0.7, color: '#E9A23B', label: '50–70%' },
  { max: 0.85, color: '#4DBB88', label: '70–85%' },
  { max: Infinity, color: '#00734A', label: '85% or more' },
];
export const binOf = c => BINS.find(b => c < b.max);
