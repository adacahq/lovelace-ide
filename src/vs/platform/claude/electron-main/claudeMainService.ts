import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { Emitter } from '../../../base/common/event.js';
import { IChatChunk } from '../common/claude.js';

interface IClaudeSDKModule {
	query: (options: any) => AsyncIterable<any>;
	AbortError?: any;
}

export interface IClaudeMainService {
	readonly _serviceBrand: undefined;
	initialize(): Promise<void>;
}

export class ClaudeMainService extends Disposable implements IClaudeMainService {
	readonly _serviceBrand: undefined;

	private sdkModule: IClaudeSDKModule | undefined;
	private tabSessions = new Map<string, { abortController: AbortController; sessionId?: string }>();
	private initialized = false;

	// Event emitters for streaming
	private readonly _onStreamChunk = this._register(new Emitter<{ tabId: string; chunk: IChatChunk }>());
	private readonly _onStreamEnd = this._register(new Emitter<{ tabId: string; error?: string }>());

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEnvironmentMainService _environmentService: IEnvironmentMainService
	) {
		super();
		// Remove registerHandlers() - we'll use channels instead
	}

	// Expose events for the channel
	onStreamChunk(listener: (data: { tabId: string; chunk: IChatChunk }) => void, thisArg?: any): void {
		this._onStreamChunk.event(listener, thisArg);
	}

	onStreamEnd(listener: (data: { tabId: string; error?: string }) => void, thisArg?: any): void {
		this._onStreamEnd.event(listener, thisArg);
	}

	// Public methods for the channel

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		try {
			this.logService.info('ClaudeMainService: Initializing Claude SDK in main process');

			// Import the Claude Code SDK
			const module = await import('@anthropic-ai/claude-code');
			this.sdkModule = module as IClaudeSDKModule;

			if (!this.sdkModule || typeof this.sdkModule.query !== 'function') {
				throw new Error('Claude Code SDK loaded but query function not found');
			}

			this.logService.info('ClaudeMainService: Claude SDK loaded successfully');
			this.initialized = true;
		} catch (error) {
			this.logService.error('ClaudeMainService: Failed to initialize Claude SDK', error);
			throw error;
		}
	}

	async isAvailable(): Promise<boolean> {
		return this.initialized && !!process.env.ANTHROPIC_API_KEY;
	}


	async startStreamingSession(request: any): Promise<any> {
		if (!this.initialized || !this.sdkModule) {
			throw new Error('Claude SDK not initialized');
		}

		// Validate working directory is provided and is a phantom directory
		if (!request.workingDirectory) {
			throw new Error('No working directory provided. Cannot proceed without phantom directory.');
		}

		// Validate that the working directory appears to be a phantom path
		// Phantom directories are typically under ~/.lovelace/phantoms/
		if (!request.workingDirectory.includes('.lovelace/phantoms/')) {
			throw new Error('Invalid working directory. Must be a phantom directory.');
		}

		// Tab ID is required for tracking
		if (!request.tabId) {
			throw new Error('Tab ID is required for streaming session');
		}

		const abortController = new AbortController();
		
		// Store abort controller by tab ID
		this.tabSessions.set(request.tabId, { 
			abortController, 
			sessionId: request.sessionId 
		});

		// Start streaming in background
		this.performStreaming(request, request.tabId, abortController).catch(error => {
			// Only report error if the tab session still exists (not cancelled/completed)
			if (this.tabSessions.has(request.tabId)) {
				this.logService.error('ClaudeMainService: Streaming error', error);
				this._onStreamEnd.fire({ tabId: request.tabId, error: error.message });
			}
		});

		return {
			tabId: request.tabId
		};
	}

	private async performStreaming(request: any, tabId: string, abortController: AbortController): Promise<void> {
		let hasCompleted = false;
		try {
			const options: any = {
				cwd: request.workingDirectory,
				model: 'claude-opus-4-20250514',
				fallbackModel: 'claude-sonnet-4-20250514',
				permissionMode: request.mode === 'agent' ? 'bypassPermissions' : 'plan',
			};

			if (request.sessionId) {
				options.resume = request.sessionId;
			}

			
			const messages = this.sdkModule!.query({
				prompt: request.message,
				abortController,
				options
			});

			for await (const message of messages) {
				if (abortController.signal.aborted) {
					break;
				}

				switch (message.type) {
					case 'system':
						// Update session ID if Claude provides one
						const claudeSessionId = message.session_id;
						if (claudeSessionId) {
							// Update the tab session with Claude's session ID
							const tabSession = this.tabSessions.get(tabId);
							if (tabSession) {
								tabSession.sessionId = claudeSessionId;
							}
						}
						this._onStreamChunk.fire({
							tabId,
							chunk: {
								type: 'metadata',
								content: '',
								metadata: {
									sessionId: claudeSessionId || request.sessionId,
									model: message.model,
									permissionMode: message.permissionMode
								}
							}
						});
						break;

					case 'assistant':
						if (message.message && message.message.content) {

							for (const content of message.message.content) {
								if (typeof content === 'string') {
									this._onStreamChunk.fire({
										tabId,
										chunk: { type: 'text', content, metadata: undefined }
									});
								} else if (content.type === 'text') {
									this._onStreamChunk.fire({
										tabId,
										chunk: { type: 'text', content: content.text, metadata: undefined }
									});
								} else if (content.type === 'tool_use') {
									this._onStreamChunk.fire({
										tabId,
										chunk: {
											type: 'tool_use',
											content: JSON.stringify(content),
											metadata: undefined
										}
									});
								}
							}
						}
						break;

					case 'user':
						break;

					case 'result':
						if (message.subtype === 'error_max_turns' || message.subtype === 'error_during_execution') {
							throw new Error(`Claude execution failed: ${message.subtype}`);
						}
						// Mark as completed for successful results
						hasCompleted = true;
						break;

					default:
						break;
				}
			}

			this._onStreamEnd.fire({ tabId });
			hasCompleted = true;
		} catch (error) {
			// Only report error if we haven't completed successfully
			// This handles the case where Claude process crashes after sending results
			if (!hasCompleted && this.tabSessions.has(tabId)) {
				this.logService.error('ClaudeMainService: Error in streaming', error);
				this._onStreamEnd.fire({ tabId, error: error.message || 'Unknown error' });
			} else {
				// Log the error but don't report it to user if stream completed
				this.logService.debug('ClaudeMainService: Post-completion error (ignored)', error);
			}
		} finally {
			// Clean up tab session
			this.tabSessions.delete(tabId);
		}
	}

	cancelSession(sessionId: string): void {
		// Find tab by Claude session ID
		for (const [tabId, tabSession] of this.tabSessions) {
			if (tabSession.sessionId === sessionId) {
				tabSession.abortController.abort();
				this.tabSessions.delete(tabId);
				return;
			}
		}
	}

	cancelTab(tabId: string): void {
		const tabSession = this.tabSessions.get(tabId);
		if (tabSession) {
			tabSession.abortController.abort();
			this.tabSessions.delete(tabId);
		}
	}

	override dispose(): void {
		// Cancel all tab sessions
		for (const [tabId, session] of this.tabSessions) {
			session.abortController.abort();
			this.logService.info(`ClaudeMainService: Cancelled tab session ${tabId}`);
		}
		this.tabSessions.clear();

		super.dispose();
	}
}
