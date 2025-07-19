import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { IPhantomService, IPhantomOptions, IPhantomReplica, IPhantomMetadata, IPhantomDiff, IAcceptResult } from './phantom.js';
import { IFileService } from '../../files/common/files.js';
import { ILogService } from '../../log/common/log.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { hash } from '../../../base/common/hash.js';
import { PhantomRegistry } from './phantomRegistry.js';
import { PhantomDiffer, IDiffOptions } from './phantomDiffer.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { VSBuffer } from '../../../base/common/buffer.js';

export abstract class PhantomService extends Disposable implements IPhantomService {
	readonly _serviceBrand: undefined;

	private readonly _onDidCreatePhantom = this._register(new Emitter<IPhantomReplica>());
	readonly onDidCreatePhantom: Event<IPhantomReplica> = this._onDidCreatePhantom.event;

	private readonly _onDidDestroyPhantom = this._register(new Emitter<string>());
	readonly onDidDestroyPhantom: Event<string> = this._onDidDestroyPhantom.event;

	private readonly _onDidChangePhantom = this._register(new Emitter<IPhantomReplica>());
	readonly onDidChangePhantom: Event<IPhantomReplica> = this._onDidChangePhantom.event;

	protected readonly phantoms = new Map<string, IPhantomReplica>();
	protected readonly phantomOptions = new Map<string, IDiffOptions>();
	protected readonly registry: PhantomRegistry;
	protected readonly differ: PhantomDiffer;
	protected phantomsRoot: URI;

	constructor(
		@IFileService protected readonly fileService: IFileService,
		@ILogService protected readonly logService: ILogService,
		@INativeEnvironmentService protected readonly environmentService: INativeEnvironmentService
	) {
		super();
		// Use ~/.lovelace/phantoms for phantom storage
		this.phantomsRoot = URI.joinPath(this.environmentService.userHome, '.lovelace', 'phantoms');
		this.registry = this._register(new PhantomRegistry(this.phantomsRoot, this.fileService, this.logService));
		this.differ = new PhantomDiffer(this.fileService, this.logService);
		this.initialize();
	}

	private async initialize(): Promise<void> {
		// Ensure parent .lovelace directory exists first
		const lovelaceRoot = URI.joinPath(this.environmentService.userHome, '.lovelace');
		await this.fileService.createFolder(lovelaceRoot);
		
		// Now create phantoms subdirectory
		await this.fileService.createFolder(this.phantomsRoot);
		await this.registry.load();
		
		for (const [id, metadata] of this.registry.getAllPhantoms()) {
			const phantomPath = URI.joinPath(this.phantomsRoot, id);
			const exists = await this.fileService.exists(phantomPath);
			if (exists) {
				this.phantoms.set(id, {
					id,
					path: phantomPath,
					metadata
				});
			} else {
				await this.registry.removePhantom(id);
			}
		}
	}

	async createPhantom(options: IPhantomOptions): Promise<IPhantomReplica> {
		const id = options.id || generateUuid();
		const workspaceId = String(hash(options.workspaceUri.toString()));
		const phantomPath = URI.joinPath(this.phantomsRoot, id);

		const metadata: IPhantomMetadata = {
			id,
			workspaceUri: options.workspaceUri,
			workspaceId,
			type: options.type,
			purpose: options.purpose,
			createdAt: Date.now(),
			parentPhantomId: options.parentPhantomId,
			tabId: options.tabId
		};

		try {
			await this.fileService.createFolder(phantomPath);

			if (options.type === 'workspace') {
				await this.copyWorkspace(options.workspaceUri, phantomPath);
			} else if (options.files && options.files.length > 0) {
				await this.copyFiles(options.files, options.workspaceUri, phantomPath);
			}

			await this.registry.addPhantom(metadata);

			const replica: IPhantomReplica = {
				id,
				path: phantomPath,
				metadata
			};

			this.phantoms.set(id, replica);
			if (options.diffOptions) {
				this.phantomOptions.set(id, options.diffOptions);
			}
			this._onDidCreatePhantom.fire(replica);

			return replica;
		} catch (error) {
			this.logService.error('Failed to create phantom:', error);
			try {
				await this.fileService.del(phantomPath, { recursive: true });
			} catch { }
			throw error;
		}
	}

