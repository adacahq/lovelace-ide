import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IMainProcessService } from '../../../platform/ipc/common/mainProcessService.js';
import {
	IClaudeService, IChatRequest, IChatChunk,
	IClaudeError
} from '../common/claude.js';
import { IClaudeChannel } from '../common/claudeIpc.js';

const SDK_INITIALIZED_KEY = 'claude.sdk.initialized';

export class ClaudeService extends Disposable implements IClaudeService {
	readonly _serviceBrand: undefined;

	private _isAvailable = false;
	private initializePromise: Promise<void> | null = null;
	private claudeChannel: IClaudeChannel | undefined;

	private readonly _onDidChangeAvailability = this._register(new Emitter<boolean>());
	readonly onDidChangeAvailability: Event<boolean> = this._onDidChangeAvailability.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
		@IMainProcessService private readonly mainProcessService: IMainProcessService
	) {
		super();
		this.logService.info('ClaudeService: Constructor called');

		// Get the claude channel
		this.claudeChannel = this.mainProcessService.getChannel('claude') as IClaudeChannel;

		this.initialize().catch(error => {
			this.logService.error('ClaudeService: Failed to initialize in constructor', error);
		});
	}

	private async initialize(): Promise<void> {
		if (this.initializePromise) {
			return this.initializePromise;
		}

		this.initializePromise = this.doInitialize();
		return this.initializePromise;
	}

	private async doInitialize(): Promise<void> {
		try {
			this.logService.info('ClaudeService: Starting initialization...');

			if (!this.claudeChannel) {
				throw new Error('Claude channel not available');
			}

			// Initialize the main process service
			await this.claudeChannel.call('initialize');

			// Check if API key is available
			const isAvailable = await this.claudeChannel.call('isAvailable');

			if (isAvailable) {
				this._isAvailable = true;
				this._onDidChangeAvailability.fire(true);
				this.storageService.store(SDK_INITIALIZED_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
				this.logService.info('Claude SDK initialized successfully via IPC');
			} else {
				this.logService.warn('Claude SDK: Not available (no API key or initialization failed)');
				this._isAvailable = false;
			}
		} catch (error) {
			this.logService.error('Failed to initialize Claude SDK via IPC', error);
			this._isAvailable = false;
			this._onDidChangeAvailability.fire(false);
		}
	}

	async isAvailable(): Promise<boolean> {
		await this.initialize();
		return this._isAvailable;
	}

	async createSession(workspaceUri: URI): Promise<string> {
		await this.ensureInitialized();

		const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		return sessionId;
	}

	async endSession(sessionId: string): Promise<void> {
		try {
			if (!this.claudeChannel) {
				throw new Error('Claude channel not available');
			}
			await this.claudeChannel.call('cancelSession', sessionId);
		} catch (error) {
			this.logService.error('ClaudeService: Error ending session', error);
		}
	}

	async cancelSession(sessionId: string): Promise<void> {
		try {
			if (!this.claudeChannel) {
				throw new Error('Claude channel not available');
			}
			await this.claudeChannel.call('cancelSession', sessionId);
		} catch (error) {
			// Don't log cancellation as error - it's expected when user cancels
			this.logService.debug('ClaudeService: Session cancelled', error);
		}
	}
	
	async cancelTab(tabId: string): Promise<void> {
		try {
			if (!this.claudeChannel) {
				throw new Error('Claude channel not available');
			}
			await this.claudeChannel.call('cancelTab', tabId);
		} catch (error) {
			this.logService.debug('ClaudeService: Tab cancelled', error);
		}
	}


	async *streamChat(request: IChatRequest): AsyncIterable<IChatChunk> {
		await this.ensureInitialized();

		try {
			if (!this.claudeChannel) {
				throw new Error('Claude channel not available');
			}

			// Start streaming session
			const session = await this.claudeChannel.call('startStreamingSession', request);
			const tabId = session.tabId;

			// Set up chunk collection
			const chunks: IChatChunk[] = [];
			let resolveChunk: ((value: IteratorResult<IChatChunk>) => void) | null = null;
			let rejectChunk: ((error: any) => void) | null = null;
			let ended = false;
			let chunkCount = 0;

			// Listen for streaming events
			const chunkListener = this.claudeChannel.listen('onStreamChunk');
			const endListener = this.claudeChannel.listen('onStreamEnd');

			const chunkDisposable = chunkListener((data: { tabId: string; chunk: IChatChunk }) => {
				if (data.tabId === tabId) {
					++chunkCount;

					if (resolveChunk) {
						resolveChunk({ value: data.chunk, done: false });
						resolveChunk = null;
						rejectChunk = null;
					} else {
						chunks.push(data.chunk);
					}
				}
			});

			const endDisposable = endListener((data: { tabId: string; error?: string }) => {
				if (data.tabId === tabId) {
					ended = true;
					if (data.error) {
						if (rejectChunk) {
							rejectChunk(new Error(data.error));
						}
					} else if (resolveChunk) {
						resolveChunk({ value: undefined, done: true });
					}
					chunkDisposable.dispose();
					endDisposable.dispose();
				}
			});

			// Async iterator implementation
			try {
				while (!ended) {
					if (chunks.length > 0) {
						const chunk = chunks.shift()!;
						yield chunk;
					} else {
						// Wait for next chunk
						try {
							yield await new Promise<IChatChunk>((resolve, reject) => {
								resolveChunk = (result) => {
									if (result.done) {
										// Stream ended normally - don't treat as error
										reject(new Error('STREAM_COMPLETE'));
									} else {
										resolve(result.value);
									}
								};
								rejectChunk = reject;

								// Check if stream already ended while we were setting up the promise
								if (ended) {
									// Stream ended normally - don't treat as error
									reject(new Error('STREAM_COMPLETE'));
								}
							});
						} catch (promiseError: any) {
							// If it's just the stream ending, break the loop normally
							if (promiseError.message === 'STREAM_COMPLETE') {
								break;
							}
							// Otherwise, it's a real error
							throw promiseError;
						}
					}
				}
			} finally {
				// Ensure cleanup
				chunkDisposable.dispose();
				endDisposable.dispose();
			}
		} catch (error) {
			this.logService.error('ClaudeService: Error in streamChat', error);
			throw this.mapError(error);
		}
	}


	private async ensureInitialized(): Promise<void> {
		if (!this._isAvailable) {
			await this.initialize();
			if (!this._isAvailable) {
				throw new Error('Claude SDK not available. Please ensure ANTHROPIC_API_KEY is set in your environment.');
			}
		}
	}

	private mapError(error: any): IClaudeError {
		let code: IClaudeError['code'] = 'SDK_ERROR';
		let retryable = false;
		let retryAfter: number | undefined;

		// Parse error message for common patterns
		const errorMessage = error.message || error.toString();
		if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
			code = 'AUTH_FAILED';
		} else if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
			code = 'RATE_LIMIT';
			retryable = true;
		} else if (errorMessage.includes('network') || errorMessage.includes('Network')) {
			code = 'NETWORK_ERROR';
			retryable = true;
		}

		return {
			code,
			message: errorMessage,
			retryable,
			retryAfter
		};
	}

	override dispose(): void {
		super.dispose();
	}
}
