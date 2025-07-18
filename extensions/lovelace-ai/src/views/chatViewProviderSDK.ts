import * as vscode from 'vscode';
import { SDKMessage, SDKAssistantMessage, SDKResultMessage, SDKUserMessage, SDKSystemMessage, ClaudeMessage } from '../types';
import { ClaudeChatService, ClaudeChatServiceManager } from '../services/claudeChatService';
import { getWorkspaceFilesForContext } from '../services/claudeAgentService';
import { SDKMessageParser } from '../utils/sdkMessageParser';
import { ClaudeSessionManager } from '../services/claudeSessionManager';
import { ClaudeAPI } from '../services/claudeApi';
import { getFileModifyingTools } from '../config/claudeToolsConfig';

export class ChatViewProviderSDK implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _chatSessions: Map<string, ChatSession> = new Map();
    private _currentSessionId?: string;
    private _parsers: Map<string, SDKMessageParser> = new Map();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _claudeApi: ClaudeAPI,
        private readonly _claudeService: ClaudeChatServiceManager,
        private readonly _outputChannel: vscode.OutputChannel,
        private readonly _sessionManager?: ClaudeSessionManager
    ) {
        // Don't initialize in constructor - wait for resolveWebviewView
    }

    private async initializeFirstSession() {
        const sessionId = this.generateSessionId();
        await this.createChatSession(sessionId, 'Chat 1');
        this._currentSessionId = sessionId;
    }

    private async createSandbox(): Promise<{ sandboxPath: string } | null> {
        try {
            // Use the new createSandbox command that just creates a sandbox without review
            const sandboxPath = await vscode.commands.executeCommand<string | null>(
                'lovelace-diffs.createSandbox'
            );

            if (!sandboxPath) {
                throw new Error('Failed to create sandbox - no path returned');
            }
            
            return { sandboxPath };
        } catch (error) {
            this._outputChannel.appendLine(`Failed to create sandbox: ${error}`);
            return null;
        }
    }

    private async createChatSession(sessionId: string, title: string, mode: 'chat' | 'agent' = 'agent') {
        try {
            // Create sandbox for this session
            const sandboxResult = await this.createSandbox();
            if (!sandboxResult || !sandboxResult.sandboxPath) {
                throw new Error('Failed to create sandbox for session');
            }

            const claudeSession = await this._claudeService.createSession(sessionId, sandboxResult.sandboxPath, mode);

            const chatSession: ChatSession = {
                id: sessionId,
                title,
                messages: [],
                claudeSession,
                isStreaming: false,
                sdkMessages: [],
                mode,
                sandboxPath: sandboxResult.sandboxPath
            };


            // Set up event listeners for the Claude session
            claudeSession.on('data', (msg: SDKMessage) => {
                this.handleSDKMessage(sessionId, msg);
            });

            claudeSession.on('message', (msg: SDKAssistantMessage) => {
                this.handleAssistantMessage(sessionId, msg);
            });

            claudeSession.on('response', (response: string) => {
                this.handleStreamingComplete(sessionId);
            });

            claudeSession.on('error', (error: string) => {
                this.handleSessionError(sessionId, error);
            });

            claudeSession.on('exit', (code: number) => {
                this.handleSessionExit(sessionId, code);
            });

            claudeSession.on('sessionIdUpdate', (claudeSessionId: string) => {
                this.handleSessionIdUpdate(sessionId, claudeSessionId);
            });

            this._chatSessions.set(sessionId, chatSession);
        } catch (error) {
            this._outputChannel.appendLine(`Failed to create Claude session: ${error}`);
            vscode.window.showErrorMessage(`Failed to create Claude session: ${error}`);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async (data: any) => {
                switch (data.type) {
                    case 'sendMessage':
                        await this.handleUserMessage(data.message, data.mode);
                        break;
                    case 'switchSession':
                        await this.switchToSession(data.sessionId);
                        break;
                    case 'closeSession':
                        await this.closeSession(data.sessionId);
                        break;
                    case 'newSession':
                        await this.newChatSession();
                        break;
                    case 'terminate':
                        await this.handleTerminate();
                        break;
                    case 'openDiff':
                        await this.openFileWithDiffs(data.sessionId, data.filePath);
                        break;
                    case 'acceptAll':
                        await this.acceptAllChanges(data.sessionId);
                        break;
                    case 'rejectAll':
                        await this.rejectAllChanges(data.sessionId);
                        break;
                }
            }
        );

        // Initialize first session if none exists
        if (this._chatSessions.size === 0) {
            this.initializeFirstSession().then(() => {
                this.updateWebview();
            }).catch(error => {
                this._outputChannel.appendLine(`Failed to initialize first session: ${error}`);
                vscode.window.showErrorMessage(`Failed to initialize chat: ${error}`);
            });
        } else {
            // Just update if sessions already exist
            this.updateWebview();
        }
    }

    private async handleUserMessage(message: string, mode?: 'chat' | 'agent') {
        if (!this._currentSessionId || !this._view) {
            this._outputChannel.appendLine(`ERROR: No current session ID or view`);
            return;
        }

        const session = this._chatSessions.get(this._currentSessionId);
        if (!session) {
            this._outputChannel.appendLine(`ERROR: No session found for ID: ${this._currentSessionId}`);
            vscode.window.showErrorMessage('No active chat session');
            return;
        }

        // If this is the first message in the session, set the mode
        if (session.messages.length === 0 && mode) {
            session.mode = mode;
            session.claudeSession.setMode(mode);
        }

        // Common message handling for both modes
        // Add user message to the chat
        const userMessage = {
            role: 'user' as const,
            content: message,
            timestamp: new Date()
        };
        session.messages.push(userMessage);

        // Create streaming assistant message placeholder
        const streamingMessage: ChatMessage = {
            role: 'assistant' as const,
            content: '',
            timestamp: new Date(),
            isStreaming: true,
            parsedMessages: []
        };
        session.messages.push(streamingMessage);

        // Initialize parser for streaming
        const parser = new SDKMessageParser();
        this._parsers.set(this._currentSessionId, parser);

        // Mark session as streaming
        session.isStreaming = true;
        this.updateWebview();

        try {
            // Set Claude session ID if we have one from previous messages
            if (session.claudeSessionId) {
                const claudeService = session.claudeSession as any;
                if (claudeService.setClaudeSessionId) {
                    claudeService.setClaudeSessionId(session.claudeSessionId);
                }
            }

            // Send message to Claude (will stream responses)
            await session.claudeSession.sendMessage(message);

        } catch (error) {
            this._outputChannel.appendLine(`Error sending message: ${error}`);
            vscode.window.showErrorMessage(`Failed to send message: ${error}`);
            session.isStreaming = false;
            this.updateWebview();
        }
    }

    private handleSDKMessage(sessionId: string, msg: SDKMessage) {
        const session = this._chatSessions.get(sessionId);
        if (!session) return;

        // Store all SDK messages
        session.sdkMessages.push(msg);

        // Handle tool results separately
        if (msg.type === 'user' && msg.message && msg.message.content) {
            for (const content of msg.message.content) {
                if (content.type === 'tool_result') {
                    // Find the last assistant message
                    const lastAssistantMsg = [...session.messages]
                        .reverse()
                        .find(m => m.role === 'assistant' && m.parsedMessages);

                    if (lastAssistantMsg && lastAssistantMsg.parsedMessages) {
                        // Find the corresponding tool action
                        const toolAction = [...lastAssistantMsg.parsedMessages]
                            .reverse()
                            .find(pm => pm.type === 'tool_action' && pm.tool === content.tool_use_id);

                        if (toolAction) {
                            if (!toolAction.output) toolAction.output = [];

                            // Format the output based on whether it's an error
                            const output = content.is_error
                                ? `❌ Error: ${content.content}`
                                : content.content;

                            if (output.trim()) {
                                toolAction.output.push(output);
                                this.updateWebview();
                            }
                        }
                    }
                }
            }
        }
    }

    private handleAssistantMessage(sessionId: string, msg: SDKAssistantMessage) {
        const session = this._chatSessions.get(sessionId);
        if (!session) return;

        const parser = this._parsers.get(sessionId);
        if (!parser) return;

        // Find the current streaming message
        const streamingMessage = session.messages.find(m =>
            m.role === 'assistant' && m.isStreaming
        );

        if (!streamingMessage) {
            this._outputChannel.appendLine(`WARNING: No streaming message found for session ${sessionId}`);
            return;
        }

        // Parse the assistant message
        const parsedMessages = parser.parseAssistantMessage(msg);

        // Initialize parsedMessages array if needed
        if (!streamingMessage.parsedMessages) {
            streamingMessage.parsedMessages = [];
        }

        // Add to existing parsed messages
        streamingMessage.parsedMessages.push(...parsedMessages);

        // Update the content with the combined text from all parsed messages
        // streamingMessage.content = this.formatParsedMessages(streamingMessage.parsedMessages);


        // Update the webview
        this.updateWebview();
    }

    private async handleTerminate() {
        if (!this._currentSessionId) return;

        const session = this._chatSessions.get(this._currentSessionId);
        if (!session || !session.claudeSession.isActive()) return;

        session.claudeSession.terminate();

        // Clear streaming state
        session.isStreaming = false;

        // Find and finalize any streaming messages
        const streamingMessage = session.messages.find(m =>
            m.role === 'assistant' && m.isStreaming
        );

        if (streamingMessage) {
            streamingMessage.isStreaming = false;
            streamingMessage.content = this.formatParsedMessages(streamingMessage.parsedMessages || []);
        }

        this.updateWebview();
    }

    private formatParsedMessages(parsedMessages: any[]): string {
        if (!parsedMessages || parsedMessages.length === 0) return '';

        return parsedMessages.map(msg => {
            switch (msg.type) {
                case 'text':
                    return msg.content;
                case 'tool_action':
                    let result = `🔧 ${msg.content}`;
                    if (msg.output && msg.output.length > 0) {
                        result += '\n' + msg.output.map((o: string) => `  ↳ ${o}`).join('\n');
                    }
                    return result;
                case 'code_block':
                    return `\`\`\`${msg.language || ''}\n${msg.content}\n\`\`\``;
                case 'status':
                    return `*${msg.content}*`;
                case 'file_operation':
                    const op = msg.fileOperation;
                    if (!op) return msg.content;

                    let content = `📄 **${op.type.charAt(0).toUpperCase() + op.type.slice(1)}: ${op.filename}**`;

                    if (op.diff) {
                        content += '\n```diff\n';
                        op.diff.forEach((line: any) => {
                            const prefix = line.operation === 'add' ? '+' :
                                line.operation === 'remove' ? '-' : ' ';
                            content += `${prefix} ${line.content}\n`;
                        });
                        content += '```';
                    } else if (op.content) {
                        // Detect language from filename
                        const ext = op.filename.split('.').pop();
                        const lang = this.getLanguageFromExtension(ext);
                        content += `\`\`\`${lang}\n${op.content}\n\`\`\``;
                    }

                    return content;
                default:
                    return msg.content;
            }
        }).join('\n\n');
    }

    private getChoiceLabel(choice: string, promptType: string): string {
        // For yes/no prompts
        if (promptType === 'yesno') {
            return choice === '0' ? 'No' : 'Yes';
        }

        // For numbered choices, return as is
        if (promptType === 'numbered') {
            return choice;
        }

        // For continue prompts
        if (promptType === 'continue') {
            return 'Continue';
        }

        // Default fallback
        return choice;
    }

    private async switchToSession(sessionId: string) {
        if (this._chatSessions.has(sessionId)) {
            this._currentSessionId = sessionId;
            this.updateWebview();
        }
    }

    private async closeSession(sessionId: string) {
        const session = this._chatSessions.get(sessionId);
        if (session) {
            // Clean up sandbox if in agent mode
            if (session.sandboxPath) {
                try {
                    this._outputChannel.appendLine(`Cleaning up sandbox for session ${sessionId}: ${session.sandboxPath}`);
                    await vscode.commands.executeCommand('lovelace-diffs.cleanupSandbox', session.sandboxPath);
                } catch (error) {
                    this._outputChannel.appendLine(`Failed to cleanup sandbox: ${error}`);
                }
            }

            await this._claudeService.closeSession(sessionId);
            this._chatSessions.delete(sessionId);
            this._parsers.delete(sessionId);
        }

        if (this._currentSessionId === sessionId) {
            const remainingSessions = Array.from(this._chatSessions.keys());
            if (remainingSessions.length > 0) {
                this._currentSessionId = remainingSessions[0];
            } else {
                await this.initializeFirstSession();
            }
        }

        this.updateWebview();
    }

    private async handleStreamingComplete(sessionId: string) {
        const session = this._chatSessions.get(sessionId);
        if (!session) return;

        // Find and finalize the streaming message
        const streamingMessage = session.messages.find(m =>
            m.role === 'assistant' && m.isStreaming
        );

        if (streamingMessage) {
            streamingMessage.isStreaming = false;
            // Format all parsed messages into final content
            streamingMessage.content = this.formatParsedMessages(streamingMessage.parsedMessages || []);
        }

        session.isStreaming = false;

        // Handle agent mode sandbox execution after streaming completes
        if (session.mode === 'agent' && streamingMessage && streamingMessage.parsedMessages) {
            await this.handleAgentToolUse(session, streamingMessage.parsedMessages);
        }

        // Detect changes in agent mode
        if (session.mode === 'agent' && session.sandboxPath) {
            await this.detectAndUpdateChanges(sessionId);
        }

        this.updateWebview();

        // Clear status after a delay
        if (this._view) {
            setTimeout(() => {
                this._view?.webview.postMessage({
                    type: 'clearStatus'
                });
            }, 2000);
        }
    }

    private async handleAgentToolUse(session: ChatSession, parsedMessages: ClaudeMessage[]) {
        // Check if any tool uses modified files using the configuration
        const fileModifyingTools = getFileModifyingTools();

        const hasFileModifications = parsedMessages.some(msg =>
            msg.type === 'tool_action' &&
            fileModifyingTools.includes(msg.tool || '')
        );

        if (!hasFileModifications) {
            // No file modifications
            return;
        }

        // Changes will be detected in handleStreamingComplete
    }

    private async detectAndUpdateChanges(sessionId: string) {
        const session = this._chatSessions.get(sessionId);
        if (!session || !session.sandboxPath) return;

        try {
            // Use lovelace-diffs to detect changes
            const changeSet = await vscode.commands.executeCommand<any>(
                'lovelace-diffs.detectChanges',
                session.sandboxPath
            );

            if (!changeSet) return;

            // Calculate line stats for each file
            const lineStats = new Map<string, {additions: number; deletions: number}>();
            
            // Calculate diff stats for modified files
            const diff = require('diff');
            const fs = require('fs').promises;
            const path = require('path');
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            
            if (workspaceFolder) {
                for (const change of changeSet.modified || []) {
                    try {
                        const originalPath = change.originalUri.fsPath;
                        const sandboxPath = change.sandboxPath;
                        
                        const originalContent = await fs.readFile(originalPath, 'utf8');
                        const modifiedContent = await fs.readFile(sandboxPath, 'utf8');
                        
                        const changes = diff.diffLines(originalContent, modifiedContent);
                        let additions = 0;
                        let deletions = 0;
                        
                        for (const diffChange of changes) {
                            if (diffChange.added) {
                                additions += diffChange.count || 1;
                            } else if (diffChange.removed) {
                                deletions += diffChange.count || 1;
                            }
                        }
                        
                        lineStats.set(change.path, { additions, deletions });
                    } catch (error) {
                        this._outputChannel.appendLine(`Failed to calculate diff for ${change.path}: ${error}`);
                        lineStats.set(change.path, { additions: 0, deletions: 0 });
                    }
                }
            }

            // Store in session
            session.pendingChanges = {
                changeSet,
                timestamp: new Date(),
                lineStats
            };

            // Send to webview
            this.sendChangesToWebview(sessionId, changeSet);
        } catch (error) {
            this._outputChannel.appendLine(`Failed to detect changes: ${error}`);
        }
    }

    private sendChangesToWebview(sessionId: string, changeSet: any) {
        if (!this._view) return;

        const formatChanges = async () => {
            const changes = {
                modified: [] as Array<{path: string; additions: number; deletions: number}>,
                added: [] as Array<{path: string; lines: number}>,
                deleted: [] as Array<{path: string}>
            };

            // Format modified files
            for (const change of changeSet.modified || []) {
                const stats = this._chatSessions.get(sessionId)?.pendingChanges?.lineStats.get(change.path);
                changes.modified.push({
                    path: change.path,
                    additions: stats?.additions || 0,
                    deletions: stats?.deletions || 0
                });
            }

            // Format added files and count lines
            const fs = require('fs').promises;
            for (const change of changeSet.added || []) {
                let lineCount = 0;
                try {
                    const content = await fs.readFile(change.sandboxPath, 'utf8');
                    lineCount = content.split('\n').length;
                } catch (error) {
                    this._outputChannel.appendLine(`Failed to count lines for ${change.path}: ${error}`);
                }
                
                changes.added.push({
                    path: change.path,
                    lines: lineCount
                });
            }

            // Format deleted files
            for (const change of changeSet.deleted || []) {
                changes.deleted.push({
                    path: change.path
                });
            }

            return changes;
        };

        // Since formatChanges is now async, handle it properly
        formatChanges().then(changes => {
            this._view?.webview.postMessage({
                type: 'changesUpdate',
                sessionId,
                changes
            });
        }).catch(error => {
            this._outputChannel.appendLine(`Failed to format changes: ${error}`);
        });
    }

    private handleSessionError(sessionId: string, error: string) {
        const session = this._chatSessions.get(sessionId);
        if (!session) return;

        // Filter system reminders from error messages
        const filteredError = this.filterSystemReminders(error);
        if (filteredError.trim()) {
            session.messages.push({
                role: 'assistant' as const,
                content: `I encountered an error: ${filteredError}`,
                timestamp: new Date()
            });
        }

        session.isStreaming = false;
        this.updateWebview();
    }

    private handleSessionExit(sessionId: string, code: number) {
        const session = this._chatSessions.get(sessionId);
        if (!session) return;

        if (code !== 0) {
            session.messages.push({
                role: 'assistant' as const,
                content: `Session ended unexpectedly (exit code: ${code})`,
                timestamp: new Date()
            });
        }

        session.isStreaming = false;

        // Clean up parser for this session
        this._parsers.delete(sessionId);

        this.updateWebview();
    }

    private handleSessionIdUpdate(sessionId: string, claudeSessionId: string) {
        const session = this._chatSessions.get(sessionId);
        if (!session) return;

        // Update the Claude session ID for the chat session
        session.claudeSessionId = claudeSessionId;

        // Update the Claude service with the new session ID if in chat mode
        const claudeChatService = session.claudeSession as any;
        if (claudeChatService.setClaudeSessionId) {
            claudeChatService.setClaudeSessionId(claudeSessionId);
        }


        // Update the webview to reflect any changes
        this.updateWebview();
    }

    private getLanguageFromExtension(ext?: string): string {
        const langMap: { [key: string]: string } = {
            'js': 'javascript',
            'ts': 'typescript',
            'jsx': 'javascript',
            'tsx': 'typescript',
            'json': 'json',
            'py': 'python',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'cs': 'csharp',
            'go': 'go',
            'rs': 'rust',
            'php': 'php',
            'rb': 'ruby',
            'swift': 'swift',
            'kt': 'kotlin',
            'scala': 'scala',
            'r': 'r',
            'lua': 'lua',
            'pl': 'perl',
            'sh': 'bash',
            'bash': 'bash',
            'zsh': 'bash',
            'fish': 'fish',
            'ps1': 'powershell',
            'bat': 'batch',
            'cmd': 'batch',
            'html': 'html',
            'htm': 'html',
            'xml': 'xml',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'less': 'less',
            'sql': 'sql',
            'md': 'markdown',
            'tex': 'latex',
            'dockerfile': 'dockerfile',
            'yaml': 'yaml',
            'yml': 'yaml',
            'toml': 'toml',
            'ini': 'ini',
            'cfg': 'ini',
            'conf': 'nginx',
            'diff': 'diff',
            'patch': 'diff'
        };

        return langMap[ext?.toLowerCase() || ''] || 'plaintext';
    }

    public async newChatSession() {
        const sessionId = this.generateSessionId();
        const sessionCount = this._chatSessions.size + 1;

        await this.createChatSession(sessionId, `Chat ${sessionCount}`);
        this._currentSessionId = sessionId;
        this.updateWebview();
    }

    private generateSessionId(): string {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private filterSystemReminders(text: string): string {
        // Remove system-reminder blocks
        const systemReminderRegex = /<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/gi;
        return text.replace(systemReminderRegex, '').trim();
    }

    private async openFileWithDiffs(sessionId: string, filePath: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
        
        // Register this file for diff decorations
        await vscode.commands.executeCommand(
            'lovelace-diffs.registerSandboxFile',
            fileUri,
            sessionId,
            this._chatSessions.get(sessionId)?.sandboxPath
        );
        
        // Open the file
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);
        
        // Trigger decoration update
        await vscode.commands.executeCommand(
            'lovelace-diffs.updateFileDecorations',
            fileUri
        );
    }

    private async acceptAllChanges(sessionId: string) {
        const session = this._chatSessions.get(sessionId);
        if (!session?.pendingChanges) {
            this._outputChannel.appendLine('No pending changes found for session');
            return;
        }

        try {
            this._outputChannel.appendLine(`Accepting changes for session ${sessionId}:`);
            this._outputChannel.appendLine(`- Modified: ${session.pendingChanges.changeSet.modified.length}`);
            this._outputChannel.appendLine(`- Added: ${session.pendingChanges.changeSet.added.length}`);
            this._outputChannel.appendLine(`- Deleted: ${session.pendingChanges.changeSet.deleted.length}`);
            
            // Log the actual files
            for (const change of session.pendingChanges.changeSet.modified) {
                this._outputChannel.appendLine(`  Modified: ${change.path} (${change.sandboxPath} -> ${change.originalUri.fsPath})`);
            }
            
            // Apply changes using sandbox service
            await vscode.commands.executeCommand(
                'lovelace-diffs.applyChanges',
                session.pendingChanges.changeSet
            );

            // Clear decorations for all affected files
            for (const change of session.pendingChanges.changeSet.modified || []) {
                const fileUri = change.originalUri;
                await vscode.commands.executeCommand(
                    'lovelace-diffs.rejectSandboxChanges',
                    fileUri,
                    sessionId
                );
            }

            // Clear pending changes
            session.pendingChanges = undefined;
            
            // Update UI
            this.sendChangesToWebview(sessionId, { modified: [], added: [], deleted: [] });
            
            vscode.window.showInformationMessage('All changes accepted');
        } catch (error) {
            this._outputChannel.appendLine(`Failed to accept changes: ${error}`);
            vscode.window.showErrorMessage(`Failed to accept changes: ${error}`);
        }
    }

    private async rejectAllChanges(sessionId: string) {
        const session = this._chatSessions.get(sessionId);
        if (!session?.pendingChanges) return;

        // Simply clear the pending changes
        session.pendingChanges = undefined;
        
        // Update UI
        this.sendChangesToWebview(sessionId, { modified: [], added: [], deleted: [] });
        
        vscode.window.showInformationMessage('All changes rejected');
    }

    private updateWebview() {
        if (!this._view) {
            return;
        }

        const sessions = Array.from(this._chatSessions.values()).map(s => ({
            id: s.id,
            title: s.title,
            messages: s.messages,
            isStreaming: s.isStreaming,
            isActive: s.claudeSession.isActive(),
            mode: s.mode
        }));

        const currentSession = this._currentSessionId ?
            this._chatSessions.get(this._currentSessionId) : null;

        const messageData = {
            type: 'update',
            sessions,
            currentSessionId: this._currentSessionId,
            currentSession: currentSession ? {
                id: currentSession.id,
                title: currentSession.title,
                messages: currentSession.messages,
                isStreaming: currentSession.isStreaming,
                isActive: currentSession.claudeSession.isActive(),
                mode: currentSession.mode
            } : null
        };

        this._view.webview.postMessage(messageData);
    }

    public getApi() {
        const getCurrentSessionMessages = () => {
            const session = this._currentSessionId ?
                this._chatSessions.get(this._currentSessionId) : null;

            return session ? [...session.messages] : [];
        };

        const sendMessage = async (message: string) => {
            if (this._currentSessionId) {
                await this.handleUserMessage(message);
            }
        };

        const clearChat = async () => {
            if (this._currentSessionId) {
                const session = this._chatSessions.get(this._currentSessionId);
                if (session) {
                    session.messages = [];
                    this.updateWebview();
                }
            }
        };

        return {
            getCurrentSessionMessages,
            sendMessage,
            clearChat
        };
    }

    public async clearChat() {
        if (this._currentSessionId) {
            const session = this._chatSessions.get(this._currentSessionId);
            if (session) {
                session.messages = [];
                this.updateWebview();
            }
        }
    }

    public updateSelection(selection: string, fileName: string) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'selectionUpdate',
                selection,
                fileName
            });
        }
    }

    public async dispose() {
        // Clean up all sessions
        for (const [sessionId, session] of this._chatSessions) {
            await this.closeSession(sessionId);
        }
        this._chatSessions.clear();
        this._parsers.clear();
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const chatJs = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'));
        const chatCss = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));
        const codiconsCss = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${codiconsCss}" rel="stylesheet">
            <link href="${chatCss}" rel="stylesheet">
            <title>Claude Chat</title>
        </head>
        <body>
            <div class="chat-container">
                <div class="sessions-header">
                    <div class="sessions-accordion" id="sessionsAccordion"></div>
                </div>
                <div class="chat-messages" id="chatMessages"></div>
                <div class="status-indicator" id="statusIndicator" style="display: none;"></div>
                <div class="chat-input-container">
                    <div class="changed-files-container" id="changedFilesContainer" style="display: none;">
                        <div class="changed-files-header">
                            <span class="changed-files-title">
                                <i class="codicon codicon-diff"></i>
                                <span>Changed Files (<span id="changeCount">0</span>)</span>
                            </span>
                            <div class="changed-files-actions">
                                <button class="batch-action-btn" id="acceptAllBtn" title="Accept all changes">
                                    <i class="codicon codicon-check-all"></i>
                                </button>
                                <button class="batch-action-btn" id="rejectAllBtn" title="Reject all changes">
                                    <i class="codicon codicon-close-all"></i>
                                </button>
                            </div>
                        </div>
                        <div class="changed-files-list" id="changedFilesList"></div>
                    </div>
                    <div class="mode-selector" id="modeSelector">
                        <label class="mode-label">
                            <input type="radio" name="mode" value="chat" />
                            <div class="mode-option">
                                <i class="codicon codicon-comment-discussion"></i>
                                <span>Chat Mode</span>
                            </div>
                        </label>
                        <label class="mode-label">
                            <input type="radio" name="mode" value="agent" checked />
                            <div class="mode-option">
                                <i class="codicon codicon-tools"></i>
                                <span>Agent Mode</span>
                            </div>
                        </label>
                    </div>
                    <div class="context-indicator" id="contextIndicator" style="display: none;"></div>
                    <textarea
                        class="chat-input"
                        id="messageInput"
                        placeholder="Type a message..."
                        rows="3"
                    ></textarea>
                    <div class="chat-actions">
                        <button class="send-button" id="sendButton">
                            <span class="button-content">
                                Send
                                <i class="codicon codicon-send"></i>
                            </span>
                        </button>
                        <button class="terminate-button" id="terminateButton" style="display: none;">
                            <span class="button-content">
                                Stop
                                <i class="codicon codicon-stop-circle"></i>
                            </span>
                        </button>
                    </div>
                </div>
            </div>
            <script src="${chatJs}"></script>
        </body>
        </html>`;
    }
}

interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    claudeSession: ClaudeChatService;
    isStreaming: boolean;
    sdkMessages: SDKMessage[];
    mode?: 'chat' | 'agent';
    claudeSessionId?: string; // Track Claude's session ID for continuity
    sandboxPath?: string; // Track sandbox path for agent mode sessions
    pendingChanges?: {
        changeSet: any; // ChangeSet from lovelace-diffs
        timestamp: Date;
        lineStats: Map<string, {additions: number; deletions: number}>;
    };
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    isStreaming?: boolean;
    parsedMessages?: ClaudeMessage[];
}
