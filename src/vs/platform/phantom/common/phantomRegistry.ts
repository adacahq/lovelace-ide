import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../files/common/files.js';
import { ILogService } from '../../log/common/log.js';
import { IPhantomRegistry, IPhantomMetadata } from './phantom.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../base/common/buffer.js';

export class PhantomRegistry extends Disposable {
	private phantoms = new Map<string, IPhantomMetadata>();
	private workspaceIndex = new Map<string, string[]>();
	private registryFile: URI;
	private saveTimeout: any | undefined;

	constructor(
		private readonly phantomsRoot: URI,
		private readonly fileService: IFileService,
		private readonly logService: ILogService
	) {
		super();
		this.registryFile = URI.joinPath(this.phantomsRoot, 'registry.json');
	}

	async load(): Promise<void> {
		try {
			const exists = await this.fileService.exists(this.registryFile);
			if (!exists) {
				await this.save();
				return;
			}

			const content = await this.fileService.readFile(this.registryFile);
			const data = JSON.parse(content.value.toString()) as IPhantomRegistry;

			this.phantoms.clear();
			this.workspaceIndex.clear();

			if (data.phantoms) {
				for (const [id, metadata] of Object.entries(data.phantoms)) {
					const metadataObj = metadata as any;
					const reconstitutedMetadata: IPhantomMetadata = {
						...metadataObj,
						workspaceUri: URI.revive(metadataObj.workspaceUri)
					};
					this.phantoms.set(id, reconstitutedMetadata);
				}
			}

			if (data.workspaceIndex) {
				for (const [workspaceId, phantomIds] of Object.entries(data.workspaceIndex)) {
					this.workspaceIndex.set(workspaceId, phantomIds as string[]);
				}
			}
		} catch (error) {
			this.logService.error('Failed to load phantom registry:', error);
			this.phantoms.clear();
			this.workspaceIndex.clear();
		}
	}

	async save(): Promise<void> {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = undefined;
		}

		try {
			// Convert Maps to plain objects for JSON serialization
			const phantomsObj: { [key: string]: IPhantomMetadata } = {};
			for (const [id, metadata] of this.phantoms) {
				phantomsObj[id] = metadata;
			}

			const workspaceIndexObj: { [key: string]: string[] } = {};
			for (const [workspaceId, phantomIds] of this.workspaceIndex) {
				workspaceIndexObj[workspaceId] = phantomIds;
			}

			const data = {
				phantoms: phantomsObj,
				workspaceIndex: workspaceIndexObj
			};

			const content = JSON.stringify(data, null, 2);
			await this.fileService.writeFile(this.registryFile, VSBuffer.fromString(content));
		} catch (error) {
			this.logService.error('Failed to save phantom registry:', error);
		}
	}

	private scheduleSave(): void {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = setTimeout(() => {
			this.save();
		}, 1000);
	}

	async addPhantom(metadata: IPhantomMetadata): Promise<void> {
		this.phantoms.set(metadata.id, metadata);

		const phantomIds = this.workspaceIndex.get(metadata.workspaceId) || [];
		if (!phantomIds.includes(metadata.id)) {
			phantomIds.push(metadata.id);
			this.workspaceIndex.set(metadata.workspaceId, phantomIds);
		}

		this.scheduleSave();
	}

	async removePhantom(id: string): Promise<void> {
		const metadata = this.phantoms.get(id);
		if (!metadata) {
			return;
		}

		this.phantoms.delete(id);

		const phantomIds = this.workspaceIndex.get(metadata.workspaceId);
		if (phantomIds) {
			const index = phantomIds.indexOf(id);
			if (index >= 0) {
				phantomIds.splice(index, 1);
				if (phantomIds.length === 0) {
					this.workspaceIndex.delete(metadata.workspaceId);
				} else {
					this.workspaceIndex.set(metadata.workspaceId, phantomIds);
				}
			}
		}

		this.scheduleSave();
	}

	getPhantom(id: string): IPhantomMetadata | undefined {
		return this.phantoms.get(id);
	}

	getAllPhantoms(): Map<string, IPhantomMetadata> {
		return new Map(this.phantoms);
	}

	getPhantomsForWorkspace(workspaceId: string): string[] {
		return this.workspaceIndex.get(workspaceId) || [];
	}

	async cleanup(): Promise<void> {
		const phantomDirs = await this.fileService.resolve(this.phantomsRoot);
		if (!phantomDirs.children) {
			return;
		}

		const validIds = new Set(this.phantoms.keys());
		const toDelete: string[] = [];

		for (const child of phantomDirs.children) {
			if (child.isDirectory && !validIds.has(child.name) && child.name !== 'registry.json') {
				toDelete.push(child.name);
			}
		}

		for (const id of toDelete) {
			try {
				await this.fileService.del(URI.joinPath(this.phantomsRoot, id), { recursive: true });
				this.logService.info(`Cleaned up orphaned phantom: ${id}`);
			} catch (error) {
				this.logService.warn(`Failed to cleanup phantom ${id}:`, error);
			}
		}

		const existingIds: string[] = [];
		for (const [id] of this.phantoms) {
			const phantomPath = URI.joinPath(this.phantomsRoot, id);
			if (await this.fileService.exists(phantomPath)) {
				existingIds.push(id);
			}
		}

		const idsToRemove = Array.from(this.phantoms.keys()).filter(id => !existingIds.includes(id));
		for (const id of idsToRemove) {
			await this.removePhantom(id);
		}
	}

	override dispose(): void {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.save();
		}
		super.dispose();
	}
}