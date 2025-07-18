import { Disposable } from '../../../../base/common/lifecycle.js';
import { IAgentService, IChatTab, IChatMessage } from '../common/agent.js';
import { IThemeService, IColorTheme } from '../../../../platform/theme/common/themeService.js';
import { IWebviewService, IWebviewElement } from '../../webview/browser/webview.js';
import { URI } from '../../../../base/common/uri.js';
import { FileAccess } from '../../../../base/common/network.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IFileService } from '../../../../platform/files/common/files.js';

export class ChatPanel extends Disposable {
	private webview: IWebviewElement | undefined;
	private container: HTMLElement | undefined;
	private pendingChanges: Map<string, IFileChanges> = new Map();

	constructor(
		private readonly tab: IChatTab,
		@IAgentService private readonly agentService: IAgentService,
		@IThemeService private readonly themeService: IThemeService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IEditorService private readonly editorService: IEditorService,
		@IFileService private readonly fileService: IFileService
	) {
		super();

		// Listen to messages
		this._register(this.agentService.onDidReceiveMessage((event: any) => {
			if (event.tabId === this.tab.id && this.webview) {
				this.updateMessage(event.message);
			}
		}));

		// Listen to mode changes
		this._register(this.agentService.onDidChangeMode((event: any) => {
			if (event.tabId === this.tab.id && this.webview) {
				this.webview.postMessage({ type: 'modeChanged', mode: event.mode });
			}
		}));

		// Listen to theme changes
		this._register(this.themeService.onDidColorThemeChange((theme: any) => {
			if (this.webview) {
				this.updateTheme(theme);
			}
		}));
	}

	show(container: HTMLElement): void {
		this.container = container;

		if (!this.webview) {
			this.createWebview();
		}

		if (this.webview && this.container) {
			this.webview.mountTo(this.container, mainWindow);
		}
	}

	hide(): void {
		// Webview will be unmounted automatically when container is hidden
	}

	layout(width: number, height: number): void {
		// Webview handles its own layout when mounted to container
	}

	private createWebview(): void {
		this.webview = this.webviewService.createWebviewElement({
			title: 'Agent Chat',
			options: {},
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [
					FileAccess.asFileUri('')
				],
				enableCommandUris: true
			},
			extension: undefined
		});

		this.webview.setHtml(this.getHtmlContent());

		// Handle messages from webview
		this._register(this.webview.onMessage((message: any) => {
			this.handleWebviewMessage(message);
		}));

		// Initialize with existing messages
		this.updateWebview();

		// Set initial mode
		this.webview.postMessage({ type: 'modeChanged', mode: this.tab.mode });

