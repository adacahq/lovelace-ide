/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const IAuthService = createDecorator<IAuthService>('authService');

export interface IAuthService {
	readonly _serviceBrand: undefined;

	/**
	 * Get authentication sessions for a provider
	 */
	getSessions(providerId: string): Promise<IAuthSession[]>;

	/**
	 * Create a new authentication session
	 */
	createSession(providerId: string, scopes: string[]): Promise<IAuthSession | undefined>;

	/**
	 * Remove an authentication session
	 */
	removeSession(providerId: string, sessionId: string): Promise<void>;

	/**
	 * Set the Anthropic API key programmatically (optional method)
	 */
	setAnthropicApiKey?(apiKey: string): void;
}

export interface IAuthSession {
	id: string;
	accessToken: string;
	account: {
		id: string;
		label: string;
	};
	scopes: readonly string[];
}
