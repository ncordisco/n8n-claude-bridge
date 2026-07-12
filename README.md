# n8n + Claude Code bridge (setup locale)

© Nino Cordisco — uso personale, ambito di test/prototipazione locale.

Bridge HTTP locale che permette a n8n di usare Claude (via abbonamento Pro/Max) come
motore AI per agenti, senza attivare una API key a consumo.

Guida completa: `docs/n8n-claude-code-bridge-guida.md`

## Avvio rapido (bridge)

    cp .env.example .env
    docker compose up -d --build
    docker compose exec claude-code claude setup-token
    # copia il token stampato in .env (CLAUDE_CODE_OAUTH_TOKEN=...)
    docker compose up -d --force-recreate claude-code
    docker compose exec n8n wget -qO- http://claude-code-agent:4000/health

## Tre modi di usare il bridge da n8n

1. **HTTP Request diretto** — `workflows/n8n-esempio-agent-claude-http.json`
2. **AI Agent nativo** (OpenAI Chat Model puntato al bridge) —
   `workflows/n8n-esempio-ai-agent-nativo.json`. Dopo l'import, la credenziale va
   ricreata a mano (vedi guida, sezione 6).
3. **Nodo custom dedicato "Claude Code Bridge"** — vedi
   `n8n-nodes-claude-code-bridge/README.md` per build e setup. UI più pulita, nessuna
   credenziale fittizia da inventare.

## Sviluppo del bridge (server.js)

Bind-mounted e ricaricato automaticamente (`node --watch`) ad ogni modifica: nessun
rebuild necessario.

## Struttura

    n8n-compose/
    ├── docker-compose.yaml
    ├── claude-code/                       # il bridge HTTP verso claude CLI
    ├── workflows/                         # esempi di workflow n8n
    ├── n8n-nodes-claude-code-bridge/       # nodo custom n8n (opzionale)
    └── docs/                              # guida completa
