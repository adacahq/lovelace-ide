/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IIndexService, IIndexSearchResult } from '../common/index.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';

export class IndexService extends Disposable implements IIndexService {
	readonly _serviceBrand: undefined;

	async searchFiles(query: string): Promise<IIndexSearchResult[]> {
		// Stub implementation - return empty results
		return [];
	}

	async getFilesInDirectory(directory: URI): Promise<URI[]> {
		// Stub implementation - return empty array
		return [];
	}

	async indexPath(path: URI): Promise<void> {
		// Stub implementation - no-op
	}
}

// Register the service
registerSingleton(IIndexService, IndexService, InstantiationType.Delayed);