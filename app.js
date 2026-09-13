"use strict";

// Unicode letters/numbers; internal hyphens and apostrophes belong to a word.
function countWords(text) {
  return (text.normalize("NFC").match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[’'\-‐‑][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu) || []).length;
}

const textInput = document.getElementById("text-input");
const micButton = document.getElementById("mic-button");
const countButton = document.getElementById("count-button");
const clearButton = document.getElementById("clear-button");
const statusLabel = document.getElementById("status-label");
const statusBadge = document.getElementById("status-badge");
const statusMessage = document.getElementById("status-message");
const micTitle = document.getElementById("mic-title");
const micHelp = document.getElementById("mic-help");
const wordCount = document.getElementById("word-count");
const wordLabel = document.getElementById("word-label");
const countNote = document.getElementById("count-note");
const testMicButton = document.getElementById("test-mic-button");
const deviceName = document.getElementById("device-name");
const inputLevel = document.getElementById("input-level");
const levelNote = document.getElementById("level-note");
const recognitionStatus = document.getElementById("recognition-status");
const microphoneSelect = document.getElementById("microphone-select");
const loadDevicesButton = document.getElementById("load-devices-button");
const deviceHint = document.getElementById("device-hint");
const deviceCount = document.getElementById("device-count");
const languageSelect = document.getElementById("recognition-language");
const languageHint = document.getElementById("language-hint");
const languageBadge = document.getElementById("language-badge");
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const canCapture = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
// The audioTrack overload has no standard feature-detection API. Older engines
// can silently ignore its argument, so gate it conservatively using MDN BCD:
// desktop Chromium >=135; Android and WebKit do not support this overload.
const chromeVersion = Number((navigator.userAgent || "").match(/(?:Chrome|Chromium)\/(\d+)/)?.[1] || 0);
const canUseSelectedTrack = chromeVersion >= 135 && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
let session = null;
let countedText = null;
let devicesRevision = 0;
let preferredDevice = { id: "", label: "" };
let preferredLanguage = "auto";
try {
  const saved = JSON.parse(window.localStorage.getItem("wortweise.microphone") || "null");
  if (saved && typeof saved.id === "string" && typeof saved.label === "string") preferredDevice = saved;
} catch { /* Device selection also works without localStorage. */ }
try {
  const saved = window.localStorage.getItem("wortweise.language");
  if (["auto", "de-DE", "tr-TR"].includes(saved)) preferredLanguage = saved;
} catch { /* Language selection also works without localStorage. */ }

function recognitionLanguage() {
  if (preferredLanguage !== "auto") return preferredLanguage;
  // Web Speech requires one locale; auto means the preferred browser language,
  // not automatic detection from speech or simultaneous bilingual recognition.
  return navigator.languages?.[0] || navigator.language || "de-DE";
}

function languageName(locale) {
  if (/^de(?:-|$)/i.test(locale)) return "Deutsch";
  if (/^tr(?:-|$)/i.test(locale)) return "Türkisch";
  return locale;
}

function renderLanguage() {
  languageSelect.value = preferredLanguage;
  const locale = recognitionLanguage();
  const name = languageName(locale);
  languageBadge.textContent = preferredLanguage === "auto" ? `Auto · ${name}` : name;
  languageHint.textContent = preferredLanguage === "auto"
    ? `Automatisch: ${name} (${locale}) aus deiner Browsersprache. Keine Erkennung der gesprochenen Sprache.`
    : `Die nächste Aufnahme wird auf ${name} (${locale}) erkannt.`;
  textInput.lang = locale;
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const revision = ++devicesRevision;
  try {
    // Keep every input Chrome exposes, including default/communications aliases
    // and anonymous entries before permission. Never filter by label or device ID.
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audioinput");
    if (revision !== devicesRevision) return;
    const options = [];
    function addOption(value, text, disabled = false) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      option.disabled = disabled;
      options.push(option);
    }
    addOption("", "Standardgerät des Browsers");
    devices.forEach((device, index) => addOption(device.deviceId,
      device.label || `Mikrofon ${index + 1} (Freigabe für Name und Auswahl nötig)`, !device.deviceId));
    deviceCount.textContent = `Chrome meldet ${devices.length} Mikrofoneinträge (inklusive Standard/Kommunikation).`;
    const missing = preferredDevice.id && !devices.some(device => device.deviceId === preferredDevice.id);
    if (missing) addOption(preferredDevice.id, `${preferredDevice.label || "Gewähltes Mikrofon"} (nicht verfügbar / noch nicht freigegeben)`);
    microphoneSelect.replaceChildren(...options);
    microphoneSelect.value = preferredDevice.id;
    deviceHint.textContent = missing
      ? "Deine Auswahl ist momentan nicht verfügbar oder noch nicht freigegeben. Aktualisiere die Liste oder wähle ein anderes Mikrofon."
      : !devices.length || devices.some(device => !device.label)
        ? "Für die vollständige Geräteliste und Gerätenamen zuerst „Mikrofone freigeben / aktualisieren“ anklicken."
        : canUseSelectedTrack
          ? "Deine Auswahl gilt für Mikrofontest und Texterkennung. Gerätewechsel startet keine Aufnahme."
          : "Die Auswahl gilt hier für den Test. Diktieren mit einem gewählten Gerät benötigt Chrome ab 135 am PC; sonst das Browser-Standardgerät nutzen.";
  } catch {
    if (revision === devicesRevision) {
      deviceCount.textContent = "Geräteliste nicht verfügbar.";
      deviceHint.textContent = "Geräteliste konnte nicht geladen werden. Bitte freigeben bzw. aktualisieren.";
    }
  }
}

function updateTextState() {
  clearButton.disabled = Boolean(session) || !textInput.value;
  if (countedText !== null && countedText !== textInput.value) {
    countNote.textContent = "Text geändert · bitte neu zählen";
  }
}

function showCount() {
  const count = countWords(textInput.value);
  wordCount.textContent = count.toLocaleString("de-DE");
  wordLabel.textContent = count === 1 ? "Wort" : "Wörter";
  countNote.textContent = count ? "Wörter in deinem Text" : "Noch keine Wörter im Text";
  countedText = textInput.value;
}

function message(text, error = false) {
  statusMessage.textContent = text;
  statusMessage.classList.toggle("error", error);
}

function renderState(state) {
  const active = state !== "idle";
  const testing = session?.mode === "test";
  const loadingDevices = session?.mode === "devices";
  textInput.readOnly = active && !testing && !loadingDevices;
  micButton.setAttribute("aria-pressed", String(active));
  micButton.setAttribute("aria-label", active ? "Mikrofon stoppen" : "Mikrofon aktivieren");
  micButton.disabled = !canCapture || (!SpeechRecognitionAPI && !active) || state === "stopping";
  microphoneSelect.disabled = active || !canCapture;
  languageSelect.disabled = active;
  loadDevicesButton.disabled = !canCapture || (active && !loadingDevices);
  loadDevicesButton.textContent = loadingDevices ? "Freigabe abbrechen" : "Mikrofone freigeben / aktualisieren";
  loadDevicesButton.setAttribute("aria-pressed", String(loadingDevices));
  testMicButton.disabled = !canCapture || (active && !testing);
  testMicButton.textContent = testing ? "Mikrofontest stoppen" : "Mikrofon testen";
  testMicButton.setAttribute("aria-pressed", String(testing));
  countButton.disabled = state === "stopping";
  statusBadge.classList.toggle("active", active);
  statusLabel.textContent = { idle: "Mikrofon aus", checking: "Mikrofonzugriff wird geprüft …", testing: "Mikrofontest aktiv", starting: "Texterkennung startet …", listening: "Mikrofon aktiv", stopping: "Aufnahme wird beendet …" }[state];
  micTitle.textContent = loadingDevices ? "Mikrofone werden geladen." : testing ? "Kommt deine Stimme an?" : active ? "Deine Worte werden Text." : "Bereit, wenn du es bist.";
  micHelp.textContent = loadingDevices ? "Der Zugriff endet nach dem Laden der Gerätenamen automatisch." : testing ? "Sprich und beobachte den Pegel. Der Test schreibt keinen Text." : active ? "Zum Beenden auf das Mikrofon oder auf „Wörter zählen“ klicken." : "Klicke auf das Mikrofon, um die Aufnahme zu starten.";
  updateTextState();
}

function finish(current) {
  if (session !== current) return;
  window.clearTimeout(current.timer);
  window.clearTimeout(current.diagnosticTimer);
  window.clearTimeout(current.restartTimer);
  releaseMicrophone(current);
  session = null;
  renderState("idle");
  if (!current.error) {
    if (current.mode === "devices") {
      message("Geräteliste aktualisiert. Wähle dein Mikrofon aus und starte anschließend den Test oder das Diktieren.");
      deviceName.textContent = "Noch keine neue Aufnahme gestartet";
    } else if (current.mode === "test") {
      message("Mikrofontest beendet. Zum Diktieren auf das große Mikrofon klicken.");
      levelNote.textContent = !current.meterAvailable ? "Test beendet: Mikrofonzugriff funktioniert; Pegelmessung war nicht verfügbar." : current.hadLevel
        ? "Test beendet: Ton ist angekommen. Wenn kein Text erscheint, prüfe die Texterkennung."
        : "Test beendet: kein messbarer Pegel. Prüfe Stummschaltung und Eingabegerät.";
    } else if (!current.hasResults) {
      message("Kein Text erhalten. Teste zuerst das Mikrofon. Wenn der Pegel reagiert, prüfe die Internetverbindung und die Spracherkennung in Chrome.", true);
      recognitionStatus.textContent = "Texterkennung: ohne Text beendet";
      levelNote.textContent = current.hadLevel ? "Aufnahme beendet: Ton am gewählten Mikrofon gemessen, aber kein Text erhalten." : "Aufnahme beendet. Prüfe bei Bedarf den Eingangspegel mit dem Mikrofontest.";
    } else {
      message("Aufnahme beendet. Du kannst deinen Text bearbeiten oder erneut diktieren.");
      recognitionStatus.textContent = "Texterkennung: Text übernommen";
      levelNote.textContent = "Aufnahme beendet. Mikrofon ist ausgeschaltet.";
    }
  }
  if (current.countAfter) showCount();
}

function stopRecording(countAfter = false) {
  if (!session) return;
  const current = session;
  current.countAfter = current.countAfter || countAfter;
  if (!current.recognition) {
    if (!current.stream) {
      current.error = true;
      deviceName.textContent = "Mikrofonprüfung abgebrochen";
      recognitionStatus.textContent = "Texterkennung: nicht aktiv";
      message("Mikrofonstart abgebrochen. Es wird nicht zugehört.");
    }
    finish(current);
    return;
  }
  if (current.stopping) return;
  current.stopping = true;
  window.clearTimeout(current.diagnosticTimer);
  renderState("stopping");
  message("Die letzten erkannten Wörter werden übernommen …");
  // Wait for final results before counting; retain the visible text if a browser stalls.
  current.timer = window.setTimeout(() => {
    current.error = true;
    recognitionStatus.textContent = "Texterkennung: beendet (Zeitlimit beim Stoppen)";
    message("Aufnahme beendet. Bitte prüfe die zuletzt erkannten Wörter.");
    finish(current);
    current.recognition.abort();
  }, 4000);
  try {
    current.recognition.stop();
    // stop() finalizes buffered speech; stop our owned hardware track immediately.
    releaseMicrophone(current);
  } catch {
    finish(current);
    current.recognition.abort();
  }
}

function releaseMicrophone(current) {
  if (current.frame !== undefined) window.cancelAnimationFrame(current.frame);
  current.stream?.getTracks().forEach(track => track.stop());
  current.stream = null;
  if (current.audioContext) {
    current.audioContext.close().catch(() => {});
    current.audioContext = null;
  }
  inputLevel.value = 0;
}

function startLevelMeter(current) {
  const context = current.audioContext;
  if (!context || context.state !== "running") {
    levelNote.textContent = "Mikrofonzugriff erlaubt. Die Pegelanzeige ist in diesem Browser momentan nicht verfügbar.";
    return;
  }
  const source = context.createMediaStreamSource(current.stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser); // No connection to speakers: no playback or feedback.
  current.meterAvailable = true;
  const samples = new Uint8Array(analyser.fftSize);
  function measure() {
    if (session !== current) return;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
    const rms = Math.sqrt(sum / samples.length);
    inputLevel.value = Math.min(100, Math.round(rms * 350));
    if (rms > 0.01 && !current.hadLevel) {
      current.hadLevel = true;
      levelNote.textContent = "Ton kommt an. Der Pegel reagiert auf das Mikrofon.";
    }
    current.frame = window.requestAnimationFrame(measure);
  }
  measure();
}

async function startRecording(mode = "dictation") {
  if (session || !canCapture || (mode === "dictation" && !SpeechRecognitionAPI)) return;
  const deviceId = preferredDevice.id;
  if (mode === "dictation" && deviceId && !canUseSelectedTrack) {
    message("Dieser Browser kann das ausgewählte Gerät nicht direkt für die Texterkennung verwenden. Nutze Chrome ab Version 135 am PC oder wähle „Standardgerät des Browsers“ und stelle dein Mikrofon in den Browsereinstellungen ein.", true);
    recognitionStatus.textContent = "Texterkennung: gewählte Audioquelle nicht unterstützt";
    return;
  }
  const current = { mode, deviceId, language: recognitionLanguage(), recognition: null, baseText: textInput.value, stopping: false, countAfter: false, error: false, timer: null, diagnosticTimer: null, restartTimer: null, hasResults: false, hadLevel: false, quickEnds: 0, networkRetries: 0, restarting: false };
  session = current;
  renderState("checking");
  deviceName.textContent = "Warte auf Mikrofonfreigabe …";
  message("Bitte erlaube den Mikrofonzugriff in Chrome. Du kannst den Start mit einem erneuten Klick abbrechen.");
  if (mode === "dictation") recognitionStatus.textContent = "Texterkennung: wartet auf Mikrofonprüfung";
  // Create/resume the audio context inside the click gesture (required on mobile).
  if (mode === "test" || (mode === "dictation" && canUseSelectedTrack)) {
    const AudioContextAPI = window.AudioContext || window.webkitAudioContext;
    if (AudioContextAPI) {
      try {
        current.audioContext = new AudioContextAPI();
        current.audioReady = current.audioContext.resume().catch(() => {});
      } catch { /* Microphone access can still be tested without a level meter. */ }
    }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: mode !== "devices" && deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false
    });
    // Permission can resolve after Stop, tab leave, or a newer session.
    if (session !== current) { stream.getTracks().forEach(track => track.stop()); return; }
    current.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState === "ended") throw Object.assign(new Error(), { name: "NotFoundError" });
    // Do not silently fall back if an explicitly selected input is gone.
    if (mode !== "devices" && deviceId && !["default", "communications"].includes(deviceId) && track.getSettings().deviceId !== deviceId) {
      throw Object.assign(new Error(), { name: "OverconstrainedError" });
    }
    deviceName.textContent = track.label || "Standardmikrofon (Browser liefert keinen Gerätenamen)";
    if (mode === "devices") {
      await refreshDevices();
      if (session === current) finish(current);
      return;
    }
    void refreshDevices();
    track.onended = () => {
      if (session !== current || current.stopping) return;
      current.error = true;
      message("Die Verbindung zum gewählten Mikrofon wurde beendet. Prüfe den Anschluss und wähle das Gerät erneut aus.", true);
      levelNote.textContent = "Mikrofon nicht mehr verfügbar.";
      recognitionStatus.textContent = "Texterkennung: Mikrofonverbindung beendet";
      finish(current);
      current.recognition?.abort();
    };
    await current.audioReady;
    if (session !== current) return;
    if (mode === "test" || canUseSelectedTrack) {
      levelNote.textContent = "Noch kein Ton gemessen. Sprich und prüfe die Stummschaltung am Mikrofon.";
      try { startLevelMeter(current); }
      catch {
        current.meterAvailable = false;
        levelNote.textContent = "Mikrofonzugriff funktioniert; die Pegelanzeige konnte nicht gestartet werden.";
      }
    }
    if (mode === "test") {
      renderState("testing");
      message("Mikrofonzugriff funktioniert. Sprich jetzt für den Pegeltest; zum Diktieren erst den Test beenden.");
      current.timer = window.setTimeout(() => finish(current), 30000);
      return;
    }
    if (!canUseSelectedTrack) {
      // Legacy default-only mode: explicitly selected devices were blocked above.
      releaseMicrophone(current);
      deviceName.textContent = `Browser-Standard (zuletzt geprüft: ${track.label || "Name unbekannt"})`;
      levelNote.textContent = "Browser bestimmt die Diktierquelle. Pegel nur im separaten Mikrofontest verfügbar.";
    }
  } catch (error) {
    if (session !== current) return;
    const errors = {
      NotAllowedError: "Mikrofonzugriff blockiert. Erlaube dieser Seite in Chrome das Mikrofon. Prüfe außerdem Windows → Datenschutz und Sicherheit → Mikrofon → Zugriff für Desktop-Apps.",
      NotFoundError: "Kein Mikrofon gefunden. Schließe dein Headset an oder wähle in Chrome ein verfügbares Mikrofon.",
      NotReadableError: "Das Mikrofon kann nicht geöffnet werden. Prüfe das Gerät und schließe gegebenenfalls andere Apps, die es exklusiv verwenden.",
      OverconstrainedError: "Das ausgewählte Mikrofon ist nicht verfügbar. Aktualisiere die Geräteliste und wähle dein Mikrofon erneut. Es wird nicht auf ein anderes Gerät gewechselt.",
      SecurityError: "Der Browser blockiert den Mikrofonzugriff auf dieser Seite.",
      AbortError: "Der Mikrofonzugriff wurde unterbrochen. Bitte erneut versuchen."
    };
    current.error = true;
    deviceName.textContent = "Mikrofonprüfung fehlgeschlagen";
    message(errors[error.name] || "Das Mikrofon konnte nicht geprüft werden. Prüfe die Berechtigung und das Eingabegerät.", true);
    recognitionStatus.textContent = "Texterkennung: nicht gestartet (Mikrofonprüfung fehlgeschlagen)";
    levelNote.textContent = `Mikrofonfehler: ${error.name || "unbekannt"}`;
    finish(current);
    return;
  }
  beginRecognition(current);
}

