# Guida: n8n + Claude Code — bridge HTTP locale via Docker

**Autore / Copyright: © Nino Cordisco**

---

## Obiettivo del progetto

Permettere a **n8n** di orchestrare agenti AI che usano **Claude** come motore di
ragionamento, sfruttando un abbonamento **Claude Pro/Max** esistente invece di attivare
un account API separato a consumo (pay-per-token).

Nello specifico, il progetto realizza:

1. Un **bridge HTTP locale** (container Docker) che espone il binario ufficiale `claude`
   (Claude Code CLI) come servizio web, autenticato via OAuth con l'abbonamento personale.
2. **Due modalità di integrazione** con n8n:
    - **Chiamata diretta** via nodo HTTP Request — semplice, prevedibile, per flow lineari.
    - **Integrazione nativa con il nodo "AI Agent"** di n8n — tramite un endpoint
      OpenAI-compatibile esposto dal bridge, per sfruttare l'orchestrazione, la memoria e
      l'interfaccia agentica standard di n8n senza scrivere codice di parsing custom.
3. Funzionalità aggiuntive del bridge: **selezione del modello** per singola chiamata,
   **elenco modelli disponibili**, e lettura dello **stato di utilizzo del piano**
   (quota residua).
4. Un flusso di sviluppo **senza rebuild ripetuti**: il codice del bridge (`server.js`) è
   montato come bind mount e ricaricato automaticamente ad ogni modifica (`node --watch`).

**Perché non semplicemente una API key?** Perché l'obiettivo esplicito di partenza era
riutilizzare l'abbonamento Pro/Max già pagato, evitando costi aggiuntivi a consumo per un
uso personale di test/prototipazione. Questa scelta comporta dei limiti d'uso descritti
nella sezione successiva — è importante conoscerli prima di usare questo setup oltre
l'ambito per cui è stato pensato.

---

## ⚠️ Prima di iniziare: limiti e ambito d'uso

Questa configurazione **non è pensata per la produzione**, per processi che servono
clienti, o per carichi condivisi tra più persone. È adatta solo a:

- test personali e prototipazione
- automazioni che usi esclusivamente tu, per te stesso

Motivi:

1. **Policy Anthropic**: l'OAuth di Pro/Max è autorizzato solo per uso individuale
   ordinario. Se l'output finisce per servire altre persone (clienti, colleghi,
   automazioni condivise), si esce dal perimetro consentito — indipendentemente dal fatto
   che si usi il binario ufficiale `claude` (di per sé consentito) dietro un wrapper HTTP
   scritto in proprio.
2. **Rate limit**: i piani Pro/Max hanno limiti tarati su un utilizzo interattivo di una
   persona, non su carichi paralleli/multi-agente.
3. **Fragilità dell'auth**: il token generato con `claude setup-token` non è eterno e in un
   ambiente containerizzato va rinnovato manualmente quando scade — non è pensato per
   girare stabilmente su un server always-on.

Per uso in produzione o multi-utente, la via corretta resta una **API key** da
console.anthropic.com (pay-per-use), usata nel nodo nativo "Anthropic Chat Model" di n8n.

---

## Architettura

```
n8n (container)
   │
   ├── Modalità A: nodo HTTP Request
   │       │  POST http://claude-code-agent:4000/run   { "prompt": "..." }
   │       ▼
   │
   └── Modalità B: nodo AI Agent + "OpenAI Chat Model" (Base URL personalizzato)
           │  POST http://claude-code-agent:4000/v1/chat/completions
           │  (formato OpenAI, con supporto streaming SSE)
           ▼

claude-code-agent (container: Node.js + server.js + binario claude)
           │
           │  execFile("claude", ["-p", prompt, "--output-format", "json", "--model", ...])
           ▼

Claude (Pro/Max, via OAuth) — modello di default: il più leggero (Haiku)
```

Nessuna porta pubblicata verso l'host: `claude-code-agent` è raggiungibile solo dalla rete
Docker interna `n8n-net`, tramite il nome del servizio come hostname.

---

## Struttura del progetto

```
n8n-compose/
├── docker-compose.yaml
├── .env                          # contiene il token OAuth — NON committare
├── .env.example
├── .gitignore
├── claude-code/
│   ├── Dockerfile
│   ├── server.js                 # wrapper HTTP → claude CLI (bind-mounted, live reload)
│   └── claude.json               # file JSON vuoto, bind-mount su /root/.claude.json
├── scripts/                      # workspace condiviso (python + claude-code)
├── workflows/
│   ├── n8n-esempio-agent-claude-http.json     # Modalità A: HTTP Request semplice
│   └── n8n-esempio-ai-agent-nativo.json       # Modalità B: AI Agent nativo
└── docs/
    └── n8n-claude-code-bridge-guida.md        # questo documento
```

