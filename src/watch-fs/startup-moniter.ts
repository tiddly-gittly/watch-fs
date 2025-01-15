import type { ITiddlyWiki } from 'tiddlywiki';
import type { FileSystemMonitor } from './FileSystemMonitor';

interface ITWWithMonitor extends ITiddlyWiki {
  watchFs: FileSystemMonitor;
}

exports.name = 'watch-fs_FileSystemMonitor';
exports.after = ['load-modules'];
exports.platforms = ['node'];
exports.synchronous = true;
exports.startup = () => {
  // Works on NodeJS side and when FileSystemAdaptor is working
  if (typeof $tw === 'undefined' || !$tw?.node || !$tw.syncadaptor) return;
  // don't let watch mode block test execution
  if (process.env.TEST === 'true') return;
  const { FileSystemMonitor } = require('$:/plugins/linonetwo/watch-fs/FileSystemMonitor.js');
  const monitor = new FileSystemMonitor();
  ($tw as ITWWithMonitor).watchFs = monitor;
};
