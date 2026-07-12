import {
    IExecuteFunctions,
    ILoadOptionsFunctions,
    INodeExecutionData,
    INodePropertyOptions,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';

export class ClaudeCodeBridge implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Claude Code Bridge',
        name: 'claudeCodeBridge',
        icon: 'file:claudeCodeBridge.svg',
        group: ['transform'],
        version: 1,
        subtitle: '={{$parameter["model"]}}',
        description:
            'Esegue un prompt su Claude tramite il bridge locale Claude Code (abbonamento Pro/Max, no API key a consumo)',
        defaults: {
            name: 'Claude Code Bridge',
        },
        inputs: ['main'],
        outputs: ['main'],
        credentials: [
            {
                name: 'claudeCodeBridgeApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Prompt',
                name: 'prompt',
                type: 'string',
                typeOptions: {
                    rows: 4,
                },
                default: '',
                required: true,
                description: 'Il testo da inviare a Claude',
            },
            {
                displayName: 'Model',
                name: 'model',
                type: 'options',
                typeOptions: {
                    loadOptionsMethod: 'getModels',
                },
                default: 'claude-code-bridge',
                description:
                    'Modello da usare. "claude-code-bridge" usa il default configurato nel bridge (il modello più leggero/veloce).',
            },
            {
                displayName: 'Opzioni aggiuntive',
                name: 'additionalOptions',
                type: 'collection',
                placeholder: 'Aggiungi opzione',
                default: {},
                options: [
                    {
                        displayName: 'Timeout (ms)',
                        name: 'timeout',
                        type: 'number',
                        default: 180000,
                        description: 'Timeout massimo di attesa per la risposta del bridge',
                    },
                ],
            },
        ],
    };

    methods = {
        loadOptions: {
            async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
                const credentials = await this.getCredentials('claudeCodeBridgeApi');
                const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');

                try {
                    const response = (await this.helpers.httpRequest({
                        method: 'GET',
                        url: `${baseUrl}/models`,
                        json: true,
                    })) as { models?: Array<{ id: string; note?: string }> };

                    const models = response.models || [];
                    if (models.length === 0) {
                        throw new Error('Lista modelli vuota');
                    }

                    return models.map((m) => ({
                        name: m.note ? `${m.id} — ${m.note}` : m.id,
                        value: m.id,
                    }));
                } catch (error) {
                    // Fallback statico se il bridge non è raggiungibile durante l'editing del workflow
                    // (es. n8n e il bridge non ancora avviati insieme). Il nodo resta comunque utilizzabile.
                    return [
                        {name: 'claude-code-bridge (default, leggero)', value: 'claude-code-bridge'},
                        {name: 'claude-opus-4-8', value: 'claude-opus-4-8'},
                        {name: 'claude-sonnet-5', value: 'claude-sonnet-5'},
                        {name: 'claude-haiku-4-5-20251001', value: 'claude-haiku-4-5-20251001'},
                    ];
                }
            },
        },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        const credentials = await this.getCredentials('claudeCodeBridgeApi');
        const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');

        for (let i = 0; i < items.length; i++) {
            const prompt = this.getNodeParameter('prompt', i) as string;
            const model = this.getNodeParameter('model', i) as string;
            const additionalOptions = this.getNodeParameter('additionalOptions', i, {}) as {
                timeout?: number;
            };

            try {
                const response = (await this.helpers.httpRequest({
                    method: 'POST',
                    url: `${baseUrl}/run`,
                    body: {prompt, model},
                    json: true,
                    timeout: additionalOptions.timeout || 180000,
                })) as {
                    is_error?: boolean;
                    result?: string;
                    total_cost_usd?: number;
                    modelUsage?: Record<string, unknown>;
                    session_id?: string;
                };

                returnData.push({
                    json: {
                        successo: !response.is_error,
                        risposta: response.result,
                        costoFigurativo: response.total_cost_usd,
                        modello: Object.keys(response.modelUsage || {})[0] || model,
                        sessionId: response.session_id,
                    },
                    pairedItem: {item: i},
                });
            } catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: {
                            successo: false,
                            errore: (error as Error).message,
                        },
                        pairedItem: {item: i},
                    });
                    continue;
                }
                throw new Error(
                    `Errore chiamando il bridge Claude Code: ${(error as Error).message}`,
                );
            }
        }

        return [returnData];
    }
}