import * as vscode from 'vscode';
import { ChatViewProviderSDK } from './views/chatViewProviderSDK';
import { ClaudeChatServiceManager } from './services/claudeChatService';
import { ClaudeSessionManager } from './services/claudeSessionManager';
import { ClaudeAPI } from './services/claudeApi';

let chatProvider: ChatViewProviderSDK;
const outputChannel = vscode.window.createOutputChannel('Lovelace');

export function activate(context: vscode.ExtensionContext) {
    outputChannel.show(); // TODO: Remove this before production release

    const claudeApi = new ClaudeAPI(outputChannel);
    const claudeService = new ClaudeChatServiceManager(outputChannel);
    const sessionManager = new ClaudeSessionManager(context, outputChannel);

    chatProvider = new ChatViewProviderSDK(context.extensionUri, claudeApi, claudeService, outputChannel, sessionManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('lovelaceAI.chatView', chatProvider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('lovelaceAI.openChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.lovelace-ai-container');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('lovelaceAI.newChat', () => {
            chatProvider.newChatSession();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('lovelaceAI.clearChat', () => {
            chatProvider.clearChat();
        })
    );


    if (vscode.workspace.getConfiguration('lovelaceAI').get('autoShareSelection')) {
        context.subscriptions.push(
            vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
                const selection = e.textEditor.document.getText(e.selections[0]);
                if (selection) {
                    chatProvider.updateSelection(selection, e.textEditor.document.fileName);
                }
            })
        );
    }


}

export async function deactivate() {
    outputChannel.appendLine('Deactivating Lovelace AI extension...');
    if (chatProvider) {
        await chatProvider.dispose();
    }
    outputChannel.dispose();
}
