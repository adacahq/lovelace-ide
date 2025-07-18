import * as vscode from 'vscode';
import { EventEmitter } from 'events';

// Types from the SDK
export type SDKMessage = any;
export type SDKAssistantMessage = any;
export type SDKUserMessage = any;
export type SDKResultMessage = any;
export type SDKSystemMessage = any;
export type AbortError = any;

export interface ClaudeSessionEvents {
    'data': (data: SDKMessage) => void;
    'message': (message: SDKAssistantMessage) => void;
    'response': (response: string) => void;
    'error': (error: string) => void;
    'exit': (code: number) => void;
    'sessionIdUpdate': (sessionId: string) => void;
}

export interface ClaudeQueryOptions {
    cwd: string;
    outputFormat: 'stream-json';
    model: string;
    fallbackModel?: string;
    permissionMode?: 'plan' | 'bypassPermissions';
    dangerouslySkipPermissions?: boolean;
    resume?: string;
}

/**
 * Base class for Claude SDK sessions - shared foundation for both chat and agent modes
 */
export abstract class ClaudeCoreClient extends EventEmitter {
    protected abortController: AbortController | null = null;
    protected _active: boolean = false;
    protected responseGenerator: AsyncGenerator<SDKMessage> | null = null;
    protected claudeCodeSDK: any = null;
    protected claudeSessionId?: string;
    protected originalCwd?: string;

    constructor(
        protected sessionId: string,
        protected outputChannel: vscode.OutputChannel,
        protected sandboxPath: string
    ) {
        super();
        if (!sandboxPath) {
            throw new Error('Sandbox path is required for Claude sessions');
        }
        this.initializeSandbox();
        this.loadSDK();
    }

    private initializeSandbox() {
        // Store the original working directory
        this.originalCwd = process.cwd();
        
        // Change to sandbox directory
        try {
            process.chdir(this.sandboxPath);
        } catch (error) {
            throw new Error(`Failed to initialize sandbox: ${error}`);
        }
    }

    private async loadSDK() {
        try {
            // Dynamic import for ES module
            const sdkModule = await import('@anthropic-ai/claude-code');
            this.claudeCodeSDK = sdkModule;
        } catch (error) {
            this.outputChannel.appendLine(`Failed to load Claude Code SDK: ${error}`);
        }
    }

    on<K extends keyof ClaudeSessionEvents>(event: K, listener: ClaudeSessionEvents[K]): this {
        return super.on(event, listener);
    }

    emit<K extends keyof ClaudeSessionEvents>(event: K, ...args: Parameters<ClaudeSessionEvents[K]>): boolean {
        return super.emit(event, ...args);
    }

    /**
     * Get base query options with common defaults
     */
    protected getBaseQueryOptions(): Partial<ClaudeQueryOptions> {
        const options: Partial<ClaudeQueryOptions> = {
            outputFormat: 'stream-json',
            model: 'claude-sonnet-4-20250514',
            cwd: this.sandboxPath
        };

        // If we have a Claude session ID, use resume
        if (this.claudeSessionId) {
            options.resume = this.claudeSessionId;
        }

        return options;
    }

    /**
     * Get query options specific to the service implementation
     * Derived classes should call getBaseQueryOptions() and extend with their specific needs
     */
    protected abstract getQueryOptions(message: string): ClaudeQueryOptions;

    /**
     * Send a message to Claude
     */
    public async sendMessage(message: string): Promise<void> {
        if (!this._active) {
            await this.initialize();
        }

        // Wait for SDK to load if needed
        if (!this.claudeCodeSDK) {
            await this.loadSDK();
            if (!this.claudeCodeSDK) {
                throw new Error('Failed to load Claude Code SDK');
            }
        }

        try {
            this.abortController = new AbortController();

            const options = this.getQueryOptions(message);

            // Start the query
            this.responseGenerator = this.claudeCodeSDK.query({
                prompt: message,
                abortController: this.abortController,
                options: options
            });

            // Process the streaming response
            if (this.responseGenerator) {

                for await (const msg of this.responseGenerator) {
                    console.log(`RESPONSE GENERATOR: ${JSON.stringify(msg)}`);

                    // Emit the raw SDK message
                    this.emit('data', msg);

                    switch (msg.type) {
                        case 'system':
                            this.handleSystemMessage(msg);
                            break;

                        case 'assistant':
                            this.handleAssistantMessage(msg);
                            break;

                        case 'user':
                            // User messages echo back what we sent
                            break;

                        case 'result':
                            this.handleResultMessage(msg);
                            break;
                    }
                }
            }
        } catch (error: any) {
            if (this.claudeCodeSDK?.AbortError && error instanceof this.claudeCodeSDK.AbortError) {
                this.outputChannel.appendLine('Query was aborted');
            } else {
                this.outputChannel.appendLine(`Error during query: ${error}`);
                this.emit('error', String(error));
            }
        }
    }

    protected handleSystemMessage(msg: SDKSystemMessage): void {
        this.outputChannel.appendLine(`System initialized: ${msg.cwd}, Model: ${msg.model}`);
        this.outputChannel.appendLine(`Available tools: ${msg.tools.join(', ')}`);

        // Check if system message contains session ID and update it
        if (msg.session_id) {
            this.outputChannel.appendLine(`Claude session ID: ${msg.session_id}`);
            this.claudeSessionId = msg.session_id;
            this.emit('sessionIdUpdate', msg.session_id);
        }
    }

    protected handleAssistantMessage(msg: SDKAssistantMessage): void {
        // Emit individual assistant messages for parsing
        this.emit('message', msg);
    }

    protected handleResultMessage(msg: SDKResultMessage): void {
        this.outputChannel.appendLine(`Result: ${msg.subtype}, Turns: ${msg.num_turns}, Cost: $${msg.total_cost_usd}`);

        if (msg.subtype === 'success') {
            this.emit('response', msg.result);
        } else {
            this.emit('error', `Query ended with ${msg.subtype}`);
        }

        // Session is complete
        this._active = false;
        this.emit('exit', msg.is_error ? 1 : 0);
    }

    public terminate(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this._active = false;
    }

    public isActive(): boolean {
        return this._active;
    }

    protected async initialize(): Promise<void> {
        this._active = true;
    }

    public async close(): Promise<void> {
        this.terminate();
        this.removeAllListeners();
    }

    public setClaudeSessionId(sessionId: string) {
        this.claudeSessionId = sessionId;
    }

    public getClaudeSessionId(): string | undefined {
        return this.claudeSessionId;
    }
}
