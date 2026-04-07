# Plan: Sprachnachrichten senden (TTS)

## Ziel
Der Bot soll Sprachnachrichten (Voice Messages) senden können wenn der Nutzer es wünscht.

## Architektur

### 1. TTS Provider System (ähnlich wie Transcription)
- **OpenAI** (primary) - `tts-1` oder `tts-1-hd` Modelle
- **ElevenLabs** (secondary) - Hohe Qualität, mehr Stimmen
- **Apple** (optional/lokal) - `say` Command auf macOS

### 2. Neue Dateien
- `src/adapters/tts.ts` - TTS Provider Interface + Implementierungen
- `src/adapters/telegram-voice.ts` - Telegram Voice Send Helper

### 3. Telegram Adapter Erweiterung
- `sendVoice()` Methode hinzufügen
- Unterstützung für .ogg/OPUS Format
- Multipart/form-data Upload

### 4. Integration
- Tool: `notify` erweitern mit `voice=true` Parameter
- Oder: Automatisch bei langen Texten (>500 Zeichen)
- Oder: Trigger-Wort erkennen ("sende als Sprachnachricht")

### 5. Config
```json
"tts": {
  "enabled": true,
  "provider": "openai",
  "model": "tts-1",
  "voice": "alloy",
  "autoVoiceThreshold": 500
}
```

## Implementierungsschritte

1. [ ] TTS Provider Interface erstellen
2. [ ] OpenAI TTS implementieren
3. [ ] ElevenLabs TTS implementieren
4. [ ] Apple TTS (say) implementieren
5. [ ] Telegram sendVoice Methode
6. [ ] Tool/Command Integration
7. [ ] Tests

## Akzeptanzkriterien
- [ ] Bot kann Text als Sprachnachricht senden
- [ ] Mehrere TTS Provider unterstützt
- [ ] Config-gesteuert
- [ ] Automatisch oder manuell auslösbar
