# n8n-nodes-claude-code-bridge

**© Nino Cordisco** — uso personale, ambito di test/prototipazione locale.

Nodo n8n custom che espone il bridge Claude Code (vedi `../docs/n8n-claude-code-bridge-guida.md`)
come componente nativo, con UI dedicata: campo Prompt, dropdown Model (popolato
dinamicamente dall'endpoint `/models` del bridge), gestione errori integrata.

Sostituisce la combinazione manuale "HTTP Request + Code" (Modalità A) descritta nella
guida principale, con un'esperienza più pulita in editing.

**Non sostituisce** la Modalità B (AI Agent nativo + OpenAI Chat Model) — quello resta
necessario se vuoi l'orchestrazione agentica di n8n. Questo nodo è pensato per flow
lineari, come alternativa più comoda alla chiamata HTTP grezza.

---

## Requisiti

- Il bridge Claude Code già funzionante (vedi guida principale nella cartella `docs/`)
- Un ambiente con Node.js e npm per compilare il pacchetto (non serve sul Mac se usi il
  metodo Docker descritto sotto — utile visto che il Mac potrebbe essere su un OS datato)

---

## 1. Build del pacchetto

Il codice è TypeScript e va compilato in JavaScript prima che n8n possa caricarlo.

**Se hai Node.js 20+ disponibile** (sul Mac o altrove):

```bash
cd n8n-nodes-claude-code-bridge
npm install
npm run build
```

**Se preferisci non installare Node.js sul Mac**, usa un container Docker usa-e-getta per
la build (stesso approccio già usato nel progetto per il bridge):

```bash
docker run --rm \
  -v "$(pwd)/n8n-nodes-claude-code-bridge:/app" \
  -w /app \
  node:22-slim \
  sh -c "npm install && npm run build"
```

Al termine, dovresti trovare una cartella `dist/` con i file compilati:

```
n8n-nodes-claude-code-bridge/
└── dist/
    ├── credentials/
    │   └── ClaudeCodeBridgeApi.credentials.js
    └── nodes/
        └── ClaudeCodeBridge/
            ├── ClaudeCodeBridge.node.js
            └── claudeCodeBridge.svg
```

---

## 2. Collegare il nodo a n8n

n8n cerca i nodi custom in `/home/node/.n8n/custom/node_modules/<nome-pacchetto>/`
dentro il container. Aggiungi un bind mount al servizio `n8n` nel `docker-compose.yaml`
principale del progetto:

```yaml
  n8n:
    # ... configurazione esistente ...
    volumes:
      - n8n_data:/home/node/.n8n
      - ./n8n-nodes-claude-code-bridge:/home/node/.n8n/custom/node_modules/n8n-nodes-claude-code-bridge
```

Poi riavvia n8n:

```bash
docker compose up -d --force-recreate n8n
```

**Verifica il caricamento** guardando i log all'avvio:

```bash
docker compose logs n8n --tail 50 | grep -i claude
```

Se tutto va bene, nella palette dei nodi di n8n (cerca "Claude Code Bridge") il nodo
dovrebbe comparire con l'icona dedicata.

---

## 3. Configurare la credenziale

A differenza del nodo "OpenAI Chat Model" (che richiede sempre un'API Key anche fittizia),
la credenziale di questo nodo ha **solo il campo Base URL** — niente più valori
placeholder da inventare:

1. Aggiungi il nodo "Claude Code Bridge" al canvas
2. Nel campo Credential, crea una nuova credenziale **"Claude Code Bridge API"**
3. **Base URL**: `http://claude-code-agent:4000`
4. Salva

---

## 4. Uso

1. Campo **Prompt**: testo o espressione (es. `={{ $json.prompt }}`)
2. Campo **Model**: dropdown popolato automaticamente interrogando `/models` sul bridge.
   Se il bridge non è raggiungibile durante l'editing, il dropdown mostra comunque una
   lista statica di fallback (`claude-code-bridge`, `claude-opus-4-8`, `claude-sonnet-5`,
   `claude-haiku-4-5-20251001`)
3. **Opzioni aggiuntive → Timeout**: default 180000 ms (3 minuti), utile alzarlo per
   prompt complessi

**Output del nodo:**

```json
{
  "successo": true,
  "risposta": "testo generato da Claude",
  "costoFigurativo": 0.0466272,
  "modello": "claude-haiku-4-5-20251001",
  "sessionId": "..."
}
```

Con **"Continue on Fail"** abilitato nelle impostazioni del nodo, un errore del bridge
produce un item con `successo: false` ed `errore` invece di interrompere il workflow.

---

## 5. Sviluppo iterativo

Durante lo sviluppo del nodo (non del bridge — quello ha già `node --watch`), dopo ogni
modifica al `.ts`:

```bash
docker run --rm -v "$(pwd)/n8n-nodes-claude-code-bridge:/app" -w /app node:22-slim \
  sh -c "npm run build"

docker compose restart n8n
```

n8n non ha hot-reload nativo per i nodi custom in produzione container: serve un riavvio
del servizio (rapido, non un rebuild dell'immagine).

---

## 6. Troubleshooting

| Problema                                                               | Causa probabile                                                                                         | Soluzione                                                                                                                                                   |
|------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Il nodo non compare nella palette                                      | Bind mount non montato, o build non eseguita (`dist/` mancante)                                         | Verifica `docker compose logs n8n` per errori di caricamento; conferma che `dist/` esista                                                                   |
| Errore di compilazione TypeScript su `NodeConnectionType` o altri tipi | La versione di `n8n-workflow` installata in fase di build non coincide con quella della tua istanza n8n | Verifica la versione n8n in uso (`docker compose exec n8n n8n --version`) e allinea la dipendenza `n8n-workflow` nel `package.json` del nodo di conseguenza |
| Dropdown "Model" mostra solo i 4 valori di fallback                    | Il bridge non era raggiungibile mentre editavi il workflow (es. container non ancora avviato)           | Verifica che `claude-code-agent` sia attivo; riapri il nodo per far ricaricare il dropdown                                                                  |
| Errore generico "Cannot find module" nei log n8n                       | Il pacchetto non ha `dist/` o il `package.json` non punta ai path corretti                              | Ricontrolla il campo `n8n.credentials`/`n8n.nodes` in `package.json` e rilancia la build                                                                    |

Se dopo questi controlli il nodo continua a non caricarsi, come alternativa più
affidabile (anche se meno "elegante") resta sempre disponibile la Modalità A descritta
nella guida principale — HTTP Request + Code — che non ha nessuna di queste fragilità di
compilazione/versione.

---

*Documento a cura di Nino Cordisco.*
