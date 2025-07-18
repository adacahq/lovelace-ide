import * as vscode from 'vscode';

export interface SessionContext {
    type: 'webview' | 'agent' | 'command';
    contextId: string;
    metadata?: Record<string, any>;
}

export class ClaudeSessionManager {
    private sessions: Map<string, SessionContext> = new Map();
    private currentSessionId: string | null = null;
    
    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) {
        this.loadSessions();
    }
    
    /**
     * Create a new session with a specific context
     */
    public createSession(context: SessionContext): string {
        const sessionId = this.generateSessionId();
        this.sessions.set(sessionId, context);
        this.saveSessions();
        this.outputChannel.appendLine(`Created new session: ${sessionId} (${context.type})`);
        return sessionId;
    }
    
    /**
     * Get session context by ID
     */
    public getSession(sessionId: string): SessionContext | undefined {
        return this.sessions.get(sessionId);
    }
    
    /**
     * Update session context
     */
    public updateSession(sessionId: string, updates: Partial<SessionContext>): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.sessions.set(sessionId, { ...session, ...updates });
            this.saveSessions();
        }
    }
    
    /**
     * Set the current active session
     */
    public setCurrentSession(sessionId: string): void {
        if (this.sessions.has(sessionId)) {
            this.currentSessionId = sessionId;
            this.outputChannel.appendLine(`Current session set to: ${sessionId}`);
        }
    }
    
    /**
     * Get the current active session ID
     */
    public getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }
    
    /**
     * Get or create a session for a specific context
     */
    public getOrCreateSessionForContext(contextId: string, type: SessionContext['type']): string {
        // Find existing session for this context
        for (const [sessionId, context] of this.sessions.entries()) {
            if (context.contextId === contextId && context.type === type) {
                return sessionId;
            }
        }
        
        // Create new session if none exists
        return this.createSession({ type, contextId });
    }
    
    /**
     * Remove a session
     */
    public removeSession(sessionId: string): void {
        this.sessions.delete(sessionId);
        if (this.currentSessionId === sessionId) {
            this.currentSessionId = null;
        }
        this.saveSessions();
        this.outputChannel.appendLine(`Removed session: ${sessionId}`);
    }
    
    /**
     * Clear all sessions
     */
    public clearAllSessions(): void {
        this.sessions.clear();
        this.currentSessionId = null;
        this.saveSessions();
        this.outputChannel.appendLine('Cleared all sessions');
    }
    
    /**
     * Get all active sessions
     */
    public getAllSessions(): Map<string, SessionContext> {
        return new Map(this.sessions);
    }
    
    private generateSessionId(): string {
        return `claude-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    private saveSessions(): void {
        const sessionsData = Array.from(this.sessions.entries());
        this.context.workspaceState.update('claudeSessions', sessionsData);
        this.context.workspaceState.update('currentSessionId', this.currentSessionId);
    }
    
    private loadSessions(): void {
        const sessionsData = this.context.workspaceState.get<Array<[string, SessionContext]>>('claudeSessions');
        if (sessionsData) {
            this.sessions = new Map(sessionsData);
        }
        this.currentSessionId = this.context.workspaceState.get<string>('currentSessionId') || null;
    }
}