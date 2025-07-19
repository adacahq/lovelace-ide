import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const IAgentService = createDecorator<IAgentService>('agentService');

export interface IAgentService {
	readonly _serviceBrand: undefined;

	// Tab management
	createTab(): Promise<IAgentTab>;
	closeTab(tabId: string): void;
	switchTab(tabId: string): void;
	getActiveTab(): IAgentTab | undefined;
	getTabs(): IAgentTab[];

	// Messaging
	sendMessage(tabId: string, message: string, files?: URI[]): Promise<void>;
	acceptChanges(tabId: string, messageId: string): Promise<void>;
	rejectChanges(tabId: string, messageId: string): Promise<void>;
	cancelRequest(tabId: string): void;

	// Mode switching
	setMode(tabId: string, mode: 'agent' | 'chat'): void;
	setTabMode(tabId: string, mode: 'agent' | 'chat'): void;

	// Events
	readonly onDidCreateTab: Event<IChatTab>;
	readonly onDidCloseTab: Event<string>;
	readonly onDidSwitchTab: Event<string>;
	readonly onDidChangeMode: Event<{ tabId: string; mode: 'agent' | 'chat' }>;
	readonly onDidReceiveMessage: Event<{ tabId: string; message: IChatMessage }>;
	readonly onDidChangeStreamingState: Event<{ tabId: string; isStreaming: boolean }>;
}

export interface IAgentTab {
	id: string;
	title: string;
	phantomId: string;              // Associated phantom
	claudeSessionId?: string;       // Claude session/conversation ID
	mode: 'agent' | 'chat';
	messages: IChatMessage[];
	isActive: boolean;
	isStreaming?: boolean;          // Track if tab is currently streaming
	isPhantomLoading?: boolean;     // Track if phantom replica is being created
}

// Backwards compatibility alias
export type IChatTab = IAgentTab;

export interface IChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: number;
	files?: URI[];                  // Attached files
	changes?: IPhantomChanges;      // Changes made by assistant
	accepted?: boolean;             // If changes were accepted
	isStreaming?: boolean;          // If message is still being streamed
	metadata?: any;                 // Additional metadata (e.g., for tool use)
}

export interface IPhantomChanges {
	phantomId: string;
	files: IFileChange[];
}

export interface IFileChange {
	uri: URI;
	originalContent: string;
	modifiedContent: string;
}

export interface IClaudeResponse {
	content: string;
	changes?: IPhantomChanges;
	error?: string;
	sessionId?: string;
}

export interface ICodeContext {
	files: URI[];
	currentFile?: URI;
	selection?: { start: number; end: number };
	workspaceRoot: URI;
	selectedFiles?: URI[];
	workingDirectory?: string;
	indexedFiles?: any[];
	phantomId?: string;  // The phantom instance ID for this chat tab
	sessionId?: string;  // Claude session ID for conversation continuity
}


export interface IClaudeIntegration {
	streamMessage(
		message: string,
		context: ICodeContext,
		mode: 'agent' | 'chat',
		tabId: string,
		onChunk: (chunk: string, type?: 'text' | 'tool_use') => void
	): Promise<IClaudeResponse>;
	cancelRequest(tabId: string): void;
}
