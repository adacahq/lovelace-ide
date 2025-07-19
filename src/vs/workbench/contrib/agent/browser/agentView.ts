import { IViewDescriptorService } from '../../../../workbench/common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IAgentService } from '../common/agent.js';
import { append, $, clearNode } from '../../../../base/browser/dom.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';

export class AgentView extends ViewPane {
	static readonly ID = 'workbench.view.agent';
	static readonly TITLE = 'Lovelace';

	private container!: HTMLElement;
	private sessionsHeader!: HTMLElement;
	private sessionsAccordion!: HTMLElement;
	private messagesContainer!: HTMLElement;
	private statusIndicator!: HTMLElement;
	private inputContainer!: HTMLElement;
	private changedFilesContainer!: HTMLElement;
	private modeSelector!: HTMLElement;
	private contextIndicator!: HTMLElement;
	private inputField!: HTMLTextAreaElement;
	private actionsContainer!: HTMLElement;
	private sendButton!: HTMLButtonElement;
	private stopButton!: HTMLButtonElement;
	private isStreaming: boolean = false;

	constructor(
		options: IViewletViewOptions,
		@IAgentService private readonly agentService: IAgentService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(this.agentService.onDidCreateTab(() => this.updateView()));
		this._register(this.agentService.onDidCloseTab(() => this.updateView()));
		this._register(this.agentService.onDidSwitchTab(() => this.updateView()));
		this._register(this.agentService.onDidChangeMode(() => this.updateView()));
		this._register(this.agentService.onDidReceiveMessage(() => this.updateView()));
		this._register(this.agentService.onDidChangeStreamingState(({ isStreaming }) => {
			this.updateStreamingUI(isStreaming);
		}));
		
		// Listen to theme changes
		this._register(themeService.onDidColorThemeChange(() => {
			this.updateTheme();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		this.container = append(container, $('.chat-container'));
		
		// Create sessions header
		this.sessionsHeader = append(this.container, $('.sessions-header'));
		this.sessionsAccordion = append(this.sessionsHeader, $('.sessions-accordion'));
		
		// Create messages container
		this.messagesContainer = append(this.container, $('.chat-messages'));
		
		// Create status indicator (hidden by default)
		this.statusIndicator = append(this.container, $('.status-indicator'));
		this.statusIndicator.style.display = 'none';
		
		// Create input container
		this.inputContainer = append(this.container, $('.chat-input-container'));
		
		// Create changed files container (hidden by default)
		this.changedFilesContainer = append(this.inputContainer, $('.changed-files-container'));
		this.changedFilesContainer.style.display = 'none';
		const changedFilesHeader = append(this.changedFilesContainer, $('.changed-files-header'));
		const changedFilesTitle = append(changedFilesHeader, $('span.changed-files-title'));
		append(changedFilesTitle, $('.codicon.codicon-diff'));
		const changeCountSpan = append(changedFilesTitle, $('span'));
		changeCountSpan.textContent = 'Changed Files (0)';
		const changedFilesActions = append(changedFilesHeader, $('.changed-files-actions'));
		const acceptAllBtn = append(changedFilesActions, $('button.batch-action-btn')) as HTMLButtonElement;
		acceptAllBtn.title = 'Accept all changes';
		append(acceptAllBtn, $('.codicon.codicon-check-all'));
		const rejectAllBtn = append(changedFilesActions, $('button.batch-action-btn')) as HTMLButtonElement;
		rejectAllBtn.title = 'Reject all changes';
		append(rejectAllBtn, $('.codicon.codicon-close-all'));
		append(this.changedFilesContainer, $('.changed-files-list'));
		
		// Create mode selector
		this.modeSelector = append(this.inputContainer, $('.mode-selector'));
		this.createModeSelector();
		
		// Create context indicator (hidden by default)
		this.contextIndicator = append(this.inputContainer, $('.context-indicator'));
		this.contextIndicator.style.display = 'none';
		
		// Create input field
		this.inputField = append(this.inputContainer, $('textarea.chat-input')) as HTMLTextAreaElement;
		this.inputField.placeholder = 'Type a message...';
		this.inputField.rows = 3;
		this.inputField.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});
		
		// Create actions container
		this.actionsContainer = append(this.inputContainer, $('.chat-actions'));
		
		// Create send button
		this.sendButton = append(this.actionsContainer, $('button.send-button')) as HTMLButtonElement;
		const sendButtonContent = append(this.sendButton, $('span.button-content'));
		append(sendButtonContent, $('span')).textContent = 'Send';
		append(sendButtonContent, $('.codicon.codicon-send'));
		this.sendButton.onclick = () => this.sendMessage();
		
		// Create stop button (hidden by default)
		this.stopButton = append(this.actionsContainer, $('button.terminate-button')) as HTMLButtonElement;
		this.stopButton.style.display = 'none';
		const stopButtonContent = append(this.stopButton, $('span.button-content'));
		append(stopButtonContent, $('span')).textContent = 'Stop';
		append(stopButtonContent, $('.codicon.codicon-stop-circle'));
		this.stopButton.onclick = () => this.stopGeneration();
		
		// Initial update
		this.updateView();
		
		// Create initial tab if none exist
		const tabs = this.agentService.getTabs();
		if (tabs.length === 0) {
			this.agentService.createTab().then(() => {
				// Update view after tab is created
				this.updateView();
			}).catch(error => {
				console.error('Failed to create initial tab:', error);
			});
		}
	}

	private createModeSelector(): void {
		// Chat mode
		const chatLabel = append(this.modeSelector, $('label.mode-label'));
		const chatRadio = append(chatLabel, $('input')) as HTMLInputElement;
		chatRadio.type = 'radio';
		chatRadio.name = 'mode';
		chatRadio.value = 'chat';
		
		const chatOption = append(chatLabel, $('.mode-option'));
		append(chatOption, $('.codicon.codicon-comment-discussion'));
		append(chatOption, $('span')).textContent = 'Chat Mode';
		
		// Agent mode
		const agentLabel = append(this.modeSelector, $('label.mode-label'));
		const agentRadio = append(agentLabel, $('input')) as HTMLInputElement;
		agentRadio.type = 'radio';
		agentRadio.name = 'mode';
		agentRadio.value = 'agent';
		agentRadio.checked = true;
		
		const agentOption = append(agentLabel, $('.mode-option'));
		append(agentOption, $('.codicon.codicon-tools'));
		append(agentOption, $('span')).textContent = 'Agent Mode';
	}
	
	private sendMessage(): void {
		const message = this.inputField.value.trim();
		if (!message || this.isStreaming) {
			return;
		}
		
		const activeTab = this.agentService.getActiveTab();
		if (!activeTab) {
			console.error('No active tab found');
			return;
		}
		
		// Get selected mode
		const modeRadio = this.modeSelector.querySelector('input[name="mode"]:checked') as HTMLInputElement;
		const mode = modeRadio ? modeRadio.value : 'agent';
		
		// If this is the first message, lock the mode
		if (activeTab.messages.length === 0) {
			this.agentService.setTabMode(activeTab.id, mode as 'chat' | 'agent');
			// Disable mode selector
			this.modeSelector.querySelectorAll('input').forEach(input => {
				(input as HTMLInputElement).disabled = true;
			});
		}
		
		// Clear input and send message
		this.inputField.value = '';
		
		// Send message (UI update will happen via updateView when messages arrive)
		this.agentService.sendMessage(activeTab.id, message).catch(error => {
			console.error('Failed to send message:', error);
			// Only reset UI on error
			this.updateStreamingUI(false);
		});
		
		this.inputField.focus();
	}
	
	private stopGeneration(): void {
		const activeTab = this.agentService.getActiveTab();
		if (activeTab) {
			// Cancel the request through the agent service
			this.agentService.cancelRequest(activeTab.id);
		}
		
		// Reset UI state
		this.updateStreamingUI(false);
	}

	private updateStreamingUI(isStreaming: boolean): void {
		this.isStreaming = isStreaming;
		this.inputField.disabled = isStreaming;
		this.sendButton.style.display = isStreaming ? 'none' : 'block';
		this.stopButton.style.display = isStreaming ? 'block' : 'none';
	}

	protected override layoutBody(height: number, width: number): void {
		if (this.container) {
			this.container.style.height = `${height}px`;
			this.container.style.width = `${width}px`;
		}
	}

	private updateView(): void {
		if (!this.sessionsAccordion || !this.messagesContainer) return;
		
		const activeTab = this.agentService.getActiveTab();
		
		// Update sessions tabs
		this.updateSessionsTabs();
		
		// Update messages
		if (!activeTab) return;
		
		// Use tab's streaming state instead of checking messages
		this.updateStreamingUI(activeTab.isStreaming || false);
		
		// Clear and render messages
		clearNode(this.messagesContainer);
		
		// Show loading state if phantom is being created
		if (activeTab.isPhantomLoading) {
			const loadingDiv = append(this.messagesContainer, $('.phantom-loading'));
			const loadingContent = append(loadingDiv, $('.loading-content'));
			append(loadingContent, $('.codicon.codicon-loading.codicon-modifier-spin'));
			append(loadingContent, $('span')).textContent = 'Creating phantom replica...';
			return;
		}
		
		// Render messages
		activeTab.messages.forEach((message: any) => {
			const messageDiv = append(this.messagesContainer, $(`.message.${message.role}`));
			
			// Message header
			const headerDiv = append(messageDiv, $('.message-header'));
			const roleSpan = append(headerDiv, $('span.message-role'));
			roleSpan.textContent = message.role === 'user' ? 'You' : 'Claude';
			
			if (message.timestamp) {
				const timeSpan = append(headerDiv, $('span.message-time'));
				timeSpan.textContent = new Date(message.timestamp).toLocaleTimeString();
			}
			
			// Message content
			const contentDiv = append(messageDiv, $('.message-content'));
			
			// Clean phantom path from content if it's an assistant message
			let content = message.content || '';
			if (message.role === 'assistant' && activeTab && content) {
				// Get the phantom path pattern to remove
				const phantomPath = activeTab.phantomId ? `.lovelace/phantoms/${activeTab.phantomId}` : '';
				if (phantomPath && content.includes(phantomPath)) {
					// Replace full phantom paths with relative paths
					const phantomRegex = new RegExp(`[^\\s]*\\.lovelace/phantoms/[^/]+/`, 'g');
					content = content.replace(phantomRegex, '');
				}
			}
			
			// Render markdown for assistant messages
			if (message.role === 'assistant' && content) {
				const markdownString = new MarkdownString(content);
				markdownString.isTrusted = true; // Trust the content
				const rendered = renderMarkdown(markdownString, {
					actionHandler: {
						callback: (content) => {
							// Handle link clicks
							window.open(content);
						},
						disposables: this._store
					}
				});
				contentDiv.appendChild(rendered.element);
				this._register({ dispose: () => rendered.dispose() });
			} else {
				// Plain text for user messages
				contentDiv.textContent = content;
			}
		});
		
		// Update mode selector state
		if (activeTab.messages.length > 0) {
			this.modeSelector.querySelectorAll('input').forEach(input => {
				(input as HTMLInputElement).disabled = true;
			});
		} else {
			this.modeSelector.querySelectorAll('input').forEach(input => {
				(input as HTMLInputElement).disabled = false;
			});
		}
		
		
		// Scroll to bottom
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}
	
	private updateSessionsTabs(): void {
		clearNode(this.sessionsAccordion);
		
		const tabs = this.agentService.getTabs();
		const activeTab = this.agentService.getActiveTab();
		
		// Render tabs
		tabs.forEach((tab, index) => {
			const tabDiv = append(this.sessionsAccordion, $('.session-tab'));
			if (tab === activeTab) {
				tabDiv.classList.add('active');
			}
			
			// Tab title
			const titleSpan = append(tabDiv, $('span'));
			titleSpan.textContent = tab.title || `Chat ${index + 1}`;
			
			// Close button
			const closeSpan = append(tabDiv, $('span.session-close.codicon.codicon-close'));
			closeSpan.onclick = async (e) => {
				e.stopPropagation();
				await this.agentService.closeTab(tab.id);
			};
			
			// Click to switch
			tabDiv.onclick = () => {
				this.agentService.switchTab(tab.id);
			};
		});
		
		// New session button
		const newSessionBtn = append(this.sessionsAccordion, $('.new-session-btn'));
		append(newSessionBtn, $('.codicon.codicon-add'));
		newSessionBtn.onclick = () => {
			this.agentService.createTab().then(() => {
				// Update view after tab is created
				this.updateView();
			}).catch(error => {
				console.error('Failed to create new tab:', error);
			});
		};
	}

	
	private updateTheme(): void {
		// Theme is handled by CSS variables
	}
}