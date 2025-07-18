import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../files/common/files.js';
import { ILogService } from '../../log/common/log.js';
import { IPhantomDiff, IFileChange, IFileDiff, ILineChange, IDiffStatistics } from './phantom.js';
import { LcsDiff } from '../../../base/common/diff/diff.js';
import { relative } from '../../../base/common/path.js';

export interface IDiffOptions {
	algorithm?: 'myers' | 'patience';
	detectModifications?: boolean;
	modificationThreshold?: number;
	proximityWindow?: number;
}

export class PhantomDiffer {
	private readonly MODIFICATION_PROXIMITY_THRESHOLD = 1;
	private readonly MODIFICATION_SIMILARITY_THRESHOLD = 0.6;

	constructor(
		private readonly fileService: IFileService,
		private readonly logService: ILogService
	) { }

	async compare(source: URI, target: URI, options?: IDiffOptions): Promise<IPhantomDiff> {
		const additions: IFileChange[] = [];
		const deletions: IFileChange[] = [];
		const modifications: IFileDiff[] = [];
		const statistics: IDiffStatistics = {
			filesAdded: 0,
			filesRemoved: 0,
			filesModified: 0,
			linesAdded: 0,
			linesRemoved: 0
		};

		const sourceFiles = await this.getAllFiles(source);
		const targetFiles = await this.getAllFiles(target);

		const sourceMap = new Map<string, URI>();
		const targetMap = new Map<string, URI>();

		for (const file of sourceFiles) {
			const relativePath = this.getRelativePath(file, source);
			sourceMap.set(relativePath, file);
		}

		for (const file of targetFiles) {
			const relativePath = this.getRelativePath(file, target);
			targetMap.set(relativePath, file);
		}

		for (const [relativePath, targetFile] of targetMap) {
			if (!sourceMap.has(relativePath)) {
				additions.push({ uri: targetFile, relativePath });
				statistics.filesAdded++;
			} else {
				const sourceFile = sourceMap.get(relativePath)!;
				const diff = await this.compareFiles(sourceFile, targetFile, relativePath, options);
				if (diff) {
					modifications.push(diff);
					statistics.filesModified++;
					for (const change of (diff.changes || diff.lineChanges || [])) {
						statistics.linesAdded += change.modifiedLines.length;
						statistics.linesRemoved += change.originalLines.length;
					}
				}
			}
		}

		for (const [relativePath, sourceFile] of sourceMap) {
			if (!targetMap.has(relativePath)) {
				deletions.push({ uri: sourceFile, relativePath });
				statistics.filesRemoved++;
			}
		}

		return {
			additions,
			deletions,
			modifications,
			statistics
		};
	}

	private async getAllFiles(root: URI): Promise<URI[]> {
		const files: URI[] = [];
		await this.collectFiles(root, files);
		return files;
	}

	private async collectFiles(dir: URI, files: URI[]): Promise<void> {
		try {
			const stat = await this.fileService.resolve(dir);
			if (!stat.isDirectory) {
				files.push(dir);
				return;
			}

			if (stat.children) {
				for (const child of stat.children) {
					if (child.isDirectory) {
						if (!this.shouldIgnoreDirectory(child.name)) {
							await this.collectFiles(child.resource, files);
						}
					} else {
						if (!this.shouldIgnoreFile(child.name)) {
							files.push(child.resource);
						}
					}
				}
			}
		} catch (error) {
			this.logService.warn(`Failed to collect files from ${dir.toString()}:`, error);
		}
	}

	private shouldIgnoreDirectory(name: string): boolean {
		const ignoreDirs = ['.git', 'node_modules', '.lovelace', 'dist', 'out', 'build', '.next', '.nuxt'];
		return ignoreDirs.includes(name) || name.startsWith('.');
	}

	private shouldIgnoreFile(name: string): boolean {
		const ignorePatterns = ['.DS_Store', 'Thumbs.db', '*.log', '*.tmp'];
		return ignorePatterns.some(pattern => {
			if (pattern.includes('*')) {
				const regex = new RegExp(pattern.replace('*', '.*'));
				return regex.test(name);
			}
			return name === pattern;
		});
	}

