import cp from 'child_process';
import fastJSONStringify = require('fast-json-stringify');
import * as fs from 'fs';
import Module = require('module');
import * as path from 'path';
import semver = require('semver');
import util from 'util';

import { Tapable } from 'tapable';
import * as Webpack from 'webpack';

const builtinModules = Module.builtinModules || require('./builtin-modules').modules as string[];
const stringify = fastJSONStringify({
  title: 'package.json',
  type: 'object',
  properties: {
    name: {
      type: 'string',
    },
    dependencies: {
      type: 'object',
      patternProperties: {
        '^(?:@([^/]+?)[/])?([^/]+?)$': {
          type: 'string',
        }
      }
    },
  },
});
const stat = util.promisify(fs.stat);
const writeFile = util.promisify(fs.writeFile);
const exec = util.promisify(cp.exec);

const findPackageJSONFiles = <T extends { dependencies: Record<string, string> }>(dirPath: string, files: T[] = []) => {
  const { name } = path.parse(dirPath);
  if (!name) {
    return files;
  }

  if (fs.readdirSync(dirPath).some(file => file === 'package.json')) {
    files.push(require(`${dirPath}/package.json`));
  }

  findPackageJSONFiles(path.resolve(`${dirPath}/..`), files);

  return files;
};

const getEntryPoints = (module, entryPoints = new Set([]), visitedFiles = {}) => {
  visitedFiles[module.userRequest] = true;

  module.reasons.forEach(reason => {
    if (reason.module && reason.module.constructor.name !== 'MultiModule') {
      if (visitedFiles[reason.module.userRequest]) {
        return;
      }

      getEntryPoints(reason.module, entryPoints, visitedFiles);
    } else {
      entryPoints.add(module.rawRequest);
    }
  });

  return entryPoints;
};

export interface Options {
  blacklist?: Array<string | RegExp>;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
}

export class DependencyPackerPlugin implements Tapable.Plugin {

  cwd: string;
  packageManager: string;
  blacklist: Array<string | RegExp>;
  name: string = 'DependencyPackerPlugin';

  projectName: string;
  entries: ReturnType<Webpack.EntryFunc>;
  outputDirectory: string;
  dependencies: { [entryName: string]: { [packageName: string]: string } } = {};
  run: boolean;

  constructor(options: Options) {
    this.cwd = process.cwd();
    this.packageManager = options.packageManager || 'npm';
    this.blacklist = options.blacklist || [];
  }

  private onBeforeRun = async (compiler: Webpack.Compiler) => {
    this.run = compiler.outputFileSystem.constructor.name === 'NodeOutputFileSystem';
    if (!this.run) {
      console.info(
        `[${this.name}] ` +
        `» Dependency packing only makes sense for NodeOutputFileSystem.`
      );
    }
  }

  private onCompilationFinishModules = <T extends Webpack.compilation.Module & { rawRequest?: string; request?: string }>(modules: T[]) => {
    if (!this.run) {
      return;
    }

    const dependentModules = modules.filter(mod => !mod.rawRequest && mod.request);

    dependentModules.forEach(mod => {
      const issuer = mod.issuer;

      if (issuer) {
        if (!builtinModules.find(builtInModule => builtInModule === mod.request)) {
          const entryPoints = Array.from(getEntryPoints(mod));

          let moduleName = mod.request;

          const packageJSONFiles = findPackageJSONFiles(mod.issuer.context);

          let nextModuleName = moduleName;

          while (nextModuleName && packageJSONFiles.every(({ dependencies = {} }) => {
            return !dependencies[moduleName];
          })) {
            nextModuleName = moduleName.split('/').slice(0, -1).join('/');
            moduleName = nextModuleName || moduleName;
          }

          moduleName = moduleName || mod.request;

          for (const { dependencies = {} } of packageJSONFiles) {
            if (this.blacklist.some(blacklisted => !!moduleName.match(blacklisted))) {
              console.info(`[${this.name}] » ${moduleName} (${mod.request}) is blacklisted. Skipping...`);
              return;
            }

            const version = dependencies[moduleName];

            if (version) {
              entryPoints.forEach(entryPoint => {
                this.dependencies[entryPoint] = this.dependencies[entryPoint] || {};
                this.dependencies[entryPoint][moduleName] = version;
              });

              break;
            }
          }

          if (entryPoints.every(entryPoint => {
            const dependencies = this.dependencies[entryPoint] || {};
            return !dependencies[moduleName];
          })) {
            console.warn(`[${this.name}] » ${mod.request} was requested, but (${moduleName}) is not listed in dependencies! Skipping...`);
          }
        }
      }
    });
  }

