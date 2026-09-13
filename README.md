# Wortweise

Web-App mit HTML, CSS und JavaScript. Keine Installation und kein Build nötig.

## Starten

1. Apache im XAMPP Control Panel starten.
2. Auf diesem PC `http://localhost/W%C3%B6rter_z%C3%A4hlen/` öffnen.
3. Bei Bedarf „Mikrofone freigeben / aktualisieren“ anklicken und den Zugriff erlauben. Die App öffnet das Standardmikrofon kurz für die Gerätenamen und schaltet es wieder aus.
4. Das gewünschte Mikrofon und „Automatisch“, „Deutsch“ oder „Türkisch“ auswählen. Optional mit „Mikrofon testen“ Gerätename und Pegel prüfen.
5. Das große Mikrofon anklicken und sprechen. Erneut anklicken, um zu stoppen, oder direkt „Wörter zählen“ wählen.

Text kann auch eingegeben oder eingefügt werden. Während der Aufnahme ist das Textfeld schreibgeschützt, damit neue Erkennungsergebnisse keine manuellen Änderungen überschreiben. Anschließend kann der Text bearbeitet werden.

## Browser und Handy

Die Spracherkennung verwendet `SpeechRecognition` bzw. `webkitSpeechRecognition`. Browserunterstützung und Dienstverfügbarkeit variieren. Chrome ist ein möglicher unterstützter Browser. Bei fehlender Unterstützung bleibt das manuelle Wörterzählen nutzbar.

Für das Handy die Dateien auf einem per HTTPS erreichbaren Webserver bereitstellen. `localhost` auf dem Handy bezeichnet das Handy selbst. Eine normale HTTP-Adresse des XAMPP-PCs im WLAN reicht für diese App nicht zum Aktivieren des Mikrofons. Das Layout passt sich kleinen Bildschirmen an.

Die Geräteauswahl verwendet `getUserMedia({ audio: { deviceId: { exact: ... } } })`. In Desktop-Chrome ab Version 135 wird genau dieser Audiokanal mit `recognition.start(audioTrack)` an die Erkennung übergeben. Der Pegel stammt aus demselben Stream. Ein verschwundenes ausgewähltes Gerät führt zu einer Fehlermeldung; die App wechselt nicht stillschweigend auf das Standardmikrofon.

Die Liste enthält alle von `enumerateDevices()` gemeldeten `audioinput`-Einträge, einschließlich Standard-/Kommunikations-Aliasen und noch namenlosen Geräten. Es wird nicht nach Gerätenamen gefiltert oder dedupliziert. Einträge ohne freigegebene Geräte-ID werden angezeigt, sind aber noch nicht auswählbar. „Mikrofone freigeben / aktualisieren“ lädt nach Freigabe neu; `devicechange` aktualisiert bei Geräteänderungen ohne Aufnahme. Der Browser kann nur vom Betriebssystem und den Berechtigungen bereitgestellte Geräte melden.

Die `audioTrack`-Übergabe ist laut MDN-Kompatibilitätsdaten noch nicht in Chrome auf Android oder Safari verfügbar. Da ältere Browser das Argument ignorieren können, erlaubt die App diese Übergabe konservativ nur bei Desktop-Chromium ab 135. In anderen Browsern ist die Geräteauswahl für den Mikrofontest verwendbar. Diktieren funktioniert dort mit der Auswahl „Standardgerät des Browsers“; das Gerät muss in den Browser-/Systemeinstellungen eingestellt werden. Die Anzeige kennzeichnet dort den zuletzt geprüften Standardeingang, nicht eine verbindlich zugewiesene Diktierquelle.

Aufnahmen starten nur nach einem Klick, niemals beim Laden, Auswählen eines Geräts/einer Sprache oder nach dem Ende einer Aufnahme. Beim Stoppen, Tabwechsel und Verlassen der Seite werden Streams und Pegelmessung beendet. Ein offener Mikrofontest endet spätestens nach 30 Sekunden. Fehler beim Hardwarezugriff, beim Erkennungsdienst und ausbleibende Texte werden getrennt angezeigt.

„Deutsch“ verwendet `de-DE`, „Türkisch“ verwendet `tr-TR`. „Automatisch“ verwendet die bevorzugte Browsersprache (`navigator.languages[0]`, ersatzweise `navigator.language` oder `de-DE`). Das ist keine automatische Erkennung der gesprochenen Sprache. Die Einstellung gilt pro Aufnahme; während einer Aufnahme ist sie gesperrt. Mikrofon- und Sprachpräferenz werden lokal gespeichert, der eingegebene Text nicht.

Je nach Browser verarbeitet ein externer Spracherkennungsdienst das Audio, und Internetzugang ist erforderlich. Die App selbst speichert weder Text noch Audio dauerhaft. Beim Neuladen geht der Text verloren.

Referenzen: [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [Audio-Track als Eingabe](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start), [Browser-Kompatibilitätsdaten](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json).

## Wortzählung

Unicode-Buchstaben und Zahlen zählen als Wörter; reine Satzzeichen und Emojis nicht. Binnenapostrophe und Bindestriche bleiben Teil eines Wortes: „E-Mail“ und „geht’s“ zählen jeweils als ein Wort. Die Zählregel ist auf deutsche Texte ausgelegt. Gezählt wird nur per Button; spätere Änderungen werden als veraltetes Ergebnis gekennzeichnet.

## Prüfungen

`node --test app.test.cjs`

Tests prüfen Wortzählung einschließlich Türkisch, manuelles Starten, konkrete Geräteübergabe, Pegel und Freigabe von Streams, Auswahl und Speicherung der Erkennungssprache, wechselnde Erkennungsergebnisse, Stoppen vor dem Zählen, Berechtigungsfehler, Tabwechsel, Zeitlimits und eingeschränkte Browser. Mikrofon und externer Erkennungsdienst müssen zusätzlich mit echter Sprache im jeweiligen Browser geprüft werden.