---

## 1. Server HTTP bridge — endpoint disponibili

| Endpoint               | Metodo | Funzione                                                                                                 |
|------------------------|--------|----------------------------------------------------------------------------------------------------------|
| `/health`              | GET    | Verifica rapida che il servizio sia attivo                                                               |
| `/run`                 | POST   | Prompt singolo: `{"prompt": "...", "model": "..." }` (model opzionale)                                   |
| `/v1/chat/completions` | POST   | Formato OpenAI-compatibile, usato dal nodo AI Agent nativo. Supporta `"stream": true`                    |
| `/v1/models`           | GET    | Elenco modelli, formato OpenAI (usato da n8n per popolare il dropdown)                                   |
| `/models`              | GET    | Stesso elenco, formato semplice                                                                          |
| `/status`              | GET    | Utilizzo residuo del piano (5h/7gg) — **endpoint non ufficiale Anthropic**, può cambiare senza preavviso |
| `/reset-session`       | POST   | Azzera il contesto della sessione persistente (vedi sezione 8.5)                                         |

**Selezione modello**: passando `"model": "claude-opus-4-8"` (o altro ID) nel body di
`/run` o `/v1/chat/completions`, il bridge usa quel modello specifico. Se il campo è
assente o vale `"claude-code-bridge"`, viene usato di default il modello **più
leggero/veloce** (`claude-haiku-4-5-20251001`, ID completo per evitare un bug noto di
risoluzione dell'alias `haiku`).

---

## 2. Sviluppo senza rebuild — bind mount + watch

`server.js` è montato come bind mount nel container (non copiato in fase di build), e il
processo Node gira con `node --watch`: qualsiasi modifica al file salvata sul Mac
**riavvia automaticamente** il server dentro il container, senza bisogno di
`docker compose up -d --build`.

Rebuild necessario solo se si modifica il `Dockerfile` stesso (es. nuove dipendenze).

---

## 3. Dockerfile

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y curl ca-certificates git && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://claude.ai/install.sh | bash -s stable

ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /workspace
COPY server.js /workspace/server.js

EXPOSE 4000
CMD ["node", "--watch", "/workspace/server.js"]
```

---

## 4. docker-compose.yaml (versione finale)

```yaml
version: "3.9"

networks:
  n8n-net:

volumes:
  n8n_data:
  claude-auth:

services:
  n8n:
    image: docker.n8n.io/n8nio/n8n
    container_name: n8n
    restart: unless-stopped
    environment:
      - N8N_HOST=localhost
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - NODE_ENV=development
      - GENERIC_TIMEZONE=Europe/Rome
      - TZ=Europe/Rome
      - N8N_SECURE_COOKIE=false
    ports:
      - "127.0.0.1:5678:5678"
    volumes:
      - n8n_data:/home/node/.n8n
    networks:
      - n8n-net

  python:
    image: python:3.11
    container_name: python-runtime
    command: tail -f /dev/null
    volumes:
      - ./scripts:/scripts
    networks:
      - n8n-net

  claude-code:
    build: ./claude-code
    container_name: claude-code-agent
    environment:
      - CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}
      - PORT=4000
    volumes:
      - claude-auth:/root/.claude
      - ./claude-code/claude.json:/root/.claude.json
      - ./claude-code/server.js:/workspace/server.js
      - ./scripts:/workspace/scripts
    networks:
      - n8n-net
    restart: unless-stopped
```

---

## 5. Setup — ordine delle operazioni

```bash
# 1. Build + avvio di tutti i servizi
docker compose up -d --build

# 2. Login OAuth (una tantum) — genera un token, NON lo salva da solo
docker compose exec claude-code claude setup-token
```

Si apre un URL nel browser: accedi con l'account Pro/Max, autorizzi.
**Il comando stampa il token a schermo e basta — copialo per intero, non si salva da solo.**

```bash
# 3. Salva il token nel file .env (stessa cartella del compose)
echo 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...(token completo)...' > .env

# 4. Ricrea il container per applicare la variabile
docker compose up -d --force-recreate claude-code

