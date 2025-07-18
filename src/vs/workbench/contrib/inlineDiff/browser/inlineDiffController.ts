import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { InlineDiffWidget } from './inlineDiffWidget.js';
import { DiffClassifier } from './diffClassifier.js';
import { URI } from '../../../../base/common/uri.js';
import { IPhantomService } from '../../../../platform/phantom/common/phantom.js';
import { IClassifiedChange, DiffDecision } from '../common/inlineDiff.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';

export const INLINE_DIFF_VISIBLE = new RawContextKey<boolean>('inlineDiffVisible', false);

export class InlineDiffController extends Disposable implements IEditorContribution {
	public static readonly ID = 'editor.contrib.inlineDiff';

	private _widget: InlineDiffWidget | undefined;
	private readonly _classifier = new DiffClassifier();
	private _currentPhantomId: string | undefined;
	private _currentFileUri: URI | undefined;
	private readonly _widgetDisposables = this._register(new DisposableStore());
	private readonly _inlineDiffVisible;

	constructor(
		private readonly _editor: ICodeEditor,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IPhantomService private readonly _phantomService: IPhantomService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService
	) {
		super();

		this._inlineDiffVisible = INLINE_DIFF_VISIBLE.bindTo(this._contextKeyService);
		this._registerCommands();
	}

	private _registerCommands(): void {
		// Register commands
		const commandIds = {
			accept: 'inlineDiff.accept',
			reject: 'inlineDiff.reject',
			acceptAll: 'inlineDiff.acceptAll',
			modify: 'inlineDiff.modify',
			next: 'inlineDiff.nextChange',
			previous: 'inlineDiff.previousChange',
			close: 'inlineDiff.close'
		};

		// Register command: Accept Current Change
		CommandsRegistry.registerCommand(commandIds.accept, () => {
			if (this._editor.hasTextFocus()) {
				this._acceptCurrentChange();
			}
		});
		KeybindingsRegistry.registerKeybindingRule({
			id: commandIds.accept,
			primary: KeyCode.KeyY,
			weight: KeybindingWeight.EditorContrib,
			when: INLINE_DIFF_VISIBLE
		});

		// Register command: Reject Current Change
		CommandsRegistry.registerCommand(commandIds.reject, () => {
			if (this._editor.hasTextFocus()) {
				this._rejectCurrentChange();
			}
		});
		KeybindingsRegistry.registerKeybindingRule({
			id: commandIds.reject,
			primary: KeyCode.KeyN,
			weight: KeybindingWeight.EditorContrib,
			when: INLINE_DIFF_VISIBLE
		});

		// Register command: Accept All Changes
		CommandsRegistry.registerCommand(commandIds.acceptAll, () => {
			if (this._editor.hasTextFocus()) {
				this._acceptAllChanges();
			}
		});
		KeybindingsRegistry.registerKeybindingRule({
			id: commandIds.acceptAll,
			primary: KeyCode.KeyA,
			weight: KeybindingWeight.EditorContrib,
			when: INLINE_DIFF_VISIBLE
		});

		// Register command: Modify Current Change
		CommandsRegistry.registerCommand(commandIds.modify, () => {
			if (this._editor.hasTextFocus()) {
				this._modifyCurrentChange();
			}
		});
		KeybindingsRegistry.registerKeybindingRule({
			id: commandIds.modify,
			primary: KeyCode.KeyM,
			weight: KeybindingWeight.EditorContrib,
			when: INLINE_DIFF_VISIBLE
		});

		// Register command: Next Change
		CommandsRegistry.registerCommand(commandIds.next, () => {
			if (this._editor.hasTextFocus()) {
				this._navigateChange(1);
			}
		});
		KeybindingsRegistry.registerKeybindingRule({
			id: commandIds.next,
			primary: KeyCode.Tab,
			weight: KeybindingWeight.EditorContrib,
			when: INLINE_DIFF_VISIBLE
		});

		// Register command: Previous Change
		CommandsRegistry.registerCommand(commandIds.previous, () => {
			if (this._editor.hasTextFocus()) {
				this._navigateChange(-1);
			}
		});
		KeybindingsRegistry.registerKeybindingRule({
			id: commandIds.previous,
			primary: KeyMod.Shift | KeyCode.Tab,
			weight: KeybindingWeight.EditorContrib,
			when: INLINE_DIFF_VISIBLE
		});

		// Register command: Close Inline Diff
		CommandsRegistry.registerCommand(commandIds.close, () => {
			if (this._editor.hasTextFocus()) {
				this.hideWidget();
			}
		});
		KeybindingsRegistry.registerKeybindingRule({
			id: commandIds.close,
			primary: KeyCode.Escape,
			weight: KeybindingWeight.EditorContrib,
			when: INLINE_DIFF_VISIBLE
		});
	}

