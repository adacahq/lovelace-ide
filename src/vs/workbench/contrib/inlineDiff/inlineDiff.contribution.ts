import { registerEditorContribution, EditorContributionInstantiation } from '../../../editor/browser/editorExtensions.js';
import { InlineDiffController } from './browser/inlineDiffController.js';
import './browser/inlineDiffActions.js';
import { registerColor } from '../../../platform/theme/common/colorRegistry.js';
import { Color, RGBA } from '../../../base/common/color.js';
import { localize } from '../../../nls.js';

// Register editor contribution
registerEditorContribution(InlineDiffController.ID, InlineDiffController, EditorContributionInstantiation.Lazy);

// Register theme colors for inline diff
export const inlineDiffBackground = registerColor('inlineDiff.background', {
	dark: new Color(new RGBA(0, 0, 0, 0.1)),
	light: new Color(new RGBA(0, 0, 0, 0.05)),
	hcDark: new Color(new RGBA(0, 0, 0, 0.1)),
	hcLight: new Color(new RGBA(0, 0, 0, 0.05))
}, localize('inlineDiffBackground', "Background color for the inline diff widget"));

export const inlineDiffBorder = registerColor('inlineDiff.border', {
	dark: '#464647',
	light: '#E4E4E4',
	hcDark: '#6FC3DF',
	hcLight: '#0F4A85'
}, localize('inlineDiffBorder', "Border color for the inline diff widget"));

export const inlineDiffAdditionBackground = registerColor('inlineDiff.additionBackground', {
	dark: new Color(new RGBA(0, 255, 0, 0.1)),
	light: new Color(new RGBA(0, 255, 0, 0.05)),
	hcDark: new Color(new RGBA(0, 255, 0, 0.1)),
	hcLight: new Color(new RGBA(0, 255, 0, 0.05))
}, localize('inlineDiffAdditionBackground', "Background color for additions in the inline diff widget"));

export const inlineDiffDeletionBackground = registerColor('inlineDiff.deletionBackground', {
	dark: new Color(new RGBA(255, 0, 0, 0.1)),
	light: new Color(new RGBA(255, 0, 0, 0.05)),
	hcDark: new Color(new RGBA(255, 0, 0, 0.1)),
	hcLight: new Color(new RGBA(255, 0, 0, 0.05))
}, localize('inlineDiffDeletionBackground', "Background color for deletions in the inline diff widget"));

export const inlineDiffModificationBackground = registerColor('inlineDiff.modificationBackground', {
	dark: new Color(new RGBA(255, 255, 0, 0.1)),
	light: new Color(new RGBA(0, 0, 255, 0.05)),
	hcDark: new Color(new RGBA(255, 255, 0, 0.1)),
	hcLight: new Color(new RGBA(0, 0, 255, 0.05))
}, localize('inlineDiffModificationBackground', "Background color for modifications in the inline diff widget"));