/**
  This file is modified based on $:/plugins/OokTech/Bob/FileSystemMonitor.js
*/

import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import type { IBootFilesIndex, IBootFilesIndexItem, ITiddlyWiki, ITiddlyWikiInfoJSON } from 'tiddlywiki';
import { deepEqual } from './deep-equal';
import { getTwCustomMimeType, safeStringifyHugeTiddler, toTWUTCString } from './utils';

interface ITWWithMonitor extends ITiddlyWiki {
  watchFs: FileSystemMonitor;
}
interface ITiddlyWikiInfoJSONWithExtraConfig extends ITiddlyWikiInfoJSON {
  watchFolder?: string;
}

exports.name = 'watch-fs_FileSystemMonitor';
exports.after = ['load-modules'];
exports.platforms = ['node'];
exports.synchronous = true;
exports.startup = () => {
  if (typeof $tw === 'undefined' || !$tw?.node) return;
  const monitor = new FileSystemMonitor();
  ($tw as ITWWithMonitor).watchFs = monitor;
};

type IBootFilesIndexItemWithTitle = Omit<IBootFilesIndexItem & { tiddlerTitle: string }, 'isEditableFile'>;

class FileSystemMonitor {
  isDebug: boolean = true;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  debugLog: (...data: any[]) => void = () => {};

  watchPathBase: string;

  /**
   * $tw.boot.files: {
   *   [tiddlerTitle: string]: {
   *     filepath: '/Users/linonetwo/xxxx/wiki/Meme-of-LinOnetwo/tiddlers/tiddlerTitle.tid',
   *     type: 'application/x-tiddler',
   *     hasMetaFile: false
   *   }
   * }
   */
  initialLoadedFiles: IBootFilesIndex = {};

  /**
   * we can use this for getTitleByPath.
   * Similar to `IBootFilesIndex`, but key is `filepath` instead of `title`
   * {
   *   [filepath: string]: {
   *     filepath: '/Users/linonetwo/xxxx/wiki/Meme-of-LinOnetwo/tiddlers/tiddlerTitle.tid',
   *     tiddlerTitle: string,
   *     type: 'application/x-tiddler',
   *     hasMetaFile: false
   *   }
   * }
   */
  inverseFilesIndex: Record<string, IBootFilesIndexItemWithTitle> = {};

  /**
   * A mutex to ignore temporary file created or deleted by this plugin.
   *
   * Set<filePath: string>
   */
  lockedFiles: Set<string> = new Set<string>();

  watcher: chokidar.FSWatcher;

  constructor() {
    // eslint-disable-next-line no-console, @typescript-eslint/no-empty-function
    this.debugLog = this.isDebug ? (...args: any[]) => console.log('[watch-fs]', ...args) : () => {};
    this.watchPathBase = path.resolve(
      ($tw.boot.wikiInfo?.config as ITiddlyWikiInfoJSONWithExtraConfig | undefined)?.watchFolder || $tw.boot.wikiTiddlersPath || './tiddlers',
    );
    this.debugLog(`watchPathBase`, JSON.stringify(this.watchPathBase, undefined, '  '));
    this.watcher = chokidar.watch(this.watchPathBase, {
      ignoreInitial: true,
      ignored: [
        '**/*.meta', // TODO: deal with field change in meta file
        '**/$__StoryList*',
        '**/*_1.*', // sometimes sync logic bug will resulted in file ends with _1, which will cause lots of trouble
        '**/subwiki/**',
        '**/.DS_Store',
        '**/.git',
      ],
      atomic: true,
      /** Fsevent requires a binary, which is not able to deliver in tiddlywiki json plugin.
       * No loader is configured for ".node" files: node_modules/.pnpm/fsevents@2.3.2/node_modules/fsevents/e
        node_modules/.pnpm/fsevents@2.3.2/node_modules/fsevents/fsevents.js:13:23:
          13 │ const Native = require("./fsevents.node");
      */
      useFsEvents: false,
      //  usePolling: true,  // CHOKIDAR_USEPOLLING=1
    });
    this.setupListeners();
  }

  // Helpers to maintain our cached index for file path and tiddler title
  updateInverseIndex(filePath: string, fileDescriptor: IBootFilesIndexItemWithTitle | undefined) {
    if (fileDescriptor) {
      this.inverseFilesIndex[filePath] = fileDescriptor;
    } else {
      delete this.inverseFilesIndex[filePath];
    }
  }

