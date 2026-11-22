const paths = {
  home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-7h6v7"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7M8 13h8m-8 4h8"/>',
  stats: '<path d="M3 3v17h18M8 16v-5m5 5V6m5 10v-8"/>',
  office: '<path d="M3 21h18M6 21V5l12-2v18M9 8h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M11 4H5v16h6m3-4 4-4-4-4m-6 4h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4m-5 3h18"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  spark: '<path d="M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10z"/>',
  shield: '<path d="M12 22s7-4 7-10V5l-7-3-7 3v7c0 6 7 10 7 10z"/><path d="m9 12 2 2 4-4"/>',
  printer: '<path d="M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6z"/>',
  message: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.7-4.1A8.5 8.5 0 1 1 21 11.5z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
};

export function icon(name) {
  return `<svg aria-hidden="true" class="icon" viewBox="0 0 24 24">${paths[name] ?? paths.file}</svg>`;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

export function date(value) {
  if (!value) return '—';
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(+parsed) ? '—' : new Intl.DateTimeFormat('pl-PL', {day:'numeric', month:'short', year:'numeric'}).format(parsed);
}

export function field(name, label, value = '', {type = 'text', required = false, options = [], hint = '', disabled = false, extra = ''} = {}) {
  const id = `field-${name}`;
  const attrs = `id="${esc(id)}" name="${esc(name)}"${required ? ' required' : ''}${disabled ? ' disabled' : ''}${hint ? ` aria-describedby="${esc(id)}-hint"` : ''} ${extra}`;
  let input;
  if (type === 'textarea') input = `<textarea ${attrs}>${esc(value)}</textarea>`;
  else if (type === 'select') input = `<select ${attrs}>${options.map(option => `<option value="${esc(option.value)}"${String(option.value) === String(value ?? '') ? ' selected' : ''}>${esc(option.label)}</option>`).join('')}</select>`;
  else input = `<input type="${esc(type)}" ${attrs} value="${esc(value)}">`;
  return `<div class="field"><label for="${esc(id)}">${esc(label)}</label>${input}${hint ? `<small id="${esc(id)}-hint" class="sub">${esc(hint)}</small>` : ''}</div>`;
}

export const button = (label, action, {style = 'primary', glyph = '', value = '', disabled = false} = {}) => `<button type="button" class="btn ${style}" data-act="${esc(action)}" data-value="${esc(value)}"${disabled ? ' disabled' : ''}>${glyph ? icon(glyph) : ''}${esc(label)}</button>`;
export const submit = (label, glyph = 'check', style = 'primary') => `<button class="btn ${style}" type="submit">${glyph ? icon(glyph) : ''}${esc(label)}</button>`;
export const pill = (text, style = '') => `<span class="pill ${style}">${esc(text)}</span>`;
export const callout = (content, style = '', glyph = 'info') => `<div class="callout ${style} inline-icon">${icon(glyph)}<div>${content}</div></div>`;
export const empty = (content) => `<p class="empty">${esc(content)}</p>`;