function beginRecognition(current) {
  if (session !== current) return;
  current.restarting = false;
  let recognition;
  try { recognition = new SpeechRecognitionAPI(); }
  catch {
    current.error = true;
    message("Der Browser stellt keine nutzbare Spracherkennung bereit. Öffne die Seite direkt in Google Chrome.", true);
    recognitionStatus.textContent = "Texterkennung: nicht verfügbar";
    finish(current);
    return;
  }
  current.recognition = recognition;
  recognition.lang = current.language;
  recognition.continuous = true;
  recognition.interimResults = true;
  renderState("starting");
  message("Mikrofonzugriff geprüft. Die Spracherkennung wird gestartet …");
  recognitionStatus.textContent = "Texterkennung: Verbindung wird aufgebaut …";
  current.diagnosticTimer = window.setTimeout(() => {
    if (session !== current) return;
    current.error = true;
    recognitionStatus.textContent = "Texterkennung: Start fehlgeschlagen";
    message("Das Mikrofon ist erreichbar, aber die Spracherkennung startet nicht. Öffne die Seite direkt in Google Chrome und prüfe die Internetverbindung.", true);
    finish(current);
    recognition.abort();
  }, 15000);

  recognition.onstart = () => {
    if (session !== current) return;
    if (current.stopping) { recognition.stop(); return; }
    recognitionStatus.textContent = "Texterkennung: Dienst gestartet, warte auf Audio …";
  };
  recognition.onaudiostart = () => {
    if (session !== current || current.stopping) return;
    window.clearTimeout(current.diagnosticTimer);
    renderState("listening");
    recognitionStatus.textContent = "Texterkennung: Audioaufnahme aktiv";
    message("Chrome nimmt Audio auf. Sprich deinen Text in normalem Tempo.");
    current.diagnosticTimer = window.setTimeout(() => {
      if (session !== current || current.hasResults || current.stopping) return;
      message("Noch kein Text erhalten. Prüfe mit „Mikrofon testen“, ob Ton ankommt. Bei reagierendem Pegel liegt es möglicherweise am Erkennungsdienst oder der Verbindung.", true);
      recognitionStatus.textContent = "Texterkennung: noch kein Ergebnis";
    }, 12000);
  };
  recognition.onspeechstart = () => {
    if (session === current && !current.stopping) recognitionStatus.textContent = "Texterkennung: Sprache erkannt, warte auf Text …";
  };
  recognition.onnomatch = () => {
    if (session !== current || current.stopping) return;
    recognitionStatus.textContent = "Texterkennung: Sprache nicht verstanden";
    message(`Chrome konnte die Sprache nicht zuordnen. Sprich bitte deutlich auf ${languageName(current.language)} oder prüfe die gewählte Erkennungssprache.`);
  };
  recognition.onresult = (event) => {
    if (session !== current) return;
    // Rebuild this session from all results so interim revisions never duplicate text.
    const parts = [];
    for (let i = 0; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript.trim();
      if (transcript) parts.push(transcript);
    }
    const dictated = parts.join(" ");
    if (dictated) {
      current.hasResults = true;
      window.clearTimeout(current.diagnosticTimer);
      recognitionStatus.textContent = "Texterkennung: Text empfangen";
      if (!current.stopping) message("Dein Text wird übernommen. Du kannst weiter sprechen.");
    }
    const separator = current.baseText && !/\s$/.test(current.baseText) && dictated ? " " : "";
    textInput.value = current.baseText + separator + dictated;
    textInput.scrollTop = textInput.scrollHeight;
    updateTextState();
  };
  recognition.onerror = (event) => {
    if (session !== current) return;
    if (event.error === "network" && !current.stopping && current.networkRetries < 2) {
      current.networkRetries += 1;
      current.restarting = true;
      window.clearTimeout(current.diagnosticTimer);
      recognitionStatus.textContent = `Texterkennung: Verbindungsproblem, Neuversuch ${current.networkRetries}/2`;
      message("Chromes Spracherkennung ist gerade nicht erreichbar. Die App versucht die Verbindung noch einmal.");
      current.restartTimer = window.setTimeout(() => beginRecognition(current), 900);
      recognition.abort();
      return;
    }
    const errors = {
      "not-allowed": "Mikrofonzugriff wurde nicht erlaubt. Prüfe die Mikrofonberechtigung dieser Seite in deinem Browser.",
      "service-not-allowed": "Der Browser erlaubt die Spracherkennung nicht. Versuche einen anderen unterstützten Browser.",
      "audio-capture": "Kein verfügbares Mikrofon gefunden. Prüfe den Anschluss und die Mikrofoneinstellungen deines Geräts.",
      network: "Mikrofonzugriff war möglich, aber Chromes Spracherkennungsdienst ist nicht erreichbar. Prüfe Internetverbindung, VPN, Firewall, Werbe-/Scriptblocker und öffne die Seite direkt in Google Chrome.",
      "no-speech": "Keine Sprache erkannt. Klicke erneut auf das Mikrofon und sprich deinen Text.",
      "language-not-supported": `Spracherkennung für ${languageName(current.language)} (${current.language}) ist in diesem Browser nicht verfügbar. Wähle eine andere Sprache.`,
      aborted: "Aufnahme abgebrochen. Dein bisheriger Text bleibt erhalten."
    };
    current.error = true;
    recognitionStatus.textContent = `Texterkennung: Fehler (${event.error})`;
    message(errors[event.error] || "Die Spracherkennung ist fehlgeschlagen. Bitte versuche es erneut.", true);
    finish(current);
    recognition.abort();
  };
  // Never restart automatically, including after silence or permission errors.
  recognition.onend = () => {
    if (session !== current || current.stopping || current.error) {
      finish(current);
      return;
    }
    if (current.restarting) return;
    window.clearTimeout(current.diagnosticTimer);
    if (current.mode !== "dictation") {
      finish(current);
      return;
    }
    const track = current.stream?.getAudioTracks?.()[0];
    if (!track || track.readyState === "ended") {
      current.error = true;
      recognitionStatus.textContent = "Texterkennung: Mikrofonverbindung beendet";
      message("Die Texterkennung wurde beendet, weil das Mikrofon nicht mehr verfügbar ist.", true);
      finish(current);
      return;
    }
    current.quickEnds += current.hasResults ? 0 : 1;
    if (current.quickEnds > 3) {
      current.error = true;
      recognitionStatus.textContent = "Texterkennung: bricht sofort ab";
      message("Chrome beendet die Texterkennung sofort wieder. Prüfe Internetverbindung, Spracheinstellung und ob Chrome Spracherkennung für diese Seite erlaubt.", true);
      finish(current);
      return;
    }
    recognitionStatus.textContent = "Texterkennung: wird erneut verbunden …";
    message("Chrome hat die Texterkennung kurz beendet. Die Aufnahme bleibt aktiv und wird erneut verbunden.");
    current.restartTimer = window.setTimeout(() => beginRecognition(current), 350);
  };
  try {
    if (canUseSelectedTrack) recognition.start(current.stream.getAudioTracks()[0]);
    else recognition.start();
  }
  catch {
    current.error = true;
    recognitionStatus.textContent = "Texterkennung: Start fehlgeschlagen";
    message("Mikrofonzugriff geprüft, aber die Texterkennung konnte nicht gestartet werden. Prüfe die Browserberechtigungen und versuche es erneut.", true);
    finish(current);
  }
}

