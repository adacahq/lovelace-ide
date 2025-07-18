import * as vscode from 'vscode';
import { ClaudeCoreClient, ClaudeQueryOptions } from './claudeCoreClient';
import { ClaudeSessionManager } from './claudeSessionManager';

export interface AgentExecutionResult {
    success: boolean;
    messages?: any[];
    error?: string;
    cost?: number;
    claudeSessionId?: string;
}

/**
 * Claude Agent Service - The worker specialist
 * Operates in sandbox environment with bypassPermissions mode
 */
export class ClaudeAgentService extends ClaudeCoreClient {
    private messages: any[] = [];
    private totalCost: number = 0;
    private hasError: boolean = false;

    constructor(
        sessionId: string,
        sandboxPath: string,
        outputChannel: vscode.OutputChannel
    ) {
        super(sessionId, outputChannel, sandboxPath);
    }

    protected getQueryOptions(message: string): ClaudeQueryOptions {
        // Start with base options from parent class
        const baseOptions = this.getBaseQueryOptions();
        
        // Add agent-specific options
        const options: ClaudeQueryOptions = {
            ...baseOptions,
            permissionMode: 'bypassPermissions',
            dangerouslySkipPermissions: true // Grant all permissions automatically
        } as ClaudeQueryOptions;

        return options;
    }


    protected handleSystemMessage(msg: any): void {
        super.handleSystemMessage(msg);
        this.messages.push(msg);
        
        // Normalize paths to handle macOS /private prefix
        const normalizedClaudePath = msg.cwd.replace(/^\/private/, '');
        const normalizedSandboxPath = this.sandboxPath.replace(/^\/private/, '');

        console.log(`[LOVELACE] Claude is operating in: ${msg.cwd}`);
        console.log(`[LOVELACE] Expected sandbox path: ${this.sandboxPath}`);
        console.log(`[LOVELACE] Normalized paths match: ${normalizedClaudePath === normalizedSandboxPath}`);
    }

    protected handleAssistantMessage(msg: any): void {
        super.handleAssistantMessage(msg);
        this.messages.push(msg);
        
        // Log tool uses for debugging
        if (msg.message?.content) {
            for (const content of msg.message.content) {
                if (content.type === 'text') {
                    this.outputChannel.appendLine(`Assistant: ${content.text.substring(0, 200)}...`);
                } else if (content.type === 'tool_use') {
                    this.outputChannel.appendLine(`Tool use: ${content.name}`);
                    if (content.name === 'Edit' || content.name === 'Write' || content.name === 'str_replace_editor') {
                        console.log(`[LOVELACE] File modification tool used: ${content.name}`);
                        console.log(`[LOVELACE] Tool input:`, JSON.stringify(content.input).substring(0, 200));
                    }
                }
            }
        }
    }

    protected handleResultMessage(msg: any): void {
        this.messages.push(msg);
        this.totalCost = msg.total_cost_usd || 0;
        if (msg.subtype !== 'success') {
            this.hasError = true;
        }
        super.handleResultMessage(msg);
    }

    public async executeAgent(userPrompt: string): Promise<AgentExecutionResult> {
        // Store original working directory
        const originalCwd = process.cwd();

        try {
            // Change to sandbox directory
            process.chdir(this.sandboxPath);
            console.log(`[LOVELACE] Changed working directory to sandbox: ${this.sandboxPath}`);

            // Reset state for new execution
            this.messages = [];
            this.totalCost = 0;
            this.hasError = false;

            // Execute the query using sendMessage from base class
            await this.sendMessage(userPrompt);

            // Restore original working directory BEFORE returning
            console.log(`[LOVELACE] Restoring working directory from ${process.cwd()} to ${originalCwd}`);
            process.chdir(originalCwd);
            console.log(`[LOVELACE] Working directory restored. Now at: ${process.cwd()}`);

            return {
                success: !this.hasError,
                messages: this.messages,
                cost: this.totalCost,
                claudeSessionId: this.getClaudeSessionId()
            };
        } catch (error: any) {
            // Restore original working directory on error
            try {
                process.chdir(originalCwd);
            } catch (cwdError) {
                this.outputChannel.appendLine(`Failed to restore working directory: ${cwdError}`);
            }

            if (this.claudeCodeSDK?.AbortError && error instanceof this.claudeCodeSDK.AbortError) {
                this.outputChannel.appendLine('Query was aborted by user');
                return {
                    success: false,
                    error: 'Query aborted by user',
                    messages: this.messages
                };
            } else {
                this.outputChannel.appendLine(`Error during Claude query: ${error}`);
                return {
                    success: false,
                    error: error.toString(),
                    messages: this.messages
                };
            }
        }
    }
}