  filePathExistsInIndex(filePath: string) {
    return Boolean(this.inverseFilesIndex[filePath]);
  }

  getTitleByPath(filePath: string) {
    try {
      return this.inverseFilesIndex[filePath].tiddlerTitle;
    } catch {
      // fatal error, shutting down.
      this.watcher.close();
      throw new Error(`${filePath}\n↑ not existed in watch-fs plugin's FileSystemMonitor's this.inverseFilesIndex`);
    }
  }

  /**
   * This is a rarely used function maybe only when user rename a tiddler on the disk,
   * we need to get old tiddler path by its name
   */
  getPathByTitle(title: string) {
    try {
      for (const filePath in this.inverseFilesIndex) {
        // TODO: old code say this is `.title`, but type only has `.tiddlerTitle`
        if (this.inverseFilesIndex[filePath].tiddlerTitle === title || this.inverseFilesIndex[filePath].tiddlerTitle === `${title}.tid`) {
          return filePath;
        }
      }
      throw new Error('getPathByTitle');
    } catch {
      // fatal error, shutting down.
      this.watcher.close();
      throw new Error(`${title}\n↑ not existed in watch-fs plugin's FileSystemMonitor's this.inverseFilesIndex`);
    }
  }

  initializeInverseFilesIndex() {
    this.initialLoadedFiles = $tw.boot.files;
    // initialize the inverse index
    for (const tiddlerTitle in this.initialLoadedFiles) {
      if ({}.hasOwnProperty.call(this.initialLoadedFiles, tiddlerTitle)) {
        const fileDescriptor = this.initialLoadedFiles[tiddlerTitle];
        const fileRelativePath = path.relative(this.watchPathBase, fileDescriptor.filepath);
        this.inverseFilesIndex[fileRelativePath] = { ...fileDescriptor, filepath: fileRelativePath, tiddlerTitle };
      }
    }
  }