		// Set initial theme
		this.updateTheme(this.themeService.getColorTheme());
	}

	private handleWebviewMessage(message: any): void {
		switch (message.type) {
			case 'sendMessage':
				this.agentService.sendMessage(this.tab.id, message.text, message.files);
				break;

			case 'changeMode':
				this.agentService.setMode(this.tab.id, message.mode);
				break;

			case 'attachFiles':
				this.attachFiles();
				break;

			case 'terminate':
				// TODO: Implement terminate functionality
				break;

			case 'openDiff':
				this.openFileWithDiff(message.filePath);
				break;

			case 'acceptAll':
				this.acceptAllChanges();
				break;

			case 'rejectAll':
				this.rejectAllChanges();
				break;
		}
	}

	private async attachFiles(): Promise<void> {
		const files = await this.fileDialogService.showOpenDialog({
			canSelectFiles: true,
			canSelectMany: true,
			openLabel: 'Attach'
		});

		if (files && this.webview) {
			this.webview.postMessage({
				type: 'filesAttached',
				files: files.map((uri: any) => ({ uri: uri.toString(), name: uri.path.split('/').pop() }))
			});
		}
	}

	private async openFileWithDiff(filePath: string): Promise<void> {
		const message = this.tab.messages.find((m: any) => m.changes?.files.some((f: any) => f.uri.path === filePath));
		if (!message || !message.changes) {
			return;
		}

		const fileChange = message.changes.files.find((f: any) => f.uri.path === filePath);
		if (!fileChange) {
			return;
		}

		// Open diff editor
		await this.editorService.openEditor({
			original: { resource: fileChange.uri },
			modified: { resource: URI.parse(`phantom:${this.tab.phantomId}/${fileChange.uri.path}`) },
			options: { pinned: true }
		});
	}

	private async acceptAllChanges(): Promise<void> {
		const changesMessage = this.tab.messages.find((m: any) => m.changes && !m.accepted);
		if (!changesMessage || !changesMessage.changes) {
			return;
		}

		await this.agentService.acceptChanges(this.tab.id, changesMessage.id);
		
		// Clear pending changes
		this.pendingChanges.delete(this.tab.id);
		
		// Update UI
		this.updateWebview();
	}

	private async rejectAllChanges(): Promise<void> {
		const changesMessage = this.tab.messages.find((m: any) => m.changes && !m.accepted);
		if (!changesMessage || !changesMessage.changes) {
			return;
		}

		await this.agentService.rejectChanges(this.tab.id, changesMessage.id);
		
		// Clear pending changes
		this.pendingChanges.delete(this.tab.id);
		
		// Update UI
		this.updateWebview();
	}

	private updateMessage(message: IChatMessage): void {
		if (this.webview) {
			// If message has changes, calculate line stats
			if (message.changes && !message.accepted) {
				this.calculateAndStoreChanges(message);
			}
			
			this.updateWebview();
		}
	}

	private async calculateAndStoreChanges(message: IChatMessage): Promise<void> {
		if (!message.changes) return;

		const fileChanges: IFileChanges = {
			modified: [],
			added: [],
			deleted: []
		};

		for (const change of message.changes.files) {
			try {
				// Check if file exists
				const exists = await this.fileService.exists(change.uri);
				
				if (!exists) {
					// File is being added
					const lines = change.modifiedContent.split('\n').length;
					fileChanges.added.push({
						path: change.uri.path,
						lines
					});
				} else if (change.modifiedContent === '') {
					// File is being deleted
					fileChanges.deleted.push({
						path: change.uri.path
					});
				} else {
					// File is being modified - calculate diff stats
					const additions = this.countAdditions(change.originalContent, change.modifiedContent);
					const deletions = this.countDeletions(change.originalContent, change.modifiedContent);
					
					fileChanges.modified.push({
						path: change.uri.path,
						additions,
						deletions
					});
				}
			} catch (error) {
				console.error(`Failed to calculate changes for ${change.uri.path}:`, error);
			}
		}

		this.pendingChanges.set(this.tab.id, fileChanges);
	}

	private countAdditions(original: string, modified: string): number {
		// Simple line count difference for now
		const originalLines = original.split('\n');
		const modifiedLines = modified.split('\n');
		return Math.max(0, modifiedLines.length - originalLines.length);
	}

	private countDeletions(original: string, modified: string): number {
		// Simple line count difference for now
		const originalLines = original.split('\n');
		const modifiedLines = modified.split('\n');
		return Math.max(0, originalLines.length - modifiedLines.length);
	}

	private updateWebview(): void {
		if (!this.webview) return;

		const messages = this.tab.messages.map((msg: any) => ({
			id: msg.id,
			role: msg.role,
			content: msg.content,
			timestamp: msg.timestamp,
			isStreaming: msg.isStreaming,
			parsedMessages: this.parseMessage(msg)
		}));

		const pendingChanges = this.pendingChanges.get(this.tab.id);

		this.webview.postMessage({
			type: 'update',
			messages,
			isStreaming: messages.some((m: any) => m.isStreaming),
			mode: this.tab.mode,
			changes: pendingChanges
		});
	}

	private parseMessage(message: IChatMessage): IParsedMessage[] {
		if (message.role !== 'assistant') {
			return [];
		}

		const parsed: IParsedMessage[] = [];
		const lines = message.content.split('\n');
		let currentText = '';
		let inCodeBlock = false;
		let codeBlockLang = '';
		let codeBlockContent = '';

		for (const line of lines) {
			// Tool action (starts with ⏺)
			if (line.startsWith('⏺ ')) {
				if (currentText) {
					parsed.push({ type: 'text', content: currentText });
					currentText = '';
				}
				parsed.push({ type: 'tool_action', content: line.substring(2) });
				continue;
			}

			// Tool output (starts with ⎿)
			if (line.trim().startsWith('⎿ ')) {
				if (currentText) {
					parsed.push({ type: 'text', content: currentText });
					currentText = '';
				}
				// Add to the last tool action if available
				const lastParsed = parsed[parsed.length - 1];
				if (lastParsed && lastParsed.type === 'tool_action') {
					if (!lastParsed.output) lastParsed.output = [];
					lastParsed.output.push(line.trim().substring(2));
				}
				continue;
			}

			// Code block start
			if (line.startsWith('```')) {
				if (inCodeBlock) {
					// End of code block
					parsed.push({
						type: 'code_block',
						language: codeBlockLang,
						content: codeBlockContent
					});
					inCodeBlock = false;
					codeBlockLang = '';
					codeBlockContent = '';
				} else {
					// Start of code block
					if (currentText) {
						parsed.push({ type: 'text', content: currentText });
						currentText = '';
					}
					inCodeBlock = true;
					codeBlockLang = line.substring(3).trim();
				}
				continue;
			}

			// Inside code block
			if (inCodeBlock) {
				codeBlockContent += (codeBlockContent ? '\n' : '') + line;
				continue;
			}

			// Status line (wrapped in asterisks)
			if (line.startsWith('*') && line.endsWith('*') && line.length > 2) {
				if (currentText) {
					parsed.push({ type: 'text', content: currentText });
					currentText = '';
				}
				parsed.push({ type: 'status', content: line.substring(1, line.length - 1) });
				continue;
			}

			// Regular text
			currentText += (currentText ? '\n' : '') + line;
		}

		// Add any remaining text
		if (currentText) {
			parsed.push({ type: 'text', content: currentText });
		}

		return parsed;
	}

	private updateTheme(theme: IColorTheme): void {
		if (this.webview) {
			const colors = {
				background: theme.getColor('editor.background')?.toString() || '#1e1e1e',
				foreground: theme.getColor('editor.foreground')?.toString() || '#cccccc',
				inputBackground: theme.getColor('input.background')?.toString() || '#3c3c3c',
				inputForeground: theme.getColor('input.foreground')?.toString() || '#cccccc',
				buttonBackground: theme.getColor('button.background')?.toString() || '#0e639c',
				buttonForeground: theme.getColor('button.foreground')?.toString() || '#ffffff',
				buttonSecondaryBackground: theme.getColor('button.secondaryBackground')?.toString() || '#3a3d41',
				buttonSecondaryForeground: theme.getColor('button.secondaryForeground')?.toString() || '#cccccc',
				panelBorder: theme.getColor('panel.border')?.toString() || '#454545',
				badgeBackground: theme.getColor('badge.background')?.toString() || '#4d4d4d',
				badgeForeground: theme.getColor('badge.foreground')?.toString() || '#ffffff',
				listHoverBackground: theme.getColor('list.hoverBackground')?.toString() || '#2a2d2e',
				editorInactiveSelectionBackground: theme.getColor('editor.inactiveSelectionBackground')?.toString() || '#3a3d41',
				descriptionForeground: theme.getColor('descriptionForeground')?.toString() || '#969696',
				focusBorder: theme.getColor('focusBorder')?.toString() || '#007acc',
				errorBackground: theme.getColor('inputValidation.errorBackground')?.toString() || '#5a1d1d',
				errorBorder: theme.getColor('inputValidation.errorBorder')?.toString() || '#be1100',
				errorForeground: theme.getColor('errorForeground')?.toString() || '#f48771',
				textLinkForeground: theme.getColor('textLink.foreground')?.toString() || '#3794ff',
				textCodeBlockBackground: theme.getColor('textCodeBlock.background')?.toString() || '#202020',
				gitDecorationModifiedResourceForeground: theme.getColor('gitDecoration.modifiedResourceForeground')?.toString() || '#73c991',
				gitDecorationAddedResourceForeground: theme.getColor('gitDecoration.addedResourceForeground')?.toString() || '#81b366',
				gitDecorationDeletedResourceForeground: theme.getColor('gitDecoration.deletedResourceForeground')?.toString() || '#c74e39',
				sideBarBackground: theme.getColor('sideBar.background')?.toString() || '#252526'
			};
			this.webview.postMessage({ type: 'themeChanged', colors });
		}
	}

	private getHtmlContent(): string {
		const nonce = generateUuid();
		const mediaUri = FileAccess.asBrowserUri('vs/workbench/contrib/agent/browser/media/').toString();

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'nonce-${nonce}';">
			<link href="${mediaUri}/codicon.css" rel="stylesheet">
			<link href="${mediaUri}/agent.css" rel="stylesheet">
			<title>Lovelace Agent</title>
		</head>
		<body>
			<div class="chat-container">
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
							<input type="radio" name="mode" value="chat" ${this.tab.mode === 'chat' ? 'checked' : ''} />
							<div class="mode-option">
								<i class="codicon codicon-comment-discussion"></i>
								<span>Chat Mode</span>
							</div>
						</label>
						<label class="mode-label">
							<input type="radio" name="mode" value="agent" ${this.tab.mode === 'agent' ? 'checked' : ''} />
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

			<script nonce="${nonce}">
				const vscode = acquireVsCodeApi();
				let isStreaming = false;
				let currentMode = '${this.tab.mode}';
				let hasFirstMessage = ${this.tab.messages.length > 0};

				// Element references
				const messagesContainer = document.getElementById('chatMessages');
				const messageInput = document.getElementById('messageInput');
				const sendButton = document.getElementById('sendButton');
				const terminateButton = document.getElementById('terminateButton');
				const statusIndicator = document.getElementById('statusIndicator');
				const modeSelector = document.getElementById('modeSelector');
				const changedFilesContainer = document.getElementById('changedFilesContainer');
				const changedFilesList = document.getElementById('changedFilesList');
				const changeCount = document.getElementById('changeCount');
				const acceptAllBtn = document.getElementById('acceptAllBtn');
				const rejectAllBtn = document.getElementById('rejectAllBtn');
				const contextIndicator = document.getElementById('contextIndicator');

				// Event listeners
				sendButton.addEventListener('click', sendMessage);
				messageInput.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						sendMessage();
					}
				});

				terminateButton.addEventListener('click', () => {
					vscode.postMessage({ type: 'terminate' });
				});

				acceptAllBtn?.addEventListener('click', () => {
					vscode.postMessage({ type: 'acceptAll' });
				});

				rejectAllBtn?.addEventListener('click', () => {
					vscode.postMessage({ type: 'rejectAll' });
				});

				// Mode selector
				document.querySelectorAll('input[name="mode"]').forEach(radio => {
					radio.addEventListener('change', (e) => {
						if (!hasFirstMessage) {
							currentMode = e.target.value;
							vscode.postMessage({ type: 'changeMode', mode: currentMode });
						}
					});
				});

				function sendMessage() {
					const message = messageInput.value.trim();
					if (!message || isStreaming) return;

					vscode.postMessage({
						type: 'sendMessage',
						text: message,
						mode: currentMode
					});

					messageInput.value = '';
					messageInput.focus();
					hasFirstMessage = true;
					
					// Disable mode selector after first message
					document.querySelectorAll('input[name="mode"]').forEach(radio => {
						radio.disabled = true;
					});
				}

				function renderMessages(messages) {
					messagesContainer.innerHTML = '';

					messages.forEach((msg, index) => {
						if (msg.role === 'assistant' && msg.parsedMessages && msg.parsedMessages.length > 0) {
							// Render parsed assistant messages
							msg.parsedMessages.forEach((parsedMsg, parsedIndex) => {
								const messageDiv = document.createElement('div');
								messageDiv.className = 'message assistant-part' + (msg.isStreaming ? ' streaming' : '');

								const headerDiv = document.createElement('div');
								headerDiv.className = 'message-header';

								// Only show header for first parsed message
								if (parsedIndex === 0) {
									headerDiv.innerHTML = \`
										<i class="codicon codicon-hubot"></i>
										<span>Claude</span>
										<span>\${formatTime(msg.timestamp)}</span>
									\`;
								} else {
									headerDiv.style.display = 'none';
								}

								const contentDiv = document.createElement('div');
								contentDiv.className = 'message-content';
								contentDiv.innerHTML = formatParsedMessage(parsedMsg);

								messageDiv.appendChild(headerDiv);
								messageDiv.appendChild(contentDiv);
								messagesContainer.appendChild(messageDiv);
							});
						} else {
							// Regular message rendering
							const messageDiv = document.createElement('div');
							messageDiv.className = 'message ' + msg.role + (msg.isStreaming ? ' streaming' : '');

							const headerDiv = document.createElement('div');
							headerDiv.className = 'message-header';

							const icon = msg.role === 'user' ? 'account' : 'hubot';
							const name = msg.role === 'user' ? 'You' : 'Claude';

							headerDiv.innerHTML = \`
								<i class="codicon codicon-\${icon}"></i>
								<span>\${name}</span>
								<span>\${formatTime(msg.timestamp)}</span>
							\`;

							const contentDiv = document.createElement('div');
							contentDiv.className = 'message-content';
							contentDiv.innerHTML = formatMessage(msg.content || '', msg.role === 'assistant');

							messageDiv.appendChild(headerDiv);
							messageDiv.appendChild(contentDiv);
							messagesContainer.appendChild(messageDiv);
						}
					});

					messagesContainer.scrollTop = messagesContainer.scrollHeight;
				}

				function formatParsedMessage(parsedMsg) {
					switch (parsedMsg.type) {
						case 'text':
							return formatMessage(parsedMsg.content, true);

						case 'tool_action':
							let toolHtml = '<div class="claude-action">⏺ ' + escapeHtml(parsedMsg.content) + '</div>';
							if (parsedMsg.output && parsedMsg.output.length > 0) {
								toolHtml += '<div class="tool-output-container">';
								parsedMsg.output.forEach(output => {
									toolHtml += '<div class="tool-output">⎿ ' + escapeHtml(output) + '</div>';
								});
								toolHtml += '</div>';
							}
							return toolHtml;

						case 'code_block':
							const lang = parsedMsg.language || 'plaintext';
							if (lang === 'diff') {
								// Special handling for diff blocks
								const lines = parsedMsg.content.split('\\n').map(line => {
									if (line.startsWith('+')) {
										return '<span class="diff-add">' + escapeHtml(line) + '</span>';
									} else if (line.startsWith('-')) {
										return '<span class="diff-remove">' + escapeHtml(line) + '</span>';
									} else {
										return escapeHtml(line);
									}
								});
								return '<pre><code class="language-diff">' + lines.join('\\n') + '</code></pre>';
							}
							return '<pre><code class="language-' + lang + '">' + escapeHtml(parsedMsg.content) + '</code></pre>';

						case 'status':
							return '<div class="status-line"><em>' + escapeHtml(parsedMsg.content) + '</em></div>';

						default:
							return formatMessage(parsedMsg.content || '', true);
					}
				}

				function formatMessage(content, isAssistant = false) {
					if (!isAssistant) {
						// User messages - simple HTML escaping and formatting
						content = escapeHtml(content);
						content = content.replace(/\\n/g, '<br>');
						return content;
					}

					// Assistant messages - advanced formatting
					let processed = content;

					// Format bold text
					processed = processed.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

					// Format italic text
					processed = processed.replace(/(?<!^)\\*([^*\\n]+)\\*(?!$)/gm, '<em>$1</em>');

					// Escape HTML
					processed = escapeHtmlButPreserveTags(processed, ['strong', 'em']);

					// Format code blocks
					processed = processed.replace(/\`\`\`(\\w+)?\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
						const trimmedCode = code.trim();
						return '<pre><code class="language-' + (lang || 'plaintext') + '">' + escapeHtml(trimmedCode) + '</code></pre>';
					});

					// Format inline code
					processed = processed.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

					// Convert newlines to breaks
					processed = processed.replace(/\\n/g, '<br>');

					return processed;
				}

				function escapeHtml(text) {
					const div = document.createElement('div');
					div.textContent = text;
					return div.innerHTML;
				}

				function escapeHtmlButPreserveTags(text, allowedTags) {
					// Simple implementation - in production would need more robust handling
					return text;
				}

				function formatTime(timestamp) {
					const date = new Date(timestamp);
					return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
				}

				function updateChangedFiles(changes) {
					if (!changes || (changes.modified.length === 0 && changes.added.length === 0 && changes.deleted.length === 0)) {
						changedFilesContainer.style.display = 'none';
						return;
					}

					changedFilesContainer.style.display = 'block';
					const totalCount = changes.modified.length + changes.added.length + changes.deleted.length;
					changeCount.textContent = totalCount;

					changedFilesList.innerHTML = '';

					// Modified files
					changes.modified.forEach(file => {
						const item = createFileItem(file.path, 'modified', file.additions, file.deletions);
						changedFilesList.appendChild(item);
					});

					// Added files
					changes.added.forEach(file => {
						const item = createFileItem(file.path, 'added', file.lines, 0);
						changedFilesList.appendChild(item);
					});

					// Deleted files
					changes.deleted.forEach(file => {
						const item = createFileItem(file.path, 'deleted', 0, 0);
						changedFilesList.appendChild(item);
					});
				}

				function createFileItem(path, type, additions, deletions) {
					const item = document.createElement('div');
					item.className = 'changed-file-item';
					item.onclick = () => vscode.postMessage({ type: 'openDiff', filePath: path });

					const icon = type === 'modified' ? 'diff-modified' :
							type === 'added' ? 'diff-added' :
							'diff-removed';

					let stats = '';
					if (type === 'modified') {
						stats = \`<span class="stat-addition">+\${additions}</span> <span class="stat-deletion">-\${deletions}</span>\`;
					} else if (type === 'added') {
						stats = \`<span class="stat-addition">+\${additions}</span>\`;
					}

					item.innerHTML = \`
						<div class="file-info">
							<i class="codicon codicon-\${icon} file-icon \${type}"></i>
							<span class="file-path">\${path}</span>
						</div>
						<div class="file-stats">\${stats}</div>
					\`;

					return item;
				}

				function updateStreamingState(streaming) {
					isStreaming = streaming;
					sendButton.style.display = streaming ? 'none' : 'block';
					terminateButton.style.display = streaming ? 'block' : 'none';
					messageInput.disabled = streaming;
				}

				// Handle messages from extension
				window.addEventListener('message', event => {
					const message = event.data;
					switch (message.type) {
						case 'update':
							renderMessages(message.messages);
							updateStreamingState(message.isStreaming);
							updateChangedFiles(message.changes);
							break;

						case 'modeChanged':
							currentMode = message.mode;
							document.querySelector(\`input[name="mode"][value="\${message.mode}"]\`).checked = true;
							break;

						case 'themeChanged':
							updateTheme(message.colors);
							break;

						case 'filesAttached':
							// TODO: Handle file attachments
							break;

						case 'clearStatus':
							statusIndicator.style.display = 'none';
							break;
					}
				});

				function updateTheme(colors) {
					const root = document.documentElement;
					Object.entries(colors).forEach(([key, value]) => {
						root.style.setProperty('--' + key, value);
					});
				}
			</script>
		</body>
		</html>`;
	}
}

interface IParsedMessage {
	type: 'text' | 'tool_action' | 'code_block' | 'status' | 'file_operation';
	content: string;
	language?: string;
	output?: string[];
	fileOperation?: {
		type: string;
		filename: string;
		diff?: any[];
		content?: string;
	};
}

interface IFileChanges {
	modified: Array<{ path: string; additions: number; deletions: number }>;
	added: Array<{ path: string; lines: number }>;
	deleted: Array<{ path: string }>;
}