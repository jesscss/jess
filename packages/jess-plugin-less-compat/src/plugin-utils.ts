/**
 * Utilities for working with Less.js plugins in Jess
 */

import type { PluginInterface } from '@jesscss/core';

/**
 * Detect if a plugin is a Less.js plugin
 */
export function isLessPlugin(plugin: any): boolean {
  if (!plugin) {
    return false;
  }
  
  // Less plugins typically have an install method
  if (typeof plugin.install === 'function') {
    return true;
  }
  
  // Some Less plugins are constructor functions that create instances with install
  // Check if the constructor's prototype has install (like autoprefix)
  if (typeof plugin === 'function') {
    // Check if the function itself has install (some plugins are like this)
    if (typeof (plugin as any).install === 'function') {
      return true;
    }
    // Check if the constructor's prototype has install
    if (plugin.prototype && typeof plugin.prototype.install === 'function') {
      return true;
    }
    // Try calling as a constructor
    try {
      const instance = new plugin({});
      if (instance && typeof instance.install === 'function') {
        return true;
      }
    } catch (e) {
      // Try calling as a function
      try {
        const instance = plugin({});
        if (instance && typeof instance.install === 'function') {
          return true;
        }
        // Even if it returns undefined, if it's a function it might be a Less plugin
        // Less.js will handle it by checking for install on the plugin object itself
        // So we should treat functions as potential Less plugins
        return true; // Assume function might be a Less plugin
      } catch (e2) {
        // Not a Less plugin
      }
    }
  }
  
  return false;
}

/**
 * Detect if a plugin is a Jess plugin
 */
export function isJessPlugin(plugin: any): plugin is PluginInterface {
  if (!plugin) {
    return false;
  }
  
  // Jess plugins implement PluginInterface
  // They have a name property and implement AbstractPlugin or match PluginInterface
  if (typeof plugin === 'object' && 'name' in plugin && typeof plugin.name === 'string') {
    // Could be a Jess plugin
    return true;
  }
  
  // Plugin factory functions that return PluginInterface
  if (typeof plugin === 'function') {
    try {
      const instance = plugin({});
      if (instance && typeof instance === 'object' && 'name' in instance && typeof instance.name === 'string') {
        return true;
      }
    } catch (e) {
      // Not a Jess plugin factory
    }
  }
  
  return false;
}

/**
 * Filter and separate Less plugins from Jess plugins
 * This allows mixed plugin arrays to be handled correctly
 */
export function filterPlugins(plugins: any[]): { lessPlugins: any[]; jessPlugins: PluginInterface[] } {
  const lessPlugins: any[] = [];
  const jessPlugins: PluginInterface[] = [];
  
  for (const plugin of plugins) {
    if (isLessPlugin(plugin)) {
      lessPlugins.push(plugin);
    } else if (isJessPlugin(plugin)) {
      jessPlugins.push(plugin);
    } else {
      // Unknown type - assume it's a Less plugin and try to handle it
      lessPlugins.push(plugin);
    }
  }
  
  return { lessPlugins, jessPlugins };
}
