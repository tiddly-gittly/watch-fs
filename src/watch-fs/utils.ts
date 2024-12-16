import { getType } from 'mime';
import path from 'path';
import { ITiddlersInFile, SourceIterator, Tiddler } from 'tiddlywiki';

export function pad(number: number) {
  if (number < 10) {
    return `0${number}`;
  }
  return String(number);
}
export function toTWUTCString(date: Date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${
    pad(
      date.getUTCHours(),
    )
  }${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}${
    (date.getUTCMilliseconds() / 1000)
      .toFixed(3)
      .slice(2, 5)
  }`;
}

export function safeStringifyHugeTiddler(tiddlerToStringify: ITiddlersInFile | Tiddler, fileExtensionOfTiddler: string) {
  if (fileExtensionOfTiddler === 'tid') {
    return JSON.stringify(tiddlerToStringify, undefined, '  ');
  }
  // shorten text in the list of tiddlers, in case of text is a png image
  if ('tiddlers' in tiddlerToStringify && Array.isArray(tiddlerToStringify.tiddlers)) {
    return JSON.stringify(
      {
        ...tiddlerToStringify,
        tiddlers: tiddlerToStringify.tiddlers.map((tiddler) => ({
          ...tiddler,
          text: tiddler.text?.length < 1000 ? tiddler.text : `${tiddler?.text?.substring(0, 1000)}\n\n--more-log-ignored-by-watch-fs-plugin--`,
        })),
      },
      undefined,
      '  ',
    ).substring(0, 2000);
  }
  return JSON.stringify(tiddlerToStringify, undefined, '  ').substring(0, 1000);
}

/**
 * Given a tiddler title and an array of existing filenames, generate a new legal filename for the title,
 * case insensitively avoiding the array of existing filenames
 *
 * Modified from TW-Bob's FileSystem/MultiWikiAdaptor.js
 *
 * @param {string} title
 */
export function generateTiddlerBaseFilepath(title: string) {
  let baseFilename;
  // Check whether the user has configured a tiddler -> pathname mapping
  const pathNameFilters = $tw.wiki.getTiddlerText('$:/config/FileSystemPaths');
  if (pathNameFilters) {
    const source = $tw.wiki.makeTiddlerIterator([title]);
    baseFilename = findFirstFilter(pathNameFilters.split('\n'), source);
    if (baseFilename) {
      // Interpret "/" and "\" as path separator
      baseFilename = baseFilename.replace(/\/|\\/g, path.sep);
    }
  }
  if (!baseFilename) {
    // No mappings provided, or failed to match this tiddler so we use title as filename
    baseFilename = title.replace(/\/|\\/g, '_');
  }
  // Remove any of the characters that are illegal in Windows filenames
  baseFilename = $tw.utils.transliterate(baseFilename.replace(/<|>|:|"|\||\?|\*|\^/g, '_'));
  // Truncate the filename if it is too long
  if (baseFilename.length > 200) {
    baseFilename = baseFilename.substr(0, 200);
  }
  return baseFilename;
}

export function findFirstFilter(filters: string[], source?: SourceIterator | undefined) {
  for (const filter of filters) {
    const result = $tw.wiki.filterTiddlers(filter, undefined, source);
    if (result.length > 0) {
      return result[0];
    }
  }
  return null;
}

export function getTwCustomMimeType(fileExtension: string) {
  let officialMimeType = getType(fileExtension);
  if (officialMimeType === 'text/markdown') {
    officialMimeType = 'text/x-markdown';
  }
  return officialMimeType;
}
