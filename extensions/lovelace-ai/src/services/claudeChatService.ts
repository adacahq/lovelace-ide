import * as vscode from 'vscode';
import { ClaudeCoreClient, ClaudeQueryOptions } from './claudeCoreClient';

/**
 * Claude Chat Service - The conversationalist specialist
 * Operates directly in the workspace with 'plan' permission mode
 */
export class ClaudeChatService extends ClaudeCoreClient {
    constructor(
        sessionId: string,
        private workspaceRoot: string | undefined,
        outputChannel: vscode.OutputChannel,
        sandboxPath: string,
        private mode: 'chat' | 'agent' = 'chat'
    ) {
        super(sessionId, outputChannel, sandboxPath);
    }

    protected getQueryOptions(message: string): ClaudeQueryOptions {
        // Start with base options from parent class
        const baseOptions = this.getBaseQueryOptions();
        
        // Add chat-specific options
        const options: ClaudeQueryOptions = {
            ...baseOptions
        } as ClaudeQueryOptions;

        // Set permission mode based on the selected mode
        if (this.mode === 'chat') {
            options.permissionMode = 'plan';
            // In plan mode, we don't set dangerouslySkipPermissions
        } else {
            // Agent mode in chat UI - still runs in workspace but with bypassPermissions
            options.permissionMode = 'bypassPermissions';
            options.dangerouslySkipPermissions = true;
        }

        return options;
    }

    public setMode(mode: 'chat' | 'agent') {
        if (this.isActive()) {
            throw new Error('Cannot change mode while session is active');
        }
        this.mode = mode;
    }

    public getMode(): 'chat' | 'agent' {
        return this.mode;
    }
}

/**
 * Service class for managing Claude chat sessions
 */
export class ClaudeChatServiceManager {
    private sessions: Map<string, ClaudeChatService> = new Map();

    constructor(
        private outputChannel: vscode.OutputChannel
    ) { }

    public async createSession(sessionId: string, sandboxPath: string, mode: 'chat' | 'agent' = 'chat'): Promise<ClaudeChatService> {
        // Get the current workspace folder
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        const session = new ClaudeChatService(
            sessionId,
            workspaceRoot,
            this.outputChannel,
            sandboxPath,
            mode
        );

        this.sessions.set(sessionId, session);
        return session;
    }

    public async closeSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.close();
            this.sessions.delete(sessionId);
        }
    }

    public async closeAllSessions(): Promise<void> {
        for (const [sessionId, session] of this.sessions) {
            await session.close();
        }
        this.sessions.clear();
    }

    public getSession(sessionId: string): ClaudeChatService | undefined {
        return this.sessions.get(sessionId);
    }
}
