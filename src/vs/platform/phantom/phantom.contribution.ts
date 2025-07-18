import { registerSingleton, InstantiationType } from '../instantiation/common/extensions.js';
import { IPhantomService } from './common/phantom.js';
import { NodePhantomService } from './node/phantomService.js';

registerSingleton(IPhantomService, NodePhantomService, InstantiationType.Delayed);
