import type { Node } from './tree/node';

const SYNC_LOG_PATH = '/Users/matthew/git/oss/jess/.cursor/debug-sync.log';

/**
 * Get a node identifier using location info (startOffset-endOffset) if available,
 * otherwise fall back to type#index
 */
export function getNodeId(node: Node): string {
  const loc = node.location;
  if (loc && loc.length >= 4) {
    return `${node.type}@${loc[0]}-${loc[3]}`;
  }
  return `${node.type}#${node.index ?? '?'}`;
}

/**
 * Synchronously log a message to the debug-sync log file
 */
export function debugLog(message: string, node?: Node, data?: Record<string, any>): void {
  try {
    const nodeId = node ? getNodeId(node) : '';
    const dataStr = data ? `, ${JSON.stringify(data)}` : '';
    const logLine = `${message}${nodeId ? `: ${nodeId}` : ''}${dataStr}\n`;
    require('fs').writeFileSync(SYNC_LOG_PATH, logLine, { flag: 'a' });
  } catch {
    // Ignore errors
  }
}


