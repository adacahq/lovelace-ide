/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IIndexService = createDecorator<IIndexService>('indexService');

export interface IIndexService {
	readonly _serviceBrand: undefined;

	/**
	 * Search for files containing the given query
	 */
	searchFiles(query: string): Promise<IIndexSearchResult[]>;

	/**
	 * Get all files in a directory
	 */
	getFilesInDirectory(directory: URI): Promise<URI[]>;

	/**
	 * Index a file or directory
	 */
	indexPath(path: URI): Promise<void>;
}

export interface IIndexSearchResult {
	uri: URI;
	score: number;
}