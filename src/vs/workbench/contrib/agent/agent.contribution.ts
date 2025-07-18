import { localize } from '../../../nls.js';
import { registerSingleton, InstantiationType } from '../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { IAgentService } from './common/agent.js';
import { AgentService } from './browser/agentService.js';
import { AgentView } from './browser/agentView.js';
import { IViewDescriptor, IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, ViewContainerLocation } from '../../../workbench/common/views.js';
import { AgentViewPaneContainer } from './browser/agentViewPaneContainer.js';
import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { registerIcon } from '../../../platform/theme/common/iconRegistry.js';
import { Codicon } from '../../../base/common/codicons.js';
import { KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyMod, KeyCode } from '../../../base/common/keyCodes.js';
import { MenuId, MenuRegistry } from '../../../platform/actions/common/actions.js';
import { registerAction2, Action2 } from '../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchLayoutService, Parts } from '../../../workbench/services/layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../workbench/services/panecomposite/browser/panecomposite.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { SchemaFileSystemProvider } from './browser/schemaFileSystemProvider.js';
import { LifecyclePhase } from '../../../workbench/services/lifecycle/common/lifecycle.js';

// Import CSS
import './browser/media/agent.css';

// Register service
registerSingleton(IAgentService, AgentService, InstantiationType.Delayed);

// Register icon
const agentIcon = registerIcon('agent', Codicon.hubot, localize('agentIcon', 'Icon for the agent feature'));

// Register view
const VIEW_ID = AgentView.ID;
const VIEW_CONTAINER_ID = 'workbench.view.agent.container';

// Create view container for auxiliary sidebar
const viewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: VIEW_CONTAINER_ID,
	title: { value: localize('agent', "Lovelace"), original: 'Lovelace' },
	icon: agentIcon,
	order: 1,
	ctorDescriptor: new SyncDescriptor(AgentViewPaneContainer),
	hideIfEmpty: false,
}, ViewContainerLocation.AuxiliaryBar);

// Register view
const viewDescriptor: IViewDescriptor = {
	id: VIEW_ID,
	name: { value: localize('agent', "Lovelace"), original: 'Lovelace' },
	containerIcon: agentIcon,
	ctorDescriptor: new SyncDescriptor(AgentView),
	order: 1,
	weight: 40,
	canToggleVisibility: false,
	canMoveView: false,
	when: undefined
};

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([viewDescriptor], viewContainer);

// Register command to toggle agent view
class ToggleAgentViewAction extends Action2 {
	static readonly ID = 'workbench.action.toggleAgentView';

	constructor() {
		super({
			id: ToggleAgentViewAction.ID,
			title: { value: localize('toggleAgentView', "Toggle Lovelace Agent"), original: 'Toggle Lovelace Agent' },
			category: { value: localize('view', "View"), original: 'View' },
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const paneCompositeService = accessor.get(IPaneCompositePartService);

		// Toggle auxiliary sidebar
		if (layoutService.isVisible(Parts.AUXILIARYBAR_PART)) {
			layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
		} else {
			layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
			// Open agent view
			await paneCompositeService.openPaneComposite(VIEW_CONTAINER_ID, ViewContainerLocation.AuxiliaryBar, true);
		}
	}
}

registerAction2(ToggleAgentViewAction);

// Register command to create new chat
class NewAgentChatAction extends Action2 {
	static readonly ID = 'workbench.action.agent.newChat';

	constructor() {
		super({
			id: NewAgentChatAction.ID,
			title: { value: localize('newAgentChat', "New Agent Chat"), original: 'New Agent Chat' },
			category: { value: localize('agent', "Agent"), original: 'Agent' },
			f1: true,
			icon: Codicon.add
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agentService = accessor.get(IAgentService);
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const paneCompositeService = accessor.get(IPaneCompositePartService);

		// Show auxiliary sidebar if hidden
		if (!layoutService.isVisible(Parts.AUXILIARYBAR_PART)) {
			layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
			await paneCompositeService.openPaneComposite(VIEW_CONTAINER_ID, ViewContainerLocation.AuxiliaryBar, true);
		}

		// Create new tab
		agentService.createTab();
	}
}

registerAction2(NewAgentChatAction);

// Add menu items
MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
	command: {
		id: NewAgentChatAction.ID,
		title: localize('newChat', "New Chat"),
		icon: Codicon.add
	},
	when: undefined,
	group: 'navigation',
	order: 1
});

// Configuration
import { Extensions as ConfigurationExtensions, IConfigurationRegistry, ConfigurationScope } from '../../../platform/configuration/common/configurationRegistry.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'agent',
	order: 100,
	title: localize('agentConfiguration', "Agent"),
	type: 'object',
	properties: {
		'agent.enabled': {
			type: 'boolean',
			default: true,
			description: localize('agent.enabled', "Enable the AI agent feature")
		},
		'agent.defaultMode': {
			type: 'string',
			enum: ['agent', 'chat'],
			default: 'chat',
			description: localize('agent.defaultMode', "Default mode for new agent tabs")
		},
		'agent.maxTabs': {
			type: 'number',
			default: 10,
			minimum: 1,
			maximum: 50,
			description: localize('agent.maxTabs', "Maximum number of agent tabs")
		},
		'agent.persistHistory': {
			type: 'boolean',
			default: true,
			description: localize('agent.persistHistory', "Persist chat history across sessions")
		}
	}
});

// Register Lovelace configuration
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'lovelace',
	order: 101,
	title: localize('lovelaceConfiguration', "Lovelace"),
	type: 'object',
	properties: {
		'lovelace.anthropicApiKey': {
			type: 'string',
			default: '',
			description: localize('lovelace.anthropicApiKey', "Anthropic API key for Claude integration"),
			scope: ConfigurationScope.APPLICATION,
			restricted: true,
			markdownDescription: localize('lovelace.anthropicApiKey.markdown', "Your Anthropic API key for Claude integration. Get your API key from [https://console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)")
		}
	}
});

// Register schema file system provider to handle vscode://schemas-associations
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../workbench/common/contributions.js';

class SchemaFileSystemProviderContribution implements IWorkbenchContribution {
	constructor(
		@IFileService fileService: IFileService
	) {
		// Register provider for vscode:// scheme to handle schema-related URIs
		const provider = new SchemaFileSystemProvider();
		fileService.registerProvider('vscode', provider);
		// Note: lovelace:// scheme is already registered elsewhere
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	SchemaFileSystemProviderContribution,
	LifecyclePhase.Restored
);
