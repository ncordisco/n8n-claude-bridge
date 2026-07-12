const http = require('http');
const https = require('https');
const {execFile, spawn} = require('child_process');
const readline = require('readline');

const PORT = process.env.PORT || 4000;
const DEFAULT_MODEL_LABEL = 'claude-code-bridge';
// claude-code-bridge punta di default al modello più leggero/veloce (Haiku).
// Usiamo l'ID completo, non l'alias "haiku", per via di un bug noto che a volte
// fa risolvere l'alias erroneamente su Sonnet.
const DEFAULT_MODEL_ID = 'claude-haiku-4-5-20251001';

// Elenco curato (statico) di alias/ID modello disponibili tramite claude CLI.
// Non esiste un comando "list models" esposto dal CLI: questa lista va aggiornata
// manualmente quando escono nuovi modelli. Gli alias "sonnet"/"opus"/"haiku" seguono
// sempre l'ultima versione; per stabilità preferire gli ID completi.
const AVAILABLE_MODELS = [
    {id: 'claude-code-bridge', note: 'alias di default: mappa su claude-haiku-4-5-20251001 (il più leggero/veloce)'},
    {id: 'sonnet', note: 'alias, segue sempre l\'ultima versione Sonnet'},
    {id: 'opus', note: 'alias, segue sempre l\'ultima versione Opus'},
    {id: 'haiku', note: 'alias — attenzione: bug noto, preferire ID completo'},
    {id: 'claude-sonnet-5'},
    {id: 'claude-opus-4-8'},
    {id: 'claude-haiku-4-5-20251001'},
];

function sendJson(res, statusCode, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(statusCode, {'Content-Type': 'application/json'});
    res.end(body);
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function runClaude(prompt, model) {
    return new Promise((resolve, reject) => {
        // --safe-mode disabilita CLAUDE.md/plugin/skill/hook/MCP discovery, come
        // --bare, ma (a differenza di --bare) NON richiede ANTHROPIC_API_KEY e
        // dovrebbe restare compatibile con CLAUDE_CODE_OAUTH_TOKEN.
        // --max-turns 1 impedisce cicli agentici multi-step: una sola risposta.
        // --allowedTools '' toglie ogni tool (Read/Bash/Edit/ecc.): comportamento
        // da puro chatbot testuale, niente tentativi di "verificare" o esplorare file.
        const args = [
            '-p', prompt,
            '--safe-mode',
            '--max-turns', '1',
            '--allowedTools', '',
            '--output-format', 'json',
        ];
        // "claude-code-bridge" (o nessun modello specificato) mappa sempre sul
        // modello più leggero/veloce: usiamo l'ID completo per evitare il bug
        // di risoluzione dell'alias "haiku".
        const resolvedModel = (!model || model === DEFAULT_MODEL_LABEL) ? DEFAULT_MODEL_ID : model;
        args.push('--model', resolvedModel);

        execFile(
            'claude',
            args,
            {maxBuffer: 20 * 1024 * 1024, timeout: 180000},
            (err, stdout, stderr) => {
                if (err && !stdout) {
                    return reject({message: err.message, stderr: stderr ? stderr.toString() : null});
                }
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    reject({message: 'Output di claude non è JSON valido', raw: stdout});
                }
            }
        );
    });
}

// ============================================================
// Sessione persistente (SPERIMENTALE)
// ============================================================
// Protocollo "--input-format stream-json" NON documentato ufficialmente da
// Anthropic (solo i flag CLI lo sono, non il formato esatto dei messaggi):
// ricostruito da fonti community/SDK non ufficiali. Ogni riga stdout viene
// loggata in console per poter fare debug se il parsing non dovesse combaciare
// con quanto assunto qui.
//
// Usata SOLO per il modello di default (quello leggero): un processo claude
// resta vivo e riceve i prompt via stdin, evitando il costo di avvio/auth ad
// ogni richiesta. Per modelli specifici diversi, si ricade sul vecchio
// comportamento spawn-per-richiesta (runClaude), più lento ma collaudato.

