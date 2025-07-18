/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ILogService } from '../../log/common/log.js';
import { INotificationService, Severity } from '../../notification/common/notification.js';
import { IDialogService } from '../../dialogs/common/dialogs.js';
import { localize } from '../../../nls.js';

export interface IMigrationService {
	migrateVSCodeData(): Promise<void>;
}

export class MigrationService implements IMigrationService {
	constructor(
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService
	) { }

	async migrateVSCodeData(): Promise<void> {
		const oldPath = path.join(os.homedir(), '.vscode');
		const newPath = path.join(os.homedir(), '.lovelace');

		try {
			// Check if old VS Code directory exists
			const oldPathExists = await this.pathExists(oldPath);
			if (!oldPathExists) {
				this.logService.info('No .vscode directory found, skipping migration');
				return;
			}

			// Check if new Lovelace directory already exists
			const newPathExists = await this.pathExists(newPath);
			if (newPathExists) {
				this.logService.info('.lovelace directory already exists, skipping migration');
				return;
			}

			// Ask user if they want to migrate
			const result = await this.dialogService.confirm({
				type: 'info',
				message: localize('migrate.confirm.message', "VS Code data found. Would you like to migrate your VS Code settings and extensions to Lovelace?"),
				detail: localize('migrate.confirm.detail', "This will copy your extensions, settings, and other data from {0} to {1}", oldPath, newPath),
				primaryButton: localize('migrate.confirm.yes', "Yes, Migrate"),
				cancelButton: localize('migrate.confirm.no', "No, Start Fresh")
			});

			if (!result.confirmed) {
				this.logService.info('User declined migration');
				return;
			}

			// Perform migration
			this.notificationService.notify({
				severity: Severity.Info,
				message: localize('migrate.progress', "Migrating VS Code data to Lovelace...")
			});

			await this.copyDirectory(oldPath, newPath);

			// Also migrate platform-specific paths
			await this.migratePlatformSpecificPaths();

			this.notificationService.notify({
				severity: Severity.Info,
				message: localize('migrate.success', "Successfully migrated VS Code data to Lovelace!")
			});

			this.logService.info('Migration completed successfully');
		} catch (error) {
			this.logService.error('Migration failed:', error);
			this.notificationService.error(localize('migrate.error', "Failed to migrate VS Code data: {0}", error.message));
		}
	}

	private async migratePlatformSpecificPaths(): Promise<void> {
		const platform = process.platform;
		
		if (platform === 'darwin') {
			// macOS
			const oldAppSupport = path.join(os.homedir(), 'Library', 'Application Support', 'Code');
			const newAppSupport = path.join(os.homedir(), 'Library', 'Application Support', 'Lovelace');
			
			if (await this.pathExists(oldAppSupport) && !(await this.pathExists(newAppSupport))) {
				await this.copyDirectory(oldAppSupport, newAppSupport);
			}
		} else if (platform === 'linux') {
			// Linux
			const oldConfig = path.join(os.homedir(), '.config', 'Code');
			const newConfig = path.join(os.homedir(), '.config', 'Lovelace');
			
			if (await this.pathExists(oldConfig) && !(await this.pathExists(newConfig))) {
				await this.copyDirectory(oldConfig, newConfig);
			}
			
			const oldCache = path.join(os.homedir(), '.cache', 'Code');
			const newCache = path.join(os.homedir(), '.cache', 'Lovelace');
			
			if (await this.pathExists(oldCache) && !(await this.pathExists(newCache))) {
				await this.copyDirectory(oldCache, newCache);
			}
		} else if (platform === 'win32') {
			// Windows
			const appData = process.env.APPDATA;
			if (appData) {
				const oldAppData = path.join(appData, 'Code');
				const newAppData = path.join(appData, 'Lovelace');
				
				if (await this.pathExists(oldAppData) && !(await this.pathExists(newAppData))) {
					await this.copyDirectory(oldAppData, newAppData);
				}
			}
		}
	}

	private async pathExists(path: string): Promise<boolean> {
		try {
			await fs.access(path);
			return true;
		} catch {
			return false;
		}
	}

	private async copyDirectory(source: string, destination: string): Promise<void> {
		await fs.mkdir(destination, { recursive: true });
		
		const entries = await fs.readdir(source, { withFileTypes: true });
		
		for (const entry of entries) {
			const sourcePath = path.join(source, entry.name);
			const destPath = path.join(destination, entry.name);
			
			if (entry.isDirectory()) {
				await this.copyDirectory(sourcePath, destPath);
			} else {
				await fs.copyFile(sourcePath, destPath);
			}
		}
	}
}