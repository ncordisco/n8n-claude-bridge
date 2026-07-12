# n8n + Claude Code bridge (setup locale)

© Nino Cordisco — uso personale, ambito di test/prototipazione locale.

Bridge HTTP locale che permette a n8n di usare Claude (via abbonamento Pro/Max) come
motore AI per agenti, senza attivare una API key a consumo.

Guida completa: `docs/n8n-claude-code-bridge-guida.md`

## Avvio rapido

    cp .env.example .env
    docker compose up -d --build
    docker compose exec claude-code claude setup-token
    # copia il token stampato in .env (CLAUDE_CODE_OAUTH_TOKEN=...)
    docker compose up -d --force-recreate claude-code
    docker compose exec n8n wget -qO- http://claude-code-agent:4000/health

## Workflow di esempio

- `workflows/n8n-esempio-agent-claude-http.json` — chiamata diretta via HTTP Request
- `workflows/n8n-esempio-ai-agent-nativo.json` — nodo AI Agent nativo di n8n

**IMPORTANTE**: dopo l'import di un workflow con nodo "OpenAI Chat Model", la credenziale
va sempre ricreata manualmente (API Key: qualsiasi valore, Base URL:
`http://claude-code-agent:4000/v1`) — vedi guida, sezione 6.

## Sviluppo

`server.js` è bind-mounted e ricaricato automaticamente (`node --watch`) ad ogni modifica:
nessun rebuild necessario per cambiare il codice del bridge.
