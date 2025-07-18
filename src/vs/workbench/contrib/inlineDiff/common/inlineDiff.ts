import { URI } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';

export const enum ChangeType {
	Addition = 1,
	Deletion = 2,
	Modification = 3
}

export interface ILineChange {
	readonly lineNumber: number;
	readonly content: string;
	readonly range: IRange;
}

export interface IClassifiedChange {
	readonly type: ChangeType;
	readonly original?: ILineChange[];
	readonly modified?: ILineChange[];
	readonly startLineNumber: number;
	readonly endLineNumber: number;
}

export interface IInlineDiffChange {
	readonly uri: URI;
	readonly changes: IClassifiedChange[];
}

export interface IModificationDetector {
	isModification(deletion: ILineChange, addition: ILineChange): boolean;
}

export interface IInlineDiffWidget {
	showChanges(changes: IClassifiedChange[]): void;
	hide(): void;
	dispose(): void;
}

export const enum DiffDecision {
	Accept = 'accept',
	Reject = 'reject',
	Modify = 'modify'
}

export interface IDiffDecisionEvent {
	readonly change: IClassifiedChange;
	readonly decision: DiffDecision;
}