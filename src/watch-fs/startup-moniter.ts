import type { ITiddlyWiki } from "tiddlywiki";
import type { FileSystemMonitor } from "./FileSystemMonitor";

interface ITWWithMonitor extends ITiddlyWiki {
  watchFs: FileSystemMonitor;
}

exports.name = 'watch-fs_FileSystemMonitor';
exports.after = ['load-modules'];
exports.platforms = ['node'];
exports.synchronous = true;
exports.startup = () => {
  if (typeof $tw === 'undefined' || !$tw?.node) return;
  const FileSystemMonitor = require('$:/plugins/linonetwo/watch-fs/FileSystemMonitor.js').FileSystemMonitor as typeof FileSystemMonitor;
  const monitor = new FileSystemMonitor();
  ($tw as ITWWithMonitor).watchFs = monitor;
};
