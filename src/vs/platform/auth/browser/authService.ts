/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { IAuthService, IAuthSession } from '../common/auth.js';
import { ILogService } from '../../log/common/log.js';
import { registerSingleton, InstantiationType } from '../../instantiation/common/extensions.js';

export class AuthService extends Disposable implements IAuthService {
	readonly _serviceBrand: undefined;

	private readonly sessions = new Map<string, IAuthSession[]>();
	private anthropicApiKey: string | undefined;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.initializeAnthropicApiKey();
	}

	private async initializeAnthropicApiKey(): Promise<void> {
		// Try to get API key from various sources
		// 1. Check if we're in Node.js environment and can access process.env
		if (typeof process !== 'undefined' && process.env) {
			this.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
			if (this.anthropicApiKey) {
				this.logService.info('AuthService: Found ANTHROPIC_API_KEY in environment variables');
			}
		}

		// 2. Check localStorage (for web environments)
		if (!this.anthropicApiKey && typeof localStorage !== 'undefined') {
			try {
				this.anthropicApiKey = localStorage.getItem('ANTHROPIC_API_KEY') || undefined;
				if (this.anthropicApiKey) {
					this.logService.info('AuthService: Found ANTHROPIC_API_KEY in localStorage');
				}
			} catch (e) {
				// localStorage might not be available in some contexts
			}
		}

		// 3. If still no key, log a warning
		if (!this.anthropicApiKey) {
			this.logService.warn('AuthService: No ANTHROPIC_API_KEY found. Please set the ANTHROPIC_API_KEY environment variable or use the authentication provider.');
		}
	}

	async getSessions(providerId: string): Promise<IAuthSession[]> {
		this.logService.debug(`Getting sessions for provider: ${providerId}`);
		
		// Special handling for Claude provider
		if (providerId === 'claude' && this.anthropicApiKey) {
			const claudeSession: IAuthSession = {
				id: 'anthropic-api-key-session',
				accessToken: this.anthropicApiKey,
				account: {
					id: 'anthropic-api-key',
					label: 'Anthropic API Key'
				},
				scopes: ['api']
			};
			return [claudeSession];
		}
		
		return this.sessions.get(providerId) || [];
	}

	async createSession(providerId: string, scopes: string[]): Promise<IAuthSession | undefined> {
		this.logService.debug(`Creating session for provider: ${providerId}, scopes: ${scopes.join(', ')}`);
		
		// Special handling for Claude provider
		if (providerId === 'claude') {
			if (this.anthropicApiKey) {
				// Return existing API key session
				const sessions = await this.getSessions(providerId);
				return sessions[0];
			} else {
				// No API key available
				this.logService.error('Cannot create Claude session: No ANTHROPIC_API_KEY found');
				return undefined;
			}
		}
		
		// For other providers, return a mock session
		const session: IAuthSession = {
			id: `session-${Date.now()}`,
			accessToken: 'mock-access-token',
			account: {
				id: 'user-id',
				label: 'User'
			},
			scopes: scopes
		};

		const sessions = this.sessions.get(providerId) || [];
		sessions.push(session);
		this.sessions.set(providerId, sessions);

		return session;
	}

	async removeSession(providerId: string, sessionId: string): Promise<void> {
		this.logService.debug(`Removing session ${sessionId} for provider: ${providerId}`);
		
		const sessions = this.sessions.get(providerId);
		if (sessions) {
			const filtered = sessions.filter(s => s.id !== sessionId);
			this.sessions.set(providerId, filtered);
		}
	}

	/**
	 * Set the Anthropic API key programmatically
	 */
	setAnthropicApiKey(apiKey: string): void {
		this.anthropicApiKey = apiKey;
		this.logService.info('AuthService: Anthropic API key set programmatically');
		
		// Also save to localStorage for persistence
		if (typeof localStorage !== 'undefined') {
			try {
				localStorage.setItem('ANTHROPIC_API_KEY', apiKey);
			} catch (e) {
				// localStorage might not be available
			}
		}
	}
}

// Register the service
registerSingleton(IAuthService, AuthService, InstantiationType.Delayed);