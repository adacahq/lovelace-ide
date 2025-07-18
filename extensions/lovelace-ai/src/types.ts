// Types for Claude SDK messages
export interface SDKMessage {
    type: string;
    message?: any;
    timestamp?: number;
}

export interface SDKAssistantMessage extends SDKMessage {
    type: 'assistant';
    message: {
        content: Array<{
            type: string;
            text?: string;
            name?: string;
            input?: any;
        }>;
    };
}

export interface SDKUserMessage extends SDKMessage {
    type: 'user';
    message: {
        content: Array<{
            type: string;
            content?: string;
            tool_use_id?: string;
            is_error?: boolean;
        }>;
    };
}

export interface SDKSystemMessage extends SDKMessage {
    type: 'system';
    message?: string;
}

export interface SDKResultMessage extends SDKMessage {
    type: 'result';
    result: any;
}

// Internal message types
export interface ClaudeMessage {
    type: 'text' | 'code_block' | 'status' | 'file_operation' | 'tool_action';
    content: string;
    language?: string;
    fileOperation?: FileOperation;
    output?: string[];
    tool?: string; // For tool_action messages
}

export interface FileOperation {
    type: 'update' | 'create' | 'write';
    filename: string;
    content?: string;
    diff?: Array<{
        operation: 'add' | 'remove' | 'equal';
        content: string;
    }>;
}