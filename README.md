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

| #                                    | Workflow di esempio                                | Velocità                             | Reset sessione                |
|--------------------------------------|----------------------------------------------------|--------------------------------------|-------------------------------|
| 1 — HTTP Request diretto             | `workflows/01-direct-http-call.json`               | Veloce (sessione persistente)        | Sì, incluso nel flow          |
| 2 — AI Agent nativo                  | `workflows/02-ai-agent-nativo.json`                | Veloce (stessa sessione persistente) | Sì, incluso nel flow          |
| 3 — Nodo custom "Claude Code Bridge" | `workflows/03-claude-code-bridge-custom-node.json` | Veloce (stessa sessione persistente) | Sì, Operation="Reset Session" |

Dopo l'import di ciascun workflow, la credenziale va sempre ricreata a mano (l'ID nel
JSON è un placeholder che non esiste nella tua istanza) — vedi guida, sezione 6 (Modalità
B) e setup del nodo custom (Modalità 3).

**Quando serve il reset e perché**: guida, sezione 8.5 — spiega il compromesso tra
velocità (sessione persistente) e isolamento del contesto tra chiamate/workflow diversi.

## Nodo custom dedicato "Claude Code Bridge"

Vedi `n8n-nodes-claude-code-bridge/README.md` per build e setup. UI più pulita, nessuna
credenziale fittizia da inventare, campo Operation per Run Prompt / Reset Session.

## Sviluppo del bridge (server.js)

Bind-mounted e ricaricato automaticamente (`node --watch`) ad ogni modifica: nessun
rebuild necessario.

## Struttura

    n8n-compose/
    ├── docker-compose.yaml
    ├── claude-code/                       # il bridge HTTP verso claude CLI
    ├── workflows/                         # 01, 02, 03 - i tre esempi di workflow
    ├── n8n-nodes-claude-code-bridge/       # nodo custom n8n (opzionale)
    └── docs/                              # guida completa