const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ supported = true, secure = true, captureError, capturePromise, audio = true, signal = 128,
  userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36', languages = ['de-DE'], saved = {} } = {}) {
  const elements = new Map();
  const events = {};
  const instances = [];
  const timers = new Map();
  const delays = new Map();
  const frames = new Map();
  const tracks = [];
  const contexts = [];
  let captureCalls = 0;
  const storage = new Map(Object.entries(saved));
  const constraints = [];
  const devices = [
    { kind: 'audioinput', deviceId: 'default', label: 'Standard - Headset (USB Audio)' },
    { kind: 'audioinput', deviceId: 'communications', label: 'Kommunikation - Headset (USB Audio)' },
    { kind: 'audioinput', deviceId: 'usb-id', label: 'Headset (USB Audio)' },
    { kind: 'audioinput', deviceId: 'built-in-id', label: 'Eingebautes Mikrofon' },
    { kind: 'audiooutput', deviceId: 'speaker-id', label: 'Lautsprecher' }
  ];
  const makeStream = (deviceId = 'usb-id') => {
    const track = { label: devices.find(device => device.deviceId === deviceId)?.label || 'Unbekanntes Mikrofon',
      getSettings: () => ({ deviceId }), readyState: 'live', stops: 0, stop() { this.stops++; this.readyState = 'ended'; } };
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  class AudioContext {
    constructor() { this.state = 'running'; contexts.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 1024, getByteTimeDomainData: data => data.fill(signal) }; }
  }
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', disabled: false, readOnly: false, attrs: {}, handlers: {},
      classList: { toggle() {} }, focus() {}, options: [], selectedOptions: [],
      replaceChildren(...options) { this.options = options; },
      choose(value) { this.value = value; this.selectedOptions = this.options.filter(option => option.value === value); return this.handlers.change(); },
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(key, fn) { this.handlers[key] = fn; },
      click() { if (!this.disabled) return this.handlers.click(); }
    });
    return elements.get(id);
  };
  class Recognition {
    constructor() { instances.push(this); this.starts = 0; this.stops = 0; this.aborts = 0; }
    start(track) { this.starts++; this.inputTrack = track; }
    stop() { this.stops++; }
    abort() { this.aborts++; }
    results(...texts) { this.onresult({ results: texts.map(transcript => [{ transcript }]) }); }
  }
  const document = { getElementById: element, createElement: () => ({ value: '', textContent: '' }), addEventListener: (key, fn) => events[key] = fn, hidden: false };
  const context = vm.createContext({ document, navigator: { userAgent, languages, mediaDevices: {
    enumerateDevices: () => Promise.resolve(devices),
    getUserMedia: request => {
      captureCalls++;
      constraints.push(request);
      if (captureError) return Promise.reject({ name: captureError });
      return capturePromise || Promise.resolve(makeStream(request.audio?.deviceId?.exact || 'usb-id'));
    }
  } }, window: {
    SpeechRecognition: supported ? Recognition : undefined,
    AudioContext: audio ? AudioContext : undefined,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    isSecureContext: secure,
    addEventListener: (key, fn) => events[key] = fn,
    setTimeout: (fn, delay) => { timers.set(fn, fn); delays.set(fn, delay); return fn; },
    clearTimeout: (key) => timers.delete(key),
    requestAnimationFrame: fn => { frames.set(fn, fn); return fn; },
    cancelAnimationFrame: key => frames.delete(key)
  }});
  vm.runInContext(fs.readFileSync(`${__dirname}/app.js`, 'utf8'), context);
  return { element, instances, context, document, events, timers, tracks, contexts, frames, constraints, storage, devices,
    captureCalls: () => captureCalls, makeStream,
    runTimer: delay => {
      const timer = [...timers.keys()].find(key => delays.get(key) === delay);
      assert.ok(timer, `Timer ${delay} exists`);
      timers.delete(timer);
      timer();
    }
  };
}

test('words: whitespace, punctuation, umlauts, hyphens, numbers and emoji', () => {
  const { context } = setup();
  for (const [text, expected] of [
    ['', 0], [' \n\t ', 0], ['Hallo Welt!', 2], ['Hallo, Welt!\nWie geht’s?', 4],
    ['Äpfel Öl Straße', 3], ['E-Mail PC-Headset', 2], ['123 45', 2],
    ['... – !!! 😊', 0], ['eins\tzwei\n\ndrei', 3], ['A\u0308pfel', 1], ['Hallo,Welt', 2]
  ]) assert.equal(vm.runInContext(`countWords(${JSON.stringify(text)})`, context), expected, text);
});

