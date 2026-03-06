<div align="center">

<img src="assets/banner.svg" alt="JARVIS 2.0" width="100%">

<br>

<a href="https://readme-typing-svg.demolab.com">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=18&duration=3000&pause=1000&color=00FF41&center=true&vCenter=true&width=600&lines=%3E+Autonomous+Multi-Agent+AI+Orchestration;%3E+Self-hosted+on+dedicated+Mac+hardware;%3E+40%2B+tools+%7C+15+plugins+%7C+6+LLM+providers;%3E+System+online.+All+agents+operational." alt="Typing SVG">
</a>

<br><br>

[![TypeScript](https://img.shields.io/badge/TYPESCRIPT-5.x-00ff41?style=for-the-badge&logo=typescript&logoColor=00ff41&labelColor=0a0a0a)](https://typescriptlang.org)
[![Node.js](https://img.shields.io/badge/NODE.JS-22+-00ff41?style=for-the-badge&logo=node.js&logoColor=00ff41&labelColor=0a0a0a)](https://nodejs.org)
[![React](https://img.shields.io/badge/REACT-19-00ff41?style=for-the-badge&logo=react&logoColor=00ff41&labelColor=0a0a0a)](https://react.dev)
[![NATS](https://img.shields.io/badge/NATS-PUB%2FSUB-00ff41?style=for-the-badge&logo=nats.io&logoColor=00ff41&labelColor=0a0a0a)](https://nats.io)
[![Redis](https://img.shields.io/badge/REDIS-STATE-00ff41?style=for-the-badge&logo=redis&logoColor=00ff41&labelColor=0a0a0a)](https://redis.io)
[![Claude](https://img.shields.io/badge/CLAUDE_OPUS-4.6-00ff41?style=for-the-badge&logo=anthropic&logoColor=00ff41&labelColor=0a0a0a)](https://anthropic.com)
[![License](https://img.shields.io/badge/LICENSE-PRIVATE-555555?style=for-the-badge&labelColor=0a0a0a)]()
[![Website](https://img.shields.io/badge/WEBSITE-LIVE-00ff41?style=for-the-badge&logo=firebase&logoColor=00ff41&labelColor=0a0a0a)](https://jarvis2-website.web.app)
[![X/Twitter](https://img.shields.io/badge/FOLLOW-@0__jarvis63497-00ff41?style=for-the-badge&logo=x&logoColor=00ff41&labelColor=0a0a0a)](https://x.com/0_jarvis63497)
[![Donate](https://img.shields.io/badge/DONATE-SUPPORT_JARVIS-ff6600?style=for-the-badge&logo=stripe&logoColor=white&labelColor=0a0a0a)](https://buy.stripe.com/eVqcN7bbA9v397k14c4sE00)
[![Download](https://img.shields.io/badge/DOWNLOAD-macOS_App-00ff41?style=for-the-badge&logo=apple&logoColor=00ff41&labelColor=0a0a0a)](https://github.com/Jarvis-2-0-kit/Jarvis-2.0/releases/latest)

</div>

<img src="assets/divider.svg" alt="" width="100%">

## ░ DOWNLOAD

<div align="center">

```
╔══════════════════════════════════════════════════════════════╗
║  JARVIS DESKTOP APP  ◆  macOS  ◆  Apple Silicon  ◆  v1.3.0 ║
╚══════════════════════════════════════════════════════════════╝
```

All-in-one native macOS application — bundles **Gateway**, **Dashboard**, **NATS**, and **Redis**. Zero setup required. Download, open, and go.

| | |
|:--|:--|
| **Platform** | macOS 13.0+ (Apple Silicon — M1/M2/M3/M4) |
| **Size** | ~43 MB |
| **Includes** | Gateway + Dashboard + NATS + Redis |
| **Setup** | None — download, open, done |

[**⬇ Download Latest Release**](https://github.com/Jarvis-2-0-kit/Jarvis-2.0/releases/latest)

</div>

<img src="assets/divider.svg" alt="" width="100%">

## ░ NEW FEATURES

<table>
<tr>
<td width="60%">

### Automatic OTA Updates

One-click over-the-air updates — right from the dashboard. Gateway polls GitHub every 5 minutes and notifies you when new commits are available. Hit **UPDATE NOW** and the system pulls, builds, and restarts itself automatically.

- **CHECK UPDATES** button in the top-right corner of **System Overview**
- Cyan banner appears below the page title when updates are available
- Shows commit count, HEAD range, and latest commit message
- Automatic rollback if the build fails

> **Where to find it:** Open the Dashboard → **System Overview** (first page) → look for the **CHECK UPDATES** button in the top-right corner next to REFRESH.

</td>
<td width="40%">

<img src="screenshots/ota-update.png" alt="OTA Update — System Overview" width="100%">
<br>
<samp>System Overview with CHECK UPDATES button (top-right)</samp>

</td>
</tr>
<tr>
<td width="60%">

### Agent Setup Wizard

Dashboard-integrated wizard for agent onboarding, deployment, and lifecycle management. No more manual CLI setup — configure and launch agents from the UI.

- **3-step wizard** — Master Status → Add Agent → Verify & Launch
- Auto-generates NATS tokens and auth credentials
- One-click `.env` generation for remote agents
- **Start / Stop / Restart** buttons directly in Agents view
- Network scan for automatic machine discovery
- Agent Registry panel with real-time status tracking

> **Where to find it:** Open the Dashboard → **Sidebar** → **Setup Wizard** (under System group). Or manage running agents from **Agents** view with the new lifecycle buttons.

</td>
<td width="40%">

### macOS Desktop App

Native Swift + WebKit wrapper that bundles the entire Jarvis stack into a single `.app` — no terminal, no brew, no config files.

- **Zero setup** — download, open, done
- Bundles Gateway, Dashboard, NATS, Redis
- Apple Silicon optimized (M1/M2/M3/M4)
- macOS 13.0+ compatible
- ~43 MB download size

> **Download:** [**GitHub Releases**](https://github.com/Jarvis-2-0-kit/Jarvis-2.0/releases/latest)

</td>
</tr>
<tr>
<td width="60%">

### Marketing Engine v4

Full-stack marketing brain with 12 SQLite tables — viral content detection, competitor tracking, lead scoring, email campaigns, and self-learning performance optimization.

- **Viral Tracker** — monitors trends and detects viral content opportunities
- **Lead Scoring** — automated outreach pipeline with scoring model
- **Email Campaigns** — A/B testing, template management, send scheduling
- **Content Library** — centralized asset management across all platforms
- **Performance Logger** — self-learning loop that improves results over time
- Loads custom system prompt from NAS (`config/marketing-hub-prompt.md`)

> **Where to find it:** Dashboard → **Marketing Hub** — full UI for campaign management, analytics, and content scheduling.

</td>
<td width="40%">

### Website Builder & Deployer

AI-powered website generation with Firebase full-stack deployment — from prompt to production in one command.

- **Tailwind CSS v4** + semantic HTML5 generation
- **SEO optimization** — meta tags, Open Graph, JSON-LD schema
- **Dark/light mode** with system preference detection
- **Firebase deployment** — Hosting, Functions, Firestore, Security Rules
- Accessibility features (ARIA, skip navigation)
- Tools: `website_generate`, `website_add_page`, `website_deploy`

</td>
</tr>
<tr>
<td width="60%">

### Advanced Media Generation

Multi-format AI content creation — images, videos, voice, and avatar generation from a single unified tool.

- **Flux Pro** — high-quality image generation (fal.ai)
- **DALL-E** — OpenAI gpt-image-1 (square, landscape, portrait)
- **Kling 3.0** — AI video generation (up to 10s)
- **ElevenLabs** — multilingual voice synthesis (11 voices)
- **HeyGen** — talking-head avatar videos
- **Runway** — video generation API
- Aspect ratios: 1:1, 16:9, 9:16, 4:3

</td>
<td width="40%">

### Social Media Automation

End-to-end social media management across 6 platforms — content generation, scheduling, cross-posting, and analytics.

- **6 platforms**: Twitter/X, Instagram, Facebook, LinkedIn, TikTok, Reddit
- **Content Generator** — platform-optimized posts via Claude Haiku
- **Scheduler** — content calendar with auto-publish every 60s
- **Analytics** — multi-platform insights and post-level metrics
- Retry logic with exponential backoff
- Campaign mode for coordinated multi-platform launches

</td>
</tr>
</table>

<img src="assets/divider.svg" alt="" width="100%">

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  JARVIS SYSTEM v2.0.0  ◆  STATUS: OPERATIONAL  ◆  NODES: 3  ◆  UPLINK: OK ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

> `40+ TOOLS LOADED` | `15 PLUGINS ACTIVE` | `34 DASHBOARD VIEWS` | `6 LLM PROVIDERS` | `50+ SKILLS AVAILABLE`

A personal AI infrastructure running on dedicated Mac Mini hardware — coordinating multiple autonomous agents through NATS messaging, Redis state, and a cyberpunk-themed real-time dashboard. Unlike cloud-only AI assistants, Jarvis operates on your own hardware with full access to your local environment — files, applications, shell, network, and macOS APIs.

<img src="assets/divider.svg" alt="" width="100%">

## ░ ARCHITECTURE

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                             JARVIS 2.0 PLATFORM                                ║
╠══════════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   ┌────────────┐  ┌────────────┐                                               ║
║   │  DASHBOARD │  │  CLI/API   │             ◆ USER INTERFACES                 ║
║   │  React 19  │  │  REST/WS   │                                               ║
║   └─────┬──────┘  └─────┬──────┘                                               ║
║         │ WS             │ HTTP                                                 ║
║         └───────┬────────┘                                                     ║
║                 ▼                                                               ║
║          ┌─────────────┐                                                        ║
║          │   GATEWAY   │◄════► ┌───────┐                                        ║
║          │   Node.js   │       │ REDIS │                                        ║
║          └──────┬──────┘       │ State │                                        ║
║                 │              └───────┘                                         ║
║                 ▼                                                                ║
║          ┌─────────────┐                                                        ║
║          │    NATS     │          ◆ MESSAGE BUS                                 ║
║          │   Pub/Sub   │                                                        ║
║          └──┬───┬───┬──┘                                                        ║
║             │   │   │                                                           ║
║     ┌───────┘   │   └───────┐                                                   ║
║     ▼           ▼           ▼                                                   ║
║  ┌──────────┐ ┌──────────┐ ┌──────────┐                                         ║
║  │  JARVIS  │ │  SMITH   │ │  JOHNY   │  ◆ AGENTS                              ║
║  │ Orchest. │ │   Dev    │ │Marketing │                                         ║
║  │  Master  │ │ Mac Mini │ │ Mac Mini │                                         ║
║  └──────────┘ └────┬─────┘ └────┬─────┘                                         ║
║       ▲            │            │                                                ║
║       │            └─────┬──────┘                                                ║
║       │    delegates     │  communicate                                          ║
║       └──────────────────┘                                                       ║
║                                                                                  ║
║                 ┌─────────────┐                                                  ║
║                 │     NAS     │   ◆ SHARED STORAGE                               ║
║                 │   Storage   │                                                  ║
║                 └─────────────┘                                                  ║
║                                                                                  ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

| Component | Description |
|:----------|:------------|
| `GATEWAY` | Central HTTP/WebSocket server — routes requests, manages state, serves dashboard |
| `DASHBOARD` | React 19 SPA with cyberpunk theme — real-time monitoring, chat, task management |
| `CLI/API` | REST/WebSocket interface for programmatic access and command-line control |
| `JARVIS` | Orchestrator agent — manages, delegates, and coordinates Smith & Johny |
| `SMITH` | Dev agent — coding, builds, deploys (Mac Mini) |
| `JOHNY` | Marketing agent — research, content, social media (Mac Mini) |
| `NATS` | High-performance message bus — inter-agent communication |
| `REDIS` | Task queue, agent state, session storage |
| `NAS` | QNAP TP-233 shared storage — configs, sessions, artifacts, knowledge, API keys |

<img src="assets/divider.svg" alt="" width="100%">

## ░ FEATURES

<details>
<summary><b>Multi-Agent Orchestration</b></summary>
<br>

- Multiple autonomous agents running on dedicated Mac Mini nodes
- Task delegation — agents can assign subtasks to other agents based on capabilities
- Priority queues (critical/high/normal/low) with Redis-backed state
- Dependency orchestration — tasks with prerequisites, automatic unblocking
- Human-in-the-loop approvals for sensitive operations

</details>

<details>
<summary><b>Real-Time Dashboard</b></summary>
<br>

- Cyberpunk-themed UI with matrix green palette, glow effects, and scanline overlay
- 32 views — Agents, Chat, Tasks, Sessions, Workflows, Timeline, Orchestrator, Setup Wizard, and more
- Fullscreen App Launcher — macOS Launchpad-style navigation with 5 categorized groups
- Live WebSocket updates — agent heartbeats, task progress, chat messages
- Code-split routing — React.lazy() for all views with Suspense loading

</details>

<details>
<summary><b>AI Chat Interface</b></summary>
<br>

- Full Markdown rendering — headers, lists, tables, code blocks with syntax highlighting
- Message search (Ctrl+F) with match highlighting and result count
- Auto-session naming from first user message
- Inline message editing and resend
- Heartbeat latency indicator — real-time connection health
- Streaming protection — beforeunload warning during active responses

</details>

<details>
<summary><b>Communication Channels</b></summary>
<br>

- **iMessage** — Full messenger interface with contact list from Contacts.app, chat threads with bubbles, compose mode, AppleScript integration
- **WhatsApp** — Bridge for sending commands and receiving updates
- **Telegram** — Bot integration for remote agent control
- **Discord** — Server management and messaging
- **Slack** — Workspace integration
- Native **voice interface** with TTS/STT

</details>

<details>
<summary><b>6 LLM Providers with Auto-Failover</b></summary>
<br>

- **Anthropic** (Claude Opus 4.6, Sonnet 4.6, Haiku 4.5) — primary provider
- **OpenAI** (GPT-4, DALL-E) — secondary provider
- **Google Gemini** — Gemini models for specialized tasks
- **OpenRouter** — multi-model aggregator (100+ models)
- **Ollama** — local model support (Llama, Mistral, etc.)
- **Claude CLI** — use Claude Code's own OAuth token (zero-config)
- Automatic failover with `chatWithFailover()` — cascading model chains

</details>

<details>
<summary><b>Task Orchestration & Decomposition</b></summary>
<br>

- **Task Decomposer** — breaks complex tasks into subtasks with dependencies
- **Dependency DAG** — directed acyclic graph for task scheduling
- **Auto-assignment** — routes subtasks to Smith or Johny based on capabilities
- Pattern-matching rules for common workflows (app building, deployments, campaigns)
- Complexity estimation and time prediction
- Per-agent concurrency limits + global throttling
- File-based delegation polling from NAS

</details>

<details>
<summary><b>Workflow Engine</b></summary>
<br>

- GitHub Actions + n8n + Temporal.io inspired workflow system
- Template-based multi-step workflows with variables
- Step types: `tool_call`, `set_variable`, `condition`, `log`, `notify`, `wait`, `delegate`, `http`, `script`
- Conditionals and branching logic
- Parallel step groups for concurrent execution
- Error handling per step: retry / skip / abort
- Tools: `workflow_create`, `workflow_execute`, `workflow_list`, `workflow_pause`, `workflow_resume`

</details>

<details>
<summary><b>Research Pipeline</b></summary>
<br>

- 4-layer structured research framework: **Research → Analysis → Strategy → Action**
- Scope options: quick (5 min), standard (15 min), deep (30+ min)
- Focus areas: competitors, market size, trends, opportunities, audience
- Output formats: summary, report, SWOT, competitive analysis, full report
- Saves framework and brief to NAS for guided execution

</details>

<details>
<summary><b>Smart Home Integration</b></summary>
<br>

- **Home Assistant** integration via REST API
- Control: lights, switches, climate, scenes, automations, locks, media players
- Entity state monitoring and automation triggers
- Tools: `home_assistant` with action-based API

</details>

<details>
<summary><b>Daily Summary & Monitoring</b></summary>
<br>

- Auto-generated end-of-day Markdown summaries
- Tracks agent status, LLM costs, infrastructure health
- Saves to NAS and optionally syncs to Obsidian vault
- Configurable summary time (hour:minute)

</details>

<details>
<summary><b>Mobile App Build & Submit</b></summary>
<br>

- React Native / Expo build pipeline
- **Fastlane** and **EAS Build** support
- Local builds for iOS and Android
- **App Store Connect** and **Google Play** submission via EAS Submit
- Tools: `mobile_build`, `mobile_submit`

</details>

<details>
<summary><b>Skills Marketplace</b></summary>
<br>

- 50+ skills across 12 categories (Dev, Apple, Media, Smart Home, AI, Security...)
- Visual browser with install/enable toggles
- Requirement detection (binaries, env vars, platform)
- Categories: Jarvis, Dev, Productivity, Communication, Apple, Media, Smart Home, Utility, Knowledge, System, AI, Security

</details>

<img src="assets/divider.svg" alt="" width="100%">

## ░ CAPABILITIES

> `AGENT TOOLSET // 40+ INTEGRATED TOOLS`

| Tool | Function |
|:-----|:---------|
| `exec` | Shell command execution with sandboxing |
| `read` / `write` / `edit` / `list` / `search` | Full filesystem access |
| `browser` / `web_fetch` / `web_search` | Web browsing and research |
| `ssh_exec` | Remote command execution across machines |
| `computer` | VNC-based GUI automation (mouse, keyboard, screenshots) |
| `imessage` | Send/read iMessages, search conversations |
| `spotify` | Playback control, search, playlists |
| `cron` | Schedule recurring tasks |
| `calendar` | macOS Calendar integration |
| `home_assistant` | Smart home control (lights, climate, scenes, locks) |
| `image_generate` | DALL-E image generation (gpt-image-1) |
| `media_generate` | Flux Pro, Kling 3.0, ElevenLabs, HeyGen, Runway |
| `social_post` / `social_schedule` | Cross-platform social media management |
| `social_generate_content` | AI-powered platform-optimized content creation |
| `research_pipeline` | 4-layer structured research framework |
| `seo_audit` | Website SEO analysis and auditing |
| `mobile_build` / `mobile_submit` | React Native builds + App Store / Google Play submission |
| `deploy` / `monitor` | Vercel/Netlify/git deployment + uptime monitoring |
| `website_generate` / `website_deploy` | AI website builder with Firebase full-stack deployment |
| `message_agent` | Inter-agent messaging and task delegation |

<img src="assets/divider.svg" alt="" width="100%">

## ░ PLUGINS

> `PLUGIN REGISTRY // 15 MODULES LOADED`

| Status | Plugin | Description |
|:------:|:-------|:------------|
| `[ON]` | `jarvis-memory` | Persistent agent memory with NAS-backed storage |
| `[ON]` | `jarvis-metrics` | Token usage tracking, cost monitoring, performance stats |
| `[ON]` | `jarvis-auto-save` | Automatic session saves and artifact management |
| `[ON]` | `jarvis-task-planner` | Task decomposition, delegation, and multi-agent tracking |
| `[ON]` | `jarvis-notifications` | Push notifications for task completion and alerts |
| `[ON]` | `jarvis-workflow-engine` | GitHub Actions-style workflows with conditions, retries, parallelization |
| `[ON]` | `jarvis-system-monitor` | CPU, memory, disk monitoring with alerts |
| `[ON]` | `activity-timeline` | Agent activity logging and visualization |
| `[ON]` | `health-check` | Service health monitoring with automatic baselines |
| `[ON]` | `rate-limiter` | API rate limiting (60/min, 500/session, 500K tokens) |
| `[ON]` | `voice` | Speech-to-text and text-to-speech interface |
| `[ON]` | `jarvis-obsidian` | Obsidian vault integration (search, read, write, daily notes) |
| `[ON]` | `marketing-engine` | Marketing brain v4 — 12 SQLite tables, viral tracking, lead scoring, email campaigns |
| `[ON]` | `social-scheduler` | Background auto-publisher — checks every 60s, retry with exponential backoff |
| `[ON]` | `website-builder` | AI website generation + Firebase full-stack deployment |

<img src="assets/divider.svg" alt="" width="100%">

## ░ SCREENSHOTS

<div align="center">

<table>
<tr>
<td align="center" width="50%">
<img src="screenshots/command-center.png" alt="Command Center" width="100%">
<br>
<b><code>COMMAND CENTER</code></b>
<br>
<samp>Remote control with dual-machine view — live terminal streams, agent chat, task queue, and real-time metrics all in one panel.</samp>
</td>
<td align="center" width="50%">
<img src="screenshots/system-overview.png" alt="System Overview" width="100%">
<br>
<b><code>SYSTEM OVERVIEW</code></b>
<br>
<samp>Infrastructure health at a glance — Gateway, NATS, Redis, NAS status, CPU/Memory/Disk metrics, agent heartbeats, top processes.</samp>
</td>
</tr>
<tr>
<td align="center" width="50%">
<img src="screenshots/app-launcher.png" alt="App Launcher" width="100%">
<br>
<b><code>APP LAUNCHER</code></b>
<br>
<samp>Fullscreen Launchpad-style navigation with 5 categorized groups, fuzzy search, and 4K-optimized icon tiles.</samp>
</td>
<td align="center" width="50%">
<img src="screenshots/skills-browser.png" alt="Skills Browser" width="100%">
<br>
<b><code>SKILLS MARKETPLACE</code></b>
<br>
<samp>50+ skills across 12 categories — GitHub, iMessage, Spotify, Image Gen, Voice, Obsidian, Smart Home, and more.</samp>
</td>
</tr>
</table>

</div>

<img src="assets/divider.svg" alt="" width="100%">

## ░ SYSTEM_MANIFEST

```
╔═══════════════════════════════════════════════════════════════╗
║  SYSTEM MANIFEST                                             ║
╠════════════════════╦══════════════════════════════════════════╣
║  Language          ║  TypeScript 5.x (strict mode)           ║
║  Runtime           ║  Node.js 22+                            ║
║  Monorepo          ║  pnpm workspaces                        ║
║  Frontend          ║  React 19, Vite 6, Zustand, Router 7   ║
║  Backend           ║  Express, WebSocket (ws)                ║
║  Messaging         ║  NATS (Thunderbolt 10Gbps priority)     ║
║  Storage           ║  Redis 7, JSONL files, NAS              ║
║  AI                ║  6 providers: Claude, OpenAI, Gemini,   ║
║                    ║  OpenRouter, Ollama, Claude CLI          ║
║  Build             ║  tsdown, Vite                           ║
║  Icons             ║  lucide-react                           ║
║  Platform          ║  macOS (AppleScript, Messages, Contacts)║
╚════════════════════╩══════════════════════════════════════════╝
```

<img src="assets/divider.svg" alt="" width="100%">

## ░ DASHBOARD_VIEWS

> `34 VIEWS // REAL-TIME MONITORING & CONTROL`

| View | Description |
|:-----|:------------|
| `Home` | System overview with agent status, recent activity |
| `Chat` | AI chat with Markdown rendering, search, editing |
| `Agents` | Agent monitoring — status, capabilities, heartbeat |
| `Tasks` | Task queue management — create, assign, track |
| `Sessions` | Session history and replay |
| `Workflows` | Multi-step workflow builder |
| `Timeline` | Activity timeline across all agents |
| `Orchestrator` | Task dependency graph visualization |
| `Approvals` | Human-in-the-loop approval queue |
| `Scheduler` | Cron-based task scheduling |
| `iMessage` | Full messenger with contacts and chat threads |
| `WhatsApp / Telegram / Discord / Slack` | Channel integrations |
| `Voice` | Speech interface controls |
| `Memory` | Agent memory browser and search |
| `Skills` | Skill marketplace with 50+ skills |
| `Providers` | LLM model configuration |
| `Plugins` | Plugin management |
| `Overview` | System metrics and charts |
| `Usage` | Token usage and cost tracking |
| `Logs` | Real-time log viewer |
| `Notifications` | Alert management |
| `Instances` | Hardware node monitoring |
| `Integrations` | Third-party service status |
| `API Keys` | Credential management |
| `Files` | NAS file browser |
| `Environment` | Environment variable management |
| `Config` | System configuration |
| `Setup Wizard` | Agent onboarding wizard — add, deploy, and manage agents |
| `Marketing` | Marketing Hub — campaigns, content library, viral tracking, lead scoring |
| `Social Media` | Social media posting, scheduling, analytics aggregation |
| `Debug` | Debug tools and diagnostics |

<img src="assets/divider.svg" alt="" width="100%">

## ░ HARDWARE

```
                    ┌─────────────────────────────────┐
                    │         NETWORK TOPOLOGY         │
                    └────────────────┬────────────────┘
                                     │
                 ┌───────────────────┼───────────────────┐
                 │                   │                   │
        ┌────────┴────────┐ ┌───────┴────────┐ ┌───────┴────────┐
        │   MAC MINI M2   │ │  MAC MINI M2   │ │  MAC MINI M2   │
        │    (Master)     │ │  (Agent Alpha) │ │  (Agent Beta)  │
        │    16GB RAM     │ │                │ │                │
        ├─────────────────┤ ├────────────────┤ ├────────────────┤
        │ ◆ Gateway       │ │ ◆ Dev Agent    │ │ ◆ Marketing    │
        │ ◆ NATS Server   │ │ ◆ Coding       │ │ ◆ Research     │
        │ ◆ Redis         │ │ ◆ Builds       │ │ ◆ Content      │
        │ ◆ Dashboard     │ │ ◆ Deploys      │ │ ◆ Social Media │
        └────────┬────────┘ └───────┬────────┘ └───────┬────────┘
                 │                   │                   │
                 │  ◄══ Thunderbolt 10Gbps ══►          │
                 │                   │      ◄══ Ethernet 1Gbps ══►
                 │                   │                   │
                 └───────────────────┼───────────────────┘
                                     │
                          ┌──────────┴──────────┐
                          │     NAS STORAGE     │
                          │  Configs │ Sessions │
                          │  Memory  │ Artifacts│
                          └─────────────────────┘
```

<img src="assets/divider.svg" alt="" width="100%">

## ░ QUICK_START

```bash
# ── Prerequisites ──────────────────────────────────────────────
# macOS (required for iMessage, Contacts, AppleScript)
# Node.js 22+  |  pnpm 10+  |  Anthropic API Key

# ── Install Infrastructure ─────────────────────────────────────
brew install nats-server redis

# ── Clone & Setup ──────────────────────────────────────────────
git clone https://github.com/Jarvis-2-0-kit/Jarvis-2.0.git
cd Jarvis-2.0/jarvis
pnpm install
pnpm build

# ── Configure ──────────────────────────────────────────────────
cp .env.example .env
# Edit .env with your API keys

# ── Launch Services ────────────────────────────────────────────
brew services start nats-server
brew services start redis

# ── Start Gateway (serves dashboard on :18900) ─────────────────
pnpm --filter @jarvis/gateway start

# ── Start an Agent ─────────────────────────────────────────────
pnpm --filter @jarvis/agent-runtime dev -- --agent agent-smith

# ── Open Dashboard ─────────────────────────────────────────────
open http://localhost:18900
```

<img src="assets/divider.svg" alt="" width="100%">

## ░ PROJECT_STRUCTURE

```
jarvis/
├── packages/
│   ├── agent-runtime/          # ◆ Autonomous AI agent engine
│   │   ├── src/
│   │   │   ├── cli.ts                 # Agent entry point
│   │   │   ├── engine/runner.ts       # LLM conversation loop
│   │   │   ├── llm/                   # Provider registry (Anthropic, OpenAI)
│   │   │   ├── plugins/              # 12 built-in plugins
│   │   │   ├── sessions/             # Session management
│   │   │   └── communication/        # NATS handler
│   │   └── package.json
│   │
│   ├── gateway/                # ◆ Central server
│   │   ├── src/
│   │   │   ├── server.ts              # HTTP + WebSocket + NATS bridge
│   │   │   └── redis/state-store.ts   # Redis task & state management
│   │   └── package.json
│   │
│   ├── dashboard/              # ◆ React web UI
│   │   ├── src/
│   │   │   ├── App.tsx                # Router + lazy loading
│   │   │   ├── components/nav/        # Sidebar + App Launcher
│   │   │   ├── views/                # 32 view components
│   │   │   ├── store/                # Zustand state (gateway, toast)
│   │   │   ├── gateway/client.ts     # WebSocket protocol client
│   │   │   └── theme/global.css      # Cyberpunk theme
│   │   └── package.json
│   │
│   ├── shared/                 # ◆ Shared types & utilities
│   │   └── src/types/                # Zod schemas (Task, Agent, etc.)
│   │
│   ├── desktop/                # ◆ Native macOS app (Swift + WebKit)
│   │   ├── Jarvis.xcodeproj         # Xcode project
│   │   └── Jarvis/                  # Swift source + bundled services
│   │
│   └── tools/                  # ◆ Agent tool implementations
│       └── src/integrations/         # iMessage, Spotify, etc.
│
├── package.json                # Root workspace config
├── pnpm-workspace.yaml
└── README.md
```

<img src="assets/divider.svg" alt="" width="100%">

## ░ CONFIGURATION

### Agent Configuration (NAS)

```json
{
  "agents": {
    "agent-smith": {
      "role": "dev",
      "model": "claude-opus-4-6",
      "capabilities": ["code", "build", "deploy", "imessage", "spotify"],
      "machine": "mac-mini-master"
    },
    "agent-johny": {
      "role": "marketing",
      "model": "claude-opus-4-6",
      "capabilities": ["research", "social-media", "imessage"],
      "machine": "mac-mini-beta"
    }
  }
}
```

### Environment Variables

| Variable | Description |
|:---------|:------------|
| `ANTHROPIC_API_KEY` | Claude API key (required) |
| `OPENAI_API_KEY` | OpenAI API key (optional, secondary provider) |
| `NATS_SERVERS` | NATS connection URLs |
| `REDIS_URL` | Redis connection string |
| `NAS_PATH` | Path to shared NAS storage |
| `GATEWAY_PORT` | Dashboard/API port (default: 18900) |
| `AUTH_TOKEN` | Gateway auth token (auto-generated if not set) |
| `NATS_USER` / `NATS_PASS` | NATS authentication credentials |
| `GOOGLE_AI_API_KEY` | Google Gemini API key (optional) |
| `OPENROUTER_API_KEY` | OpenRouter API key (optional, 100+ models) |
| `OLLAMA_HOST` | Ollama server URL (optional, local models) |
| `OBSIDIAN_API_KEY` | Obsidian Local REST API key |

<img src="assets/divider.svg" alt="" width="100%">

## ░ DEVELOPMENT

```bash
# ── Dev Mode (hot reload) ──────────────────────────────────────
pnpm --filter @jarvis/dashboard dev          # Vite dev server
pnpm --filter @jarvis/gateway dev            # tsx watch
pnpm --filter @jarvis/agent-runtime dev -- --agent agent-smith

# ── Build ──────────────────────────────────────────────────────
pnpm build                                   # Build all packages
pnpm --filter @jarvis/dashboard build        # Build dashboard only

# ── Type Checking ──────────────────────────────────────────────
pnpm --filter @jarvis/shared typecheck
```

<img src="assets/divider.svg" alt="" width="100%">

## ░ SECURITY

> `FORTRESS MODE // 18 VULNERABILITIES PATCHED`

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  SECURITY AUDIT  ◆  34/34 TESTS PASSED  ◆  STATUS: HARDENED               ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

| Layer | Protection | Details |
|:------|:-----------|:--------|
| `AUTH` | Token-based authentication | All WebSocket & REST `/api/*` endpoints require Bearer token. Auto-generated on first start. `crypto.timingSafeEqual()` prevents timing attacks |
| `SECRETS` | API key masking | `apikeys.list` returns only `sk-...****`. Environment variables with `KEY`, `SECRET`, `PASSWORD`, `TOKEN` in name are masked |
| `HEADERS` | Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy`, `X-XSS-Protection` on all responses |
| `RATE LIMIT` | Request throttling | 60 req/min per IP on REST, 30 msg/min per WebSocket connection (token bucket algorithm) |
| `EXEC` | Command sandboxing | Default mode `restricted` — allowlist of safe commands. Blocked patterns: `rm -rf`, `curl\|sh`, `eval`, fork bombs. Environment vars filtered (no secrets in child processes) |
| `INPUT` | Zod validation | Chat messages validated: max 50K chars, required fields, type checking. HTML/XSS tags stripped. Null bytes and injection patterns handled |
| `FILES` | Path jail | `ALLOWED_ROOTS` whitelist — agents cannot read `~/.ssh/`, `~/.gnupg/`, `/etc/shadow`. Symlink escape protection via `fs.realpath()` |
| `SSH` | Host key verification | `known_hosts` validation instead of blind accept. TOFU (Trust On First Use) with logged warnings |
| `NATS` | Authenticated messaging | User/password auth on NATS connections. Unauthenticated clients rejected |
| `SESSIONS` | Cryptographic IDs | `crypto.randomUUID()` instead of `Date.now()` + random. Session TTL with auto-cleanup |
| `SQL` | Parameterized queries | iMessage queries use `?` placeholders — no string interpolation |
| `VNC` | Credential protection | No hardcoded passwords in public HTML files. VNC credentials served only to authenticated clients |
| `AUDIT` | Security logging | Auth attempts (success/fail), exec commands, file operations logged. Failed auth alerting after 5 attempts in 5 min |

<details>
<summary><b>Security Test Suite</b></summary>
<br>

```
🔒 JARVIS 2.0 SECURITY TEST SUITE

── 1. Authentication ──
  ✅ WS without token rejected
  ✅ WS with wrong token rejected
  ✅ WS with correct token works
  ✅ REST /api without auth → 401
  ✅ REST /api with auth → 200
  ✅ /health accessible without auth

── 2. Secrets Masking ──
  ✅ API keys are masked (no plaintext)
  ✅ Env vars with secrets are masked

── 3. Input Validation ──
  ✅ XSS tags in chat handled
  ✅ Oversized message rejected
  ✅ Prompt injection handled

── 4. Security Headers ──
  ✅ X-Content-Type-Options: nosniff
  ✅ X-Frame-Options: DENY
  ✅ Content-Security-Policy present

── 5. Advanced ──
  ✅ Timing-safe token comparison
  ✅ Path traversal blocked
  ✅ WebSocket survives malformed JSON
  ✅ WebSocket survives 1MB frame
  ✅ Type confusion rejected
  ✅ SQL injection handled
  ✅ Null byte injection handled

══════════════════════════════════════════════════════
  RESULTS: 34/34 passed, 0 failed
══════════════════════════════════════════════════════
```

</details>

<img src="assets/divider.svg" alt="" width="100%">

## ░ ROADMAP

> `ROADMAP // PLANNED ENHANCEMENTS`

- [x] Authenticated inter-agent messaging (NATS auth)
- [x] Multi-LLM routing (6 providers with auto-failover)
- [x] Marketing automation engine (v4 with 12 SQLite tables)
- [x] Social media scheduler (6 platforms, auto-publish)
- [x] Website builder with Firebase deployment
- [x] Media generation (Flux, Kling, ElevenLabs, HeyGen)
- [x] Smart home integration (Home Assistant)
- [x] Research pipeline (4-layer framework)
- [x] Daily summary reports (NAS + Obsidian sync)
- [x] Mobile build & App Store submission pipeline
- [ ] Multi-modal vision (camera + screen capture analysis)
- [ ] Workflow marketplace (share workflows between agents)
- [ ] Mobile companion app (React Native)
- [ ] Voice wake word ("Hey Jarvis")
- [ ] Plugin hot-reload (no agent restart)
- [ ] Kubernetes deployment option

<img src="assets/divider.svg" alt="" width="100%">

<div align="center">

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║           Built with dedication on Apple Silicon             ║
║                                                              ║
║                  JARVIS 2.0 — v2.0.0                         ║
║           Your personal AI infrastructure.                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

<samp>[ SYSTEM ONLINE ] — All agents operational</samp>

</div>
