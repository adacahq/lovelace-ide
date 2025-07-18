import { IClassifiedChange, ChangeType, IModificationDetector, ILineChange as IInlineDiffLineChange } from '../common/inlineDiff.js';
import { ILineChange as IPhantomLineChange } from '../../../../platform/phantom/common/phantom.js';

export class DiffClassifier {
	private readonly modificationDetector: IModificationDetector;

	constructor() {
		this.modificationDetector = new ModificationDetector();
	}

	public classifyChanges(changes: IPhantomLineChange[]): IClassifiedChange[] {
		const classified: IClassifiedChange[] = [];
		const processedChanges = new Set<IPhantomLineChange>();

		for (const change of changes) {
			if (processedChanges.has(change)) {
				continue;
			}

			const classification = this.classifySingleChange(change, changes, processedChanges);
			if (classification) {
				classified.push(classification);
			}
		}

		return classified;
	}

	private classifySingleChange(change: IPhantomLineChange, allChanges: IPhantomLineChange[], processedChanges: Set<IPhantomLineChange>): IClassifiedChange | null {
		const isAddition = change.originalStartLineNumber === 0;
		const isDeletion = change.modifiedStartLineNumber === 0;

		if (isAddition) {
			processedChanges.add(change);
			return {
				type: ChangeType.Addition,
				modified: this.extractLineChanges(change, true),
				startLineNumber: change.modifiedStartLineNumber,
				endLineNumber: change.modifiedEndLineNumber
			};
		}

		if (isDeletion) {
			// Check for potential modification
			const potentialAddition = this.findPotentialAddition(change, allChanges, processedChanges);
			if (potentialAddition) {
				const deletionLines = this.extractLineChanges(change, false);
				const additionLines = this.extractLineChanges(potentialAddition, true);

				if (this.isModification(deletionLines, additionLines)) {
					processedChanges.add(change);
					processedChanges.add(potentialAddition);
					return {
						type: ChangeType.Modification,
						original: deletionLines,
						modified: additionLines,
						startLineNumber: Math.min(change.originalStartLineNumber, potentialAddition.modifiedStartLineNumber),
						endLineNumber: Math.max(change.originalEndLineNumber, potentialAddition.modifiedEndLineNumber)
					};
				}
			}

			processedChanges.add(change);
			return {
				type: ChangeType.Deletion,
				original: this.extractLineChanges(change, false),
				startLineNumber: change.originalStartLineNumber,
				endLineNumber: change.originalEndLineNumber
			};
		}

		return null;
	}

	private findPotentialAddition(deletion: IPhantomLineChange, allChanges: IPhantomLineChange[], processedChanges: Set<IPhantomLineChange>): IPhantomLineChange | null {
		const proximityThreshold = 1;

		for (const change of allChanges) {
			if (processedChanges.has(change) || change.originalStartLineNumber !== 0) {
				continue;
			}

			const lineDistance = Math.abs(change.modifiedStartLineNumber - deletion.originalStartLineNumber);
			if (lineDistance <= proximityThreshold) {
				return change;
			}
		}

		return null;
	}

	private isModification(deletionLines: IInlineDiffLineChange[], additionLines: IInlineDiffLineChange[]): boolean {
		if (deletionLines.length === 0 || additionLines.length === 0) {
			return false;
		}

		// Check each deletion against each addition
		for (const deletion of deletionLines) {
			for (const addition of additionLines) {
				if (this.modificationDetector.isModification(deletion, addition)) {
					return true;
				}
			}
		}

		return false;
	}

	private extractLineChanges(change: IPhantomLineChange, isModified: boolean): IInlineDiffLineChange[] {
		const lines: IInlineDiffLineChange[] = [];
		const content = isModified ? change.modifiedLines : change.originalLines;
		const startLine = isModified ? change.modifiedStartLineNumber : change.originalStartLineNumber;

		for (let i = 0; i < content.length; i++) {
			lines.push({
				lineNumber: startLine + i,
				content: content[i],
				range: {
					startLineNumber: startLine + i,
					startColumn: 1,
					endLineNumber: startLine + i,
					endColumn: content[i].length + 1
				}
			});
		}

		return lines;
	}
}

class ModificationDetector implements IModificationDetector {
	private readonly similarityThreshold = 0.6;

	public isModification(deletion: IInlineDiffLineChange, addition: IInlineDiffLineChange): boolean {
		// Check line proximity
		if (Math.abs(deletion.lineNumber - addition.lineNumber) > 1) {
			return false;
		}

		// Check content similarity
		const similarity = this.calculateSimilarity(deletion.content, addition.content);
		if (similarity < this.similarityThreshold) {
			return false;
		}

		// Check structural similarity (indentation)
		const deletionIndent = this.getIndentation(deletion.content);
		const additionIndent = this.getIndentation(addition.content);
		if (deletionIndent !== additionIndent) {
			return false;
		}

		// Check semantic matching
		return this.hasSemanticMatch(deletion.content, addition.content);
	}

	private calculateSimilarity(str1: string, str2: string): number {
		const longer = str1.length > str2.length ? str1 : str2;
		const shorter = str1.length > str2.length ? str2 : str1;

		if (longer.length === 0) {
			return 1.0;
		}

		const editDistance = this.levenshteinDistance(longer, shorter);
		return (longer.length - editDistance) / longer.length;
	}

	private levenshteinDistance(str1: string, str2: string): number {
		const matrix: number[][] = [];

		for (let i = 0; i <= str2.length; i++) {
			matrix[i] = [i];
		}

		for (let j = 0; j <= str1.length; j++) {
			matrix[0][j] = j;
		}

		for (let i = 1; i <= str2.length; i++) {
			for (let j = 1; j <= str1.length; j++) {
				if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
					matrix[i][j] = matrix[i - 1][j - 1];
				} else {
					matrix[i][j] = Math.min(
						matrix[i - 1][j - 1] + 1,
						matrix[i][j - 1] + 1,
						matrix[i - 1][j] + 1
					);
				}
			}
		}

		return matrix[str2.length][str1.length];
	}

	private getIndentation(line: string): number {
		const match = line.match(/^(\s*)/);
		return match ? match[1].length : 0;
	}

	private hasSemanticMatch(deletion: string, addition: string): boolean {
		// Extract identifiers (variable names, function names)
		const identifierPattern = /\b[a-zA-Z_]\w*\b/g;
		const deletionIdentifiers = new Set(deletion.match(identifierPattern) || []);
		const additionIdentifiers = new Set(addition.match(identifierPattern) || []);

		// Check if most identifiers are preserved
		let matchCount = 0;
		for (const id of deletionIdentifiers) {
			if (additionIdentifiers.has(id)) {
				matchCount++;
			}
		}

		const totalIdentifiers = Math.max(deletionIdentifiers.size, additionIdentifiers.size);
		return totalIdentifiers === 0 || (matchCount / totalIdentifiers) >= 0.5;
	}
}