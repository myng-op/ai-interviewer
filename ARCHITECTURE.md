# gabm-ai-interviewer — Software Architecture

> **Last updated:** 2026-04-15 — Incremental message persistence

## Architecture Diagram

```mermaid
graph TB
    subgraph Browser["🖥️ Browser (React + Vite, port 3000)"]
        direction TB
        HTML["index.html<br/>#root mount"]
        Main["main.tsx<br/>React 19 entry"]
        App["App.tsx<br/>View router: setup → interview → results"]
        Types["types.ts<br/>Question, InterviewMessage,<br/>InterviewState, InterviewScript"]
        
        subgraph Components["Components"]
            IS["InterviewSession.tsx<br/>3-state UI: idle / active / completed<br/>Timer · Mute · Messages feed"]
        end
        
        subgraph Lib["Library"]
            RT["realtime.ts<br/>RealtimeSession class<br/>WebSocket client · Mic capture<br/>Audio playback · VAD"]
            AZ["azureConfig.ts<br/>VITE_* env reader<br/>host · apiKey · model · voice"]
            LS["loadScript.ts<br/>Fetch & parse JSON<br/>interview script"]
        end
        
        subgraph Styling["Styling & Assets"]
            CSS["index.css<br/>Tailwind 4 · Custom scrollbar"]
            Icons["public/<br/>female_face.svg · OP_logo.png<br/>interview_scripts/test_1.json"]
        end
        
        HTML --> Main
        Main --> App
        App -->|setup view| LS
        App -->|interview view| IS
        IS --> RT
        RT --> AZ
        LS --> Types
        IS --> Types
        App --> Types
    end

    subgraph Backend["⚙️ Express Server (port 3001)"]
        direction TB
        Server["server/index.ts<br/>Express 5 + better-sqlite3"]
        
        subgraph Endpoints["REST API"]
            E1["POST /api/interviews<br/>Create session"]
            E2["POST /api/interviews/:id/messages<br/>Append one message"]
            E3["PATCH /api/interviews/:id/complete<br/>Mark finished"]
            E4["GET /api/interviews<br/>List all"]
            E5["GET /api/interviews/:id<br/>Get with messages"]
        end
        
        DB[("data/interviews.db<br/>SQLite WAL<br/>─────────────<br/>interviews table<br/>interview_messages table")]
        
        Server --> E1
        Server --> E2
        Server --> E3
        Server --> E4
        Server --> E5
        E1 --> DB
        E2 --> DB
        E3 --> DB
        E4 --> DB
        E5 --> DB
    end

    subgraph Azure["☁️ Azure OpenAI"]
        GPT["gpt-realtime-1.5<br/>Speech-to-Speech"]
        Whisper["Whisper-1<br/>Input Transcription"]
        VAD["Server-side VAD<br/>Turn detection<br/>700ms silence"]
    end

    subgraph Config["🔧 Configuration"]
        ENV[".env<br/>VITE_AZURE_ENDPOINT<br/>VITE_AZURE_API_KEY<br/>VITE_AZURE_REALTIME_MODEL<br/>VITE_AZURE_REALTIME_VOICE"]
        Script["interview_scripts/test_1.json<br/>3 questions: content, type,<br/>requirement, condition, max_sec"]
        PKG["package.json<br/>dev: vite :3000<br/>dev:server: tsx watch :3001"]
        Vite["vite.config.ts<br/>/api → localhost:3001 proxy<br/>Tailwind + React plugins"]
    end

    %% Data flows
    App -- "1. POST /api/interviews<br/>(create session at start)" --> Server
    IS -- "2. POST .../messages<br/>(fire-and-forget per turn)" --> Server
    IS -- "3. PATCH .../complete<br/>(on end)" --> Server
    App -- "GET /api/interviews" --> Server

    RT <== "WebSocket (wss://)<br/>PCM16 24kHz audio ↕<br/>Transcript events ↕" ==> GPT
    GPT --> Whisper
    GPT --> VAD

    ENV -.-> AZ
    Script -.-> LS
    Vite -.->|proxy /api| Server
```