# 5. Verifica
docker compose exec n8n wget -qO- http://claude-code-agent:4000/health
```

---

## 6. ⚠️ Fix necessario in n8n: credenziale "fake" per il nodo OpenAI Chat Model

**Questo passaggio è OBBLIGATORIO e non automatico dopo l'import di un workflow.**

Il nodo **"OpenAI Chat Model"**, usato per collegare il bridge al nodo AI Agent nativo,
richiede sempre una credenziale valida — anche se il nostro bridge non verifica alcuna
API key. Se importi un workflow che referenzia una credenziale (es. dal file JSON di
esempio), l'ID salvato nel JSON **non esiste** nella tua istanza n8n e la credenziale
risulterà "non impostata", con errore:

```
Node does not have any credentials set
```

**Come risolvere, ogni volta che serve una nuova credenziale per il bridge:**

1. Apri il nodo **"OpenAI Chat Model"**
2. Clicca **"Set up credential"** (o "Create New Credential")
3. Compila:
    - **API Key**: qualsiasi valore placeholder, es. `non-serve` — il bridge non lo
      controlla, ma il campo è obbligatorio lato n8n
    - **Base URL**: `http://claude-code-agent:4000/v1`
4. Clicca **"Save"** — dovresti vedere "Connection tested successfully" (n8n verifica la
   credenziale chiamando `GET /v1/models`, che il bridge implementa correttamente)
5. Nel campo **Model** del nodo, scrivi/seleziona `claude-code-bridge` (o un ID modello
   specifico, es. `claude-opus-4-8` per task complessi)

Una volta creata la prima volta, la credenziale resta salvata nell'istanza n8n e può
essere riutilizzata in altri workflow senza ripetere la procedura — il problema si
presenta solo quando si importa un JSON che referenzia un ID credenziale inesistente.

---

## 7. Streaming SSE — perché serve

Il nodo AI Agent nativo di n8n (basato su LangChain) si aspetta che il Chat Model risponda
in **streaming** (`"stream": true`, formato Server-Sent Events), anche per chiamate non
interattive. Senza questo supporto, si ottiene l'errore:

```
Cannot read properties of undefined (reading 'content')
```

perché il client prova a leggere "pezzi" di uno stream che il bridge non fornisce nel
formato atteso.

