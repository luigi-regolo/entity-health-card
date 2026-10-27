/**
 * Entity Health Card — Home Assistant dashboard card.
 * Copyright (c) 2026 luigi-regolo. SPDX-License-Identifier: GPL-3.0-only.
 * No telemetry, remote scripts, external assets, or credentials. Read-only: never sends commands.
 */
const EH_TAG = 'entity-health-card';
const EH_EDITOR_TAG = 'entity-health-card-editor';
const EH_DEFAULT_EXCLUDED = Object.freeze(['update', 'button', 'scene']);
const EH_DEFAULTS = Object.freeze({
  title: 'Salute entità', eyebrow: 'Monitoraggio', theme_mode: 'auto', mode: 'all',
  entities: [], exclude_domains: EH_DEFAULT_EXCLUDED, include_hidden: false,
  show_unavailable: true, show_unknown: true, max_rows: 4, show_entity_id: true, group_details: true,
});
const EH_LABEL = Object.freeze({ unavailable: 'Non disponibile', unknown: 'Sconosciuto', missing: 'Non trovata' });
const EH_ICON = Object.freeze({ unavailable: 'alert-circle-outline', unknown: 'help-circle-outline', missing: 'link-variant-off' });
const EH_ORDER = Object.freeze({ unavailable: 0, missing: 1, unknown: 2 });

