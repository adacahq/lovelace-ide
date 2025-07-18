import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const IClaudeService = createDecorator<IClaudeService>('claudeService');
export const IClaudeMainService = createDecorator<IClaudeMainService>('claudeMainService');

export interface IClaudeService {
	readonly _serviceBrand: undefined;

	// Chat operations
	streamChat(request: IChatRequest): AsyncIterable<IChatChunk>;

	// Session management
	cancelSession(sessionId: string): Promise<void>;
	cancelTab(tabId: string): Promise<void>;

	// Status
	isAvailable(): Promise<boolean>;
	readonly onDidChangeAvailability: Event<boolean>;
}

export interface IChatRequest {
	message: string;
	sessionId?: string;  // Optional, not provided on first message
	tabId: string;  // Required for tracking
	context?: ICodeContext;
	mode: 'agent' | 'chat';  // Required for permission mode
	workingDirectory: string;  // Phantom directory path
	attachments?: URI[];
}

export interface IChatResponse {
	message: string;
	codeChanges: ICodeChange[];
	sessionId: string;
	metadata?: IResponseMetadata;
}

export interface IChatChunk {
	type: 'text' | 'code' | 'metadata' | 'tool_use';
	content: string;
	metadata?: any;
}


export interface ICodeContext {
	files?: IFileContext[];
	activeFile?: URI;
	selection?: ITextSelection;
	workingDirectory?: string;  // Optional working directory
}

export interface IFileContext {
	uri: URI;
	content: string;
	language?: string;
}

export interface ITextSelection {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export interface ICodeChange {
	uri: URI;
	edits: ITextEdit[];
	description?: string;
}

export interface ITextEdit {
	range: IRange;
	text: string;
}

export interface IRange {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export interface IResponseMetadata {
	model?: string;
	tokensUsed?: number;
	processingTime?: number;
}

export interface IClaudeError {
	code: 'AUTH_FAILED' | 'RATE_LIMIT' | 'NETWORK_ERROR' | 'SDK_ERROR';
	message: string;
	retryable: boolean;
	retryAfter?: number;
}

export interface IClaudeConfiguration {
	endpoint?: string;
	model?: string;
	maxTokens?: number;
	temperature?: number;
}

export interface IClaudeMainService {
	readonly _serviceBrand: undefined;
	initialize(): Promise<void>;
}