  public setupListeners() {
    this.initializeInverseFilesIndex();

    // every time a file changed, refresh the count down timer, so only when disk get stable after a while, will we sync to the browser
    // $tw.wiki.watchFs.canSync = false;
    // const debounceInterval = 4 * 1000;
    // let syncTimeoutHandler;
    // const refreshCanSyncState = () => {
    //   $tw.wiki.watchFs.canSync = false;
    //   this.debugLog(`canSync is now ${$tw.wiki.watchFs.canSync}`);
    //   clearTimeout(syncTimeoutHandler);
    //   syncTimeoutHandler = setTimeout(() => {
    //     $tw.wiki.watchFs.canSync = true;
    //     this.debugLog(`canSync is now ${$tw.wiki.watchFs.canSync}`);
    //   }, debounceInterval);
    // };

    /**
     * This watches for changes to a folder and updates the wiki when anything changes in the folder.
     *
     * The filePath reported by listener is not the actual tiddler name, and all tiddlywiki operations requires that we have the name of tiddler,
     * So we have get tiddler name by path from `$tw.boot.files`.
     *
     * Then we can perform following logic:
     * File update -> update or create tiddler using `$tw.syncadaptor.wiki.addTiddler`
     * File remove & tiddler exist in wiki -> then remove tiddler using `$tw.syncadaptor.wiki.deleteTiddler`
     * File remove & tiddler not exist in wiki -> This change is caused by tiddlywiki itself, do noting here
     *
     * @param {*} filePath changed file's relative path to the folder executing this watcher
     */
    const listener = (changeType: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir', filePath: string, _stats?: fs.Stats): void => {
      const fileRelativePath = path.relative(this.watchPathBase, filePath);
      const fileAbsolutePath = path.join(this.watchPathBase, fileRelativePath);
      const metaFileAbsolutePath = `${fileAbsolutePath}.meta`;
      const fileName = path.basename(fileAbsolutePath);
      const fileNameBase = path.parse(fileAbsolutePath).name;
      const fileExtension = path.extname(fileRelativePath);
      const fileMimeType = getTwCustomMimeType(fileExtension);
      this.debugLog(`${fileRelativePath} ${changeType}`);
      if (this.lockedFiles.has(fileRelativePath)) {
        this.debugLog(`${fileRelativePath} ignored due to mutex lock`);
        // release lock as we have already finished our job
        this.lockedFiles.delete(fileRelativePath);
        return;
      }
      // on create or modify
      if (changeType === 'add' || changeType === 'change') {
        // get tiddler from the disk
        /**
         * tiddlersDescriptor:
         * {
         *    "filepath": "Meme-of-LinOnetwo/tiddlers/$__StoryList.tid",
         *    "type": "application/x-tiddler",
         *    "tiddlers": [
         *      {
         *        "title": "$:/StoryList",
         *        "list": "Index"
         *      }
         *    ],
         *    "hasMetaFile": false
         *  }
         */
        let tiddlersDescriptor;

        // on creation of non-tiddler file, for example, .md and .png file, we create a .meta file for it
        const isCreatingNewNonTiddlerFile = changeType === 'add' && !fileExtension.endsWith('tid') && !fs.existsSync(metaFileAbsolutePath);
        if (isCreatingNewNonTiddlerFile) {
          const createdTime = toTWUTCString(new Date());
          this.debugLog(`Adding meta file ${metaFileAbsolutePath} using mime type ${fileMimeType}`);
          fs.writeFileSync(
            metaFileAbsolutePath,
            `caption: ${fileNameBase}\ncreated: ${createdTime}\nmodified: ${createdTime}\ntitle: ${fileName}\ntype: ${fileMimeType}\n`,
          );
        }
        // sometimes this file get removed by wiki before we can get it, for example, Draft tiddler done editing, it get removed, and we got ENOENT here
        try {
          tiddlersDescriptor = $tw.loadTiddlersFromFile(fileAbsolutePath);
        } catch (error) {
          this.debugLog(error);
          return;
        }

        // need to delete original created file, because tiddlywiki will try to recreate a _1 file
        if (isCreatingNewNonTiddlerFile) {
          fs.unlinkSync(fileAbsolutePath);
          fs.unlinkSync(metaFileAbsolutePath);
        }

        this.debugLog(`tiddlersDescriptor`, safeStringifyHugeTiddler(tiddlersDescriptor, fileExtension));
        const { tiddlers, ...fileDescriptor } = tiddlersDescriptor;
        // if user is using git or VSCode to create new file in the disk, that is not yet exist in the wiki
        // but maybe our index is not updated, or maybe user is modify a system tiddler, we need to check each case
        if (!this.filePathExistsInIndex(fileRelativePath)) {
          tiddlers.forEach((tiddler) => {
            // check whether we are rename an existed tiddler
            this.debugLog('getting new tiddler.title', tiddler.title);
            const existedWikiRecord = $tw.wiki.getTiddler(tiddler.title);
            if (existedWikiRecord && deepEqual(tiddler, existedWikiRecord.fields)) {
              // because disk file and wiki tiddler is identical, so this file creation is triggered by wiki.
              // We just update the index.
              // But it might also be user changing the name of the file, so filename to be different with the actual tiddler title, while tiddler content is still same as old one
              // We allow filename to be different with the tiddler title, but we need to handle this in the inverse index to prevent the error that we can't get tiddler from index by its path
              this.debugLog('deepEqual with existed tiddler, tiddler.title: ', tiddler.title);
              // if (
              //   fileDescriptor.tiddlerTitle &&
              //   fileDescriptor.tiddlerTitle !== `${tiddler.title}.tid` &&
              //   fileDescriptor.tiddlerTitle !== tiddler.title
              // ) {
              //   // We have no API in tw to inform $tw about we have a file changed its name, but remain its tiddler title
              //   // because to do that now we have to use `$tw.syncadaptor.wiki.addTiddler(tiddler);`, which will create a new file with the title we pass to it, it can't assign a disk file name while create a new tiddler
              //   throw new Error('Rename filename is not supported, please submit your idea to improve this logic');
              //   // updateInverseIndex(fileRelativePath, { ...fileDescriptor, tiddlerTitle: tiddler.title });
              // } else {
              this.updateInverseIndex(fileRelativePath, { ...fileDescriptor, tiddlerTitle: tiddler.title });
              // }
            } else {
              this.debugLog(
                'get new addTiddler tiddler.title',
                tiddler.title,
              );
              this.updateInverseIndex(fileRelativePath, { ...fileDescriptor, tiddlerTitle: tiddler.title });
              $tw.syncadaptor.wiki.addTiddler(tiddler);
            }
          });
        } else {
          // if it already existed in the wiki, this change might 1. due to our last call to `$tw.syncadaptor.wiki.addTiddler`; 2. due to user change in git or VSCode
          // so we have to check whether tiddler in the disk is identical to the one in the wiki, if so, we ignore it in the case 1.
          tiddlers
            .filter((tiddler) => {
              this.debugLog('updating existed tiddler', tiddler.title);
              const tiddlerInWiki = $tw.wiki.getTiddler(tiddler.title)?.fields;
              if (tiddlerInWiki === undefined) {
                return true;
              }
              if (deepEqual(tiddler, tiddlerInWiki)) {
                this.debugLog('Ignore update due to detect this is a change from the Browser', tiddler.title);
                return false;
              }
              // if user is continuously editing, after last trigger of listener, we have waste too many time in fs, and now $tw.wiki.getTiddler get a new tiddler that is just updated by user from the wiki
              // then our $tw.loadTiddlersFromFile's tiddler will have an old timestamp than it, ignore this case, since it means we are editing from the wiki
              // if both are created before, and just modified now
              if (tiddler.modified && tiddlerInWiki.modified && tiddlerInWiki.modified > tiddler.modified) {
                this.debugLog('Ignore update due to there is latest change from the Browser', tiddler.title);
                return false;
              }

              this.debugLog('Saving updated', tiddler.title);
              return true;
            })
            // then we update wiki with each newly created tiddler
            .forEach((tiddler) => {
              $tw.syncadaptor.wiki.addTiddler(tiddler);
            });
        }
      }

      // on delete
      if (changeType === 'unlink') {
        const tiddlerTitle = this.getTitleByPath(fileRelativePath);

        // if this tiddler is not existed in the wiki, this means this deletion is triggered by wiki
        // we only react on event that triggered by the git or VSCode
        const existedTiddlerResult = $tw.wiki.getTiddler(tiddlerTitle);
        this.debugLog('existedTiddlerResult', existedTiddlerResult && safeStringifyHugeTiddler(existedTiddlerResult, fileExtension));
        if (!existedTiddlerResult) {
          this.debugLog('file already deleted by wiki', fileAbsolutePath);
          this.updateInverseIndex(fileRelativePath, undefined);
        } else {
          // now event is triggered by the git or VSCode
          // ask tiddlywiki to delete the file, we first need to create a fake file for it to delete
          // can't directly use $tw.wiki.syncadaptor.deleteTiddler(tiddlerTitle);  because it will try to modify fs, and will failed:
          /* Sync error while processing delete of 'blabla': Error: ENOENT: no such file or directory, unlink '/Users//Desktop/repo/wiki/Meme-of-LinOnetwo/tiddlers/blabla.tid'
          syncer-server-filesystem: Dispatching 'delete' task: blabla
          Sync error while processing delete of 'blabla': Error: ENOENT: no such file or directory, unlink '/Users//Desktop/repo/wiki/Meme-of-LinOnetwo/tiddlers/blabla.tid' */
          this.lockedFiles.add(fileRelativePath);
          this.debugLog('trying to delete', fileAbsolutePath);
          fs.writeFile(fileAbsolutePath, '', {}, () => {
            // we may also need to provide a .meta file for wiki to delete
            if (!fileAbsolutePath.endsWith('.tid')) {
              fs.writeFileSync(metaFileAbsolutePath, '');
            }
            $tw.syncadaptor.wiki.deleteTiddler(tiddlerTitle);
            // sometime deleting system tiddler will result in an empty file, we need to try delete that empty file
            try {
              if (
                fileAbsolutePath.startsWith('$') &&
                fs.existsSync(fileAbsolutePath) &&
                fs.readFileSync(fileAbsolutePath, 'utf-8').length === 0
              ) {
                fs.unlinkSync(fileAbsolutePath);
              }
            } catch (error) {
              console.error(error);
            }
            this.updateInverseIndex(fileRelativePath, undefined);
          });
        }
      }

      // refreshCanSyncState();
    };

    this.watcher.on('all', listener);
  }
}