test('microphone stays off until click; interim revisions and restarts do not duplicate text', async () => {
  const { element: el, instances, captureCalls, tracks } = setup();
  assert.equal(instances.length, 0);
  assert.equal(captureCalls(), 0);
  el('text-input').value = 'Mein Text.';
  await el('mic-button').click();
  const rec = instances[0];
  assert.equal(el('device-name').textContent, 'Headset (USB Audio)');
  assert.equal(tracks[0].stops, 0, 'selected microphone stays live for recognition');
  assert.equal(rec.inputTrack, tracks[0], 'speech receives the exact captured track');
  assert.equal(rec.starts, 1);
  assert.equal(el('text-input').readOnly, true);
  rec.onstart();
  rec.results('Hallo');
  rec.results('Hallo Welt.');
  rec.results('Hallo Welt.', 'Noch ein Satz.');
  assert.equal(el('text-input').value, 'Mein Text. Hallo Welt. Noch ein Satz.');
  rec.onend();
  assert.equal(rec.starts, 1);
  assert.equal(instances.length, 1);
  assert.equal(el('text-input').readOnly, false);
  await el('mic-button').click();
  instances[1].results('Weiter.');
  assert.equal(el('text-input').value, 'Mein Text. Hallo Welt. Noch ein Satz. Weiter.');
});

test('count waits for final speech results and marks subsequent edits', async () => {
  const { element: el, instances } = setup();
  await el('mic-button').click();
  const rec = instances[0];
  rec.onstart();
  rec.results('Hallo');
  el('count-button').click();
  assert.equal(rec.stops, 1);
  assert.equal(el('count-button').disabled, true);
  rec.results('Hallo schöne Welt');
  rec.onend();
  assert.equal(el('word-count').textContent, '3');
  el('text-input').value += ' heute';
  el('text-input').handlers.input();
  assert.match(el('count-note').textContent, /neu zählen/);
  el('count-button').click();
  assert.equal(el('word-count').textContent, '4');
});

test('permission denial leaves text editable and never retries automatically', async () => {
  const { element: el, instances } = setup();
  el('text-input').value = 'Bleibt erhalten';
  await el('mic-button').click();
  instances[0].onerror({ error: 'not-allowed' });
  instances[0].onend();
  assert.equal(instances.length, 1);
  assert.equal(el('text-input').value, 'Bleibt erhalten');
  assert.equal(el('text-input').readOnly, false);
  assert.match(el('status-message').textContent, /nicht erlaubt/);
});

test('leaving stops capture and ignores late results', async () => {
  const { element: el, instances, events, document } = setup();
  await el('mic-button').click();
  instances[0].results('Hallo');
  document.hidden = true;
  events.visibilitychange();
  assert.equal(instances[0].aborts, 1);
  instances[0].results('Spätes Ergebnis');
  assert.equal(el('text-input').value, 'Hallo');
  assert.equal(el('mic-button').attrs['aria-pressed'], 'false');
});

test('stalled stop recovers and counts visible text', async () => {
  const { element: el, instances, timers } = setup();
  await el('mic-button').click();
  instances[0].results('Zwei Wörter');
  el('count-button').click();
  [...timers.values()][0]();
  assert.equal(el('word-count').textContent, '2');
  assert.equal(el('text-input').readOnly, false);
  assert.equal(instances[0].aborts, 1);
});

test('unsupported or insecure browsers still allow typing and counting', () => {
  for (const options of [{ supported: false }, { secure: false }]) {
    const { element: el, instances } = setup(options);
    assert.equal(el('mic-button').disabled, true);
    el('mic-button').click();
    assert.equal(instances.length, 0);
    el('text-input').value = 'Manuell schreiben funktioniert';
    el('count-button').click();
    assert.equal(el('word-count').textContent, '3');
  }
});

test('microphone test shows actual device and level without invoking speech recognition', async () => {
  const { element: el, instances, tracks, contexts, frames } = setup({ signal: 140 });
  await el('test-mic-button').click();
  assert.equal(instances.length, 0);
  assert.equal(tracks[0].stops, 0);
  assert.equal(el('device-name').textContent, 'Headset (USB Audio)');
  assert.ok(el('input-level').value > 0);
  assert.match(el('level-note').textContent, /Ton kommt an/);
  el('test-mic-button').click();
  assert.equal(tracks[0].stops, 1);
  assert.equal(contexts[0].state, 'closed');
  assert.equal(frames.size, 0);
  assert.equal(el('input-level').value, 0);
  assert.match(el('level-note').textContent, /Ton ist angekommen/);
});

