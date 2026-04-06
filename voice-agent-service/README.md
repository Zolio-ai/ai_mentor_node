# Voice Agent Microservice (Node.js)

This microservice migrates the Python LiveKit mentor agent to Node.js with equivalent behavior:

- Supportive mentor persona and concise voice-first responses
- STT: `deepgram/nova-3` (`language: multi`)
- LLM: `openai/gpt-4.1-mini`
- TTS: `deepgram/aura-2` voice `orpheus` (`language: en`)
- Preemptive generation and interruptions enabled
- Optional Beyond Presence avatar participant via `@livekit/agents-plugin-bey`
- Health endpoint at `GET /health`

## Important parity note

The original Python service starts a LiveAvatar session. In Node, this service uses Beyond Presence instead when `BEY_API_KEY` (or `BEYOND_API_KEY`) is provided.
Silero VAD and the LiveKit turn detector are omitted in this Node service to avoid `onnxruntime-node` install failures on some Linux environments (especially CUDA 13 combinations).

## Run

Node.js 22 LTS is recommended.

1. Copy `.env.example` to `.env.local` and fill credentials.
2. Install dependencies:

```bash
npm install
```

3. Start in dev mode:

```bash
npm run dev
```

4. Production worker:

```bash
npm run start
```

5. Health check:

```bash
curl http://localhost:5051/health
```

## Commands

- `npm run dev` - run LiveKit worker in dev mode
- `npm run start` - run LiveKit worker in start mode
- `npm run download-files` - download required local model files
- `npm test` - run Node tests
