<div align="center">

# JARVIS 2.0

### Autonomous Multi-Agent AI Orchestration Platform

<br>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![NATS](https://img.shields.io/badge/NATS-Messaging-27AAE1?logo=nats.io&logoColor=white)](https://nats.io)
[![Redis](https://img.shields.io/badge/Redis-Store-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Claude](https://img.shields.io/badge/Claude_Opus_4.6-Anthropic-D4A574?logo=anthropic&logoColor=white)](https://anthropic.com)
[![License](https://img.shields.io/badge/License-Private-555555)]()

<br>

*A personal AI infrastructure that runs on dedicated Mac Mini hardware,*
*coordinating multiple AI agents through NATS messaging, Redis state,*
*and a cyberpunk-themed real-time dashboard.*

<br>

</div>

---

## Overview

Jarvis 2.0 is a self-hosted, multi-agent AI orchestration system designed for personal automation at scale. It runs on dedicated Mac Mini hardware nodes, each hosting an autonomous AI agent powered by Claude Opus 4.6. Agents communicate through NATS messaging, share state via Redis, and are managed through a real-time web dashboard.

Unlike cloud-only AI assistants, Jarvis operates on your own hardware with full access to your local environment — files, applications, shell, network, and macOS APIs. It can send iMessages, control Spotify, manage your Obsidian vault, execute code, browse the web, and orchestrate complex multi-step workflows across multiple machines.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        JARVIS 2.0 PLATFORM                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│  │ Dashboard │◄──►│ Gateway  │◄──►│   NATS   │◄──►│ Agent Alpha  │  │
│  │ (React)  │ WS │ (Node)   │    │ (Pub/Sub)│    │ (Mac Mini 1) │  │
│  └──────────┘    └────┬─────┘    └────┬─────┘    └──────────────┘  │
│                       │               │                             │
│                  ┌────┴─────┐    ┌────┴─────┐    ┌──────────────┐  │
│                  │  Redis   │    │   NAS    │    │ Agent Beta   │  │
│                  │ (State)  │    │(Storage) │    │ (Mac Mini 2) │  │
│                  └──────────┘    └──────────┘    └──────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

| Component | Description |
|-----------|-------------|
| **Gateway** | Central HTTP/WebSocket server — routes requests, manages state, serves dashboard |
| **Dashboard** | React 19 SPA with cyberpunk theme — real-time monitoring, chat, task management |
| **Agent Runtime** | Autonomous AI agent with 33+ tools, 12 plugins, LLM integration |
| **NATS** | High-performance message bus for inter-agent communication |
| **Redis** | Task queue, agent state, session storage |
| **NAS** | Shared network storage for configs, sessions, artifacts, memory |

---

## Features

### Multi-Agent Orchestration
- **Multiple autonomous agents** running on dedicated Mac Mini nodes
- **Task delegation** — agents can assign subtasks to other agents based on capabilities
- **Priority queues** (critical/high/normal/low) with Redis-backed state
- **Dependency orchestration** — tasks with prerequisites, automatic unblocking
- **Human-in-the-loop approvals** for sensitive operations

### Real-Time Dashboard
- **Cyberpunk-themed UI** with matrix green palette, glow effects, and scanline overlay
- **31 views** — Agents, Chat, Tasks, Sessions, Workflows, Timeline, Orchestrator, and more
- **Fullscreen App Launcher** — macOS Launchpad-style navigation with 5 categorized groups
- **Live WebSocket updates** — agent heartbeats, task progress, chat messages
- **Code-split routing** — React.lazy() for all views with Suspense loading

### AI Chat Interface
- **Full Markdown rendering** — headers, lists, tables, code blocks with syntax highlighting
- **Message search** (Ctrl+F) with match highlighting and result count
- **Auto-session naming** from first user message
- **Inline message editing** and resend
- **Heartbeat latency indicator** — real-time connection health
- **Streaming protection** — beforeunload warning during active responses

### Communication Channels
- **iMessage** — Full messenger interface with contact list from Contacts.app, chat threads with bubbles, compose mode, AppleScript integration
- **WhatsApp** — Bridge for sending commands and receiving updates
- **Telegram** — Bot integration for remote agent control
- **Discord** — Server management and messaging
- **Slack** — Workspace integration
- Native **voice interface** with TTS/STT

### Agent Capabilities (33+ Tools)
- `exec` — Shell command execution with sandboxing
- `read` / `write` / `edit` / `list` / `search` — Full filesystem access
- `browser` / `web_fetch` / `web_search` — Web browsing and research
- `ssh_exec` — Remote command execution across machines
- `computer` — VNC-based GUI automation (mouse, keyboard, screenshots)
- `imessage` — Send/read iMessages, search conversations
- `spotify` — Playback control, search, playlists
- `cron` — Schedule recurring tasks
- `calendar` — macOS Calendar integration

### Plugin System (12 Built-in Plugins)
| Plugin | Description |
|--------|-------------|
| **jarvis-memory** | Persistent agent memory with NAS-backed storage |
| **jarvis-metrics** | Token usage tracking, cost monitoring, performance stats |
| **jarvis-auto-save** | Automatic session saves and artifact management |
| **jarvis-task-planner** | Task decomposition, delegation, and tracking |
| **jarvis-notifications** | Push notifications for task completion and alerts |
| **jarvis-workflow-engine** | Multi-step workflow definitions and execution |
| **jarvis-system-monitor** | CPU, memory, disk monitoring with alerts |
| **activity-timeline** | Agent activity logging and visualization |
| **health-check** | Service health monitoring with automatic baselines |
| **rate-limiter** | API rate limiting (60/min, 500/session, 500K tokens) |
| **voice** | Speech-to-text and text-to-speech interface |
| **jarvis-obsidian** | Obsidian vault integration (search, read, write, daily notes) |

### Skills Marketplace
- **50+ skills** across 12 categories (Dev, Apple, Media, Smart Home, AI, Security...)
- Visual browser with install/enable toggles
- Requirement detection (binaries, env vars, platform)
- Categories: Jarvis, Dev, Productivity, Communication, Apple, Media, Smart Home, Utility, Knowledge, System, AI, Security

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Language** | TypeScript 5.x (strict mode) |
| **Runtime** | Node.js 22+ |
| **Monorepo** | pnpm workspaces |
| **Frontend** | React 19, Vite 6, Zustand, React Router 7 |
| **Backend** | Express, WebSocket (ws) |
| **Messaging** | NATS (with Thunderbolt 10Gbps priority) |
| **Storage** | Redis 7, JSONL files, NAS |
| **AI** | Claude Opus 4.6 (Anthropic), OpenAI (secondary) |
| **Build** | tsdown, Vite |
| **Icons** | lucide-react |
| **Platform** | macOS (AppleScript, Messages.app, Contacts.app) |

---

## Project Structure

```
jarvis/
├── packages/
│   ├── agent-runtime/     # Autonomous AI agent engine
│   │   ├── src/
│   │   │   ├── cli.ts              # Agent entry point
│   │   │   ├── engine/runner.ts    # LLM conversation loop
│   │   │   ├── llm/               # Provider registry (Anthropic, OpenAI)
│   │   │   ├── plugins/           # 12 built-in plugins
│   │   │   ├── sessions/          # Session management
│   │   │   └── communication/     # NATS handler
│   │   └── package.json
│   │
│   ├── gateway/           # Central server
│   │   ├── src/
│   │   │   ├── server.ts           # HTTP + WebSocket + NATS bridge
│   │   │   └── redis/state-store.ts # Redis task & state management
│   │   └── package.json
│   │
│   ├── dashboard/         # React web UI
│   │   ├── src/
│   │   │   ├── App.tsx             # Router + lazy loading
│   │   │   ├── components/nav/     # Sidebar + App Launcher
│   │   │   ├── views/             # 31 view components
│   │   │   ├── store/             # Zustand state (gateway, toast)
│   │   │   ├── gateway/client.ts  # WebSocket protocol client
│   │   │   └── theme/global.css   # Cyberpunk theme
│   │   └── package.json
│   │
│   ├── shared/            # Shared types & utilities
│   │   └── src/types/             # Zod schemas (Task, Agent, etc.)
│   │
│   └── tools/             # Agent tool implementations
│       └── src/integrations/      # iMessage, Spotify, etc.
│
├── package.json           # Root workspace config
├── pnpm-workspace.yaml
└── README.md
```

---

## Quick Start

### Prerequisites

- **macOS** (required for iMessage, Contacts, AppleScript integrations)
- **Node.js 22+**
- **pnpm 10+**
- **NATS Server** — `brew install nats-server`
- **Redis** — `brew install redis`
- **Anthropic API Key** — for Claude Opus 4.6

### Installation

```bash
# Clone the repository
git clone https://github.com/bosoninfinity-beep/Jarvis-2.0.git
cd Jarvis-2.0/jarvis

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Configure environment
cp .env.example .env
# Edit .env with your API keys
```

### Running

```bash
# Start infrastructure
brew services start nats-server
brew services start redis

# Start the gateway (serves dashboard on port 18900)
pnpm --filter @jarvis/gateway start

# Start an agent
pnpm --filter @jarvis/agent-runtime dev -- --agent agent-alpha

# Open the dashboard
open http://localhost:18900
```

---

## Dashboard Views

| View | Description |
|------|-------------|
| **Home** | System overview with agent status, recent activity |
| **Chat** | AI chat with Markdown rendering, search, editing |
| **Agents** | Agent monitoring — status, capabilities, heartbeat |
| **Tasks** | Task queue management — create, assign, track |
| **Sessions** | Session history and replay |
| **Workflows** | Multi-step workflow builder |
| **Timeline** | Activity timeline across all agents |
| **Orchestrator** | Task dependency graph visualization |
| **Approvals** | Human-in-the-loop approval queue |
| **Scheduler** | Cron-based task scheduling |
| **iMessage** | Full messenger with contacts and chat threads |
| **WhatsApp / Telegram / Discord / Slack** | Channel integrations |
| **Voice** | Speech interface controls |
| **Memory** | Agent memory browser and search |
| **Skills** | Skill marketplace with 50+ skills |
| **Providers** | LLM model configuration |
| **Plugins** | Plugin management |
| **Overview** | System metrics and charts |
| **Usage** | Token usage and cost tracking |
| **Logs** | Real-time log viewer |
| **Notifications** | Alert management |
| **Instances** | Hardware node monitoring |
| **Integrations** | Third-party service status |
| **API Keys** | Credential management |
| **Files** | NAS file browser |
| **Environment** | Environment variable management |
| **Config** | System configuration |
| **Debug** | Debug tools and diagnostics |

---

## Hardware Setup

Jarvis 2.0 runs on dedicated Apple hardware:

| Node | Machine | Role | Connection |
|------|---------|------|-----------|
| **Master** | Mac Mini M2 (16GB) | Gateway, NATS, Redis, Dashboard | Ethernet + Thunderbolt |
| **Agent Alpha** | Mac Mini M2 | Dev agent — coding, builds, deploys | Thunderbolt Bridge (10Gbps) |
| **Agent Beta** | Mac Mini M2 | Marketing agent — research, content | Ethernet (1Gbps) |

Agents connect via **NATS Thunderbolt** for ultra-low-latency messaging (sub-millisecond) and fall back to standard Ethernet. Shared storage is provided by a NAS mount accessible to all nodes.

---

## Configuration

### Agent Configuration (NAS)

```json
{
  "agents": {
    "agent-alpha": {
      "role": "dev",
      "model": "claude-opus-4-6",
      "capabilities": ["code", "build", "deploy", "imessage", "spotify"],
      "machine": "mac-mini-master"
    },
    "agent-beta": {
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
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key (required) |
| `OPENAI_API_KEY` | OpenAI API key (optional, secondary provider) |
| `NATS_SERVERS` | NATS connection URLs |
| `REDIS_URL` | Redis connection string |
| `NAS_PATH` | Path to shared NAS storage |
| `GATEWAY_PORT` | Dashboard/API port (default: 18900) |
| `OBSIDIAN_API_KEY` | Obsidian Local REST API key |

---

## Screenshots

> **Note:** Screenshots are from the live dashboard running at `http://localhost:18900`

### App Launcher
*Fullscreen Launchpad-style navigation with 5 categorized groups, search, and 4K-optimized icon tiles.*

### Chat Interface
*AI chat with full Markdown rendering, code blocks, message search (Ctrl+F), inline editing, and latency indicator.*

### iMessage Messenger
*Split-panel messenger with Contacts.app integration, conversation list, iMessage-style chat bubbles, and compose mode.*

### Skills Browser
*50+ skills across 12 categories with install/enable toggles, requirement badges, and visual category filtering.*

### Agent Monitoring
*Real-time agent status with heartbeat tracking, capability badges, session history, and tool usage stats.*

---

## Development

```bash
# Development mode (hot reload)
pnpm --filter @jarvis/dashboard dev     # Vite dev server
pnpm --filter @jarvis/gateway dev       # tsx watch
pnpm --filter @jarvis/agent-runtime dev -- --agent agent-alpha

# Build
pnpm build                              # Build all packages
pnpm --filter @jarvis/dashboard build   # Build dashboard only

# Type checking
pnpm --filter @jarvis/shared typecheck
```

---

## Roadmap

- [ ] Multi-modal vision (camera + screen capture analysis)
- [ ] Workflow marketplace (share workflows between agents)
- [ ] Mobile companion app (React Native)
- [ ] Voice wake word ("Hey Jarvis")
- [ ] Multi-LLM routing (auto-select best model per task)
- [ ] Plugin hot-reload (no agent restart)
- [ ] End-to-end encryption for inter-agent messaging
- [ ] Kubernetes deployment option

---

<div align="center">

Built with dedication on Apple Silicon.

**Jarvis 2.0** — Your personal AI infrastructure.

</div>
