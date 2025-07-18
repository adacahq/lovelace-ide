import { Disposable } from '../../../../base/common/lifecycle.js';
import { IAgentService, IChatMessage, ICodeContext } from '../common/agent.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { URI } from '../../../../base/common/uri.js';

export class ChatController extends Disposable {
	constructor(
		@IAgentService private readonly agentService: IAgentService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super();
	}

	async processMessage(tabId: string, message: string, files?: URI[]): Promise<void> {
		const tab = this.agentService.getTabs().find(t => t.id === tabId);
		if (!tab) {
			return;
		}

		// Build context
		const context = await this.buildContext(files);

		// Parse for special commands
		const command = this.parseCommand(message);
		if (command) {
			await this.executeCommand(tabId, command, context);
		} else {
			// Regular message
			await this.agentService.sendMessage(tabId, message, files);
		}
	}

	private async buildContext(attachedFiles?: URI[]): Promise<ICodeContext> {
		const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		const activeEditor = this.editorService.activeEditor;
		const currentFile = activeEditor?.resource;

		let selection: { start: number; end: number } | undefined;

		// Get selection from active editor
		if (activeEditor) {
			const control = this.editorService.activeTextEditorControl;
			if (control && 'getModel' in control && 'getSelection' in control) {
				const model = control.getModel() as ITextModel;
				const sel = control.getSelection();
				if (sel && model) {
					selection = {
						start: model.getOffsetAt(sel.getStartPosition()),
						end: model.getOffsetAt(sel.getEndPosition())
					};
				}
			}
		}

		// Get relevant files from index
		const files = attachedFiles || [];
		if (currentFile && files.length === 0) {
			// Include current file if no files attached
			files.push(currentFile);
		}

		// TODO: Get related files from index service based on message content

		return {
			files,
			currentFile,
			selection,
			workspaceRoot
		};
	}

	private parseCommand(message: string): ICommand | undefined {
		const trimmed = message.trim();

		// Check for special commands
		if (trimmed.startsWith('/')) {
			const parts = trimmed.split(' ');
			const command = parts[0].substring(1);
			const args = parts.slice(1).join(' ');

			switch (command) {
				case 'refactor':
					return { type: 'refactor', args };
				case 'test':
					return { type: 'test', args };
				case 'explain':
					return { type: 'explain', args };
				case 'fix':
					return { type: 'fix', args };
				default:
					return undefined;
			}
		}

		// Check for agent mode keywords
		const agentKeywords = [
			'refactor all',
			'update all',
			'fix all',
			'migrate',
			'rename across',
			'extract to'
		];

		for (const keyword of agentKeywords) {
			if (trimmed.toLowerCase().includes(keyword)) {
				return { type: 'agent', args: message };
			}
		}

		return undefined;
	}

	private async executeCommand(tabId: string, command: ICommand, context: ICodeContext): Promise<void> {
		const tab = this.agentService.getTabs().find(t => t.id === tabId);
		if (!tab) {
			return;
		}

		switch (command.type) {
			case 'agent':
				// Switch to agent mode if not already
				if (tab.mode !== 'agent') {
					this.agentService.setMode(tabId, 'agent');
				}
				await this.agentService.sendMessage(tabId, command.args, context.files);
				break;

			case 'refactor':
			case 'test':
			case 'explain':
			case 'fix':
				// These are handled by the mode handlers
				await this.agentService.sendMessage(tabId, `/${command.type} ${command.args}`, context.files);
				break;
		}
	}

	formatMessage(message: IChatMessage): string {
		let formatted = message.content;

		// Add file references
		if (message.files && message.files.length > 0) {
			formatted = `Files: ${message.files.map(f => f.path).join(', ')}\n\n${formatted}`;
		}

		// Add change summary
		if (message.changes) {
			const fileCount = message.changes.files.length;
			formatted += `\n\n📝 Modified ${fileCount} file${fileCount > 1 ? 's' : ''}`;
		}

		return formatted;
	}
}

interface ICommand {
	type: 'refactor' | 'test' | 'explain' | 'fix' | 'agent';
	args: string;
}