## Interview Lifecycle (Sequence)

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant App as App.tsx
    participant IS as InterviewSession
    participant RT as RealtimeSession
    participant API as Express :3001
    participant DB as SQLite
    participant Azure as Azure GPT Realtime 1.5

    Note over App: Setup View
    App->>+LS: loadInterviewScript()
    LS-->>-App: questions[], totalTimeSec

    U->>App: Click "Start Conversation"
    App->>+API: POST /api/interviews
    API->>DB: INSERT interviews
    API-->>-App: { id: 42 }
    App->>IS: render(interviewId=42, questions, totalTimeSec)

    Note over IS: Idle → Active
    IS->>RT: new RealtimeSession(callbacks)
    RT->>Azure: WebSocket connect (wss://)
    RT->>Azure: session.update (instructions, voice, VAD)
    RT->>RT: getUserMedia() → mic capture
    RT->>Azure: triggerResponse()
    Azure-->>RT: response.audio.delta (PCM16 chunks)
    Azure-->>RT: response.audio_transcript.done
    RT-->>IS: onAssistantTranscriptDone("Hello, I'm Isabella...")
    IS->>API: POST /api/interviews/42/messages {interviewer, text, ts}
    API->>DB: INSERT interview_messages

    loop Each conversation turn
        U->>RT: speaks (mic → PCM16 → input_audio_buffer.append)
        RT->>Azure: audio chunks via WebSocket
        Azure->>Azure: VAD detects end of speech
        Azure-->>RT: input_audio_transcription.completed
        RT-->>IS: onUserTranscriptDone(text)
        IS->>API: POST .../messages {candidate, text, ts}
        API->>DB: INSERT interview_messages

        Azure-->>RT: response.audio.delta (streaming)
        Azure-->>RT: response.audio_transcript.delta (streaming)
        RT-->>IS: onAssistantTranscriptDelta (UI pending text)
        Azure-->>RT: response.audio_transcript.done
        RT-->>IS: onAssistantTranscriptDone(text)
        IS->>API: POST .../messages {interviewer, text, ts}
        API->>DB: INSERT interview_messages
    end

    U->>IS: Click "End Interview" (or timer expires)
    IS->>RT: disconnect()
    IS->>API: PATCH /api/interviews/42/complete
    API->>DB: UPDATE completed_at

    Note over IS: Active → Completed
    U->>App: Click "View Transcript"
    App->>App: downloadTranscript() → .txt file
```

## Component & File Map

| Layer | File | Role |
|-------|------|------|
| **Entry** | `index.html` → `src/main.tsx` | HTML shell, React 19 mount |
| **Router** | `src/App.tsx` | 3-view state machine (setup / interview / results) |
| **UI** | `src/components/InterviewSession.tsx` | Interview conductor — idle/active/completed states, timer, mute toggle, message feed |
| **Realtime** | `src/lib/realtime.ts` | WebSocket client for Azure GPT Realtime — mic capture (PCM16 24kHz), audio playback, transcript callbacks, server-side VAD |
| **Config** | `src/lib/azureConfig.ts` | Reads `VITE_*` env vars → `{ host, apiKey, realtimeModel, realtimeVoice }` |
| **Script** | `src/lib/loadScript.ts` | Fetches + parses JSON interview script → `Question[]` + `totalTimeSec` |
| **Types** | `src/types.ts` | `Question`, `InterviewMessage`, `InterviewState`, `InterviewScript`, `RawQuestion` |
| **Style** | `src/index.css` | Tailwind 4 import, custom scrollbar, body defaults |
| **Backend** | `server/index.ts` | Express 5 + better-sqlite3 — 5 REST endpoints for interview persistence |
| **Database** | `data/interviews.db` | SQLite WAL — `interviews` + `interview_messages` tables |
| **Assets** | `public/`, `icons/` | Isabella avatar, OP logo, interview script JSON |
| **Config** | `.env`, `vite.config.ts`, `tsconfig.json` | Azure creds, Vite proxy (`/api` → `:3001`), TypeScript |

## Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Frontend | React | 19 |
| Build | Vite | 6 |
| Language | TypeScript | 5.8 |
| Styling | Tailwind CSS | 4.1 |
| Animation | Motion (Framer) | 12.23 |
| Icons | Lucide React | 0.546 |
| Markdown | react-markdown | 10.1 |
| Backend | Express | 5.2 |
| Database | better-sqlite3 | 12.9 |
| AI Model | Azure OpenAI GPT Realtime 1.5 | — |
| Transcription | Whisper-1 (server-side) | — |
| Audio | PCM16, 24kHz, WebSocket | — |

## Changelog

| Date | Change |
|------|--------|
| 2026-04-15 | Incremental message persistence (per-turn POST, PATCH complete) |
| 2026-04-15 | Express + SQLite backend with 5 REST endpoints |
| 2026-04-15 | JSON-driven interview scripts (`loadScript.ts`) |
| 2026-04-14 | Isabella persona + OP LAB rebrand (orange theme) |
| 2026-04-14 | Azure GPT Realtime 1.5 speech-to-speech pivot |
| 2026-04-14 | Initial React + Vite scaffold |
