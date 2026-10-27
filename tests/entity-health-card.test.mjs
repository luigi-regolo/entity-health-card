import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Minimal browser stubs so the module can be imported in Node.
globalThis.HTMLElement = class {};
globalThis.customElements = { get() { return undefined; }, define() {} };
globalThis.CustomEvent = class { constructor(type, o = {}) { this.type = type; this.detail = o.detail ?? null; } };

const url = new URL('../src/entity-health-card.js', import.meta.url);
const src = fs.readFileSync(url, 'utf8');
const dist = fs.readFileSync(new URL('../dist/entity-health-card.js', import.meta.url), 'utf8');
const m = await import(url.href);

const st = (state, extra = {}) => ({ state, last_changed: '2026-01-01T00:00:00Z', attributes: {}, ...extra });

test('dist bundle matches source', () => assert.equal(dist, src));

test('safe defaults', () => {
  const c = m.ehConfig();
  assert.equal(c.mode, 'all');
  assert.deepEqual(c.exclude_domains, ['update', 'button', 'scene']);
  assert.equal(c.include_hidden, false);
  assert.equal(c.max_rows, 4);
  assert.equal(c.theme_mode, 'auto');
});

test('config normalization rejects invalid input', () => {
  const c = m.ehConfig({ theme_mode: 'neon', mode: 'x', max_rows: 99, entities: ['sensor.ok', 'bad id', '<x>.y', { entity: 'switch.a' }, 'sensor.ok'] });
  assert.equal(c.theme_mode, 'auto');
  assert.equal(c.mode, 'all');
  assert.equal(c.max_rows, 10);
  assert.deepEqual(c.entities, ['sensor.ok', 'switch.a']);
  assert.equal(m.ehConfig({ max_rows: 0 }).max_rows, 1);
  assert.equal(m.ehConfig('nope').title, 'Salute entità');
});

test('at least one state stays monitored', () => {
  const c = m.ehConfig({ show_unavailable: false, show_unknown: false });
  assert.equal(c.show_unavailable, true);
  assert.equal(c.show_unknown, true);
});

test('status classification: zero and off are values, not problems', () => {
  assert.equal(m.ehStatus(st('unavailable')), 'unavailable');
  assert.equal(m.ehStatus(st('unknown')), 'unknown');
  assert.equal(m.ehStatus(undefined), 'missing');
  assert.equal(m.ehStatus(st('0')), 'ok');
  assert.equal(m.ehStatus(st('off')), 'ok');
});

test('collect returns null until states are available', () => {
  assert.equal(m.ehCollect(m.ehConfig(), null), null);
  assert.equal(m.ehCollect(m.ehConfig(), {}), null);
});

test('all mode: excluded domains and hidden entities are skipped', () => {
  const hass = {
    states: {
      'sensor.a': st('unavailable'), 'sensor.b': st('unknown'), 'sensor.c': st('5'),
      'update.x': st('unavailable'), 'button.y': st('unknown'), 'scene.z': st('unknown'),
      'sensor.hidden': st('unavailable'),
    },
    entities: { 'sensor.hidden': { hidden: true, platform: 'demo' }, 'sensor.a': { platform: 'zha' } },
  };
  const d = m.ehCollect(m.ehConfig(), hass);
  assert.equal(d.monitored, 3);
  assert.deepEqual(d.counts, { unavailable: 1, unknown: 1, missing: 0 });
  assert.equal(d.withValue, 1);
  assert.deepEqual(d.problems.map(p => p.id), ['sensor.a', 'sensor.b']);
  const withHidden = m.ehCollect(m.ehConfig({ include_hidden: true }), hass);
  assert.equal(withHidden.counts.unavailable, 2);
});

test('manual mode: a missing entity is a problem, never "ok"', () => {
  const hass = { states: { 'sensor.a': st('1') } };
  const d = m.ehCollect(m.ehConfig({ mode: 'manual', entities: ['sensor.a', 'sensor.gone'] }), hass);
  assert.equal(d.monitored, 2);
  assert.equal(d.counts.missing, 1);
  assert.equal(d.withValue, 1);
  assert.equal(d.problems[0].status, 'missing');
});

test('hidden state filters do not inflate the "with value" count', () => {
  const hass = { states: { 'sensor.a': st('unknown'), 'sensor.b': st('1') } };
  const d = m.ehCollect(m.ehConfig({ show_unknown: false }), hass);
  assert.equal(d.problems.length, 0);
  assert.equal(d.withValue, 1);
  assert.equal(d.monitored, 2);
});

test('grouping: integration when available, otherwise domain', () => {
  const a = m.ehGroups([{ platform: 'zha', domain: 'sensor' }, { platform: '', domain: 'switch' }]);
  assert.deepEqual(a.map(g => g.label), ['ZHA', 'Altre']);
  const b = m.ehGroups([{ platform: '', domain: 'switch' }, { platform: '', domain: 'sensor' }]);
  assert.deepEqual(b.map(g => g.label), ['sensor', 'switch']);
});

test('relative time and invalid timestamps', () => {
  const now = Date.parse('2026-01-02T00:00:00Z');
  assert.equal(m.ehSince('2026-01-01T23:59:30Z', now), 'da meno di 1 min');
  assert.equal(m.ehSince('2026-01-01T23:30:00Z', now), 'da 30 min');
  assert.equal(m.ehSince('2026-01-01T19:00:00Z', now), 'da 5 h');
  assert.equal(m.ehSince('2025-12-30T00:00:00Z', now), 'da 3 g');
  assert.equal(m.ehSince('2026-02-01T00:00:00Z', now), '');
  assert.equal(m.ehSince(null, now), '');
});

test('HTML escaping of names and ids', () => {
  assert.equal(m.ehEsc('<script>'), '&lt;script&gt;');
  const html = m.ehRowHTML({ id: 'sensor.x', status: 'unavailable', name: '<img src=x onerror=alert(1)>', since: null }, m.ehConfig());
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('entity id validation', () => {
  assert.equal(m.ehEntityId('Sensor.Temp_1'), 'sensor.temp_1');
  assert.equal(m.ehEntityId('sensor.a b'), '');
  assert.equal(m.ehEntityId('javascript:alert(1)'), '');
});

test('read-only and private: no commands, no network, no URLs', () => {
  assert.doesNotMatch(src, /callService|callApi|callWS|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|eval\s*\(|new Function/);
  assert.doesNotMatch(src, /https?:\/\//);
});

test('entity id is not repeated when the name equals the id', () => {
  const html = m.ehRowHTML({ id: 'sensor.x', status: 'missing', name: 'sensor.x', since: null }, m.ehConfig());
  assert.doesNotMatch(html, /eh-eid/);
});

test('rows expose the escaped entity id used to position the popup', () => {
  const html = m.ehRowHTML({ id: 'sensor.x', status: 'unavailable', name: 'N', since: null }, m.ehConfig(), true, 0);
  assert.match(html, /data-id="sensor\.x"/);
  const evil = m.ehRowHTML({ id: 'a"><img', status: 'unavailable', name: 'N', since: null }, m.ehConfig(), true, 0);
  assert.doesNotMatch(evil, /<img/);
});