let persistentProc = null;
let persistentReady = false;
let requestQueue = [];
let currentRequest = null;
const PERSISTENT_TIMEOUT_MS = 120000;

// Reset automatico per inattività: se non arrivano richieste per questo tempo,
// il processo persistente viene terminato (si riavvierà, con contesto vuoto,
// alla richiesta successiva). Configurabile via env var, default 10 minuti.
const IDLE_RESET_MS = parseInt(process.env.IDLE_RESET_MS || '600000', 10);
let idleResetTimer = null;

function scheduleIdleReset() {
    if (idleResetTimer) clearTimeout(idleResetTimer);
    idleResetTimer = setTimeout(() => {
        if (persistentProc) {
            console.log(`[persistente] inattivo da ${IDLE_RESET_MS}ms, reset automatico del contesto`);
            persistentProc.kill();
        }
    }, IDLE_RESET_MS);
}

function startPersistentSession() {
    const args = [
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--replay-user-messages',
        '--allowedTools', '',
        '--max-turns', '1',
        '--model', DEFAULT_MODEL_ID,
    ];

    console.log('Avvio processo claude persistente:', args.join(' '));
    const proc = spawn('claude', args, {stdio: ['pipe', 'pipe', 'pipe']});
    persistentProc = proc;
    persistentReady = true;

    const rl = readline.createInterface({input: proc.stdout});

    rl.on('line', (line) => {
        if (!line.trim()) return;
        console.log('[persistente:stdout]', line);
        let event;
        try {
            event = JSON.parse(line);
        } catch (e) {
            console.error('Riga non JSON dal processo persistente, ignorata:', line);
            return;
        }
        handlePersistentEvent(event);
    });

    proc.stderr.on('data', (chunk) => {
        console.error('[persistente:stderr]', chunk.toString());
    });

    proc.on('exit', (code) => {
        console.error(`Processo claude persistente terminato (code ${code}), verrà riavviato alla prossima richiesta`);
        persistentReady = false;
        persistentProc = null;
        if (currentRequest) {
            clearTimeout(currentRequest.timeoutHandle);
            currentRequest.reject(new Error('Processo persistente terminato inaspettatamente'));
            currentRequest = null;
        }
        requestQueue.forEach((req) => {
            clearTimeout(req.timeoutHandle);
            req.reject(new Error('Processo persistente non disponibile'));
        });
        requestQueue = [];
    });

    proc.on('error', (err) => {
        console.error('[persistente] errore di avvio:', err.message);
        persistentReady = false;
        persistentProc = null;
    });
}

function handlePersistentEvent(event) {
    if (!currentRequest) return; // evento fuori contesto (es. init all'avvio), ignora

    // Testo in streaming a pezzi, se il formato lo prevede
    if (
        event.type === 'stream_event' &&
        event.event &&
        event.event.delta &&
        event.event.delta.type === 'text_delta'
    ) {
        currentRequest.buffer.text += event.event.delta.text || '';
        return;
    }

    // Evento di risultato finale del turno (stesso formato del batch --output-format json)
    if (event.type === 'result') {
        clearTimeout(currentRequest.timeoutHandle);
        const finalText = currentRequest.buffer.text || event.result || '';
        currentRequest.resolve({
            is_error: !!event.is_error,
            result: finalText,
            total_cost_usd: event.total_cost_usd,
            session_id: event.session_id,
            usage: event.usage,
            modelUsage: event.modelUsage,
        });
        currentRequest = null;
        processQueue();
        return;
    }
}

function processQueue() {
    if (currentRequest || requestQueue.length === 0) return;
    currentRequest = requestQueue.shift();

    currentRequest.timeoutHandle = setTimeout(() => {
        console.error('[persistente] timeout: nessun evento "result" ricevuto, riavvio il processo');
        if (persistentProc) persistentProc.kill();
        currentRequest.reject(new Error('Timeout in attesa di risposta dal processo persistente'));
        currentRequest = null;
    }, PERSISTENT_TIMEOUT_MS);

    const message = {
        type: 'user',
        message: {role: 'user', content: [{type: 'text', text: currentRequest.prompt}]},
    };

    persistentProc.stdin.write(JSON.stringify(message) + '\n');
}

