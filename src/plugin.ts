import cp = require('child_process');
import fs = require('fs');
import Module = require('module');
import path = require('path');
import semver = require('semver');
import util = require('util');

import * as Webpack from 'webpack';

const builtinModules = Module.builtinModules || require('./builtin-modules').modules as string[];
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

export interface Options {
  blacklist?: Array<string | RegExp>;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
}

export class DependencyPackerPlugin {

  cwd: string;
  packageManager: string;
  blacklist: Array<string | RegExp>;
  name: string = 'DependencyPackerPlugin';

  projectName: string;
  entries: Webpack.EntryNormalized;
  outputDirectory: string;
  dependencies: { [entryName: string]: { [packageName: string]: string } } = {};
  run: boolean;

  constructor(options: Options) {
    this.cwd = process.cwd();
    this.packageManager = options.packageManager || 'npm';
    this.blacklist = options.blacklist || [];
  }

  private onBeforeRun = async (compiler: Webpack.Compiler) => {
    this.run = true;
    if (!this.run) {
      console.info(
        `[${this.name}] ` +
        `» Dependency packing only makes sense for NodeOutputFileSystem.`
      );
    }
  }

  private onCompilationFinishModules = <T extends Webpack.NormalModule>(compilation: Webpack.Compilation, modules: T[]) => {
    if (!this.run) {
      return;
    }

    const dependentModules = Array.from(modules).filter(mod => !mod.rawRequest && mod.request);

    dependentModules.forEach(mod => {
      const incomingConnections = compilation.moduleGraph.getIncomingConnections(mod);

      if (!builtinModules.find(builtInModule => builtInModule === mod.request)) {
        const entryPoints = Array.from(new Set(Array.from(incomingConnections).map((connection) => connection.originModule).filter((originModule): originModule is Webpack.NormalModule => {
          return 'rawRequest' in originModule;
        }).map((originModule) => originModule.rawRequest)));

        let moduleName = mod.request;

        const packageJSONFiles = findPackageJSONFiles(compilation.moduleGraph.getIssuer(mod).context);

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
    });
  }

  private onDone = async (stats: Webpack.Stats) => {
    if (!this.run || stats.compilation.errors.length) {
      return;
    }

    const entries = typeof this.entries === 'function' ? await this.entries() : this.entries;

    let dependencies = {};
    const packaged = (Object.keys(entries) as Array<keyof Webpack.Entry>).map(async entryName => {
      await stat(this.outputDirectory);

      const paths = entries[entryName].import;

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

      await writeFile(`${this.outputDirectory}/package.json`, JSON.stringify(entryPackage));

      console.info(
        `[${this.name}] ` +
          `» Installing packages for \`${Object.keys(entries).join(', ')}'...`,
      );

      const cacheDirectory = path.join(this.outputDirectory, '.cache');
      const cacheOption = (() => {
        switch (this.packageManager) {
          case 'yarn':
            return '--cache-folder';
          case 'pnpm':
            return '--store';
          case 'npm':
          default:
            return '--cache';
        }
      })();

      await exec(`${this.packageManager} install ${cacheOption} ${cacheDirectory}`, {
        cwd: path.resolve(this.outputDirectory),
      });

      try {
        await exec(`rm -r ${cacheDirectory}`);
      } catch (error) { }

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
    this.entries = compiler.options.entry;

    this.outputDirectory = compiler.options.output.path;

    ({ name: this.projectName } = require(`${this.cwd}/package.json`));

    // Hooks
    compiler.hooks.beforeRun.tapPromise(this.name, this.onBeforeRun);

    compiler.hooks.compilation.tap(this.name, (compilation) => {
      compilation.hooks.finishModules.tap(
        this.name, <T extends Webpack.NormalModule>(modules: T[]) => this.onCompilationFinishModules(compilation, modules));
    });

    compiler.hooks.done.tapPromise(this.name, this.onDone);
  }
}