	private async compareFiles(source: URI, target: URI, relativePath: string, options?: IDiffOptions): Promise<IFileDiff | null> {
		try {
			const [sourceStat, targetStat] = await Promise.all([
				this.fileService.stat(source),
				this.fileService.stat(target)
			]);

			if (!sourceStat.isFile || !targetStat.isFile) {
				return null;
			}

			if (this.isBinaryFile(source.fsPath)) {
				if (sourceStat.size !== targetStat.size || sourceStat.mtime !== targetStat.mtime) {
					return {
						uri: source,
						relativePath,
						changes: [{
							originalStartLineNumber: 1,
							originalEndLineNumber: 1,
							modifiedStartLineNumber: 1,
							modifiedEndLineNumber: 1,
							originalLines: ['[Binary file]'],
							modifiedLines: ['[Binary file - modified]'],
							type: 'modification'
						}],
						changeType: 'modified'
					};
				}
				return null;
			}

			const [sourceContent, targetContent] = await Promise.all([
				this.fileService.readFile(source),
				this.fileService.readFile(target)
			]);

			const sourceText = sourceContent.value.toString();
			const targetText = targetContent.value.toString();

			if (sourceText === targetText) {
				return null;
			}

			const sourceLines = sourceText.split('\n');
			const targetLines = targetText.split('\n');

			const diff = new LcsDiff({ getElements: () => sourceLines }, { getElements: () => targetLines });
			const diffResult = diff.ComputeDiff(false);
			const changes = diffResult.changes;

			if (!changes || changes.length === 0) {
				return null;
			}

			let lineChanges: ILineChange[] = changes.map((change: any) => ({
				originalStartLineNumber: change.originalStart + 1,
				originalEndLineNumber: change.originalStart + change.originalLength,
				modifiedStartLineNumber: change.modifiedStart + 1,
				modifiedEndLineNumber: change.modifiedStart + change.modifiedLength,
				originalLines: sourceLines.slice(change.originalStart, change.originalStart + change.originalLength),
				modifiedLines: targetLines.slice(change.modifiedStart, change.modifiedStart + change.modifiedLength),
				type: change.originalLength === 0 ? 'addition' : (change.modifiedLength === 0 ? 'deletion' : 'modification') as 'addition' | 'deletion' | 'modification'
			}));

			if (options?.detectModifications) {
				lineChanges = this.detectModifications(lineChanges, options);
			}

			return {
				uri: source,
				relativePath,
				changes: lineChanges,
				changeType: 'modified',
				lineChanges
			} as IFileDiff;
		} catch (error) {
			this.logService.error(`Failed to compare files ${source.toString()} and ${target.toString()}:`, error);
			return null;
		}
	}

	private isBinaryFile(filePath: string): boolean {
		const binaryExtensions = [
			'.exe', '.dll', '.so', '.dylib', '.bin',
			'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.webp',
			'.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav',
			'.zip', '.tar', '.gz', '.7z', '.rar',
			'.pdf', '.doc', '.docx', '.xls', '.xlsx',
			'.woff', '.woff2', '.ttf', '.eot'
		];
		
		const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
		return binaryExtensions.includes(ext);
	}

	private getRelativePath(fileUri: URI, rootUri: URI): string {
		return relative(rootUri.fsPath, fileUri.fsPath);
	}