micButton.addEventListener("click", () => session ? stopRecording() : startRecording());
testMicButton.addEventListener("click", () => session ? stopRecording() : startRecording("test"));
loadDevicesButton.addEventListener("click", () => session ? stopRecording() : startRecording("devices"));
microphoneSelect.addEventListener("change", () => {
  if (session) return;
  preferredDevice = { id: microphoneSelect.value, label: microphoneSelect.selectedOptions[0]?.textContent || "" };
  try { window.localStorage.setItem("wortweise.microphone", JSON.stringify(preferredDevice)); } catch { /* Optional preference storage. */ }
  deviceName.textContent = "Auswahl geändert · noch nicht gestartet";
  levelNote.textContent = "Zum Prüfen des gewählten Geräts auf „Mikrofon testen“ klicken.";
  message("Mikrofon ausgewählt. Klicke zum Diktieren auf das große Mikrofon.");
});
languageSelect.addEventListener("change", () => {
  if (session || !["auto", "de-DE", "tr-TR"].includes(languageSelect.value)) return;
  preferredLanguage = languageSelect.value;
  try { window.localStorage.setItem("wortweise.language", preferredLanguage); } catch { /* Optional preference storage. */ }
  renderLanguage();
});
countButton.addEventListener("click", () => session ? stopRecording(true) : showCount());
textInput.addEventListener("input", updateTextState);
clearButton.addEventListener("click", () => {
  if (session) return;
  textInput.value = "";
  countedText = null;
  wordCount.textContent = "–";
  wordLabel.textContent = "Wörter";
  countNote.textContent = "Bereit zum Zählen";
  updateTextState();
  textInput.focus();
});

