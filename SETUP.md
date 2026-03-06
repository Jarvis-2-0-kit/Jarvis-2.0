# JARVIS 2.0 // SETUP GUIDE

## Architektura systemu

```
                    ┌─────────────────────────────────┐
                    │         QNAP NAS (SMB/NFS)      │
                    │   /jarvis-nas/                   │
                    │   ├── sessions/   knowledge/     │
                    │   ├── workspace/  logs/          │
                    │   ├── media/      config/        │
                    └────────┬────────────────────────┘
                             │ SMB mount (auto)
          ┌──────────────────┼──────────────────┐
          │                  │                  │
  ┌───────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐
  │  MAC MINI     │  │  MAC MINI    │  │  MAC MINI    │
  │  MASTER       │  │  ALPHA       │  │  BETA        │
  │               │  │              │  │              │
  │  Gateway:18900│  │  Agent Dev   │  │  Agent Mktg  │
  │  Dashboard:3K │  │  VNC:6080    │  │  VNC:6080    │
  │  NATS:4222    │  │              │  │              │
  │  Redis:6379   │  │  Playwright  │  │  Social APIs │
  └───────────────┘  └──────────────┘  └──────────────┘
        │                   │                  │
        └───────── NATS (message broker) ──────┘
```

---

## Szybki start (3 kroki)

### Krok 1: Master (na glownym Mac Mini)

```bash
cd ~/Documents/Jarvis-2.0/jarvis
chmod +x scripts/install-master.sh
./scripts/install-master.sh
```

Instalator **automatycznie**:
- Zainstaluje Homebrew, Node.js 22, pnpm, NATS, Redis
- Zapyta o IP urzadzen (lub skan sieci)
- Zamontuje NAS (z auto-mount po restarcie, haslo w Keychain)
- Wygeneruje klucze SSH i skopiuje na agentow
- Wygeneruje token autoryzacji i .env
- Skopiuje projekt na agentow (rsync)
- Uruchomi caly system

### Krok 2: Agent Alpha - Dev (na drugim Mac Mini)

Jesli Master juz zadeplotowal kod przez SSH, wystarczy:
```bash
cd ~/Documents/Jarvis-2.0/jarvis
./scripts/jarvis-agent.sh start
```

Jesli trzeba zainstalowac od zera:
```bash
cd ~/Documents/Jarvis-2.0/jarvis
chmod +x scripts/install-agent.sh
./scripts/install-agent.sh
```

Instalator automatycznie:
- Znajdzie Master w sieci (skan portu 18900)
- Zapyta o role (Dev / Marketing)
- Zainstaluje wszystko (Node, Playwright, Fastlane...)
- Zamontuje NAS
- Uruchomi agenta + websockify (VNC)

### Krok 3: Agent Beta - Marketing (na trzecim Mac Mini)

Identycznie jak Alpha:
```bash
cd ~/Documents/Jarvis-2.0/jarvis
./scripts/install-agent.sh
```
Wybierz role: **2) BETA - Marketing**

---

## Zarzadzanie systemem

### Na Master:
```bash
./scripts/jarvis.sh start      # Start NATS + Redis + Gateway + Dashboard
./scripts/jarvis.sh stop       # Stop wszystkiego
./scripts/jarvis.sh restart    # Restart
./scripts/jarvis.sh status     # Status calego systemu
./scripts/jarvis.sh health     # Health JSON
./scripts/jarvis.sh logs       # Wszystkie logi
./scripts/jarvis.sh logs gateway   # Logi Gateway
```

### Na Alpha/Beta:
```bash
./scripts/jarvis-agent.sh start    # Start agenta + VNC
./scripts/jarvis-agent.sh stop     # Stop
./scripts/jarvis-agent.sh status   # Status
./scripts/jarvis-agent.sh logs     # Logi
```

---

## Dashboard (http://localhost:3000)

- **AGENTS** - status agentow, aktywne taski, historia
- **REMOTE DESKTOPS** - VNC podglad ekranow Alpha/Beta na zywo
- **CHAT** - wysylaj komendy do agentow (ALL / ALPHA / BETA)
- **TASK QUEUE** - lista zadan, priorytety, przypisania
- **METRICS** - statystyki, infrastruktura (NATS/Redis/NAS)
- **CONSOLE** - logi agentow w czasie rzeczywistym
- **SETTINGS** (przycisk w headerze) - konfiguracja sieci, NAS, agentow

