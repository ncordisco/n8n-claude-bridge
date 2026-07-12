import {ICredentialType, INodeProperties} from 'n8n-workflow';

export class ClaudeCodeBridgeApi implements ICredentialType {
    name = 'claudeCodeBridgeApi';

    displayName = 'Claude Code Bridge API';

    documentationUrl = '';

    properties: INodeProperties[] = [
        {
            displayName: 'Base URL',
            name: 'baseUrl',
            type: 'string',
            default: 'http://claude-code-agent:4000',
            required: true,
            description:
                'URL base del bridge Claude Code (senza /v1 o /run finale). ' +
                'Nella rete Docker interna è tipicamente http://claude-code-agent:4000',
        },
    ];
}
