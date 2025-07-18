import { ClaudeMessage, FileOperation, SDKAssistantMessage, SDKMessage } from '../types';

export class SDKMessageParser {
    /**
     * Convert SDK assistant messages to our internal ClaudeMessage format
     */
    public parseAssistantMessage(msg: SDKAssistantMessage): ClaudeMessage[] {
        const messages: ClaudeMessage[] = [];

        if (!msg.message || !msg.message.content) return messages;

        for (const content of msg.message.content) {
            switch (content.type) {
                case 'text':
                    // Parse text content to extract different message types
                    if (content.text) {
                        messages.push(...this.parseTextContent(content.text));
                    }
                    break;

                case 'tool_use':
                    messages.push({
                        type: 'tool_action',
                        content: `⏺ ${content.name}`,
                        output: []
                    });
                    break;
            }
        }

        return messages;
    }

    /**
     * Parse text content to identify different types of messages
     */
    private parseTextContent(text: string): ClaudeMessage[] {
        const messages: ClaudeMessage[] = [];

        // First, filter out system-reminder content
        const filteredText = this.filterSystemReminders(text);
        if (!filteredText.trim()) {
            // If all content was filtered out, return empty array
            return messages;
        }

        const lines = filteredText.split('\n');

        let currentCodeBlock: { language: string; lines: string[] } | null = null;
        let currentText: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();

            // Code block detection
            if (trimmed.startsWith('```')) {
                // First, flush any accumulated text
                if (currentText.length > 0) {
                    messages.push({
                        type: 'text',
                        content: currentText.join('\n').trim()
                    });
                    currentText = [];
                }

                if (currentCodeBlock) {
                    // End code block
                    messages.push({
                        type: 'code_block',
                        content: currentCodeBlock.lines.join('\n'),
                        language: currentCodeBlock.language
                    });
                    currentCodeBlock = null;
                } else {
                    // Start code block
                    const language = trimmed.substring(3).trim() || '';
                    currentCodeBlock = { language, lines: [] };
                }
                continue;
            }

            // Add to code block if active
            if (currentCodeBlock) {
                currentCodeBlock.lines.push(line);
                continue;
            }

            // Status line detection
            if (this.isStatusLine(trimmed)) {
                // Flush text first
                if (currentText.length > 0) {
                    messages.push({
                        type: 'text',
                        content: currentText.join('\n').trim()
                    });
                    currentText = [];
                }

                messages.push({
                    type: 'status',
                    content: trimmed
                });
                continue;
            }

            // File operation detection
            const fileOp = this.detectFileOperation(trimmed);
            if (fileOp) {
                // Flush text first
                if (currentText.length > 0) {
                    messages.push({
                        type: 'text',
                        content: currentText.join('\n').trim()
                    });
                    currentText = [];
                }

                messages.push({
                    type: 'file_operation',
                    content: trimmed,
                    fileOperation: fileOp
                });
                continue;
            }

            // Accumulate regular text
            currentText.push(line);
        }

        // Flush any remaining content
        if (currentCodeBlock) {
            messages.push({
                type: 'code_block',
                content: currentCodeBlock.lines.join('\n'),
                language: currentCodeBlock.language
            });
        } else if (currentText.length > 0) {
            messages.push({
                type: 'text',
                content: currentText.join('\n').trim()
            });
        }

        return messages;
    }

    /**
     * Filter out content within <system-reminder></system-reminder> tags
     */
    private filterSystemReminders(text: string): string {
        // Remove system-reminder blocks using regex
        const systemReminderRegex = /<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/gi;
        return text.replace(systemReminderRegex, '').trim();
    }

    /**
     * Check if a line is a status update
     */
    private isStatusLine(line: string): boolean {
        const statusPatterns = [
            /^[·✻•◐◑◒◓✽✶✳✢]\s+/,
            /^(Thinking|Analyzing|Processing|Working)/i,
            /^\*[^*]+\*$/ // Italic text often used for status
        ];

        return statusPatterns.some(pattern => pattern.test(line));
    }

    /**
     * Detect file operations in text
     */
    private detectFileOperation(line: string): FileOperation | null {
        const patterns = {
            update: /^(?:Update|Updating|Modified?)\s+(.+?)$/i,
            create: /^(?:Create|Creating|Added?)\s+(.+?)$/i,
            write: /^(?:Write|Writing|Wrote)\s+(.+?)$/i
        };

        for (const [type, pattern] of Object.entries(patterns)) {
            const match = line.match(pattern);
            if (match) {
                return {
                    type: type as 'update' | 'create' | 'write',
                    filename: match[1].trim()
                };
            }
        }

        return null;
    }

    /**
     * Extract tool results from SDK messages
     */
    public extractToolResults(messages: SDKMessage[]): Map<string, any> {
        const results = new Map<string, any>();

        for (const msg of messages) {
            if (msg.type === 'assistant' && msg.message.content) {
                for (const content of msg.message.content) {
                    if (content.type === 'tool_use') {
                        // Store tool use ID and input for later reference
                        results.set(content.id, {
                            name: content.name,
                            input: content.input
                        });
                    }
                }
            }
        }

        return results;
    }
}