---

## Konfiguracja NAS

### Automatyczna (przez instalator)
Instalator pyta o IP NAS, login/haslo i automatycznie:
1. Montuje NAS przez SMB
2. Zapisuje haslo w macOS Keychain
3. Konfiguruje auto-mount przez launchd (restart-proof)

### Reczna
```bash
# Zamontuj
sudo mkdir -p /Volumes/JarvisNAS
mount -t smbfs //USER@IP_NAS/jarvis-nas /Volumes/JarvisNAS

# Lub z haslem
mount -t smbfs //USER:HASLO@IP_NAS/jarvis-nas /Volumes/JarvisNAS
```

### Przez Dashboard
1. Otworz Dashboard -> SETTINGS -> zakladka NAS
2. Wpisz IP, share, login, haslo
3. Kliknij MONTUJ NAS

---

## Wymagane porty

| Port | Opis | Kierunek |
|------|------|----------|
| 4222 | NATS | Alpha/Beta -> Master |
| 6379 | Redis | localhost na Master |
| 18900 | Gateway HTTP+WS | Przegladarka -> Master |
| 3000 | Dashboard | Przegladarka -> Master |
| 6080 | Websockify (VNC) | Master -> Alpha/Beta |
| 5900 | VNC (Screen Sharing) | localhost |
| 445 | SMB (NAS) | Wszystkie -> NAS |

---

## Klucze API

Edytuj `.env` na kazdej maszynie:

```bash
nano .env
```

**LLM (przynajmniej jeden wymagany):**
- `ANTHROPIC_API_KEY` - Claude
- `OPENAI_API_KEY` - GPT-4
- `GOOGLE_AI_API_KEY` - Gemini
- `OPENROUTER_API_KEY` - OpenRouter (wiele modeli)
- Ollama - darmowe lokalne modele (`brew install ollama && ollama pull llama3.2`)

**Social Media (tylko Beta/Marketing):**
- Twitter: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`
- Instagram/Facebook: `META_APP_ID`, `INSTAGRAM_ACCESS_TOKEN`, `FACEBOOK_PAGE_TOKEN`
- LinkedIn: `LINKEDIN_ACCESS_TOKEN`
- TikTok: `TIKTOK_ACCESS_TOKEN`
- Brave Search: `BRAVE_API_KEY`
- Perplexity: `PERPLEXITY_API_KEY`

---

## VNC (Remote Desktop)

### Automatyczna konfiguracja
Instalator agenta automatycznie:
1. Probuje wlaczyc Screen Sharing
2. Instaluje websockify
3. Konfiguruje launchd service

### Reczna konfiguracja
1. **System Settings** -> **General** -> **Sharing** -> **Screen Sharing** ON
2. `websockify 6080 localhost:5900 &`

---

## Troubleshooting

| Problem | Rozwiazanie |
|---------|-------------|
| Agent nie widzi Master | Sprawdz NATS: `nc -z MASTER_IP 4222` |
| NAS nie montuje sie | Sprawdz SMB: `smbclient -L //NAS_IP -U user` |
| VNC nie dziala | Sprawdz: `lsof -i :6080` i Screen Sharing |
| Dashboard nie laczy | Sprawdz Gateway: `curl http://localhost:18900/health` |
| Port zajety | Zabij: `lsof -ti :PORT \| xargs kill` |
| SSH nie dziala | Reczne: `ssh-copy-id -i ~/.ssh/jarvis_ed25519 user@ip` |

---

## Pliki konfiguracyjne

| Plik | Opis |
|------|------|
| `.env` | Konfiguracja serwisow (porty, klucze API, NAS) |
| `.env.example` | Template konfiguracji |
| `scripts/jarvis.sh` | Zarzadzanie Master |
| `scripts/jarvis-agent.sh` | Zarzadzanie Agentem |
| `scripts/install-master.sh` | Instalator Master (jednorazowy) |
| `scripts/install-agent.sh` | Instalator Agent (jednorazowy) |
| `scripts/mount-nas.sh` | Auto-mount NAS (generowany) |
| `scripts/nats.conf` | Konfiguracja NATS (generowana) |
| `NAS/config/network.json` | Konfiguracja sieci (generowana) |
