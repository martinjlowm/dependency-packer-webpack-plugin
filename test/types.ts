import * as webpack from 'webpack';

import { DependencyPackerPlugin } from '@/plugin';

export function isDependencyPackerPlugin(
  plugin: webpack.Plugin | DependencyPackerPlugin
): plugin is DependencyPackerPlugin {
  return (plugin as DependencyPackerPlugin).name === 'DependencyPackerPlugin';
}