function runClaudePersistent(prompt) {
    return new Promise((resolve, reject) => {
        if (!persistentReady) {
            startPersistentSession();
        }
        scheduleIdleReset();
        requestQueue.push({prompt, resolve, reject, buffer: {text: ''}});
        processQueue();
    });
}

function messagesToPrompt(messages) {
    return (messages || [])
        .map((m) => {
            const role = m.role === 'system' ? 'System' : m.role === 'assistant' ? 'Assistant' : 'User';
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return `${role}: ${content}`;
        })
        .join('\n\n');
}

// Interroga l'endpoint (non documentato ufficialmente) usato dalla statusline
// di Claude Code per leggere l'utilizzo residuo del piano Pro/Max.
// Può cambiare o smettere di funzionare senza preavviso: Anthropic non lo
// garantisce come API pubblica stabile.
function fetchUsageStatus() {
    return new Promise((resolve, reject) => {
        const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
        if (!token) {
            return reject({message: 'CLAUDE_CODE_OAUTH_TOKEN non impostato nel container'});
        }

        const options = {
            hostname: 'api.anthropic.com',
            path: '/api/oauth/usage',
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'anthropic-beta': 'oauth-2025-04-20',
                'Content-Type': 'application/json',
            },
        };

        const apiReq = https.request(options, (apiRes) => {
            let data = '';
            apiRes.on('data', (c) => {
                data += c;
            });
            apiRes.on('end', () => {
                try {
                    resolve({statusCode: apiRes.statusCode, body: JSON.parse(data)});
                } catch (e) {
                    reject({message: 'Risposta non JSON da Anthropic', raw: data});
                }
            });
        });

        apiReq.on('error', (err) => reject({message: err.message}));
        apiReq.end();
    });
}

