import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { IAgentService, IChatTab, IChatMessage, IPhantomChanges, ICodeContext } from '../common/agent.js';
import { IPhantomService } from '../../../../platform/phantom/common/phantom.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ClaudeIntegration } from './claudeIntegration.js';
import { ILogService } from '../../../../platform/log/common/log.js';

export class AgentService extends Disposable implements IAgentService {
	readonly _serviceBrand: undefined;

	private readonly _tabs = new Map<string, IChatTab>();
	private _activeTabId: string | undefined;
	private _garbageCollectionInterval: any;

	private readonly _onDidCreateTab = this._register(new Emitter<IChatTab>());
	readonly onDidCreateTab: Event<IChatTab> = this._onDidCreateTab.event;

	private readonly _onDidCloseTab = this._register(new Emitter<string>());
	readonly onDidCloseTab: Event<string> = this._onDidCloseTab.event;

	private readonly _onDidSwitchTab = this._register(new Emitter<string>());
	readonly onDidSwitchTab: Event<string> = this._onDidSwitchTab.event;

	private readonly _onDidChangeMode = this._register(new Emitter<{ tabId: string; mode: 'agent' | 'chat' }>());
	readonly onDidChangeMode: Event<{ tabId: string; mode: 'agent' | 'chat' }> = this._onDidChangeMode.event;

	private readonly _onDidReceiveMessage = this._register(new Emitter<{ tabId: string; message: IChatMessage }>());
	readonly onDidReceiveMessage: Event<{ tabId: string; message: IChatMessage }> = this._onDidReceiveMessage.event;

	private readonly _onDidChangeStreamingState = this._register(new Emitter<{ tabId: string; isStreaming: boolean }>());
	readonly onDidChangeStreamingState: Event<{ tabId: string; isStreaming: boolean }> = this._onDidChangeStreamingState.event;

	private readonly _claudeIntegration: ClaudeIntegration;
	// private readonly _agentModeHandler: AgentModeHandler;
	// private readonly _chatModeHandler: ChatModeHandler;

	constructor(
		@IPhantomService private readonly phantomService: IPhantomService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@ILogService private readonly logService: ILogService,
		// @IIndexService private readonly indexService: IIndexService,
		// @IAuthService private readonly authService: IAuthService
	) {
		super();

		this._claudeIntegration = this._register(this.instantiationService.createInstance(ClaudeIntegration as any));
		// this._agentModeHandler = this._register(this.instantiationService.createInstance(AgentModeHandler));
		// this._chatModeHandler = this._register(this.instantiationService.createInstance(ChatModeHandler));

		// Set up periodic garbage collection (every 5 minutes)
		this._garbageCollectionInterval = setInterval(() => {
			this.runGarbageCollection();
		}, 5 * 60 * 1000);

		// Clean up interval on dispose
		this._register({
			dispose: () => {
				if (this._garbageCollectionInterval) {
					clearInterval(this._garbageCollectionInterval);
				}
			}
		});
	}

	async createTab(): Promise<IChatTab> {
		const id = generateUuid();
		const phantomId = generateUuid();
		const tabIndex = this._tabs.size + 1;

		// Create phantom instance for this tab
		const workspaceUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (workspaceUri) {
			try {
				await this.phantomService.createPhantom({
					id: phantomId,
					workspaceUri: workspaceUri,
					type: 'workspace',
					purpose: 'agent',
					tabId: id
				});
			} catch (error) {
				this.logService.error('Failed to create phantom for tab:', error);
				// Continue even if phantom creation fails
			}
		} else {
			this.logService.warn('No workspace available for phantom creation');
		}

		const tab: IChatTab = {
			id,
			title: `Chat ${tabIndex}`,
			phantomId,
			mode: 'chat',
			messages: [],
			isActive: false,
			isStreaming: false
		};

		this._tabs.set(id, tab);
		this.logService.info(`Created tab ${id} with phantom ${phantomId}`);
		this._onDidCreateTab.fire(tab);

		// Always switch to the newly created tab
		this.switchTab(id);

		return tab;
	}

