import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { InlineDiffController } from './inlineDiffController.js';
import { URI } from '../../../../base/common/uri.js';
import { IPhantomService } from '../../../../platform/phantom/common/phantom.js';
import { localize } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';

export class ShowInlineDiffAction extends Action2 {
	static readonly ID = 'inlineDiff.show';

	constructor() {
		super({
			id: ShowInlineDiffAction.ID,
			title: { value: localize('showInlineDiff', "Show Inline Diff"), original: 'Show Inline Diff' },
			category: { value: localize('phantom', "Phantom"), original: 'Phantom' },
			precondition: ContextKeyExpr.and(EditorContextKeys.editorTextFocus),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor, phantomId: string, fileUri: URI): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const activeEditor = codeEditorService.getActiveCodeEditor();

		if (!activeEditor) {
			return;
		}

		const controller = activeEditor.getContribution<InlineDiffController>(InlineDiffController.ID);
		if (controller) {
			await controller.showDiff(phantomId, fileUri);
		}
	}
}

export class ComparePhantomFileAction extends Action2 {
	static readonly ID = 'phantom.compareFile';

	constructor() {
		super({
			id: ComparePhantomFileAction.ID,
			title: { value: localize('comparePhantomFile', "Compare Phantom File"), original: 'Compare Phantom File' },
			category: { value: localize('phantom', "Phantom"), original: 'Phantom' },
			precondition: ContextKeyExpr.and(EditorContextKeys.editorTextFocus),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const phantomService = accessor.get(IPhantomService);
		const activeEditor = codeEditorService.getActiveCodeEditor();

		if (!activeEditor) {
			return;
		}

		const model = activeEditor.getModel();
		if (!model) {
			return;
		}

		const uri = model.uri;
		
		// Check if this is a phantom file
		if (!phantomService.getPhantomForFile) {
			return;
		}
		
		const phantomInfo = await phantomService.getPhantomForFile(uri);
		if (!phantomInfo) {
			return;
		}

		const controller = activeEditor.getContribution<InlineDiffController>(InlineDiffController.ID);
		if (controller) {
			await controller.showDiff(phantomInfo.metadata.id, uri);
		}
	}
}

// Register actions
registerAction2(ShowInlineDiffAction);
registerAction2(ComparePhantomFileAction);