"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.ClaudeCodeBridgeApi = void 0;
class ClaudeCodeBridgeApi {
    constructor() {
        this.name = 'claudeCodeBridgeApi';
        this.displayName = 'Claude Code Bridge API';
        this.documentationUrl = '';
        this.properties = [
            {
                displayName: 'Base URL',
                name: 'baseUrl',
                type: 'string',
                default: 'http://claude-code-agent:4000',
                required: true,
                description: 'URL base del bridge Claude Code (senza /v1 o /run finale). ' +
                    'Nella rete Docker interna è tipicamente http://claude-code-agent:4000',
            },
        ];
    }
}
exports.ClaudeCodeBridgeApi = ClaudeCodeBridgeApi;