	closeTab(tabId: string): void {
		const tab = this._tabs.get(tabId);
		if (!tab) {
			return;
		}

		// Clean up phantom
		this.phantomService.destroyPhantom(tab.phantomId);

		this._tabs.delete(tabId);
		this._onDidCloseTab.fire(tabId);

		// If this was the active tab, switch to another
		if (this._activeTabId === tabId) {
			const remainingTabs = Array.from(this._tabs.values());
			if (remainingTabs.length > 0) {
				this.switchTab(remainingTabs[0].id);
			} else {
				this._activeTabId = undefined;
			}
		}

		// Run garbage collection after tab closure
		this.runGarbageCollection();
	}

	switchTab(tabId: string): void {
		const tab = this._tabs.get(tabId);
		if (!tab) {
			this.logService.warn(`Cannot switch to tab ${tabId} - not found`);
			return;
		}

		// Deactivate current tab
		if (this._activeTabId) {
			const currentTab = this._tabs.get(this._activeTabId);
			if (currentTab) {
				currentTab.isActive = false;
			}
		}

		// Activate new tab
		tab.isActive = true;
		this._activeTabId = tabId;
		this.logService.info(`Switched to tab ${tabId}`);
		this._onDidSwitchTab.fire(tabId);
	}

	getActiveTab(): IChatTab | undefined {
		return this._activeTabId ? this._tabs.get(this._activeTabId) : undefined;
	}

	getTabs(): IChatTab[] {
		return Array.from(this._tabs.values());
	}

