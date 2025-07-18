import { registerSingleton, InstantiationType } from '../../platform/instantiation/common/extensions.js';
import { IClaudeService } from './common/claude.js';
import { ClaudeService } from './browser/claudeService.js';

registerSingleton(IClaudeService, ClaudeService, InstantiationType.Delayed);
