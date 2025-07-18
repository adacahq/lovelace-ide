import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileSystemProvider, FileSystemProviderCapabilities, IFileChange, IStat, FileType, IWatchOptions } from '../../../../platform/files/common/files.js';
import { Event, Emitter } from '../../../../base/common/event.js';

export class SchemaFileSystemProvider extends Disposable implements IFileSystemProvider {
	readonly capabilities = FileSystemProviderCapabilities.Readonly;

	private readonly _onDidChangeCapabilities = this._register(new Emitter<void>());
	readonly onDidChangeCapabilities: Event<void> = this._onDidChangeCapabilities.event;

	private readonly _onDidChangeFile = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile: Event<readonly IFileChange[]> = this._onDidChangeFile.event;

	watch(_resource: URI, _opts: IWatchOptions): IDisposable {
		// No-op for schema resources
		return Disposable.None;
	}

	async stat(_resource: URI): Promise<IStat> {
		// Return a dummy stat for schema resources
		return {
			type: FileType.File,
			ctime: Date.now(),
			mtime: Date.now(),
			size: 0
		};
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		// Return empty schema associations by default
		if (resource.path === '/schemas-associations.json') {
			return new TextEncoder().encode('{}');
		}
		return new Uint8Array(0);
	}

	readdir(_resource: URI): Promise<[string, FileType][]> {
		return Promise.resolve([]);
	}

	mkdir(_resource: URI): Promise<void> {
		throw new Error('Not supported');
	}

	writeFile(_resource: URI, _content: Uint8Array, _opts: { create: boolean; overwrite: boolean; unlock: boolean }): Promise<void> {
		throw new Error('Not supported');
	}

	delete(_resource: URI, _opts: { recursive: boolean; useTrash: boolean }): Promise<void> {
		throw new Error('Not supported');
	}

	rename(_from: URI, _to: URI, _opts: { overwrite: boolean }): Promise<void> {
		throw new Error('Not supported');
	}
}