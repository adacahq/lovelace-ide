import { Disposable } from '../../../../base/common/lifecycle.js';
import { IClaudeIntegration, ICodeContext, IClaudeResponse } from '../common/agent.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IClaudeService } from '../../../../platform/claude/common/claude.js';

export class ClaudeIntegration extends Disposable implements IClaudeIntegration {
	private _currentRequest: CancellationTokenSource | undefined;
	private _lastSessionId: string | undefined;

	constructor(
		@IClaudeService private readonly claudeService: IClaudeService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}


	async streamMessage(
		message: string,
		context: ICodeContext,
		mode: 'agent' | 'chat',
		tabId: string,
		onChunk: (chunk: string, type?: 'text' | 'tool_use') => void
	): Promise<IClaudeResponse> {
		// Cancel any ongoing request for this tab
		this.cancelRequest(tabId);

		this._currentRequest = new CancellationTokenSource();

		// Declare variables outside try block for proper scope
		let fullMessage = '';
		let sessionId = context.sessionId || this._lastSessionId;
		let codeChanges: any[] = [];
		

		try {
			// Validate working directory
			if (!context.workingDirectory) {
				const error = 'No phantom directory available. The workspace isolation may have failed.';
				this.logService.error(`ClaudeIntegration: ${error}`);
				throw new Error(error);
			}

			// Check if Claude service is available
			const isAvailable = await this.claudeService.isAvailable();
			if (!isAvailable) {
				throw new Error('Claude service is not available. Please configure your Anthropic API key.');
			}

			// Stream request to Claude service
			let chunkCount = 0;


			const chunks = this.claudeService.streamChat({
				message,
				sessionId: sessionId,
				tabId: tabId,
				mode,
				workingDirectory: context.workingDirectory,
				context: {
					files: context.files?.map(f => ({
						uri: f,
						content: '',
						language: undefined
					})),
					activeFile: context.currentFile,
					selection: context.selection ? {
						startLine: context.selection.start,
						startColumn: 0,
						endLine: context.selection.end,
						endColumn: 0
					} : undefined,
					workingDirectory: context.workingDirectory
				},
				attachments: context.files
			});

			// Process chunks
			for await (const chunk of chunks) {
				if (this._currentRequest?.token.isCancellationRequested) {
					break;
				}

				chunkCount++;

				// Extract text content from chunk
				if (chunk.type === 'text' && chunk.content) {
					fullMessage += chunk.content;
					onChunk(chunk.content, 'text');
				} else if (chunk.type === 'metadata' && chunk.metadata?.sessionId) {
					sessionId = chunk.metadata.sessionId;
					// Update last session ID immediately for cancellation
					this._lastSessionId = sessionId;
				} else if (chunk.type === 'tool_use') {

					// Pass tool use to callback with formatted display
					try {
						const toolUse = JSON.parse(chunk.content);
						let displayText = `Using tool: ${toolUse.name}`;
						if (toolUse.name === 'Edit' && toolUse.input?.file_path) {
							displayText = `Editing file: ${toolUse.input.file_path}`;
						} else if (toolUse.name === 'Write' && toolUse.input?.file_path) {
							displayText = `Writing file: ${toolUse.input.file_path}`;
						} else if (toolUse.name === 'Read' && toolUse.input?.file_path) {
							displayText = `Reading file: ${toolUse.input.file_path}`;
						}
						onChunk(displayText, 'tool_use');

						// Store tool use for potential code changes
						if (toolUse.name === 'Edit' || toolUse.name === 'Write') {
							codeChanges.push(toolUse);
						}
					} catch (e) {
						this.logService.error('[Claude Integration] Failed to parse tool use:', e);
					}
				}
			}

			// Store session ID for subsequent messages
			if (sessionId) {
				this._lastSessionId = sessionId;
				this.logService.info(`ClaudeIntegration: Got session ID: ${sessionId}`);
			}

			// Return the complete response
			return {
				content: fullMessage,
				sessionId: sessionId,
				changes: codeChanges.length > 0 ? {
					phantomId: context.phantomId || '',
					files: codeChanges.map(change => ({
						uri: change.input.file_path,
						originalContent: '',
						modifiedContent: ''
					}))
				} : undefined
			};
		} catch (error) {
			// Check if this is a cancellation
			if (this._currentRequest?.token.isCancellationRequested) {
				// User cancelled - this is not an error
				this.logService.debug('ClaudeIntegration: Streaming cancelled by user');
				return {
					content: fullMessage || '',
					sessionId: sessionId,
					changes: undefined
				};
			}
			this.logService.error('ClaudeIntegration: Error streaming message', error);
			throw error;
		} finally {
			this._currentRequest = undefined;
		}
	}

	cancelRequest(tabId: string): void {
		if (this._currentRequest) {
			this._currentRequest.cancel();
			this._currentRequest = undefined;
		}
		
		// Cancel by tab ID
		this.claudeService.cancelTab(tabId).catch(error => {
			this.logService.debug('[ClaudeIntegration] Cancel tab error:', error);
		});
	}

	getLastSessionId(): string | undefined {
		return this._lastSessionId;
	}
}