function stopWhenLeaving() {
  if (!session) return;
  const current = session;
  current.error = true;
  message("Aufnahme beim Verlassen der Seite gestoppt. Zum Fortsetzen erneut klicken.");
  finish(current);
  current.recognition?.abort();
  levelNote.textContent = "Mikrofon beim Verlassen der Seite gestoppt.";
  recognitionStatus.textContent = "Texterkennung: nicht aktiv";
}
document.addEventListener("visibilitychange", () => { if (document.hidden) stopWhenLeaving(); });
window.addEventListener("pagehide", stopWhenLeaving);
window.addEventListener("languagechange", () => { if (!session) renderLanguage(); });
if (canCapture) {
  // Enumeration only: loading the page never opens a microphone or asks permission.
  void refreshDevices();
  navigator.mediaDevices.addEventListener?.("devicechange", refreshDevices);
}

renderLanguage();
renderState("idle");
if (!canCapture || !SpeechRecognitionAPI) {
  micButton.disabled = true;
  statusLabel.textContent = canCapture ? "Texterkennung nicht verfügbar" : "Mikrofon nicht verfügbar";
  micTitle.textContent = "Tippen funktioniert immer.";
  micHelp.textContent = "Du kannst deinen Text eingeben und Wörter zählen.";
  recognitionStatus.textContent = !SpeechRecognitionAPI ? "Texterkennung: von diesem Browser nicht unterstützt" : "Texterkennung: Mikrofonzugriff nicht verfügbar";
  message(!window.isSecureContext
    ? "Öffne die App über HTTPS oder auf diesem PC über localhost, um das Mikrofon zu verwenden."
    : !canCapture ? "Dieser Browser bietet keinen Mikrofonzugriff. Öffne die Seite direkt in Google Chrome."
    : "Dieser Browser unterstützt keine Spracherkennung. Du kannst das Mikrofon separat testen oder die Seite direkt in Google Chrome öffnen.", true);
}
