import cp from 'child_process';
import util from 'util';

const exec = util.promisify(cp.exec);

export const run = async (command: string, cwd: string = __dirname) => {
  const { stdout, stderr } = await exec(command, { cwd });

  if (process.env.VERBOSE) {
    stdout && console.debug('[stdout]:', stdout);
    stderr && console.debug('[stderr]:', stderr);
  }
};