const server = http.createServer(async (req, res) => {
    try {
        if (req.method === 'GET' && req.url === '/health') {
            return sendJson(res, 200, {status: 'ok'});
        }

        // --- Reset della sessione persistente: azzera il contesto conversazionale
        // accumulato, forzando un nuovo processo (e quindi una nuova sessione "vuota")
        // alla prossima richiesta. Utile per evitare che chiamate non correlate
        // "ricordino" prompt precedenti.
        if (req.method === 'POST' && req.url === '/reset-session') {
            if (persistentProc) {
                persistentProc.kill();
                return sendJson(res, 200, {status: 'reset', note: 'Sessione persistente terminata, ne verrà avviata una nuova alla prossima richiesta'});
            }
            return sendJson(res, 200, {status: 'noop', note: 'Nessuna sessione persistente attiva da resettare'});
        }

        // --- Lista modelli disponibili (statica/curata) ---
        if (req.method === 'GET' && (req.url === '/models' || req.url === '/v1/models')) {
            if (req.url === '/v1/models') {
                return sendJson(res, 200, {
                    object: 'list',
                    data: AVAILABLE_MODELS.map((m) => ({id: m.id, object: 'model', owned_by: 'anthropic-subscription'})),
                });
            }
            return sendJson(res, 200, {models: AVAILABLE_MODELS});
        }

        // --- Stato/utilizzo del piano Pro/Max (endpoint non ufficiale) ---
        if (req.method === 'GET' && req.url === '/status') {
            try {
                const result = await fetchUsageStatus();
                return sendJson(res, result.statusCode, result.body);
            } catch (err) {
                return sendJson(res, 502, {
                    error: 'Impossibile leggere lo stato di utilizzo (endpoint non ufficiale)',
                    details: err.message,
                });
            }
        }

        // --- Endpoint semplice: prompt singolo, con modello opzionale ---
        if (req.method === 'POST' && req.url === '/run') {
            const payload = await readJsonBody(req);
            if (!payload.prompt || typeof payload.prompt !== 'string') {
                return sendJson(res, 400, {error: 'Campo "prompt" mancante o non stringa'});
            }

            const useDefault = !payload.model || payload.model === DEFAULT_MODEL_LABEL;
            let output;
            try {
                output = useDefault
                    ? await runClaudePersistent(payload.prompt)
                    : await runClaude(payload.prompt, payload.model);
            } catch (err) {
                // Fallback automatico: se la sessione persistente fallisce, riprova
                // con il vecchio metodo spawn-per-richiesta prima di arrendersi.
                console.error('[persistente] fallback a runClaude classico:', err.message);
                output = await runClaude(payload.prompt, payload.model);
            }

            return sendJson(res, 200, output);
        }

        // --- Compatibilità OpenAI: chat completions, con selezione modello ---
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
            const payload = await readJsonBody(req);
            const prompt = messagesToPrompt(payload.messages);

            if (!prompt) {
                return sendJson(res, 400, {error: 'Campo "messages" mancante o vuoto'});
            }

            const useDefault = !payload.model || payload.model === DEFAULT_MODEL_LABEL;
            let claudeOut;
            try {
                claudeOut = useDefault
                    ? await runClaudePersistent(prompt)
                    : await runClaude(prompt, payload.model);
            } catch (err) {
                console.error('[persistente] fallback a runClaude classico (chat/completions):', err.message);
                claudeOut = await runClaude(prompt, payload.model);
            }

            if (claudeOut.is_error) {
                return sendJson(res, 500, {
                    error: {message: claudeOut.result || 'Errore da claude', type: 'upstream_error'},
                });
            }

            const usedModel = Object.keys(claudeOut.modelUsage || {})[0] || payload.model || DEFAULT_MODEL_LABEL;
            const completionId = `chatcmpl-${claudeOut.session_id || Date.now()}`;
            const createdAt = Math.floor(Date.now() / 1000);
            const content = claudeOut.result || '';
            const usage = {
                prompt_tokens: (claudeOut.usage && claudeOut.usage.input_tokens) || 0,
                completion_tokens: (claudeOut.usage && claudeOut.usage.output_tokens) || 0,
                total_tokens:
                    ((claudeOut.usage && claudeOut.usage.input_tokens) || 0) +
                    ((claudeOut.usage && claudeOut.usage.output_tokens) || 0),
            };

            // Molti client LangChain/OpenAI (incluso il nodo AI Agent di n8n) richiedono
            // risposta in streaming (Server-Sent Events). claude -p non streamma
            // nativamente: "finto streaming" restituendo l'intera risposta in un unico
            // chunk SSE, che i client OpenAI-compatibili sanno comunque interpretare.
            if (payload.stream) {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                });

                const roleChunk = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: createdAt,
                    model: usedModel,
                    choices: [{index: 0, delta: {role: 'assistant'}, finish_reason: null}],
                };
                const contentChunk = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: createdAt,
                    model: usedModel,
                    choices: [{index: 0, delta: {content}, finish_reason: null}],
                };
                const finishChunk = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: createdAt,
                    model: usedModel,
                    choices: [{index: 0, delta: {}, finish_reason: 'stop'}],
                    usage,
                };

                res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);
                res.write(`data: ${JSON.stringify(contentChunk)}\n\n`);
                res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
                res.write('data: [DONE]\n\n');
                return res.end();
            }

            const completion = {
                id: completionId,
                object: 'chat.completion',
                created: createdAt,
                model: usedModel,
                choices: [
                    {
                        index: 0,
                        message: {role: 'assistant', content},
                        finish_reason: 'stop',
                    },
                ],
                usage,
            };

            return sendJson(res, 200, completion);
        }

        res.writeHead(404, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'Not found'}));
    } catch (err) {
        sendJson(res, 500, {
            error: 'Errore interno del bridge',
            details: err && err.message ? err.message : String(err),
        });
    }
});

server.listen(PORT, () => {
    console.log(`Claude bridge HTTP in ascolto sulla porta ${PORT}`);
    console.log(`Endpoint: GET /health, GET /models, GET /v1/models, GET /status,`);
    console.log(`          POST /run {prompt, model?}, POST /v1/chat/completions {messages, model?}`);
});