	async destroyPhantom(id: string): Promise<void> {
		const phantom = this.phantoms.get(id);
		if (!phantom) {
			return;
		}

		try {
			await this.fileService.del(phantom.path, { recursive: true });
			await this.registry.removePhantom(id);
			this.phantoms.delete(id);
			this.phantomOptions.delete(id);
			this._onDidDestroyPhantom.fire(id);
		} catch (error) {
			this.logService.error('Failed to destroy phantom:', error);
			throw error;
		}
	}

	async destroyAllPhantoms(): Promise<void> {
		const phantomIds = Array.from(this.phantoms.keys());
		const errors: Error[] = [];

		for (const id of phantomIds) {
			try {
				await this.destroyPhantom(id);
			} catch (error) {
				errors.push(error as Error);
			}
		}

		if (errors.length > 0) {
			throw new Error(`Failed to destroy ${errors.length} phantoms`);
		}
	}

	getPhantom(id: string): IPhantomReplica | undefined {
		return this.phantoms.get(id);
	}

	listPhantoms(): IPhantomReplica[] {
		return Array.from(this.phantoms.values());
	}

	listPhantomsForWorkspace(workspaceUri: URI): IPhantomReplica[] {
		const workspaceId = String(hash(workspaceUri.toString()));
		const phantomIds = this.registry.getPhantomsForWorkspace(workspaceId);
		return phantomIds
			.map(id => this.phantoms.get(id))
			.filter((phantom): phantom is IPhantomReplica => phantom !== undefined);
	}

	getPhantomMetadata(id: string): IPhantomMetadata | undefined {
		return this.phantoms.get(id)?.metadata;
	}

	async cleanupWorkspacePhantoms(workspaceUri: URI): Promise<void> {
		const phantoms = this.listPhantomsForWorkspace(workspaceUri);
		const errors: Error[] = [];

		for (const phantom of phantoms) {
			try {
				await this.destroyPhantom(phantom.id);
			} catch (error) {
				errors.push(error as Error);
			}
		}

		if (errors.length > 0) {
			throw new Error(`Failed to cleanup ${errors.length} phantoms`);
		}
	}

	async compareToOriginal(phantomId: string): Promise<IPhantomDiff> {
		const phantom = this.getPhantom(phantomId);
		if (!phantom) {
			throw new Error(`Phantom ${phantomId} not found`);
		}

		const diffOptions = this.phantomOptions.get(phantomId) || {
			detectModifications: true,
			modificationThreshold: 0.6,
			proximityWindow: 1
		};

		return this.differ.compare(phantom.metadata.workspaceUri, phantom.path, diffOptions);
	}

	async comparePhantoms(phantomId1: string, phantomId2: string): Promise<IPhantomDiff> {
		const phantom1 = this.getPhantom(phantomId1);
		const phantom2 = this.getPhantom(phantomId2);

		if (!phantom1) {
			throw new Error(`Phantom ${phantomId1} not found`);
		}
		if (!phantom2) {
			throw new Error(`Phantom ${phantomId2} not found`);
		}

		const diffOptions = this.phantomOptions.get(phantomId1) || this.phantomOptions.get(phantomId2) || {
			detectModifications: true,
			modificationThreshold: 0.6,
			proximityWindow: 1
		};

		return this.differ.compare(phantom1.path, phantom2.path, diffOptions);
	}

