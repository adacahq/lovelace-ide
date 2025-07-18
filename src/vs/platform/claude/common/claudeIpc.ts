import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Event, Emitter } from '../../../base/common/event.js';
import { IChatRequest, IChatChunk } from './claude.js';

export interface IStreamingSession {
	tabId: string;
}

export interface IClaudeChannel extends IChannel {
	call(command: 'initialize'): Promise<void>;
	call(command: 'isAvailable'): Promise<boolean>;
	call(command: 'startStreamingSession', arg: IChatRequest): Promise<IStreamingSession>;
	call(command: 'cancelSession', arg: string): Promise<void>;
	call(command: 'cancelTab', arg: string): Promise<void>;
	call(command: string, arg?: any): Promise<any>;
	listen(event: 'onStreamChunk'): Event<{ tabId: string; chunk: IChatChunk }>;
	listen(event: 'onStreamEnd'): Event<{ tabId: string; error?: string }>;
	listen(event: string): Event<any>;
}

export class ClaudeChannel implements IServerChannel {
	private readonly _onStreamChunk = new Emitter<{ tabId: string; chunk: IChatChunk }>();
	private readonly _onStreamEnd = new Emitter<{ tabId: string; error?: string }>();

	constructor(private service: any) {
		// Register event handlers if service supports them
		if (this.service.onStreamChunk) {
			this.service.onStreamChunk((data: any) => {
				this._onStreamChunk.fire(data);
			}, this._onStreamChunk);
		}
		if (this.service.onStreamEnd) {
			this.service.onStreamEnd((data: any) => {
				this._onStreamEnd.fire(data);
			}, this._onStreamEnd);
		}
	}

	listen(_: unknown, event: string): Event<any> {
		switch (event) {
			case 'onStreamChunk':
				return this._onStreamChunk.event;
			case 'onStreamEnd':
				return this._onStreamEnd.event;
			default:
				throw new Error(`Event not found: ${event}`);
		}
	}

	async call(_: unknown, command: string, arg?: any): Promise<any> {
		
		switch (command) {
			case 'initialize':
				return this.service.initialize();
			case 'isAvailable':
				return this.service.isAvailable();
			case 'startStreamingSession':
				return this.service.startStreamingSession(arg);
			case 'cancelSession':
				return this.service.cancelSession(arg);
			case 'cancelTab':
				return this.service.cancelTab(arg);
			default:
				throw new Error(`Call not found: ${command}`);
		}
	}

	dispose(): void {
		this._onStreamChunk.dispose();
		this._onStreamEnd.dispose();
	}
}