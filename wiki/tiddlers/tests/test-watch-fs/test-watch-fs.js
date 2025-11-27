(function() {

  /*jslint node: true, browser: true */
  /*global $tw: false, describe: false, it: false, expect: false, spyOn: false, beforeAll: false, beforeEach: false */
  "use strict";

  describe("watch-fs FileSystemMonitor", function() {

    if (!$tw.node) return;

    var FileSystemMonitorModule;
    var chokidar;
    var path = require("path");
    var mockWatcher;

    beforeAll(function() {
      FileSystemMonitorModule = require("$:/plugins/linonetwo/watch-fs/FileSystemMonitor.js").FileSystemMonitor;
      chokidar = require('$:/plugins/linonetwo/watch-fs/chokidar.js').default;
    });

    // Create a fresh mock for every single test
    beforeEach(function() {
      mockWatcher = {
        on: jasmine.createSpy("watcher.on"),
               close: jasmine.createSpy("watcher.close")
      };
    });

    it("should update $tw.boot.files BEFORE adding tiddler to prevent duplicate _1 files", function() {
      spyOn(chokidar, "watch").and.returnValue(mockWatcher);
      spyOn($tw.syncadaptor.wiki, "addTiddler");
      spyOn($tw, "loadTiddlersFromFile").and.returnValue({
        tiddlers: [{ title: "New_Tiddler_Test", text: "content" }],
        filepath: "/mock/path/New_Tiddler_Test.tid",
        type: "text/vnd.tiddlywiki"
      });

      var monitor = new FileSystemMonitorModule();

      // Use mostRecent() to ensure we get the listener from *this* test instance
      var listener = mockWatcher.on.calls.mostRecent().args[1];

      var mockPath = "/mock/path/New_Tiddler_Test.tid";
      listener("add", mockPath);

      expect($tw.boot.files["New_Tiddler_Test"]).toBeDefined();
      expect($tw.syncadaptor.wiki.addTiddler).toHaveBeenCalled();

      delete $tw.boot.files["New_Tiddler_Test"];
    });

    it("should clean up $tw.boot.files when a file is deleted", function() {
      spyOn(chokidar, "watch").and.returnValue(mockWatcher);
      spyOn($tw.wiki, "deleteTiddler");
      spyOn($tw.syncadaptor, "removeTiddlerFileInfo");

      // Mock getTiddler to return a fake tiddler so the plugin proceeds with deletion
      spyOn($tw.wiki, "getTiddler").and.callFake(function(title) {
        if (title === "Test_Delete") {
          return { fields: { title: "Test_Delete" } };
        }
        return null;
      });

      var monitor = new FileSystemMonitorModule();
      monitor.inverseFilesIndex["Test_Delete.tid"] = { tiddlerTitle: "Test_Delete" };

      var listener = mockWatcher.on.calls.mostRecent().args[1];

      // Construct full path using the monitor's actual base path
      var mockFullPath = path.join(monitor.watchPathBase, "Test_Delete.tid");

      listener("unlink", mockFullPath);

      expect($tw.wiki.deleteTiddler).toHaveBeenCalledWith("Test_Delete");
      expect($tw.syncadaptor.removeTiddlerFileInfo).toHaveBeenCalledWith("Test_Delete");
    });

    it("should handle multiple rapid file deletions correctly", function() {
      spyOn(chokidar, "watch").and.returnValue(mockWatcher);
      spyOn($tw.wiki, "deleteTiddler");
      spyOn($tw.syncadaptor, "removeTiddlerFileInfo");

      // Mock getTiddler for BOTH files
      spyOn($tw.wiki, "getTiddler").and.callFake(function(title) {
        if (title === "File_A" || title === "File_B") {
          return { fields: { title: title } };
        }
        return null;
      });

      // Initialize Monitor (This triggers mockWatcher.on)
      var monitor = new FileSystemMonitorModule();

      var listener = mockWatcher.on.calls.mostRecent().args[1];

      // Populate the index so the plugin recognizes the files
      monitor.inverseFilesIndex["File_A.tid"] = { tiddlerTitle: "File_A" };
      monitor.inverseFilesIndex["File_B.tid"] = { tiddlerTitle: "File_B" };

      // Simulate "Simultaneous" Events
      // We assume paths are relative or absolute based on your OS, usually relative works if watchPathBase is set correctly
      listener("unlink", path.join(monitor.watchPathBase, "File_A.tid"));
      listener("unlink", path.join(monitor.watchPathBase, "File_B.tid"));

      // Verify
      expect($tw.wiki.deleteTiddler).toHaveBeenCalledWith("File_A");
      expect($tw.wiki.deleteTiddler).toHaveBeenCalledWith("File_B");
      expect($tw.wiki.deleteTiddler).toHaveBeenCalledTimes(2);
    });

  });

})();
