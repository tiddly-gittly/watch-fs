const tw = require('tiddlywiki');

const $tw = tw.TiddlyWiki();
// $tw.boot.argv = ['--version'];
$tw.boot.argv = ['.\\wiki'];
$tw.boot.boot(() => {
  const result = $tw.loadTiddlersFromFile('.\\wiki\\tiddlers\\$__DefaultTiddlers.tid');
  // DEBUG: console result
  console.log(`result`, result);
  // DEBUG: console $tw.boot.files
  console.log(`$tw.boot.files`, $tw.boot.files);
});