	private detectModifications(changes: ILineChange[], options: IDiffOptions): ILineChange[] {
		const deletions = changes.filter(c => c.type === 'deletion');
		const additions = changes.filter(c => c.type === 'addition');
		const modifications = changes.filter(c => c.type === 'modification');

		const remainingDeletions: ILineChange[] = [];
		const remainingAdditions: ILineChange[] = [];
		const detectedModifications: ILineChange[] = [...modifications];

		const proximityWindow = options.proximityWindow || this.MODIFICATION_PROXIMITY_THRESHOLD;
		const similarityThreshold = options.modificationThreshold || this.MODIFICATION_SIMILARITY_THRESHOLD;

		for (const deletion of deletions) {
			let matched = false;

			for (let i = 0; i < additions.length; i++) {
				const addition = additions[i];
				if (!addition) continue;

				const lineDiff = Math.abs(deletion.originalStartLineNumber - addition.modifiedStartLineNumber);
				if (lineDiff <= proximityWindow) {
					const deletedContent = deletion.originalLines.join('\n');
					const addedContent = addition.modifiedLines.join('\n');

					const similarity = this.calculateSimilarity(deletedContent, addedContent);
					if (similarity >= similarityThreshold && this.hasStructuralSimilarity(deletedContent, addedContent)) {
						detectedModifications.push({
							originalStartLineNumber: deletion.originalStartLineNumber,
							originalEndLineNumber: deletion.originalEndLineNumber,
							modifiedStartLineNumber: addition.modifiedStartLineNumber,
							modifiedEndLineNumber: addition.modifiedEndLineNumber,
							originalLines: deletion.originalLines,
							modifiedLines: addition.modifiedLines,
							type: 'modification',
							originalContent: deletedContent,
							modifiedContent: addedContent,
							similarity
						});
						additions[i] = undefined as any;
						matched = true;
						break;
					}
				}
			}

			if (!matched) {
				remainingDeletions.push(deletion);
			}
		}

		for (const addition of additions) {
			if (addition) {
				remainingAdditions.push(addition);
			}
		}

		return [...remainingDeletions, ...remainingAdditions, ...detectedModifications].sort((a, b) => 
			(a.originalStartLineNumber || a.modifiedStartLineNumber) - (b.originalStartLineNumber || b.modifiedStartLineNumber)
		);
	}

	private calculateSimilarity(str1: string, str2: string): number {
		if (str1 === str2) return 1;
		if (!str1 || !str2) return 0;

		const len1 = str1.length;
		const len2 = str2.length;
		const maxLen = Math.max(len1, len2);

		if (maxLen === 0) return 1;

		const distance = this.levenshteinDistance(str1, str2);
		return 1 - (distance / maxLen);
	}

	private levenshteinDistance(str1: string, str2: string): number {
		const len1 = str1.length;
		const len2 = str2.length;
		const matrix: number[][] = [];

		for (let i = 0; i <= len1; i++) {
			matrix[i] = [i];
		}

		for (let j = 0; j <= len2; j++) {
			matrix[0][j] = j;
		}

		for (let i = 1; i <= len1; i++) {
			for (let j = 1; j <= len2; j++) {
				const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
				matrix[i][j] = Math.min(
					matrix[i - 1][j] + 1,
					matrix[i][j - 1] + 1,
					matrix[i - 1][j - 1] + cost
				);
			}
		}

		return matrix[len1][len2];
	}

	private hasStructuralSimilarity(line1: string, line2: string): boolean {
		const indent1 = line1.match(/^\s*/)?.[0].length || 0;
		const indent2 = line2.match(/^\s*/)?.[0].length || 0;

		if (Math.abs(indent1 - indent2) > 4) {
			return false;
		}

		const syntaxPatterns = [
			/^\s*function\s+\w+\s*\(/,
			/^\s*const\s+\w+\s*=/,
			/^\s*let\s+\w+\s*=/,
			/^\s*var\s+\w+\s*=/,
			/^\s*class\s+\w+/,
			/^\s*interface\s+\w+/,
			/^\s*if\s*\(/,
			/^\s*for\s*\(/,
			/^\s*while\s*\(/,
			/^\s*return\s+/
		];

		for (const pattern of syntaxPatterns) {
			const match1 = pattern.test(line1);
			const match2 = pattern.test(line2);
			if (match1 && match2) {
				return true;
			}
		}

		const hasAssignment1 = line1.includes('=');
		const hasAssignment2 = line2.includes('=');
		if (hasAssignment1 && hasAssignment2) {
			return true;
		}

		const hasFunctionCall1 = /\w+\s*\(/.test(line1);
		const hasFunctionCall2 = /\w+\s*\(/.test(line2);
		if (hasFunctionCall1 && hasFunctionCall2) {
			return true;
		}

		return false;
	}
}