test('microphone test works without speech support and stops after 30 seconds', async () => {
  const { element: el, runTimer, tracks, instances } = setup({ supported: false });
  assert.equal(el('test-mic-button').disabled, false);
  await el('test-mic-button').click();
  runTimer(30000);
  assert.equal(tracks[0].stops, 1);
  assert.equal(instances.length, 0);
  assert.match(el('level-note').textContent, /kein messbarer Pegel/);
  assert.equal(el('mic-button').disabled, true);
});

test('unavailable meter is not falsely reported as silent hardware', async () => {
  const { element: el } = setup({ audio: false });
  await el('test-mic-button').click();
  el('test-mic-button').click();
  assert.match(el('level-note').textContent, /Pegelmessung war nicht verfügbar/);
});

test('capture errors are distinguished before starting recognition', async () => {
  for (const [error, expected] of [['NotAllowedError', /blockiert/], ['NotFoundError', /Kein Mikrofon/], ['NotReadableError', /nicht geöffnet/]]) {
    const { element: el, instances } = setup({ captureError: error });
    await el('mic-button').click();
    assert.equal(instances.length, 0);
    assert.match(el('status-message').textContent, expected);
    assert.equal(el('text-input').readOnly, false);
    assert.equal(el('mic-button').attrs['aria-pressed'], 'false');
  }
});

test('cancellation while permission is pending releases late streams without starting speech', async () => {
  let resolve;
  const capturePromise = new Promise(done => { resolve = done; });
  const { element: el, instances, makeStream, tracks } = setup({ capturePromise });
  const pending = el('mic-button').click();
  el('mic-button').click();
  resolve(makeStream());
  await pending;
  assert.equal(tracks[0].stops, 1);
  assert.equal(instances.length, 0);
  assert.equal(el('text-input').readOnly, false);
});

test('speech start timeout recovers; network error remains distinguishable from hardware', async () => {
  const { element: el, instances, runTimer } = setup();
  await el('mic-button').click();
  instances[0].onstart();
  assert.notEqual(el('status-label').textContent, 'Mikrofon aktiv');
  runTimer(15000);
  assert.equal(instances[0].aborts, 1);
  assert.match(el('status-message').textContent, /Spracherkennung startet nicht/);
  await el('mic-button').click();
  instances[1].onerror({ error: 'network' });
  instances[1].onend();
  assert.match(el('recognition-status').textContent, /network/);
  assert.match(el('status-message').textContent, /Mikrofonzugriff war möglich/);
});

test('audio without text receives a diagnostic and later results clear it', async () => {
  const { element: el, instances, runTimer } = setup();
  await el('mic-button').click();
  instances[0].onaudiostart();
  assert.equal(el('status-label').textContent, 'Mikrofon aktiv');
  runTimer(12000);
  assert.match(el('status-message').textContent, /Noch kein Text/);
  instances[0].results('Jetzt funktioniert es');
  assert.equal(el('text-input').value, 'Jetzt funktioniert es');
  assert.match(el('recognition-status').textContent, /Text empfangen/);
});

test('unplugging or leaving during a microphone test closes all capture resources', async () => {
  for (const leave of [false, true]) {
    const { element: el, tracks, contexts, frames, document, events } = setup();
    await el('test-mic-button').click();
    if (leave) { document.hidden = true; events.visibilitychange(); }
    else tracks[0].onended();
    assert.equal(tracks[0].stops, 1);
    assert.equal(contexts[0].state, 'closed');
    assert.equal(frames.size, 0);
    assert.equal(el('mic-button').attrs['aria-pressed'], 'false');
  }
});

test('selected microphone is used for capture, meter and actual speech input', async () => {
  const { element: el, instances, tracks, constraints, storage } = setup();
  await new Promise(setImmediate);
  assert.equal(el('microphone-select').options.length, 5, 'all four inputs retained, speakers excluded');
  el('microphone-select').choose('built-in-id');
  assert.equal(instances.length, 0, 'selection does not start listening');
  await el('mic-button').click();
  assert.equal(constraints[0].audio.deviceId.exact, 'built-in-id');
  assert.equal(el('device-name').textContent, 'Eingebautes Mikrofon');
  assert.equal(instances[0].inputTrack, tracks[0]);
  assert.equal(el('microphone-select').disabled, true);
  el('mic-button').click();
  assert.equal(tracks[0].stops, 1, 'stop releases hardware immediately');
  instances[0].onend();
  assert.equal(el('microphone-select').disabled, false);
  assert.equal(JSON.parse(storage.get('wortweise.microphone')).id, 'built-in-id');
});

