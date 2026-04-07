# Plan: Trusted User System für pi-bridge

## Ziel
Die Bridge soll für vertrauenswürdige Nutzer (z.B. nur der Admin) Zugriff auf alle pi-Tools und Skills haben, während unbekannte Nutzer eingeschränkt sind.

## Sicherheitsstufen

### Level 1: Trusted User (Admin)
- Voller Zugriff auf alle Tools
- Kann Dateien lesen/schreiben
- Kann Shell-Befehle ausführen
- Kann Web-Search nutzen
- Kann Skills aufrufen

### Level 2: Standard User
- Nur Chat-Funktionalität
- Kein Tool-Zugriff
- Oder: Nur "sichere" Tools (read, web_search)

### Level 3: Blocked
- Gar kein Zugriff

## Implementation

### 1. Config-Erweiterung
```json
"security": {
  "trustedChatIds": ["14939216"],
  "trustedPermissions": {
    "read": true,
    "write": true,
    "shell": true,
    "web_search": true,
    "skills": true,
    "tts": true,
    "restart": false,
    "config_edit": false
  },
  "untrustedPermissions": {
    "read": false,
    "write": false,
    "shell": false,
    "web_search": true,
    "skills": false
  }
}
```

### 2. Tool-Proxy System
Die Bridge muss Befehle an die Haupt-pi-Instanz senden können:
- Neue Event-Types: `bridge:execute`, `bridge:result`
- Oder: Direkter IPC/Subprocess-Aufruf

### 3. Berechtigungsprüfung
Vor jedem Tool-Aufruf:
1. Prüfe Chat-ID
2. Bestimme Trust-Level
3. Prüfe Berechtigung für das Tool
4. Führe aus oder blockiere

### 4. Skills-Integration
Skills müssen über die Bridge erreichbar sein:
- Skill-Registry Zugriff
- Skill-Ausführung
- Skill-Antwort zurück an Telegram

## Dateien zu ändern
1. `src/types.ts` - SecurityConfig Interface
2. `src/config.ts` - Config loading für Security
3. `src/bridge/bridge.ts` - Berechtigungsprüfung
4. `src/bridge/tool-proxy.ts` - NEU: Tool-Proxy System
5. `src/adapters/telegram.ts` - Trusted User Erkennung

## Akzeptanzkriterien
- [ ] Trusted Users können alle Tools nutzen
- [ ] Untrusted Users haben eingeschränkten Zugriff
- [ ] Config-gesteuerte Berechtigungen
- [ ] Sensible Aktionen (restart, config) sind blockiert
- [ ] Skills funktionieren für Trusted Users
- [ ] Web-Search funktioniert für alle (oder nur Trusted)