	async acceptChanges(phantomId: string, files?: URI[]): Promise<IAcceptResult> {
		const phantom = this.getPhantom(phantomId);
		if (!phantom) {
			throw new Error(`Phantom ${phantomId} not found`);
		}

		const result: IAcceptResult = {
			applied: [],
			conflicts: [],
			updatedPhantoms: []
		};

		const diff = await this.compareToOriginal(phantomId);
		const filesToApply = files || [
			...diff.additions.map(f => f.uri),
			...diff.modifications.map(f => f.uri),
			...diff.deletions.map(f => f.uri)
		];

		for (const fileUri of filesToApply) {
			try {
				const relativePath = this.getRelativePath(fileUri, phantom.metadata.workspaceUri);
				const phantomFileUri = URI.joinPath(phantom.path, relativePath);
				const originalFileUri = URI.joinPath(phantom.metadata.workspaceUri, relativePath);

				const phantomExists = await this.fileService.exists(phantomFileUri);
				const originalExists = await this.fileService.exists(originalFileUri);

				if (!phantomExists && originalExists) {
					await this.fileService.del(originalFileUri);
					result.applied.push(fileUri);
				} else if (phantomExists) {
					if (originalExists) {
						const originalContent = await this.fileService.readFile(originalFileUri);
						const currentContent = await this.fileService.readFile(originalFileUri);
						
						if (!originalContent.value.equals(currentContent.value)) {
							result.conflicts.push({
								uri: fileUri,
								reason: 'File has been modified in original workspace',
								originalContent: originalContent.value.toString(),
								phantomContent: (await this.fileService.readFile(phantomFileUri)).value.toString(),
								currentContent: currentContent.value.toString()
							});
							continue;
						}
					}

					const content = await this.fileService.readFile(phantomFileUri);
					await this.fileService.writeFile(originalFileUri, content.value);
					result.applied.push(fileUri);
				}
			} catch (error) {
				result.conflicts.push({
					uri: fileUri,
					reason: `Error applying changes: ${error}`
				});
			}
		}

		const otherPhantoms = this.listPhantomsForWorkspace(phantom.metadata.workspaceUri)
			.filter(p => p.id !== phantomId);

		for (const otherPhantom of otherPhantoms) {
			let hasConflict = false;
			for (const appliedUri of result.applied) {
				const relativePath = this.getRelativePath(appliedUri, phantom.metadata.workspaceUri);
				const otherPhantomFileUri = URI.joinPath(otherPhantom.path, relativePath);
				
				if (await this.fileService.exists(otherPhantomFileUri)) {
					const otherContent = await this.fileService.readFile(otherPhantomFileUri);
					const phantomFileUri = URI.joinPath(phantom.path, relativePath);
					const phantomContent = await this.fileService.readFile(phantomFileUri);
					
					if (!otherContent.value.equals(phantomContent.value)) {
						hasConflict = true;
						break;
					}
				}
			}

			if (!hasConflict) {
				await this.syncPhantomFromOriginal(otherPhantom.id, result.applied);
				result.updatedPhantoms.push(otherPhantom.id);
			}
		}

		return result;
	}

	async syncToOriginal(id: string, files?: URI[]): Promise<void> {
		const result = await this.acceptChanges(id, files);
		if (result.conflicts.length > 0) {
			throw new Error(`Failed to sync: ${result.conflicts.length} conflicts found`);
		}
	}

	async getPhantomForFile(fileUri: URI): Promise<IPhantomReplica | undefined> {
		for (const phantom of this.phantoms.values()) {
			const relativePath = this.getRelativePath(fileUri, phantom.metadata.workspaceUri);
			const phantomFileUri = URI.joinPath(phantom.path, relativePath);
			
			if (await this.fileService.exists(phantomFileUri)) {
				return phantom;
			}
		}
		return undefined;
	}

	protected abstract copyWorkspace(source: URI, destination: URI): Promise<void>;
	protected abstract copyFiles(files: URI[], sourceRoot: URI, destination: URI): Promise<void>;