/**
 * Service class for managing Claude agent sessions
 */
export class ClaudeAgentServiceManager {
    private sessions: Map<string, ClaudeAgentService> = new Map();

    constructor(
        private outputChannel: vscode.OutputChannel
    ) { }

    public async createSession(sessionId: string, sandboxPath: string): Promise<ClaudeAgentService> {
        const session = new ClaudeAgentService(
            sessionId,
            sandboxPath,
            this.outputChannel
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

    public getSession(sessionId: string): ClaudeAgentService | undefined {
        return this.sessions.get(sessionId);
    }
}

/**
 * Creates an agent function that can be executed within a sandbox by lovelace-diffs
 */
export function createClaudeAgentFunction(
    sessionManager: ClaudeSessionManager,
    outputChannel: vscode.OutputChannel,
    userPrompt: string,
    sessionId?: string,
    claudeSessionId?: string
) {
    /**
     * This function will be serialized and executed in the sandbox environment
     * It must be self-contained and include all necessary logic
     */
    return async (sandboxPath: string): Promise<AgentExecutionResult> => {
        outputChannel.appendLine(`Executing Claude agent in sandbox: ${sandboxPath}`);

        try {
            // Get or create session ID
            const currentSessionId = sessionId || sessionManager.getCurrentSessionId() ||
                sessionManager.createSession({ type: 'agent', contextId: sandboxPath });

            // Create the agent service instance for this sandbox
            const agentServiceManager = new ClaudeAgentServiceManager(outputChannel);
            const agentService = await agentServiceManager.createSession(currentSessionId, sandboxPath);

            // Set Claude session ID if we have one from a previous run
            if (claudeSessionId) {
                agentService.setClaudeSessionId(claudeSessionId);
            }

            // Execute the agent
            const result = await agentService.executeAgent(userPrompt);

            // Update session metadata with execution details
            sessionManager.updateSession(currentSessionId, {
                metadata: {
                    lastExecution: new Date().toISOString(),
                    sandboxPath: sandboxPath,
                    totalCost: result.cost || 0,
                    mode: 'agent'
                }
            });

            // Clean up the agent service
            await agentServiceManager.closeSession(currentSessionId);

            return result;

        } catch (error: any) {
            outputChannel.appendLine(`Failed to execute agent function: ${error}`);
            return {
                success: false,
                error: error.toString()
            };
        }
    };
}

/**
 * Helper to get files from the current workspace for context
 * This returns an empty array since the sandbox will contain all workspace files
 * and Claude SDK will operate within that sandbox directory
 */
export async function getWorkspaceFilesForContext(): Promise<vscode.Uri[]> {
    // For agent mode, we return an empty array because:
    // 1. The lovelace-diffs sandbox service will copy the entire workspace to the tmp directory
    // 2. Claude SDK will operate within that sandbox and have access to all files
    // 3. We don't need to specify individual files since the whole workspace is available

    // However, if we wanted to be more selective, we could implement logic like:
    // const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    // if (!workspaceFolder) {
    //     return [];
    // }
    //
    // const files = await vscode.workspace.findFiles(
    //     '**/*.{ts,js,tsx,jsx,py,java,cpp,c,cs,go,rs,php,rb,swift,kt,scala,html,css,scss,less,json,yaml,yml,xml,md,txt}',
    //     '**/node_modules/**'
    // );
    //
    // return files.slice(0, 50); // Limit to 50 files to avoid overwhelming

    return [];
}