	async sendMessage(tabId: string, message: string, files?: URI[]): Promise<void> {
		const tab = this._tabs.get(tabId);
		if (!tab) {
			throw new Error(`Tab ${tabId} not found`);
		}


		// Create user message
		const userMessage: IChatMessage = {
			id: generateUuid(),
			role: 'user',
			content: message,
			timestamp: Date.now(),
			files
		};

		tab.messages.push(userMessage);
		this._onDidReceiveMessage.fire({ tabId, message: userMessage });

		// Set streaming state
		tab.isStreaming = true;
		this._onDidChangeStreamingState.fire({ tabId, isStreaming: true });

		try {
			// Get context
			const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
			const activeEditor = this.editorService.activeEditor;
			const currentFile = activeEditor?.resource;

			// Get phantom working directory with validation and recreation if needed
			let phantom = this.phantomService.getPhantom(tab.phantomId);
			let phantomExists = phantom ? await this.phantomService.validatePhantomExists(tab.phantomId) : false;
			
			if (!phantom || !phantomExists) {
				this.logService.warn(`AgentService: Phantom ${tab.phantomId} ${!phantom ? 'not found' : 'directory missing'}, attempting to recreate`);
				
				// Attempt to recreate the phantom
				const workspaceUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
				if (workspaceUri) {
					// If phantom exists in registry but not on disk, remove it first
					if (phantom && !phantomExists) {
						try {
							await this.phantomService.destroyPhantom(tab.phantomId);
						} catch (error) {
							// Ignore errors during cleanup
							this.logService.warn(`Failed to cleanup phantom ${tab.phantomId}:`, error);
						}
					}
					
					try {
						phantom = await this.phantomService.createPhantom({
							id: tab.phantomId,
							workspaceUri: workspaceUri,
							type: 'workspace',
							purpose: 'agent',
							tabId: tabId
						});
						this.logService.info(`AgentService: Successfully recreated phantom ${tab.phantomId}`);
						
						// Wait a moment for filesystem to settle
						await new Promise(resolve => setTimeout(resolve, 100));
					} catch (error) {
						this.logService.error(`AgentService: Failed to recreate phantom ${tab.phantomId}`, error);
						throw new Error(`Failed to create workspace isolation. Please try again.`);
					}
				} else {
					throw new Error('No workspace available to create phantom directory');
				}
			}
			
			const workingDirectory = phantom?.path.fsPath;
			
			// Ensure we have a valid phantom working directory
			if (!workingDirectory) {
				throw new Error('Failed to get phantom working directory. Cannot proceed without workspace isolation.');
			}

			const context: ICodeContext = {
				files: files || [],
				currentFile,
				workspaceRoot,
				selection: undefined, // TODO: Get from editor
				phantomId: tab.phantomId,
				workingDirectory,
				sessionId: tab.claudeSessionId
			};

			// Use streaming API
			let chunkCount = 0;
			
			const response = await this._claudeIntegration.streamMessage(
				message, 
				context, 
				tab.mode,
				tabId,
				(chunk: string, type?: 'text' | 'tool_use') => {
					// Check if streaming was cancelled
					if (!tab.isStreaming) {
						return; // Don't process chunks after cancellation
					}
					
					// Skip empty chunks
					if (!chunk) {
						return;
					}
					
					chunkCount++;
					
					// Create a new assistant message for each chunk
					const chunkMessage: IChatMessage = {
						id: generateUuid(),
						role: 'assistant',
						content: chunk,
						timestamp: Date.now(),
						isStreaming: false,
						// Mark tool use messages differently for styling
						metadata: type === 'tool_use' ? { type: 'tool_use' } : undefined
					};
					tab.messages.push(chunkMessage);
					
					this._onDidReceiveMessage.fire({ tabId, message: chunkMessage });
				}
			);

			// Clear streaming state when done
			tab.isStreaming = false;
			this._onDidChangeStreamingState.fire({ tabId, isStreaming: false });

			// Store Claude session ID if this is the first message
			if (response.sessionId && !tab.claudeSessionId) {
				tab.claudeSessionId = response.sessionId;
				// Also update the phantom registry with the Claude session ID
				await this.phantomService.updateClaudeSessionId(tab.phantomId, response.sessionId);
			}

			// Apply changes to phantom if present
			if (response.changes) {
				await this._applyChangesToPhantom(tab.phantomId, response.changes);
			}
		} catch (error) {
			// Clear streaming state
			tab.isStreaming = false;
			this._onDidChangeStreamingState.fire({ tabId, isStreaming: false });
			
			// Create an error message
			const errorContent = error instanceof Error ? error.message : String(error);
			const errorMessage: IChatMessage = {
				id: generateUuid(),
				role: 'assistant',
				content: `Error: ${errorContent}`,
				timestamp: Date.now(),
				isStreaming: false
			};
			tab.messages.push(errorMessage);
			this._onDidReceiveMessage.fire({ tabId, message: errorMessage });
		} finally {
			// Ensure tab streaming state is cleared
			if (tab.isStreaming) {
				tab.isStreaming = false;
				this._onDidChangeStreamingState.fire({ tabId, isStreaming: false });
			}

			// Ensure no messages are left in streaming state
			tab.messages.forEach(m => {
				if (m.isStreaming) {
					m.isStreaming = false;
				}
			});
			// Fire update to reset UI
			const lastMessage = tab.messages[tab.messages.length - 1];
			if (lastMessage) {
				this._onDidReceiveMessage.fire({ tabId, message: lastMessage });
			}
		}
	}

	async acceptChanges(tabId: string, messageId: string): Promise<void> {
		const tab = this._tabs.get(tabId);
		if (!tab) {
			return;
		}

		const message = tab.messages.find(m => m.id === messageId);
		if (!message || !message.changes) {
			return;
		}

		// Sync phantom changes to original files
		await this.phantomService.syncToOriginal(tab.phantomId);
		message.accepted = true;
		this._onDidReceiveMessage.fire({ tabId, message });
	}

