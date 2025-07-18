import { URI } from '../../../base/common/uri.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IPhantomService = createDecorator<IPhantomService>('phantomService');

export interface IPhantomService {
	readonly _serviceBrand: undefined;

	onDidCreatePhantom: Event<IPhantomReplica>;
	onDidDestroyPhantom: Event<string>;
	onDidChangePhantom: Event<IPhantomReplica>;

	createPhantom(options: IPhantomOptions): Promise<IPhantomReplica>;
	destroyPhantom(id: string): Promise<void>;
	destroyAllPhantoms(): Promise<void>;
	getPhantom(id: string): IPhantomReplica | undefined;
	listPhantoms(): IPhantomReplica[];

	listPhantomsForWorkspace(workspaceUri: URI): IPhantomReplica[];
	getPhantomMetadata(id: string): IPhantomMetadata | undefined;
	cleanupWorkspacePhantoms(workspaceUri: URI): Promise<void>;

	compareToOriginal(phantomId: string): Promise<IPhantomDiff>;
	comparePhantoms(phantomId1: string, phantomId2: string): Promise<IPhantomDiff>;

	acceptChanges(phantomId: string, files?: URI[]): Promise<IAcceptResult>;
	syncToOriginal(id: string, files?: URI[]): Promise<void>;
	updatePhantomFile(phantomId: string, fileUri: URI, content: string): Promise<void>;
	updateClaudeSessionId(phantomId: string, claudeSessionId: string): Promise<void>;
	validatePhantomExists(phantomId: string): Promise<boolean>;
	
	getPhantomForFile?(fileUri: URI): Promise<IPhantomReplica | undefined>;
	getPhantomsByTabId(tabId: string): IPhantomReplica[];
	garbageCollectPhantoms(workspaceUri: URI, activeTabIds: string[]): Promise<number>;
}

export interface IPhantomOptions {
	workspaceUri: URI;
	type: 'workspace' | 'file';
	purpose: 'agent' | 'inline-edit';
	files?: URI[];
	parentPhantomId?: string;
	id?: string;
	tabId?: string;
	diffOptions?: {
		algorithm?: 'myers' | 'patience';
		detectModifications?: boolean;
		modificationThreshold?: number;
		proximityWindow?: number;
	};
}

export interface IPhantomReplica {
	id: string;
	path: URI;
	metadata: IPhantomMetadata;
}

export interface IPhantomMetadata {
	id: string;
	workspaceUri: URI;
	workspaceId: string;
	type: 'workspace' | 'file';
	purpose: 'agent' | 'inline-edit';
	createdAt: number;
	parentPhantomId?: string;
	tabId?: string;              // Associated agent/chat tab ID
	claudeSessionId?: string;    // Associated Claude conversation session ID
}

export interface IPhantomRegistry {
	phantoms: Map<string, IPhantomMetadata>;
	workspaceIndex: Map<string, string[]>;
}

export interface IPhantomDiff {
	additions: IFileChange[];
	deletions: IFileChange[];
	modifications: IFileDiff[];
	statistics: IDiffStatistics;
}

export interface IFileChange {
	uri: URI;
	relativePath: string;
}

export interface IFileDiff {
	uri: URI;
	relativePath: string;
	changes?: ILineChange[];
	changeType?: 'added' | 'deleted' | 'modified';
	lineChanges?: ILineChange[];
}

export interface ILineChange {
	originalStartLineNumber: number;
	originalEndLineNumber: number;
	modifiedStartLineNumber: number;
	modifiedEndLineNumber: number;
	originalLines: string[];
	modifiedLines: string[];
	type?: 'addition' | 'deletion' | 'modification';
	originalContent?: string;
	modifiedContent?: string;
	similarity?: number;
}

export interface IDiffStatistics {
	filesAdded: number;
	filesRemoved: number;
	filesModified: number;
	linesAdded: number;
	linesRemoved: number;
}

export interface IAcceptResult {
	applied: URI[];
	conflicts: IConflict[];
	updatedPhantoms: string[];
}

export interface IConflict {
	uri: URI;
	reason: string;
	originalContent?: string;
	phantomContent?: string;
	currentContent?: string;
}