# Plan: Personal Life-OS Agents für finalform

## Vision
Ein Team von spezialisierten Subagents die als persönliche Assistenten fungieren, orchestrated durch die Telegram Bridge.

## Agent-Rollen

### 1. Health Agent
**Aufgaben:**
- Tägliche Health-Check-Ins ("Wie fühlst du dich heute?")
- Analyse von Health-Daten aus dem Vault
- Erinnerungen an Medikamente/Termine
- Zusammenfassungen für Arztbesuche

**Beispiel-Interaktion:**
```
User: "Ich habe Kopfschmerzen seit 3 Tagen"
Bridge: → Health Agent analysiert
Health Agent: "Ich sehe in deinem Tagebuch erhöhten Stress + schlechter Schlaf. 
Möchtest du einen Termin beim Hausarzt vorschlagen?"
```

### 2. Task Master
**Aufgaben:**
- Aufgaben aus Gesprächen extrahieren
- Priorisierung (Eisenhower-Matrix)
- Erinnerungen
- Wochenplanung

**Beispiel:**
```
User: "Ich muss nächste Woche den Steuerberater anrufen und mein Fahrrad reparieren"
Task Master: "Habe 2 Tasks erstellt:
🔴 Steuerberater anrufen (hoch, Termin nötig)
🟡 Fahrrad reparieren (mittel, Reifen flicken)
Soll ich Erinnerungen setzen?"
```

### 3. Email Kurator
**Aufgaben:**
- Ungelesene Emails zusammenfassen
- Priorisierung (wichtig vs. Newsletter)
- Entwürfe für Antworten schreiben
- Follow-up Erinnerungen

**Beispiel:**
```
User: "Was ist wichtig in meinem Posteingang?"
Email Agent: "3 wichtige Emails:
1. Versicherung - Dokumente fehlen (antworten bis Freitag)
2. Eltern - Treffen am Wochenende planen
3. Arbeit - Projekt-Update angefordert
Soll ich einen Entwurf für #3 schreiben?"
```

### 4. Calendar Agent
**Aufgaben:**
- Termine analysieren und vorschlagen
- Konflikte erkennen
- Optimale Zeiten für Tasks finden
- Vorbereitungs-Erinnerungen

**Beispiel:**
```
User: "Wann habe ich Zeit für Sport diese Woche?"
Calendar Agent: "3 Slots verfügbar:
- Di 18:00-19:00 (nach Arbeit)
- Do 07:00-08:00 (vor Meetings)
- Sa 10:00-12:00 (Wochenende)
Soll ich einen Blocker eintragen?"
```

### 5. Diary Scribe
**Aufgaben:**
- Tägliche Journaling-Prompts
- Stimmungs-Tracking
- Highlights des Tages zusammenfassen
- Reflexions-Fragen

**Beispiel:**
```
User: "Fasse meinen Tag zusammen"
Diary Agent: "Heute:
✅ Projekt X abgeschlossen
✅ 30min Sport
✅ Gesundes Essen

Stimmung: Gut, aber müde
Highlight: Das Gespräch mit Y

Möchtest du ein Journaling-Prompt für heute Abend?"
```

## Architektur

### Kommunikations-Flow
```
User Telegram
    ↓
Bridge Agent (Orchestrator)
    ↓ (delegiert an)
Subagents (parallel oder sequentiell)
    ↓
Ergebnisse → Bridge → User
```

### Wichtige Features
1. **Async Execution** - Subagents laufen im Hintergrund
2. **Progress Updates** - "Der Health Agent analysiert..."
3. **Session Sharing** - Zugriff auf Vault-Daten
4. **Tool Access** - Lesen/Schreiben im Vault

## Implementation

### Phase 1: Setup
1. pi-subagents installieren
2. Agent-Definitionen erstellen (.md files)
3. Bridge-Integration bauen

### Phase 2: Agenten erstellen
Für jeden Agent:
- System-Prompt definieren
- Tools konfigurieren (read, write, grep)
- Beispiel-Workflows testen

### Phase 3: Integration
- Bridge erweitern für Subagent-Delegation
- Event-Handling für Notifications
- Error-Handling

## Technische Details

### Agent-Definition (Beispiel: Health Agent)
```yaml
---
name: health-agent
description: Persönlicher Health-Assistent
tools: read, write, grep, find
model: claude-sonnet-4-20250514
output: health-analysis.md
---

Du bist ein Health-Assistent für den User.
Zugriff auf: ~/projects/finalform/health/

Aufgaben:
1. Analysiere Health-Daten
2. Identifiziere Patterns
3. Gebe Empfehlungen
4. Dokumentiere Ergebnisse
```

### Bridge-Integration
```typescript
// Wenn User nach Health fragt
if (detectHealthQuery(text)) {
  // Starte Health Agent im Hintergrund
  const job = await subagent.run({
    agent: "health-agent",
    task: text,
    background: true
  });
  
  // Sofortige Rückmeldung
  sendReply("🔍 Health Agent analysiert...");
  
  // Wenn fertig, Notification
  job.onComplete = (result) => {
    sendVoiceMessage(result.summary);
  };
}
```

## Nächste Schritte

1. **Installation**: pi-subagents testen
2. **Erster Agent**: Health Agent als MVP
3. **Integration**: Bridge erweitern
4. **Test**: End-to-End Workflow

## Offene Fragen

- Soll der Health Agent auch Erinnerungen senden können?
- Wie oft sollen automatische Check-Ins passieren?
- Sollen Agents Daten voneinander teilen können?
