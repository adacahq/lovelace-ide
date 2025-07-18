import claudeToolsData from './claudeTools.json';

export interface ClaudeTool {
    name: string;
    description: string;
    permissionRequired: boolean;
    modifiesFiles: boolean;
}

export interface ClaudeToolsConfig {
    tools: ClaudeTool[];
}

export const claudeTools: ClaudeToolsConfig = claudeToolsData;

/**
 * Get all tools that modify files
 */
export function getFileModifyingTools(): string[] {
    return claudeTools.tools
        .filter(tool => tool.modifiesFiles)
        .map(tool => tool.name);
}

/**
 * Get all tools that require permissions
 */
export function getPermissionRequiredTools(): string[] {
    return claudeTools.tools
        .filter(tool => tool.permissionRequired)
        .map(tool => tool.name);
}

/**
 * Check if a tool modifies files
 */
export function doesToolModifyFiles(toolName: string): boolean {
    const tool = claudeTools.tools.find(t => t.name === toolName);
    return tool?.modifiesFiles ?? false;
}

/**
 * Check if a tool requires permissions
 */
export function doesToolRequirePermission(toolName: string): boolean {
    const tool = claudeTools.tools.find(t => t.name === toolName);
    return tool?.permissionRequired ?? false;
}

/**
 * Get tool by name
 */
export function getToolByName(toolName: string): ClaudeTool | undefined {
    return claudeTools.tools.find(t => t.name === toolName);
}