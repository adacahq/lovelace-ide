import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ZoneWidget } from '../../../../editor/contrib/zoneWidget/browser/zoneWidget.js';
import { IClassifiedChange, ChangeType, DiffDecision, IDiffDecisionEvent, IInlineDiffWidget } from '../common/inlineDiff.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { IPosition } from '../../../../editor/common/core/position.js';
import { DiffEditorWidget } from '../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { Color } from '../../../../base/common/color.js';
import { diffInserted, diffRemoved, editorInfoBackground } from '../../../../platform/theme/common/colors/editorColors.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

export class InlineDiffWidget extends ZoneWidget implements IInlineDiffWidget {
	private readonly _onDecision = new Emitter<IDiffDecisionEvent>();
	public readonly onDecision: Event<IDiffDecisionEvent> = this._onDecision.event;

	private _diffEditor: DiffEditorWidget | undefined;
	private _changes: IClassifiedChange[] = [];
	private _currentChangeIndex = 0;

	constructor(
		editor: ICodeEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService private readonly themeService: IThemeService
	) {
		super(editor, {
			showArrow: true,
			showFrame: true,
			isResizeable: true,
			isAccessible: true,
			showInHiddenAreas: true,
			ordinal: 10000
		});

		this._disposables.add(this._onDecision);
	}

	protected override _fillContainer(container: HTMLElement): void {
		// Create header with bulk actions
		const header = append(container, $('.inline-diff-header'));
		this._createBulkActions(header);

		// Create diff editor container
		const diffContainer = append(container, $('.inline-diff-editor'));
		diffContainer.style.height = '200px';

		// Create action buttons container
		const actionsContainer = append(container, $('.inline-diff-actions'));
		this._createActionButtons(actionsContainer);
	}

	private _createBulkActions(container: HTMLElement): void {
		const acceptAllBtn = this._createButton(container, 'Accept All', () => {
			this._changes.forEach(change => {
				this._onDecision.fire({ change, decision: DiffDecision.Accept });
			});
			this.hide();
		});
		acceptAllBtn.element.classList.add('accept-all');

		const rejectAllBtn = this._createButton(container, 'Reject All', () => {
			this._changes.forEach(change => {
				this._onDecision.fire({ change, decision: DiffDecision.Reject });
			});
			this.hide();
		});
		rejectAllBtn.element.classList.add('reject-all');
	}

	private _createActionButtons(container: HTMLElement): void {
		clearNode(container);

		if (this._currentChangeIndex >= this._changes.length) {
			return;
		}

		const change = this._changes[this._currentChangeIndex];

		switch (change.type) {
			case ChangeType.Addition:
				this._createButton(container, 'Accept Addition', () => this._handleDecision(DiffDecision.Accept), 'codicon-add');
				this._createButton(container, 'Reject', () => this._handleDecision(DiffDecision.Reject), 'codicon-close');
				break;

			case ChangeType.Deletion:
				this._createButton(container, 'Accept Deletion', () => this._handleDecision(DiffDecision.Accept), 'codicon-remove');
				this._createButton(container, 'Keep Original', () => this._handleDecision(DiffDecision.Reject), 'codicon-discard');
				break;

			case ChangeType.Modification:
				this._createButton(container, 'Accept Change', () => this._handleDecision(DiffDecision.Accept), 'codicon-check');
				this._createButton(container, 'Reject', () => this._handleDecision(DiffDecision.Reject), 'codicon-close');
				this._createButton(container, 'Edit', () => this._handleDecision(DiffDecision.Modify), 'codicon-edit');
				break;
		}

		// Navigation buttons
		if (this._changes.length > 1) {
			const navContainer = append(container, $('.navigation'));
			navContainer.style.marginLeft = 'auto';

			const prevBtn = this._createButton(navContainer, 'Previous', () => this._navigateChange(-1), 'codicon-chevron-up');
			prevBtn.enabled = this._currentChangeIndex > 0;

			const nextBtn = this._createButton(navContainer, 'Next', () => this._navigateChange(1), 'codicon-chevron-down');
			nextBtn.enabled = this._currentChangeIndex < this._changes.length - 1;

			const counter = append(navContainer, $('span.change-counter'));
			counter.textContent = `${this._currentChangeIndex + 1} / ${this._changes.length}`;
		}
	}

	private _createButton(container: HTMLElement, label: string, onClick: () => void, icon?: string): Button {
		const button = this._disposables.add(new Button(container, defaultButtonStyles));
		if (icon) {
			button.icon = ThemeIcon.fromId(icon);
		}
		button.label = label;
		this._disposables.add(button.onDidClick(onClick));
		return button;
	}

	private _handleDecision(decision: DiffDecision): void {
		const change = this._changes[this._currentChangeIndex];
		this._onDecision.fire({ change, decision });

		// Move to next change or hide if done
		if (this._currentChangeIndex < this._changes.length - 1) {
			this._navigateChange(1);
		} else {
			this.hide();
		}
	}

	private _navigateChange(direction: number): void {
		this._currentChangeIndex = Math.max(0, Math.min(this._changes.length - 1, this._currentChangeIndex + direction));
		this._showCurrentChange();
	}

	private _showCurrentChange(): void {
		if (this._currentChangeIndex >= this._changes.length) {
			return;
		}

		const change = this._changes[this._currentChangeIndex];
		
		// Update editor position
		this.editor.revealLineInCenter(change.startLineNumber);
		
		// Update action buttons
		const actionsContainer = this.domNode.querySelector('.inline-diff-actions');
		if (actionsContainer) {
			this._createActionButtons(actionsContainer as HTMLElement);
		}

		// Update diff editor content if needed
		this._updateDiffEditor(change);

		// Update background color based on change type
		this._updateBackgroundColor(change.type);
	}

	private _updateDiffEditor(change: IClassifiedChange): void {
		// This would create/update the diff editor with the change content
		// Actual implementation would use the DiffEditorWidget
	}

	private _updateBackgroundColor(type: ChangeType): void {
		let color: Color | undefined;
		
		switch (type) {
			case ChangeType.Addition:
				color = this.themeService.getColorTheme().getColor(diffInserted);
				break;
			case ChangeType.Deletion:
				color = this.themeService.getColorTheme().getColor(diffRemoved);
				break;
			case ChangeType.Modification:
				color = this.themeService.getColorTheme().getColor(editorInfoBackground);
				break;
		}

		if (color) {
			this.domNode.style.backgroundColor = color.toString();
		}
	}

	public override show(rangeOrPos: IRange | IPosition, heightInLines: number): void {
		super.show(rangeOrPos, heightInLines);
	}

	public showChanges(changes: IClassifiedChange[]): void {
		this._changes = changes;
		this._currentChangeIndex = 0;

		if (changes.length === 0) {
			return;
		}

		const firstChange = changes[0];
		this.show({
			lineNumber: firstChange.startLineNumber,
			column: 1
		}, 10);

		this._showCurrentChange();
	}

	public override hide(): void {
		this._changes = [];
		this._currentChangeIndex = 0;
		super.hide();
	}

	protected override _onWidth(widthInPixel: number): void {
		super._onWidth(widthInPixel);
		if (this._diffEditor) {
			this._diffEditor.layout();
		}
	}

	protected _doOnHeight(heightInPixel: number): void {
		if (this._diffEditor) {
			this._diffEditor.layout();
		}
	}

	public override dispose(): void {
		this._onDecision.dispose();
		super.dispose();
	}
}