test('loading device names never starts dictation and releases its temporary stream', async () => {
  const { element: el, instances, tracks, captureCalls } = setup();
  assert.equal(captureCalls(), 0);
  await el('load-devices-button').click();
  assert.equal(instances.length, 0);
  assert.equal(tracks[0].stops, 1);
  assert.match(el('status-message').textContent, /Geräteliste aktualisiert/);
});

test('unsupported track routing blocks an explicit selection instead of using a wrong mic', async () => {
  for (const userAgent of ['Chrome/134.0.0.0', 'Mozilla/5.0 (Linux; Android 16) Chrome/140.0.0.0']) {
    const { element: el, instances, captureCalls } = setup({ userAgent });
    await new Promise(setImmediate);
    el('microphone-select').choose('built-in-id');
    await el('mic-button').click();
    assert.equal(captureCalls(), 0);
    assert.equal(instances.length, 0);
    assert.match(el('recognition-status').textContent, /nicht unterstützt/);
    await el('test-mic-button').click();
    assert.equal(el('device-name').textContent, 'Eingebautes Mikrofon');
  }
});

test('missing saved input does not silently change selection or fall back on capture failure', async () => {
  const { element: el, instances, constraints } = setup({
    saved: { 'wortweise.microphone': JSON.stringify({ id: 'unplugged-id', label: 'Altes Headset' }) },
    captureError: 'OverconstrainedError'
  });
  await new Promise(setImmediate);
  assert.equal(el('microphone-select').value, 'unplugged-id');
  assert.match(el('device-hint').textContent, /nicht verfügbar/);
  await el('mic-button').click();
  assert.equal(constraints[0].audio.deviceId.exact, 'unplugged-id');
  assert.equal(instances.length, 0);
  assert.match(el('status-message').textContent, /nicht auf ein anderes Gerät/);
});

test('German, Turkish and automatic browser language reach speech recognition', async () => {
  for (const [choice, language] of [['de-DE', 'de-DE'], ['tr-TR', 'tr-TR'], ['auto', 'tr-TR']]) {
    const { element: el, instances, storage } = setup({ languages: ['tr-TR', 'de-DE'] });
    el('recognition-language').choose(choice);
    assert.equal(instances.length, 0);
    await el('mic-button').click();
    assert.equal(instances[0].lang, language);
    assert.equal(el('recognition-language').disabled, true);
    instances[0].results('Merhaba dünya, bugün nasılsın?');
    el('count-button').click();
    instances[0].onend();
    assert.equal(el('word-count').textContent, '4');
    assert.equal(el('recognition-language').disabled, false);
    assert.equal(storage.get('wortweise.language'), choice);
  }
});

test('saved language preference is restored and unsupported-language error names it', async () => {
  const { element: el, instances } = setup({ saved: { 'wortweise.language': 'tr-TR' } });
  assert.equal(el('recognition-language').value, 'tr-TR');
  assert.equal(el('language-badge').textContent, 'Türkisch');
  await el('mic-button').click();
  instances[0].onerror({ error: 'language-not-supported' });
  assert.match(el('status-message').textContent, /Türkisch \(tr-TR\)/);
});

test('all browser inputs including aliases, virtual devices and unnamed devices are listed', async () => {
  const { element: el, devices, context } = setup();
  devices.push({ kind: 'audioinput', deviceId: 'virtual-id', label: 'Virtuelles Mikrofon' });
  devices.push({ kind: 'audioinput', deviceId: '', label: '' });
  await vm.runInContext('refreshDevices()', context);
  const options = el('microphone-select').options;
  for (const id of ['default', 'communications', 'usb-id', 'built-in-id', 'virtual-id']) {
    assert.ok(options.some(option => option.value === id), `input ${id} present`);
  }
  assert.equal(options.length, 7, 'six reported inputs plus browser default option');
  assert.ok(options.some(option => option.disabled && /Freigabe/.test(option.textContent)));
  assert.match(el('device-count').textContent, /6 Mikrofoneinträge/);
});

test('refresh discovers newly connected microphones while preserving selection', async () => {
  const { element: el, devices, context, captureCalls } = setup();
  await vm.runInContext('refreshDevices()', context);
  el('microphone-select').choose('built-in-id');
  devices.push({ kind: 'audioinput', deviceId: 'bluetooth-id', label: 'Bluetooth-Headset' });
  await vm.runInContext('refreshDevices()', context);
  assert.ok(el('microphone-select').options.some(option => option.value === 'bluetooth-id'));
  assert.equal(el('microphone-select').value, 'built-in-id');
  assert.equal(captureCalls(), 0, 'device discovery does not listen');
});