	private async syncPhantomFromOriginal(phantomId: string, files: URI[]): Promise<void> {
		const phantom = this.getPhantom(phantomId);
		if (!phantom) {
			return;
		}

		for (const fileUri of files) {
			const relativePath = this.getRelativePath(fileUri, phantom.metadata.workspaceUri);
			const originalFileUri = URI.joinPath(phantom.metadata.workspaceUri, relativePath);
			const phantomFileUri = URI.joinPath(phantom.path, relativePath);

			if (await this.fileService.exists(originalFileUri)) {
				const content = await this.fileService.readFile(originalFileUri);
				await this.fileService.writeFile(phantomFileUri, content.value);
			} else if (await this.fileService.exists(phantomFileUri)) {
				await this.fileService.del(phantomFileUri);
			}
		}

		this._onDidChangePhantom.fire(phantom);
	}

	async updatePhantomFile(phantomId: string, fileUri: URI, content: string): Promise<void> {
		const phantom = this.getPhantom(phantomId);
		if (!phantom) {
			throw new Error(`Phantom ${phantomId} not found`);
		}

		const relativePath = this.getRelativePath(fileUri, phantom.metadata.workspaceUri);
		const phantomFileUri = URI.joinPath(phantom.path, relativePath);
		
		await this.fileService.writeFile(phantomFileUri, VSBuffer.fromString(content));
		this._onDidChangePhantom.fire(phantom);
	}

	async updateClaudeSessionId(phantomId: string, claudeSessionId: string): Promise<void> {
		const phantom = this.getPhantom(phantomId);
		if (!phantom) {
			throw new Error(`Phantom ${phantomId} not found`);
		}

		phantom.metadata.claudeSessionId = claudeSessionId;
		await this.registry.addPhantom(phantom.metadata); // This will update the existing entry
		this._onDidChangePhantom.fire(phantom);
	}

	async validatePhantomExists(phantomId: string): Promise<boolean> {
		const phantom = this.getPhantom(phantomId);
		if (!phantom) {
			return false;
		}
		
		// Check if the directory actually exists on disk
		try {
			return await this.fileService.exists(phantom.path);
		} catch (error) {
			this.logService.error(`Failed to check phantom existence for ${phantomId}:`, error);
			return false;
		}
	}

	getPhantomsByTabId(tabId: string): IPhantomReplica[] {
		const result: IPhantomReplica[] = [];
		for (const phantom of this.phantoms.values()) {
			if (phantom.metadata.tabId === tabId) {
				result.push(phantom);
			}
		}
		return result;
	}

	async garbageCollectPhantoms(workspaceUri: URI, activeTabIds: string[]): Promise<number> {
		// Get all phantoms for this workspace
		const workspacePhantoms = this.listPhantomsForWorkspace(workspaceUri);
		
		// Filter to find phantoms that should be deleted:
		// - Must belong to this workspace
		// - Must have a tabId (agent-created phantoms)
		// - TabId must NOT be in the active tabs list
		const phantomsToDelete = workspacePhantoms.filter(phantom => {
			const hasTabId = !!phantom.metadata.tabId;
			const isOrphaned = hasTabId && phantom.metadata.tabId && !activeTabIds.includes(phantom.metadata.tabId);
			return isOrphaned;
		});

		// Delete the orphaned phantoms
		let deletedCount = 0;
		for (const phantom of phantomsToDelete) {
			try {
				await this.destroyPhantom(phantom.id);
				deletedCount++;
			} catch (error) {
				this.logService.error(`Failed to garbage collect phantom ${phantom.id}:`, error);
			}
		}


		return deletedCount;
	}

	private getRelativePath(fileUri: URI, rootUri: URI): string {
		const filePath = fileUri.fsPath;
		const rootPath = rootUri.fsPath;
		
		if (filePath.startsWith(rootPath)) {
			return filePath.substring(rootPath.length + 1);
		}
		
		return filePath;
	}
}