function ehText(value, max = 100) { return String(value ?? '').trim().slice(0, max); }
function ehEsc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ehEntityId(value) {
  const id = ehText(value, 160).toLowerCase();
  return /^[a-z0-9_]+\.[a-z0-9_]+$/.test(id) ? id : '';
}
function ehDomain(id) { return String(id).split('.')[0]; }
function ehConfig(raw = {}) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const entities = [];
  if (Array.isArray(r.entities)) {
    for (const item of r.entities) {
      const id = ehEntityId(item && typeof item === 'object' ? item.entity : item);
      if (id && !entities.includes(id) && entities.length < 500) entities.push(id);
    }
  }
  let excluded = [...EH_DEFAULT_EXCLUDED];
  if (Array.isArray(r.exclude_domains)) {
    excluded = [];
    for (const d of r.exclude_domains) {
      const dom = ehText(d, 60).toLowerCase();
      if (/^[a-z0-9_]+$/.test(dom) && !excluded.includes(dom) && excluded.length < 50) excluded.push(dom);
    }
  }
  let showUnavailable = r.show_unavailable !== false;
  let showUnknown = r.show_unknown !== false;
  // At least one state must be monitored, otherwise the card would silently report nothing.
  if (!showUnavailable && !showUnknown) { showUnavailable = true; showUnknown = true; }
  const rows = Number(r.max_rows);
  return {
    type: 'custom:entity-health-card',
    title: ehText(r.title ?? EH_DEFAULTS.title, 60),
    eyebrow: ehText(r.eyebrow ?? EH_DEFAULTS.eyebrow, 60),
    theme_mode: ['auto', 'light', 'dark'].includes(r.theme_mode) ? r.theme_mode : 'auto',
    mode: r.mode === 'manual' ? 'manual' : 'all',
    entities,
    exclude_domains: excluded,
    include_hidden: r.include_hidden === true,
    show_unavailable: showUnavailable,
    show_unknown: showUnknown,
    max_rows: Number.isInteger(rows) ? Math.max(1, Math.min(10, rows)) : EH_DEFAULTS.max_rows,
    show_entity_id: r.show_entity_id !== false,
    group_details: r.group_details !== false,
  };
}
function ehStatus(entity) {
  if (!entity) return 'missing';
  if (entity.state === 'unavailable') return 'unavailable';
  if (entity.state === 'unknown') return 'unknown';
  return 'ok';
}
function ehSince(iso, now = Date.now()) {
  if (typeof iso !== 'string') return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms > now + 60000) return '';
  const min = Math.floor(Math.max(0, now - ms) / 60000);
  if (min < 1) return 'da meno di 1 min';
  if (min < 60) return `da ${min} min`;
  if (min < 1440) return `da ${Math.floor(min / 60)} h`;
  return `da ${Math.floor(min / 1440)} g`;
}
function ehHumanize(value) {
  const t = String(value).replace(/_/g, ' ');
  return t.length <= 3 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1);
}
/** Returns null until Home Assistant has provided its states; never invents data. */
function ehCollect(config, hass) {
  const states = hass && hass.states;
  if (!states || typeof states !== 'object') return null;
  const registry = hass.entities && typeof hass.entities === 'object' ? hass.entities : null;
  let ids;
  if (config.mode === 'manual') ids = config.entities;
  else {
    const excluded = new Set(config.exclude_domains);
    ids = Object.keys(states).filter(id => !excluded.has(ehDomain(id)) && (config.include_hidden || !registry || !registry[id] || registry[id].hidden !== true));
  }
  const counts = { unavailable: 0, unknown: 0, missing: 0 };
  const problems = [];
  for (const id of ids) {
    const entity = states[id];
    const status = ehStatus(entity);
    if (status === 'ok') continue;
    counts[status]++;
    if (status === 'unavailable' && !config.show_unavailable) continue;
    if (status === 'unknown' && !config.show_unknown) continue;
    const platform = registry && registry[id] && typeof registry[id].platform === 'string' ? registry[id].platform : '';
    const friendly = entity && entity.attributes && typeof entity.attributes.friendly_name === 'string' ? entity.attributes.friendly_name : '';
    problems.push({ id, status, name: ehText(friendly, 80) || id, since: entity ? entity.last_changed : null, platform, domain: ehDomain(id) });
  }
  problems.sort((a, b) => (EH_ORDER[a.status] - EH_ORDER[b.status]) || a.name.localeCompare(b.name, 'it'));
  const monitored = ids.length;
  const withValue = monitored - counts.unavailable - counts.unknown - counts.missing;
  return { monitored, counts, withValue, problems };
}
/** Groups by integration when the registry exposes it; otherwise by domain (always derivable from the entity id). */
function ehGroups(problems) {
  const byPlatform = problems.some(p => p.platform);
  const map = new Map();
  for (const p of problems) {
    const key = byPlatform ? (p.platform || '\u0000') : p.domain;
    const label = byPlatform ? (p.platform ? ehHumanize(p.platform) : 'Altre') : p.domain;
    if (!map.has(key)) map.set(key, { label, items: [] });
    map.get(key).items.push(p);
  }
  return [...map.values()].sort((a, b) => (a.label === 'Altre') - (b.label === 'Altre') || a.label.localeCompare(b.label, 'it'));
}
const ehIcon = (name) => `<ha-icon icon="mdi:${name}" aria-hidden="true"></ha-icon>`;
function ehRowHTML(p, cfg, asButton = false, index = 0) {
  const warn = p.status === 'unavailable';
  const open = asButton ? `<button type="button" class="eh-row" data-open="1" data-focus="row:${index}">` : '<div class="eh-row">';
  const close = asButton ? '</button>' : '</div>';
  const since = ehSince(p.since);
  return `${open}<span class="eh-ico ${warn ? '' : 'eh-neutral'}">${ehIcon(EH_ICON[p.status])}</span>` +
    `<span class="eh-info"><span class="eh-name">${ehEsc(p.name)}</span>${cfg.show_entity_id && p.name !== p.id ? `<span class="eh-eid">${ehEsc(p.id)}</span>` : ''}</span>` +
    `<span class="eh-st"><span class="eh-badge ${warn ? '' : 'eh-neutral'}">${EH_LABEL[p.status]}</span>${since ? `<span class="eh-since">${ehEsc(since)}</span>` : ''}</span>${close}`;
}
const EH_STYLE = `
:host{display:block;box-sizing:border-box;color:var(--primary-text-color,#18221c);font-family:var(--ha-font-family-body,var(--paper-font-body1_-_font-family,Roboto,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif));font-size:14px}
*,*:before,*:after{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer}
ha-icon{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;--mdc-icon-size:20px;width:20px;height:20px}
.eh-theme{--eh-accent:#0a7156;--eh-muted:#56675c;--eh-surface:#f0f2ef;--eh-circle:#fff;--eh-border:#e0e5df;--eh-bg:#fafbf9;--eh-fg:#18221c;--eh-warn-bg:#f9f3de;--eh-warn-bd:#d3bd63;--eh-warn-fg:#5f4a10;--eh-btn-fg:var(--eh-accent)}
.eh-theme.eh-dark{--eh-accent:#0e795d;--eh-muted:#bbc5bd;--eh-surface:#191c1a;--eh-circle:#282b29;--eh-border:#2b302c;--eh-bg:#101211;--eh-fg:#f5f7f4;--eh-warn-bg:#302b1b;--eh-warn-bd:#816e31;--eh-warn-fg:#f1d78b;--eh-btn-fg:var(--eh-fg)}
.eh-host{container:eh-card/inline-size;min-width:0;width:100%}
.eh-root{background:var(--eh-bg);color:var(--eh-fg);border:1px solid var(--eh-border);border-radius:26px;padding:18px;min-width:0}
.eh-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.eh-head>div{min-width:0}
.eh-eyebrow{font-size:10px;letter-spacing:1.7px;font-weight:750;color:var(--eh-muted);text-transform:uppercase}
.eh-title{margin:7px 0 0;font-size:25px;line-height:1.14;font-weight:780;letter-spacing:-.7px;overflow-wrap:anywhere}.eh-title b{color:var(--eh-accent);font-weight:800}
.eh-status{flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:var(--eh-warn-bg);color:var(--eh-warn-fg);box-shadow:inset 0 0 0 1px var(--eh-warn-bd)}
.eh-status ha-icon{--mdc-icon-size:22px;width:22px;height:22px}
.eh-status.eh-ok{background:color-mix(in srgb,var(--eh-accent) 14%,transparent);color:var(--eh-btn-fg);box-shadow:none}
.eh-status.eh-neutral{background:var(--eh-circle);color:var(--eh-muted);box-shadow:inset 0 0 0 1px var(--eh-border)}
.eh-summary{display:grid;grid-template-columns:repeat(var(--eh-tiles,3),minmax(0,1fr));gap:8px;margin-top:14px}
.eh-tile{background:var(--eh-surface);border-radius:16px;padding:10px 12px;min-width:0}
.eh-tile .n{font-size:22px;font-weight:700;line-height:1.1}.eh-tile .l{font-size:11.5px;color:var(--eh-muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eh-tile.eh-warn .n{color:var(--eh-warn-fg)}.eh-tile.eh-good .n{color:var(--eh-btn-fg)}
.eh-list{display:grid;gap:8px;margin-top:14px}
.eh-row{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:10px;align-items:center;background:var(--eh-surface);border:0;border-radius:16px;padding:10px 12px;min-width:0;width:100%;text-align:left}
button.eh-row:hover{box-shadow:inset 0 0 0 1px var(--eh-accent)}
.eh-ico{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--eh-warn-bg);color:var(--eh-warn-fg);box-shadow:inset 0 0 0 1px var(--eh-warn-bd)}
.eh-ico.eh-neutral,.eh-badge.eh-neutral{background:var(--eh-circle);color:var(--eh-muted);box-shadow:inset 0 0 0 1px var(--eh-border)}
.eh-info{min-width:0;display:block}.eh-name{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eh-eid{display:block;font-size:11.5px;color:var(--eh-muted);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.eh-st{text-align:right}.eh-badge{display:inline-block;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--eh-warn-bg);color:var(--eh-warn-fg);box-shadow:inset 0 0 0 1px var(--eh-warn-bd);white-space:nowrap}
.eh-since{display:block;font-size:11px;color:var(--eh-muted);margin-top:3px}
.eh-more{font-size:12.5px;color:var(--eh-muted);margin:2px 4px 0}
.eh-msg{display:grid;grid-template-columns:36px minmax(0,1fr);gap:10px;align-items:center;background:var(--eh-surface);border-radius:16px;padding:10px 12px}
.eh-msg .eh-name{white-space:normal}.eh-msg .eh-eid{font-family:inherit;white-space:normal}
.eh-ico.eh-ok{background:color-mix(in srgb,var(--eh-accent) 14%,transparent);color:var(--eh-btn-fg);box-shadow:none}
.eh-foot{margin-top:14px}
.eh-details{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:44px;padding:10px 14px;border-radius:999px;font-weight:600;font-size:13.5px;border:1px solid color-mix(in srgb,var(--eh-accent) 45%,transparent);background:color-mix(in srgb,var(--eh-accent) 12%,transparent);color:var(--eh-btn-fg)}
.eh-details:hover{background:color-mix(in srgb,var(--eh-accent) 22%,transparent)}.eh-details ha-icon{--mdc-icon-size:18px;width:18px;height:18px}
.eh-details:focus-visible,.eh-row:focus-visible,.eh-x:focus-visible,.eh-chip:focus-visible{outline:2px solid var(--eh-accent);outline-offset:2px}
.eh-overlay{position:fixed;inset:0;z-index:9999;background:#0009;display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
.eh-modal{width:min(390px,100%);max-height:min(88vh,680px);display:flex;flex-direction:column;background:var(--eh-bg);color:var(--eh-fg);border:1px solid var(--eh-border);border-radius:26px;overflow:hidden;box-shadow:0 18px 60px #0005}
.eh-mhead{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 16px 12px 18px;background:var(--eh-bg);border-bottom:1px solid var(--eh-border)}
.eh-mhead .eh-title{font-size:20px;margin-top:5px}
.eh-modal .eh-row{grid-template-columns:36px minmax(0,1fr)}.eh-modal .eh-st{grid-column:2;text-align:left;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.eh-modal .eh-since{display:inline;margin-top:0}
.eh-x{flex:none;width:40px;height:40px;border-radius:50%;border:1px solid var(--eh-border);background:var(--eh-surface);color:var(--eh-fg);display:grid;place-items:center;padding:0}
.eh-mbody{overflow-y:auto;overscroll-behavior:contain;padding:12px 18px 18px;min-width:0}
.eh-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.eh-chip{font-size:12.5px;padding:6px 11px;border-radius:999px;border:1px solid var(--eh-border);background:var(--eh-surface);min-height:32px}
.eh-chip[aria-pressed="true"]{background:color-mix(in srgb,var(--eh-accent) 14%,transparent);border-color:var(--eh-accent);color:var(--eh-btn-fg);font-weight:600}
.eh-gh{display:flex;justify-content:space-between;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--eh-muted);font-weight:600;margin:14px 2px 6px}.eh-gh:first-of-type{margin-top:4px}
.eh-note{margin-top:16px;font-size:12px;color:var(--eh-muted);line-height:1.5}
@container eh-card (max-width:420px){
  .eh-root{padding:13px;border-radius:23px}.eh-title{font-size:23px}.eh-summary{--eh-tiles:3;gap:6px}
  .eh-summary.eh-four{grid-template-columns:repeat(2,minmax(0,1fr))}
  .eh-row{grid-template-columns:36px minmax(0,1fr)}.eh-st{grid-column:2;text-align:left;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.eh-since{display:inline;margin-top:0}
  .eh-tile{padding:8px 10px}.eh-tile .n{font-size:19px}
}
@container eh-card (max-width:340px){.eh-tile .l{font-size:10.5px;white-space:normal;overflow:visible;line-height:1.25}.eh-status{display:none}}
@container eh-card (max-width:280px){.eh-summary{grid-template-columns:1fr}}
@media(prefers-reduced-motion:no-preference){.eh-details{transition:background .15s}}
`;
class EntityHealthCard extends HTMLElement {
  static getStubConfig() { return ehConfig(); }
  static getConfigElement() { return document.createElement(EH_EDITOR_TAG); }
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = ehConfig(); this._hass = null;
    this._open = false; this._filter = 'all'; this._last = ''; this._openerKey = ''; this._pendingFocus = '';
    this.shadowRoot.addEventListener('click', event => this._click(event));
    this._onKey = event => this._key(event);
    this._onAppearance = () => this._paint();
    this._media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme:dark)') : null;
  }
  connectedCallback() {
    this._media?.addEventListener?.('change', this._onAppearance);
    this._last = ''; this._paint();
  }
  disconnectedCallback() {
    this._media?.removeEventListener?.('change', this._onAppearance);
    document.removeEventListener('keydown', this._onKey);
  }
  setConfig(raw) { this._config = ehConfig(raw); this._open = false; this._filter = 'all'; this._last = ''; this._paint(); }
  set hass(hass) { this._hass = hass; this._paint(); }
  getCardSize() { return 4 + Math.min(this._config.max_rows, 4); }
  _isDark() {
    const mode = this._config.theme_mode;
    return mode === 'dark' || (mode === 'auto' && (this._hass?.themes?.darkMode === true || (!this._hass?.themes && this._media?.matches === true)));
  }
  _activeKey() {
    const el = this.shadowRoot.activeElement;
    return el && el.getAttribute ? (el.getAttribute('data-focus') || '') : '';
  }
  _paint() {
    if (!this.shadowRoot || !this.isConnected) return;
    const data = ehCollect(this._config, this._hass);
    const dark = this._isDark();
    const sig = JSON.stringify([this._config, data && [data.monitored, data.counts, data.problems.map(p => [p.id, p.status, p.since, p.name])], dark, this._open, this._filter, Math.floor(Date.now() / 60000)]);
    if (sig === this._last) return;
    this._last = sig;
    const scroll = this.shadowRoot.querySelector('.eh-mbody')?.scrollTop || 0;
    const want = this._pendingFocus || this._activeKey();
    this._pendingFocus = '';
    this.shadowRoot.innerHTML = `<style>${EH_STYLE}</style><div class="eh-theme ${dark ? 'eh-dark' : 'eh-light'}">${this._card(data)}${this._open && data ? this._popup(data) : ''}</div>`;
    const body = this.shadowRoot.querySelector('.eh-mbody');
    if (body) body.scrollTop = scroll;
    if (want) this.shadowRoot.querySelector(`[data-focus="${want}"]`)?.focus({ preventScroll: true });
  }
  _card(data) {
    const c = this._config;
    let icon = 'help-circle-outline', cls = 'eh-neutral', body, foot = '';
    if (!data) {
      body = '<div class="eh-list"><div class="eh-msg"><span class="eh-ico eh-neutral">' + ehIcon('help-circle-outline') + '</span><div><span class="eh-name">In attesa dei dati di Home Assistant</span></div></div></div>';
    } else if (data.monitored === 0) {
      const text = c.mode === 'manual' ? 'Nessuna entità selezionata. Aggiungine dall’editor.' : 'Nessuna entità da monitorare con le esclusioni attuali.';
      body = `<div class="eh-list"><div class="eh-msg"><span class="eh-ico eh-neutral">${ehIcon('help-circle-outline')}</span><div><span class="eh-name">Nessuna entità monitorata</span><span class="eh-eid">${ehEsc(text)}</span></div></div></div>`;
    } else {
      const tiles = [];
      if (c.show_unavailable) tiles.push(['Non disponibili', data.counts.unavailable, data.counts.unavailable ? 'eh-warn' : '']);
      if (c.show_unknown) tiles.push(['Sconosciute', data.counts.unknown, '']);
      if (data.counts.missing) tiles.push(['Non trovate', data.counts.missing, 'eh-warn']);
      tiles.push(['Con valore', data.withValue, 'eh-good']);
      const summary = `<div class="eh-summary ${tiles.length > 3 ? 'eh-four' : ''}" style="--eh-tiles:${tiles.length}">${tiles.map(t => `<div class="eh-tile ${t[2]}"><div class="n">${t[1]}</div><div class="l">${t[0]}</div></div>`).join('')}</div>`;
      let list;
      if (data.problems.length) {
        icon = 'alert-circle-outline'; cls = '';
        const shown = data.problems.slice(0, c.max_rows);
        list = `<div class="eh-list">${shown.map((p, i) => ehRowHTML(p, c, true, i)).join('')}${data.problems.length > shown.length ? `<div class="eh-more">+ altre ${data.problems.length - shown.length} nel dettaglio</div>` : ''}</div>`;
      } else {
        const all = data.withValue === data.monitored;
        icon = all ? 'check-circle-outline' : 'help-circle-outline'; cls = all ? 'eh-ok' : 'eh-neutral';
        list = `<div class="eh-list"><div class="eh-msg"><span class="eh-ico ${all ? 'eh-ok' : 'eh-neutral'}">${ehIcon(icon)}</span><div><span class="eh-name">Nessuna entità da verificare</span><span class="eh-eid">${all ? `Tutte le ${data.monitored} entità monitorate hanno un valore.` : 'Controllo limitato agli stati selezionati nella configurazione.'}</span></div></div></div>`;
      }
      body = summary + list;
      foot = `<div class="eh-foot"><button type="button" class="eh-details" data-open="1" data-focus="details">Dettagli e stato ${ehIcon('chevron-right')}</button></div>`;
    }
    return `<div class="eh-host"><section class="eh-root" aria-labelledby="eh-t"><div class="eh-head"><div><div class="eh-eyebrow">${ehEsc(c.eyebrow)}</div><h2 class="eh-title" id="eh-t">${ehEsc(c.title)}<b>.</b></h2></div><div class="eh-status ${cls}" aria-hidden="true">${ehIcon(icon)}</div></div>${body}${foot}</section></div>`;
  }
  _popup(data) {
    const c = this._config;
    const counts = { all: data.problems.length, unavailable: 0, unknown: 0, missing: 0 };
    data.problems.forEach(p => { counts[p.status]++; });
    const defs = [['all', 'Tutte']];
    if (c.show_unavailable) defs.push(['unavailable', 'Non disponibili']);
    if (c.show_unknown) defs.push(['unknown', 'Sconosciute']);
    if (counts.missing) defs.push(['missing', 'Non trovate']);
    const filter = defs.some(d => d[0] === this._filter) ? this._filter : 'all';
    const chips = defs.map(d => `<button type="button" class="eh-chip" data-f="${d[0]}" data-focus="chip:${d[0]}" aria-pressed="${filter === d[0]}">${d[1]} (${counts[d[0]]})</button>`).join('');
    const items = data.problems.filter(p => filter === 'all' || p.status === filter);
    let list;
    if (!items.length) {
      list = `<div class="eh-msg"><span class="eh-ico eh-ok">${ehIcon('check-circle-outline')}</span><div><span class="eh-name">Nessuna entità in questo elenco</span></div></div>`;
    } else if (c.group_details) {
      list = ehGroups(items).map(g => `<div class="eh-gh"><span>${ehEsc(g.label)}</span><span>${g.items.length}</span></div><div class="eh-list" style="margin-top:0">${g.items.map(p => ehRowHTML(p, c)).join('')}</div>`).join('');
    } else {
      list = `<div class="eh-list" style="margin-top:0">${items.map(p => ehRowHTML(p, c)).join('')}</div>`;
    }
    return `<div class="eh-overlay" data-backdrop="1"><div class="eh-modal" role="dialog" aria-modal="true" aria-labelledby="eh-mt"><div class="eh-mhead"><div><div class="eh-eyebrow">Elenco entità</div><h2 class="eh-title" id="eh-mt">Da verificare<b>.</b></h2></div><button class="eh-x" type="button" data-close="1" data-focus="close" aria-label="Chiudi">${ehIcon('close')}</button></div><div class="eh-mbody"><div class="eh-chips">${chips}</div>${list}<p class="eh-note">«Non disponibile» significa che Home Assistant non riesce a leggere il valore dell’entità: non implica che il dispositivo sia spento. «Sconosciuto» indica che l’entità esiste ma non ha ancora un valore.${counts.missing ? ' «Non trovata» indica un’entità selezionata che non esiste più in Home Assistant.' : ''}</p></div></div></div>`;
  }
  _openPopup(key) {
    this._openerKey = key || 'details'; this._open = true; this._filter = 'all'; this._pendingFocus = 'close'; this._last = '';
    document.addEventListener('keydown', this._onKey); this._paint();
  }
  _closePopup() {
    if (!this._open) return;
    this._open = false; this._pendingFocus = this._openerKey || 'details'; this._last = '';
    document.removeEventListener('keydown', this._onKey); this._paint();
  }
  _key(event) {
    if (!this._open) return;
    if (event.key === 'Escape') { this._closePopup(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...this.shadowRoot.querySelectorAll('.eh-modal button')];
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1], active = this.shadowRoot.activeElement;
    if (event.shiftKey && (active === first || !active)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !active)) { event.preventDefault(); first.focus(); }
  }
  _click(event) {
    const t = event.target;
    if (!t || !t.closest) return;
    if (t.dataset && t.dataset.backdrop === '1') { this._closePopup(); return; }
    if (t.closest('[data-close]')) { this._closePopup(); return; }
    const chip = t.closest('[data-f]');
    if (chip) { this._filter = chip.dataset.f; this._pendingFocus = `chip:${chip.dataset.f}`; this._last = ''; this._paint(); return; }
    const open = t.closest('[data-open]');
    if (open) this._openPopup(open.dataset.focus);
  }
}
const EH_EDITOR_CSS = `
:host{display:block;color:var(--primary-text-color,#18221c);font-family:var(--ha-font-family-body,Roboto,Arial,sans-serif);font-size:var(--ha-font-size-m,14px)}
*,*:before,*:after{box-sizing:border-box}
.eh-tabs{display:flex;gap:5px;overflow-x:auto;padding-bottom:14px;border-bottom:1px solid var(--divider-color,#dfe5df)}
.eh-tab{border:0;background:none;color:var(--secondary-text-color,#536359);border-radius:13px;padding:10px 13px;white-space:nowrap;font:inherit;cursor:pointer}
.eh-tab.active{color:var(--primary-text-color,#17231c);background:var(--secondary-background-color,#f0f2ef);font-weight:650}
.eh-heading{font-size:21px;font-weight:500;margin:25px 0 9px}.eh-desc{color:var(--secondary-text-color,#55665a);font-size:13px;line-height:1.5;margin-bottom:22px}
.eh-sub{font-size:11px;letter-spacing:1.2px;font-weight:700;text-transform:uppercase;color:var(--secondary-text-color,#55665a);margin:24px 0 4px}
.eh-field{display:block;margin:20px 0}.eh-label{font-size:14px;margin-bottom:10px}
.eh-input{display:block;width:100%;background:var(--secondary-background-color,#f0f2ef);color:var(--primary-text-color,#18221c);border:0;border-bottom:1px solid var(--divider-color,#a5afa5);padding:14px 13px;min-height:50px;border-radius:11px 11px 0 0;font:inherit}
.eh-row{border-bottom:1px solid var(--divider-color,#e3e7e3);padding:13px 0;display:flex;align-items:center;justify-content:space-between;gap:15px}
.eh-row label{flex:1}.eh-row input[type=checkbox]{width:18px;height:18px;accent-color:var(--primary-color,#0c7157)}
.eh-muted{font-size:12px;line-height:1.5;color:var(--secondary-text-color,#5e6c62)}
.eh-action{background:var(--secondary-background-color,#eff2ee);border:1px solid var(--divider-color,#dbe2db);color:var(--primary-text-color,#18221c);padding:10px 14px;border-radius:14px;font:inherit;cursor:pointer}
.eh-slot{display:flex;align-items:center;gap:8px;min-width:0;margin:12px 0}.eh-slot-grow{flex:1;min-width:0}
.eh-clear{display:flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;background:var(--secondary-background-color,#eef1ef);border:1px solid var(--divider-color,#dfe5df);border-radius:50%;cursor:pointer;color:var(--secondary-text-color,#57655c);padding:0}
.eh-editor ha-selector{display:block;width:100%}.eh-fallback{display:none}.eh-no-native .eh-fallback{display:block}.eh-no-native ha-selector{display:none}
.eh-input:focus-visible,.eh-action:focus-visible,.eh-tab:focus-visible,.eh-clear:focus-visible{outline:2px solid var(--primary-color,#0b7457);outline-offset:2px}
`;
class EntityHealthCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = ehConfig(); this._hass = null; this._tab = 'entita'; this._slots = []; this._nativeTried = false;
    this.shadowRoot.addEventListener('click', e => this._click(e));
    this.shadowRoot.addEventListener('change', e => this._change(e));
  }
  set hass(hass) { this._hass = hass; this.shadowRoot.querySelectorAll('ha-selector').forEach(el => { el.hass = hass; }); }
  setConfig(raw) {
    const config = ehConfig(raw);
    const same = JSON.stringify(config) === JSON.stringify(this._config);
    if (same && this.shadowRoot.querySelector('.eh-editor')) return;
    this._config = config;
    if (JSON.stringify(this._slots.filter(Boolean)) !== JSON.stringify(config.entities)) this._slots = [...config.entities];
    this._render();
  }
  connectedCallback() { if (!this._slots.length) this._slots = [...this._config.entities]; this._render(); this._ensureNative(); }
  async _ensureNative() {
    if (this._nativeTried) return;
    this._nativeTried = true;
    if (!customElements.get('ha-selector')) {
      try { const helper = await window.loadCardHelpers?.(); await helper?.importSelector?.(); }
      catch { /* The native selector is optional: a text field is used instead. */ }
    }
    this._render();
  }
  _emit() { this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true })); }
  _update(patch) { this._config = ehConfig({ ...this._config, ...patch }); this._emit(); this._render(); }
  _sync() { this._update({ entities: this._slots.filter(Boolean) }); }
  _field(label, inner, help = '') { return `<div class="eh-field"><div class="eh-label">${ehEsc(label)}</div>${inner}${help ? `<div class="eh-muted" style="margin-top:8px">${ehEsc(help)}</div>` : ''}</div>`; }
  _input(key, label, value) { return this._field(label, `<input class="eh-input" type="text" maxlength="60" data-key="${key}" value="${ehEsc(value)}"/>`); }
  _select(key, label, options, value) { return this._field(label, `<select class="eh-input" data-key="${key}">${options.map(([v, l]) => `<option value="${v}" ${String(value) === String(v) ? 'selected' : ''}>${ehEsc(l)}</option>`).join('')}</select>`); }
  _check(attr, id, label, checked, help = '') { return `<div class="eh-row"><label for="eh-${id}">${label}${help ? `<div class="eh-muted">${ehEsc(help)}</div>` : ''}</label><input id="eh-${id}" type="checkbox" ${attr} ${checked ? 'checked' : ''}/></div>`; }
  _render() {
    if (!this.isConnected) return;
    const c = this._config;
    const tabs = [['entita', 'Entità'], ['aspetto', 'Aspetto'], ['avanzate', 'Avanzate']];
    let body = '';
    if (this._tab === 'entita') {
      body = '<div class="eh-heading">Entità monitorate</div><div class="eh-desc">Scegli se controllare tutte le entità di Home Assistant oppure solo quelle selezionate da te.</div>' +
        this._select('mode', 'Modalità', [['all', 'Tutte le entità (con esclusioni)'], ['manual', 'Selezione manuale']], c.mode);
      if (c.mode === 'all') {
        body += '<div class="eh-sub">Esclusioni</div>' +
          EH_DEFAULT_EXCLUDED.map(d => this._check(`data-excl="${d}"`, `excl-${d}`, `Escludi <code>${d}.*</code>`, c.exclude_domains.includes(d))).join('') +
          this._check('data-key="include_hidden"', 'hidden', 'Includi entità nascoste', c.include_hidden, 'Le entità disabilitate non sono visibili alla card.');
      } else {
        body += '<div class="eh-sub">Entità selezionate</div>' + this._slots.map((v, i) =>
          `<div class="eh-slot"><div class="eh-slot-grow"><div data-slot-host="${i}"></div><div class="eh-fallback"><input class="eh-input" type="text" placeholder="sensor.esempio" data-slot="${i}" value="${ehEsc(v)}"/></div></div><button type="button" class="eh-clear" data-remove="${i}" aria-label="Rimuovi entità">✕</button></div>`).join('') +
          '<button type="button" class="eh-action" data-add="1">+ Aggiungi entità</button>';
      }
      body += '<div class="eh-sub">Stati da segnalare</div>' +
        this._check('data-key="show_unavailable"', 'unav', 'Non disponibile', c.show_unavailable) +
        this._check('data-key="show_unknown"', 'unk', 'Sconosciuto', c.show_unknown, 'Almeno uno dei due stati deve restare attivo.');
    }
    if (this._tab === 'aspetto') {
      body = '<div class="eh-heading">Aspetto Edera</div><div class="eh-desc">Tema, titolo e numero di righe mostrate nella card.</div>' +
        this._input('eyebrow', 'Intestazione superiore', c.eyebrow) + this._input('title', 'Titolo', c.title) +
        this._select('theme_mode', 'Tema', [['auto', 'Auto (Home Assistant)'], ['light', 'Light Edera'], ['dark', 'Dark Edera']], c.theme_mode) +
        this._select('max_rows', 'Righe visibili nella card', [3, 4, 5, 6, 8, 10].map(n => [n, String(n)]), c.max_rows);
    }
    if (this._tab === 'avanzate') {
      body = '<div class="eh-heading">Avanzate</div><div class="eh-desc">Opzioni del dettaglio. La card è solo in lettura: non invia comandi a Home Assistant.</div>' +
        this._check('data-key="show_entity_id"', 'eid', 'Mostra <code>entity_id</code>', c.show_entity_id) +
        this._check('data-key="group_details"', 'grp', 'Raggruppa nel dettaglio', c.group_details, 'Per integrazione, se disponibile; altrimenti per dominio.');
    }
    this.shadowRoot.innerHTML = `<style>${EH_EDITOR_CSS}</style><div class="eh-editor"><div class="eh-tabs">${tabs.map(([id, label]) => `<button type="button" class="eh-tab ${this._tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>${body}</div>`;
    this.shadowRoot.querySelector('.eh-editor').classList.toggle('eh-no-native', !customElements.get('ha-selector'));
    this._mountSelectors();
  }
  _mountSelectors() {
    if (!customElements.get('ha-selector')) return;
    this.shadowRoot.querySelectorAll('[data-slot-host]').forEach(slot => {
      const index = Number(slot.dataset.slotHost);
      const selector = document.createElement('ha-selector');
      selector.hass = this._hass; selector.selector = { entity: {} }; selector.value = this._slots[index] || '';
      selector.addEventListener('value-changed', e => {
        e.stopPropagation();
        if (!selector.isConnected || !e.detail || !Object.prototype.hasOwnProperty.call(e.detail, 'value')) return;
        this._slots[index] = ehEntityId(e.detail.value); this._sync();
      });
      slot.appendChild(selector);
    });
  }
  _click(event) {
    const t = event.target;
    if (!t || !t.closest) return;
    const tab = t.closest('[data-tab]'); if (tab) { this._tab = tab.dataset.tab; this._render(); return; }
    if (t.closest('[data-add]')) { this._slots.push(''); this._render(); return; }
    const rm = t.closest('[data-remove]'); if (rm) { this._slots.splice(Number(rm.dataset.remove), 1); this._sync(); }
  }
  _change(event) {
    const el = event.target;
    if (!el || !el.dataset) return;
    if (el.dataset.excl !== undefined) {
      const set = new Set(this._config.exclude_domains);
      if (el.checked) set.add(el.dataset.excl); else set.delete(el.dataset.excl);
      this._update({ exclude_domains: [...set] }); return;
    }
    if (el.dataset.slot !== undefined) { this._slots[Number(el.dataset.slot)] = ehEntityId(el.value); this._sync(); return; }
    const key = el.dataset.key;
    if (!key || !(key in EH_DEFAULTS)) return;
    const value = el.type === 'checkbox' ? el.checked : key === 'max_rows' ? Number(el.value) : el.value;
    this._update({ [key]: value });
  }
}
if (typeof customElements !== 'undefined') {
  if (!customElements.get(EH_TAG)) customElements.define(EH_TAG, EntityHealthCard);
  if (!customElements.get(EH_EDITOR_TAG)) customElements.define(EH_EDITOR_TAG, EntityHealthCardEditor);
}
if (typeof window !== 'undefined') {
  window.customCards = window.customCards || [];
  if (!window.customCards.some(c => c.type === EH_TAG)) window.customCards.push({ type: EH_TAG, name: 'Entity Health Card', description: 'Elenca le entità non disponibili o sconosciute, in sola lettura, con aspetto Edera.', preview: true });
}
export { ehConfig, ehStatus, ehSince, ehCollect, ehGroups, ehEntityId, ehEsc, ehRowHTML };