**Soluzione implementata**: quando il body della richiesta contiene `"stream": true`, il
bridge esegue comunque `claude -p` in modo sincrono (l'esecuzione stessa non streamma), ma
restituisce l'intera risposta incapsulata in un formato SSE valido — un "finto streaming"
a chunk singolo, tecnica comune per esporre backend non-streaming dietro un'interfaccia
OpenAI-compatibile.

---

## 8. Errori incontrati durante lo sviluppo e relative soluzioni

| Errore                                                                 | Causa                                                                                                          | Soluzione                                                                                      |
|------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| `source ... /root/.claude.json is not directory`                       | Un volume Docker (directory) montato sopra un path che il container si aspetta come file                       | Bind mount su file locale: `./claude-code/claude.json:/root/.claude.json`                      |
| `Unexpected EOF` (JSON parse error)                                    | File creato con `touch` → vuoto → non è JSON valido                                                            | `echo '{}' > ./claude-code/claude.json` invece di `touch`                                      |
| `Not logged in · Please run /login`                                    | `claude setup-token` genera il token ma non lo salva automaticamente                                           | Copiare il token stampato e impostarlo esplicitamente come `CLAUDE_CODE_OAUTH_TOKEN` in `.env` |
| `The "CLAUDE_CODE_OAUTH_TOKEN" variable is not set`                    | File `.env` mancante, nel path sbagliato, o variabile scritta male                                             | Verificare con `cat -A .env`; confermare con `docker compose config \                          | grep CLAUDE_CODE_OAUTH_TOKEN` |
| `401 Invalid bearer token`                                             | Token copiato incompleto o con caratteri spuri                                                                 | Rigenerare con `claude setup-token`, copiare l'intera stringa con attenzione                   |
| `Unrecognized node type: n8n-nodes-base.executeCommand`                | Da n8n 2.0 il nodo Execute Command è disabilitato di default                                                   | Superato: architettura finale basata su HTTP, non serve più Execute Command                    |
| `Problem in node 'AI Agent' — A Chat Model sub-node must be connected` | Il nodo AI Agent nativo richiede un sotto-nodo Chat Model                                                      | Aggiungere "OpenAI Chat Model" con Base URL puntato al bridge                                  |
| `/bin/sh: docker: not found`                                           | Approccio precedente (`docker exec`) richiedeva il client Docker in n8n                                        | Superato dall'architettura HTTP: non serve più il client Docker in n8n                         |
| `Node does not have any credentials set`                               | L'ID credenziale nel JSON importato non esiste nella tua istanza                                               | Vedi sezione 6 — creare manualmente la credenziale "fake" con Base URL del bridge              |
| `Cannot read properties of undefined (reading 'content')`              | Il nodo AI Agent richiede risposta in streaming (SSE), il bridge inizialmente rispondeva solo con JSON singolo | Vedi sezione 7 — implementato supporto `"stream": true` con risposta SSE                       |

---

## 8.5. Sessione persistente: latenza, contesto condiviso e quando resettare

### Perché esiste una sessione persistente

Le chiamate a `/run` (usate dalla Modalità A e dal nodo custom, Modalità C) non avviano
più un processo `claude` da zero ad ogni richiesta. Un singolo processo resta vivo e
riceve i prompt uno dopo l'altro via stdin — questo abbatte la latenza da ~7 secondi a
~3-3,5 secondi a regime (la prima chiamata dopo l'avvio resta più lenta, perché deve
avviare il processo).

**Effetto collaterale**: il processo persistente tratta le chiamate come **un'unica
conversazione continua**. Claude "ricorda" i prompt precedenti nella stessa sessione — non
è un comportamento stateless come una chiamata API pura.

**Nota importante**: questa ottimizzazione riguarda *solo* `/run`. L'endpoint
`/v1/chat/completions` (usato dalla Modalità B, AI Agent nativo) resta stateless — ogni
chiamata paga il costo pieno di avvio (~7s), ma non ha bisogno di reset perché non
condivide mai contesto tra chiamate diverse.

### Quando il reset è NECESSARIO

- **Workflow diversi o non correlati** che potrebbero eseguire nella stessa finestra di
  tempo (es. due automazioni distinte che girano a pochi minuti di distanza)
- **Dati sensibili o specifici di un cliente/contesto** in un prompt, che non devono
  "contaminare" le risposte a richieste successive non correlate
- **Test e debug**: vuoi che la stessa identica richiesta dia sempre la stessa risposta,
  senza influenze da chiamate precedenti nella sessione
- **Pattern multi-agente** (orchestratore + agenti specialisti): se agenti con ruoli/system
  prompt diversi passano dallo stesso bridge, senza reset l'agente B "vede" quello che ha
  detto l'agente A nella stessa sessione — quasi mai quello che vuoi in un'architettura a
  agenti indipendenti

### Quando il reset NON è necessario

- **Chiamate consecutive all'interno della stessa esecuzione di workflow**, dove in
  realtà il contesto condiviso è desiderabile (es. una vera conversazione multi-turno con
  lo stesso "agente")
- **Uso saltuario/personale**, dove la contaminazione tra una chiamata e l'altra non è un
  problema pratico

### Reset automatico per inattività (già attivo di default)

Se il bridge resta inutilizzato per **10 minuti** (default, configurabile), il processo
persistente si auto-termina — la chiamata successiva parte con contesto vuoto. Per
cambiare la soglia, nel `docker-compose.yaml`, servizio `claude-code`:

```yaml
environment:
  - IDLE_RESET_MS=300000   # esempio: 5 minuti invece di 10
```

Questo protegge dalla contaminazione tra sessioni di lavoro *separate nel tempo* (oggi vs
domani), ma **non basta** da solo per isolare esecuzioni ravvicinate di workflow diversi
— per quello serve il reset esplicito descritto sotto.

### Come resettare nelle tre modalità

**Modalità A — HTTP Request diretto**

Aggiungi un nodo HTTP Request prima della chiamata a `/run`:

```
Metodo: POST
URL: http://claude-code-agent:4000/reset-session
Body (JSON): {}
```

Vedi `workflows/01-direct-http-call.json` per un esempio completo già collegato
(Trigger → Reset Sessione → Costruisci Prompt → Chiama Claude → Estrai Risposta).

**Modalità B — AI Agent nativo**

**Non serve alcun reset**: `/v1/chat/completions` è stateless per progettazione (ogni
chiamata è indipendente, senza sessione condivisa). È il "costo" della maggiore lentezza
di questa modalità — nessuna ottimizzazione di sessione persistente applicata qui.

Se in futuro si estendesse la sessione persistente anche a questo endpoint (per
uniformare la velocità), tornerebbe necessario un meccanismo di reset equivalente — non
ancora implementato.

**Modalità C — Nodo custom "Claude Code Bridge"**

Il nodo ha un campo **Operation** con due valori: "Run Prompt" e "Reset Session".
Aggiungi un nodo "Claude Code Bridge" con Operation = "Reset Session" prima di quello con
Operation = "Run Prompt", usando la stessa credenziale già configurata (nessuna
riconfigurazione necessaria):

```
Trigger → [Claude Code Bridge: Reset Session] → [Claude Code Bridge: Run Prompt] → ...
```

Vedi `workflows/03-claude-code-bridge-custom-node.json` per un esempio pronto.

### Riepilogo comparativo

| Modalità            | Velocità                                  | Reset necessario?       | Come                                          |
|---------------------|-------------------------------------------|-------------------------|-----------------------------------------------|
| A — HTTP diretto    | Veloce (sessione persistente)             | Sì, se serve isolamento | Nodo HTTP Request → `/reset-session`          |
| B — AI Agent nativo | Lenta (stateless per progettazione)       | Mai                     | —                                             |
| C — Nodo custom     | Veloce (stessa sessione persistente di A) | Sì, se serve isolamento | Operation = "Reset Session" nello stesso nodo |

---

## 9. Integrazione — Modalità A: HTTP Request semplice

Per flow lineari, senza bisogno dell'orchestrazione agentica di n8n:

```
Metodo: POST
URL: http://claude-code-agent:4000/run
Body (JSON): { "prompt": "{{ $json.prompt }}" }
```

Nodo Code successivo per estrarre la risposta:

```javascript
const output = $input.item.json;

if (output.error) {
    return {json: {successo: false, errore: output.error}};
}

return {
    json: {
        successo: !output.is_error,
        risposta: output.result,
        costo_figurativo: output.total_cost_usd,
        modello: Object.keys(output.modelUsage || {})[0] || null,
    }
};
```

Workflow di esempio: `workflows/n8n-esempio-agent-claude-http.json`

---

## 10. Integrazione — Modalità B: AI Agent nativo

Per sfruttare l'orchestrazione, la memoria conversazionale e l'interfaccia agentica
standard di n8n:

1. Nodo **AI Agent**
2. Sotto-nodo **Chat Model** → "OpenAI Chat Model"
3. Credenziale: vedi sezione 6 (Base URL `http://claude-code-agent:4000/v1`)
4. Campo Model: `claude-code-bridge` o un ID specifico

**Limite noto**: il tool-calling nativo (l'agente che decide autonomamente di chiamare
altri nodi come "tool") si basa sul function-calling strutturato di OpenAI. Il bridge
attuale non implementa questo formato — funziona per conversazione/ragionamento testuale,
ma i Tool collegati all'agente probabilmente non verranno invocati correttamente.

Workflow di esempio: `workflows/n8n-esempio-ai-agent-nativo.json`

---

## 10.5. Terza modalità: nodo custom "Claude Code Bridge"

Oltre alle Modalità A (HTTP Request) e B (AI Agent nativo), è disponibile un **nodo n8n
dedicato**, con UI propria (Prompt, dropdown Model popolato dinamicamente, gestione
errori nativa) — elimina il bisogno di una credenziale fittizia e del nodo Code per il
parsing.

Setup completo: `n8n-nodes-claude-code-bridge/README.md`

**Compromesso da conoscere**: essendo un nodo TypeScript compilato contro le API di
`n8n-workflow`, è più sensibile a differenze di versione rispetto al resto del progetto
(che è JavaScript puro/HTTP standard). Se dopo un aggiornamento di n8n il nodo smette di
caricarsi, le Modalità A e B restano sempre disponibili come alternativa stabile.

---

## 11. Manutenzione

- **Il token scade periodicamente.** Se un workflow smette improvvisamente di rispondere
  con errori di autenticazione, il primo sospetto è il token: rigeneralo con
  `claude setup-token` e aggiorna `.env`.
- **Non committare `.env`** su repository Git — il token vale come una password
  dell'abbonamento. Aggiungilo al `.gitignore` (già presente nel progetto).
- **Prima di ogni riavvio del container** dopo aver aggiornato `.env`, usa
  `--force-recreate` per essere sicuro che la nuova variabile venga applicata.
- **Il file `/status`** dipende da un endpoint Anthropic non documentato pubblicamente:
  se smette di funzionare, non è necessariamente un bug del bridge.

---

## 12. Quando passare alla API key

Valuta il passaggio a un account API separato (console.anthropic.com) se:

- vuoi esporre questi workflow ad altre persone (colleghi, clienti)
- hai bisogno di più agenti in esecuzione parallela / alto volume
- vuoi stabilità di produzione senza gestione manuale della scadenza del token
- il contesto è legato a clienti regolamentati (banking/healthcare) dove la governance
  dell'infrastruttura è soggetta ad audit
- hai bisogno di vero function-calling/tool-calling strutturato lato agente

In quel caso, il nodo nativo **"Anthropic Chat Model"** di n8n con una API key sostituisce
interamente il container `claude-code` — nessun binario da mantenere, nessun OAuth da
rinnovare, autenticazione via semplice header HTTP, e supporto nativo al tool-calling.

---

*Documento a cura di Nino Cordisco — uso personale, ambito di test/prototipazione locale.*