	public async showDiff(phantomId: string, fileUri: URI): Promise<void> {
		this._currentPhantomId = phantomId;
		this._currentFileUri = fileUri;

		try {
			// Get diff from phantom service
			const diff = await this._phantomService.compareToOriginal(phantomId);
			
			// Find changes for specific file
			const fileChanges = diff.modifications.find((m: any) => m.uri.toString() === fileUri.toString());
			if (!fileChanges || !fileChanges.lineChanges) {
				this._notificationService.info('No changes found for this file');
				return;
			}

			// Classify changes
			const classified = this._classifier.classifyChanges(fileChanges.lineChanges);
			
			// Create and show widget
			this._ensureWidget();
			if (this._widget) {
				this._widget.showChanges(classified);
				this._inlineDiffVisible.set(true);
			}
		} catch (error) {
			this._notificationService.error(`Failed to show diff: ${error}`);
		}
	}

	private _ensureWidget(): void {
		if (!this._widget) {
			this._widgetDisposables.clear();
			this._widget = this._instantiationService.createInstance(InlineDiffWidget, this._editor);
			
			this._widgetDisposables.add(this._widget);
			if (this._widget) {
				this._widgetDisposables.add(this._widget.onDecision((e: any) => this._handleDecision(e.change, e.decision)));
			}
		}
	}

	private async _handleDecision(change: IClassifiedChange, decision: DiffDecision): Promise<void> {
		if (!this._currentPhantomId || !this._currentFileUri) {
			return;
		}

		try {
			switch (decision) {
				case DiffDecision.Accept:
					await this._acceptChange(change);
					break;
				case DiffDecision.Reject:
					await this._rejectChange(change);
					break;
				case DiffDecision.Modify:
					await this._modifyChange(change);
					break;
			}
		} catch (error) {
			this._notificationService.error(`Failed to process decision: ${error}`);
		}
	}

	private async _acceptChange(change: IClassifiedChange): Promise<void> {
		if (!this._currentPhantomId || !this._currentFileUri) {
			return;
		}

		// For now, accept the entire file
		// In a real implementation, we'd accept only the specific change
		await this._phantomService.acceptChanges(this._currentPhantomId, [this._currentFileUri]);
	}

	private async _rejectChange(change: IClassifiedChange): Promise<void> {
		// In a real implementation, this would revert the specific change in the phantom file
		// For now, we just log it
		console.log('Rejecting change:', change);
	}

	private async _modifyChange(change: IClassifiedChange): Promise<void> {
		// This would open an inline editor to modify the change
		// For now, we just log it
		console.log('Modifying change:', change);
	}

	private _acceptCurrentChange(): void {
		// Trigger accept on the widget's current change
		if (this._widget) {
			// Widget would expose a method to get current change and trigger accept
		}
	}

	private _rejectCurrentChange(): void {
		// Trigger reject on the widget's current change
		if (this._widget) {
			// Widget would expose a method to get current change and trigger reject
		}
	}

	private _acceptAllChanges(): void {
		// Trigger accept all on the widget
		if (this._widget) {
			// Widget would expose a method to accept all changes
		}
	}

	private _modifyCurrentChange(): void {
		// Trigger modify on the widget's current change
		if (this._widget) {
			// Widget would expose a method to get current change and trigger modify
		}
	}

	private _navigateChange(direction: number): void {
		// Navigate to next/previous change in the widget
		if (this._widget) {
			// Widget would expose navigation methods
		}
	}

	public hideWidget(): void {
		if (this._widget) {
			this._widget.hide();
			this._inlineDiffVisible.set(false);
		}
		this._currentPhantomId = undefined;
		this._currentFileUri = undefined;
	}

	public override dispose(): void {
		this.hideWidget();
		super.dispose();
	}
}