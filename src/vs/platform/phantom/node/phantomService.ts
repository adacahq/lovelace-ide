import { PhantomService } from '../common/phantomService.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../files/common/files.js';
import { ILogService } from '../../log/common/log.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { dirname, relative } from '../../../base/common/path.js';
import { Queue } from '../../../base/common/async.js';
import { IPhantomReplica } from '../common/phantom.js';

export class NodePhantomService extends PhantomService {
	private readonly copyQueue = new Queue();

	constructor(
		@IFileService fileService: IFileService,
		@ILogService logService: ILogService,
		@INativeEnvironmentService environmentService: INativeEnvironmentService
	) {
		super(fileService, logService, environmentService);
	}

	protected async copyWorkspace(source: URI, destination: URI): Promise<void> {
		await this.copyQueue.queue(async () => {
			await this.copyDirectory(source, destination);
		});
	}

	protected async copyFiles(files: URI[], sourceRoot: URI, destination: URI): Promise<void> {
		await this.copyQueue.queue(async () => {
			const copiedDirs = new Set<string>();

			for (const file of files) {
				const relativePath = relative(sourceRoot.fsPath, file.fsPath);
				const destFile = URI.joinPath(destination, relativePath);
				const destDir = URI.file(dirname(destFile.fsPath));

				const dirKey = destDir.toString();
				if (!copiedDirs.has(dirKey)) {
					await this.fileService.createFolder(destDir);
					copiedDirs.add(dirKey);
				}

				try {
					await this.copyFile(file, destFile);
				} catch (error) {
					this.logService.error(`Failed to copy file ${file.toString()}:`, error);
					throw error;
				}
			}
		});
	}

	private async copyDirectory(source: URI, destination: URI): Promise<void> {
		const stat = await this.fileService.resolve(source);

		if (!stat.isDirectory) {
			await this.copyFile(source, destination);
			return;
		}

		await this.fileService.createFolder(destination);

		if (stat.children) {
			const copyPromises: Promise<void>[] = [];

			for (const child of stat.children) {
				if (this.shouldSkip(child.name, child.isDirectory)) {
					continue;
				}

				const destChild = URI.joinPath(destination, child.name);

				if (child.isDirectory) {
					copyPromises.push(this.copyDirectory(child.resource, destChild));
				} else {
					copyPromises.push(this.copyFile(child.resource, destChild));
				}
			}

			const batchSize = 10;
			for (let i = 0; i < copyPromises.length; i += batchSize) {
				await Promise.all(copyPromises.slice(i, i + batchSize));
			}
		}
	}

	private async copyFile(source: URI, destination: URI): Promise<void> {
		try {
			const stat = await this.fileService.stat(source);

			if (stat.isSymbolicLink) {
				const target = await this.fileService.readFile(source);
				await this.fileService.writeFile(destination, target.value);
			} else {
				const content = await this.fileService.readFile(source);
				await this.fileService.writeFile(destination, content.value);
			}

			// Note: IFileStatWithPartialMetadata doesn't include permissions
			// If needed, we would need to use native fs.stat to get permissions
		} catch (error) {
			this.logService.error(`Failed to copy file ${source.toString()} to ${destination.toString()}:`, error);
			throw error;
		}
	}

	private shouldSkip(name: string, isDirectory: boolean): boolean {
		const skipDirs = [
			'.git',
			'node_modules',
			'.vscode',
			'dist',
			'out',
			'build',
			'.next',
			'.nuxt',
			'coverage',
			'.cache',
			'.parcel-cache',
			'.turbo',
			'.svelte-kit',
			'target',
			'bin',
			'obj'
		];

		const skipFiles = [
			'.DS_Store',
			'Thumbs.db',
			'desktop.ini',
			'*.log',
			'*.lock',
			'package-lock.json',
			'yarn.lock',
			'pnpm-lock.yaml'
		];

		if (isDirectory) {
			return skipDirs.includes(name) || name.startsWith('.');
		}

		for (const pattern of skipFiles) {
			if (pattern.includes('*')) {
				const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
				if (regex.test(name)) {
					return true;
				}
			} else if (name === pattern) {
				return true;
			}
		}

		return name.startsWith('.') && name !== '.env' && name !== '.env.local';
	}

	// Explicitly override methods to satisfy TypeScript
	override getPhantomsByTabId(tabId: string): IPhantomReplica[] {
		return super.getPhantomsByTabId(tabId);
	}

	override async garbageCollectPhantoms(workspaceUri: URI, activeTabIds: string[]): Promise<number> {
		return super.garbageCollectPhantoms(workspaceUri, activeTabIds);
	}
}