  private onDone = async (stats: Webpack.compiler.Stats) => {
    if (!this.run || stats.compilation.errors.length) {
      return;
    }

    let webpackEntries: Webpack.Entry;
    let entries = await this.entries;

    if (Array.isArray(entries)) {
      webpackEntries = { output: entries };
    } else if (typeof entries === 'string') {
      webpackEntries = { output: entries };
    } else {
      webpackEntries = entries;
    }

    let dependencies = {};
    const packaged = (Object.keys(webpackEntries) as Array<keyof Webpack.Entry>).map(async entryName => {
      await stat(this.outputDirectory);

      const paths = webpackEntries[entryName];

      const collectedEntryDependencies = (Array.isArray(paths) ? paths : [paths]).reduce((acc, path) => {
        return {
          ...acc,
          ...(this.dependencies[path] || {})
        };
      }, {});

      dependencies = { ...dependencies, ...collectedEntryDependencies };
      const peerDependenciesInstallations = Object.keys(dependencies).map(async pkg => {
        const [, version] = dependencies[pkg].match(/^(?:\^|~)?(.+)/);

        if (semver.valid(version)) {
          const { stdout: result } = await exec(`${this.packageManager} info ${pkg}@${version} peerDependencies --json`, {
            cwd: this.outputDirectory,
          });

          let peerDependencies: Record<string, string> | {} | undefined;
          try {
            let type: string | undefined;
            ({ type, ...peerDependencies } = JSON.parse(result));
            if (type) {
              peerDependencies = (peerDependencies as { data: typeof peerDependencies }).data;
            }
          } catch (_) { }

          dependencies = { ...dependencies, ...(peerDependencies || {}) };
        }
      });

      return Promise.all(peerDependenciesInstallations);
    });

    try {
      await Promise.all(packaged);

      const entryPackage = {
        dependencies,
      };

      await writeFile(`${this.outputDirectory}/package.json`, stringify(entryPackage));

      console.info(
        `[${this.name}] ` +
          `» Installing packages for \`${Object.keys(webpackEntries).join(', ')}'...`,
      );

      await exec(`${this.packageManager} install`, {
        cwd: path.resolve(this.outputDirectory),
      });

      console.info(
        `[${this.name}] ` +
          '» Finished installing packages.',
      );
    } catch (error) {
      console.error(
        `[${this.name}] ` +
        `! ${error.message}`,
      );
      process.exit(1);
    }
  }

  apply(compiler: Webpack.Compiler) {
    let entry = compiler.options.entry;

    if (typeof entry === 'function') {
      this.entries = entry();
    } else {
      this.entries = entry;
    }

    this.outputDirectory = compiler.options.output.path;

    ({ name: this.projectName } = require(`${this.cwd}/package.json`));

    // Hooks
    compiler.hooks.beforeRun.tapPromise(this.name, this.onBeforeRun);

    compiler.hooks.compilation.tap(this.name, (compilation) => {
      compilation.hooks.finishModules.tap(
        this.name, this.onCompilationFinishModules);
    });

    compiler.hooks.done.tapPromise(this.name, this.onDone);
  }
}