	async rejectChanges(tabId: string, messageId: string): Promise<void> {
		const tab = this._tabs.get(tabId);
		if (!tab) {
			return;
		}

		const message = tab.messages.find(m => m.id === messageId);
		if (!message || !message.changes) {
			return;
		}

		// Reset phantom to original state - recreate the phantom
		// There's no resetPhantom method, so we destroy and recreate
		await this.phantomService.destroyPhantom(tab.phantomId);
		const newPhantom = await this.phantomService.createPhantom({
			workspaceUri: this.workspaceContextService.getWorkspace().folders[0]?.uri || URI.file(''),
			type: 'workspace',
			purpose: 'agent',
			tabId: tabId
		});
		tab.phantomId = newPhantom.id;
		message.accepted = false;
		this._onDidReceiveMessage.fire({ tabId, message });
	}

	setMode(tabId: string, mode: 'agent' | 'chat'): void {
		const tab = this._tabs.get(tabId);
		if (!tab || tab.mode === mode) {
			return;
		}

		tab.mode = mode;
		this._onDidChangeMode.fire({ tabId, mode });

		// Create workspace-wide phantom for agent mode if needed
		if (mode === 'agent' && tab.messages.length === 0) {
			// Agent mode uses workspace-wide phantom
			this.phantomService.createPhantom({
				id: tab.phantomId,
				workspaceUri: this.workspaceContextService.getWorkspace().folders[0]?.uri || URI.file(''),
				type: 'workspace',
				purpose: 'agent',
				tabId: tabId
			});
		}
	}

	setTabMode(tabId: string, mode: 'agent' | 'chat'): void {
		this.setMode(tabId, mode);
	}

	private async _applyChangesToPhantom(phantomId: string, changes: IPhantomChanges): Promise<void> {
		// Ensure phantom exists
		let phantom = this.phantomService.getPhantom(phantomId);
		if (!phantom) {
			// Find the tab associated with this phantom
			let tabId: string | undefined;
			for (const [id, tab] of this._tabs) {
				if (tab.phantomId === phantomId) {
					tabId = id;
					break;
				}
			}
			
			phantom = await this.phantomService.createPhantom({
				id: phantomId,
				workspaceUri: this.workspaceContextService.getWorkspace().folders[0]?.uri || URI.file(''),
				type: 'workspace',
				purpose: 'agent',
				tabId: tabId
			});
		}

		// Apply each file change
		for (const change of changes.files) {
			await this.phantomService.updatePhantomFile(phantomId, change.uri, change.modifiedContent);
		}
	}

	private async runGarbageCollection(): Promise<void> {
		try {
			const workspaceUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
			if (!workspaceUri) {
				return;
			}

			// Get all active tab IDs
			const activeTabIds = Array.from(this._tabs.keys());
			
			// Run garbage collection
			const deletedCount = await this.phantomService.garbageCollectPhantoms(workspaceUri, activeTabIds);
			
			if (deletedCount > 0) {
				this.logService.info(`AgentService: Garbage collected ${deletedCount} orphaned phantoms`);
			}
		} catch (error) {
			this.logService.error('AgentService: Error during garbage collection', error);
		}
	}

	cancelRequest(tabId: string): void {
		// Cancel any ongoing Claude request for this tab
		this._claudeIntegration.cancelRequest(tabId);
		
		// Find the tab and update any streaming messages
		const tab = this._tabs.get(tabId);
		if (tab) {
			// Clear streaming state
			if (tab.isStreaming) {
				tab.isStreaming = false;
				this._onDidChangeStreamingState.fire({ tabId, isStreaming: false });
			}

			// Mark any streaming messages as complete
			for (const message of tab.messages) {
				if (message.isStreaming) {
					message.isStreaming = false;
				}
			}
			
			// Fire update event to refresh UI
			const lastMessage = tab.messages[tab.messages.length - 1];
			if (lastMessage) {
				this._onDidReceiveMessage.fire({ tabId, message: lastMessage });
			}
		}
	}
}