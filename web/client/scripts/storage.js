/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util", 
        "../scripts/merge", 
        "../scripts/remote-null",
        "../scripts/remote-dropbox",
        "../scripts/remote-onedrive2",
        "../scripts/remote-http",
        "../scripts/picker",
        ], function(Promise,Util,merge,NullRemote,Dropbox,Onedrive,HttpRemote,Picker) {


var Encoding = {
  Base64: "base64",
  Utf8: "utf-8",

  decode: function( enc, text ) {
    if (enc===Encoding.Base64) {
      return Util.decodeBase64(text);
    }
    else {
      return text;
    }
  },

  encode: function( enc, data ) {
    if (!data) return "";
    if (enc===Encoding.Base64) {
      if (data instanceof ArrayBuffer) 
        return Util.encodeBase64(data);
      else
        return window.btoa(data);
    }
    else if (typeof data === "object") {
      return JSON.stringify(data);
    }
    else {
      return data;
    }
  },

  fromExt: function(fpath) {
    var mime = Util.mimeFromExt(fpath);
    return (Util.isTextMime(mime) ? Encoding.Utf8 : Encoding.Base64);
  },
};



function picker( storage, params ) {
  if (storage && !storage.isSynced() && (params.command !== "save" && params.command !== "connect" && params.command !== "push" && params.command !== "message")) params.alert = "true";
  return Picker.show(params).then( function(res) {
    if (params.command === "message") return null;
    if (!res || !res.path) throw new Error("canceled");

    var folder = Util.dirname(res.path);
    var fileName = Util.basename(res.path);
    if (Util.extname(res.path) == "" && (params.command === "save" || params.command === "new" || params.command==="push")) {
      folder = res.path;
      fileName = Util.basename(res.path) + ".mdk";
    }
    var remote = unpersistRemote( res.remote, { folder: folder } );
    if (!remote) throw new Error("canceled");
    return { storage: new Storage(remote), docName: fileName, template: res.template }
  });
}

function openFile(storage) {
  var params = {
    command: "open",   
    extensions: ".mdk .md .madoko .mkdn", 
  }
  if (storage && storage.remote.type() !== "null") {
    params.remote = storage.remote.type();
    params.folder = storage.remote.getFolder();
  }

  return picker( storage, params);
}

function createFile(storage) {
  var params = {
    command: "new", 
  }
  if (storage && storage.remote.type() !== "null") {
    params.remote = storage.remote.type();
    params.folder = storage.remote.getFolder();
  }
  return picker(storage, params).then( function(res) {
    if (!res) return null;
    return createFromTemplate( res.storage, res.docName, res.template ).then( function(content) {
      return res;
    });
  });
}

function createFromTemplate( storage, docName, template )
{
  if (!template) template = "default";
  return Util.requestGET( "templates/" + template + ".mdk" ).then( function(content) {
    return content;
  }, function(err) {
    var elem = document.getElementById("template-" + template);
    if (!elem) elem = document.getElementById("template-default");
    return (elem ? elem.textContent : "");
  }).then( function(content) {
    storage.writeFile(docName, content);      
    return content;
  });
}

function checkConnected(remote) {
  if (!remote.connected()) return Promise.resolved(false);
  return remote.getUserName().then( function(userName) {
    return (userName != null);
  }, function(err) {
    if (err.httpCode === 401) { // access token expired
      remote.logout();
      return false;
    }
    else {
      return false;
    }
  });
}

function connect(storage) {
  if (!storage) return Promise.resolved();
  var params = {
    command: "connect"
  }
  if (storage.remote.type() !== "null") {
    params.remote = storage.remote.type();
  }
  return picker(storage,params).then( function(res) {
    return;
  }, function(err) {
    return;
  });
}

function discard(storage,docName) {
  var params = {
    command: "alert",
    alert: "true",
    header: Util.escape(Util.combine(storage.folder(),docName))
  };
  if (storage.remote.type() !== "null") {
    params.remote = storage.remote.type();
    params.headerLogo = "images/dark/" + storage.remote.logo();
  }
  return picker(storage,params).then( function(res) {
    return true;
  }, function(err) {
    return false;
  });
}

function httpOpenFile(url,doc) {  
  return HttpRemote.openFile(url).then( function(remote) {
    return { storage: new Storage(remote), docName: doc };
  });
}

function createNullStorage() {
  return new Storage( new NullRemote.NullRemote() );
}

function serverGetInitialContent(fpath) {
  if (!Util.extname(fpath)) fpath = fpath + ".mdk";
  if (!Util.isRelative(fpath)) throw new Error("can only get initial content for relative paths");
  return Util.requestGET( { url: fpath,  binary: Util.hasImageExt(fpath) } );
}

function unpersistRemote(remoteType,obj) {
  if (obj && remoteType) {
    if (remoteType===Onedrive.type()) {
      return Onedrive.unpersist(obj);
    }
    else if (remoteType===Dropbox.type()) {
      return Dropbox.unpersist(obj);
    }
    else if (remoteType===HttpRemote.type()) {
      return HttpRemote.unpersist(obj);
    }
  }
  return NullRemote.unpersist();
}
  
function unpersistStorage( obj ) {
  var remote = unpersistRemote( obj.remoteType, obj.remote );
  var storage = new Storage(remote);
  storage.files = Util.unpersistMap( obj.files );
  // be downward compatible with old storage..
  storage.files.forEach( function(fpath,file) {
    if (file.kind) {
      file.encoding = Encoding.fromExt(fpath);
      file.mime = Util.mimeFromExt(fpath);
      delete file.url;
    }
    if (typeof file.createdTime === "string") {
      file.createdTime = new Date(file.createdTime);
    }
    else if (!file.createdTime) {
      file.createdTime = new Date(0);
    }
    delete file.generated;
  });
  return storage;
}


function newOnedriveAt( folder ) {
  return Onedrive.createAt( folder );
}

function newDropboxAt( folder ) {
  return Dropbox.createAt(folder);
}

function saveAs( storage, docName ) {
  var stem = Util.stemname(docName);
  var params = {
    command: "save",
    file: (stem === Util.basename(Util.dirname(docName)) ? stem : Util.basename(docName)),
  }
  if (storage && storage.remote.type() !== "null") {
    params.remote = storage.remote.type();
    params.folder = Util.dirname(docName);
    params.file   = Util.stemname(docName);
  }
  return picker( storage, params).then( function(res) {
    if (!res) return null; // cancel
    return saveTo( storage, res.storage, stem, Util.stemname(res.docName) );
  });
}

function saveTo(  storage, toStorage, docStem, newStem ) 
{
  var newStem = (newStem === docStem ? "" : newStem);
  var newName = (newStem ? newStem : docStem) + ".mdk";
  return toStorage.readFile( newName, false ).then( 
    function(file) {
      throw new Error( "cannot save, document already exists: " + Util.combine(toStorage.folder(), newName) );
    },
    function(err) {
      storage.forEachFile( function(file0) {
        var file = Util.copy(file0);
        file.modified = true;
        if (newStem) {
          file.path = file.path.replace( 
                          new RegExp( "(^|[\\/\\\\])(" + docStem + ")((?:[\\.\\-][\\w\\-\\.]*)?$)" ), 
                            "$1" + newStem + "$3" );
        }
        toStorage.files.set( file.path, file );
      });
      return toStorage.sync().then( function(){ return {storage: toStorage, docName: newName }; } );
    }
  );
}  


function publishSite(  storage, docName, indexName )
{
  var headerLogo = "images/dark/" + Dropbox.logo();
  var params = { 
      command: "push", 
      remote:"dropbox", 
      root:"/apps/Azure", 
      folder:"/apps/Azure/" + Util.stemname(docName), 
      file: "index.html",
      extensions: "folder .html .htm .aspx",
      headerLogo: headerLogo,
  };
  return picker( storage, params ).then( function(res) {
    var toStorage = res.storage;
    storage.forEachFile( function(file0) {
      var file = Util.copy(file0);
      file.modified = true;
      if (Util.startsWith(file.path, "out/") && (!Util.hasGeneratedExt(file.path) || Util.extname(file.path) === ".html")) {
        if (file.path === indexName) {
          file.path = res.docName;
        }
        else {
          file.path = file.path.substr(4);        
        }
        toStorage.files.set( file.path, file );
      }
    });
    return Promise.when( toStorage.files.elems().map( function(file) { 
      return toStorage.pushFile(file); 
    }) ).then( function() {
      var params = {
        command: "message",
        header: Util.escape(toStorage.folder()),
        headerLogo: headerLogo,
        message: 
            ["<p>Website saved.</p>",
            ,"<p></p>"
            ,"<p>Visit the <a target='azure' href='http://manage.windowsazure.com'>Azure web manager</a> to synchronize your website.</p>",
            ,"<p></p>"
            ,"<p>Or view this <a target='webcast' href='http://www.youtube.com/watch?v=hC1xAjz6jHI&hd=1'>webcast</a> to learn more about Azure website deployment from Dropbox.</p>"
            ].join("\n")
      };
      return picker( storage, params ).then( function() {
        return toStorage.folder();
      });
    });
  });
}  

function createSnapshotFolder(remote, docstem, stem, num ) {
  if (!stem) {
    var now = new Date();
    var month = now.getMonth()+1;
    var day   = now.getDate();
            
    stem = ["snapshot", docstem, 
            now.getFullYear().toString(),
            Util.lpad( month.toString(), 2, "0" ),
            Util.lpad( day.toString(), 2, "0" ),
           ].join("-");
  }
  var folder = stem + (num ? "-v" + num.toString() : "");

  return remote.createSubFolder(folder).then( function(info) {
    if (info.created) return info.folder;
    if (num && num >= 100) throw new Error("too many snapshot verions");  // don't loop forever...
    return createSnapshotFolder(remote,stem, (num ? num+1 : 2));
  });
}

function createSnapshot( storage, docName ) {
  return storage.remote.connect().then( function() {
    return createSnapshotFolder( storage.remote, Util.stemname(docName) );
  }).then( function(folder) {
    return storage.remote.createNewAt( folder );
  }).then( function(toRemote) {
    var toStorage = new Storage(toRemote);
    storage.forEachFile( function(file0) {
      var file = Util.copy(file0);
      file.modified = true;
      toStorage.files.set( file.path, file );
    });
    return toStorage.sync().then( function() {
      Util.message( "snapshot saved to: " + toStorage.folder(), Util.Msg.Info );
    });
  });
}

function isEditable(file) {
  return (Util.isTextMime(file.mime) && !Util.hasGeneratedExt(file.path));
}

function getEditPosition(file) {
  return (file.position || { lineNumber: 1, column: 1 });
}

function pushAtomic( fpath, time, release ) {
  return Util.requestPOST( "rest/push-atomic", {}, { name: fpath, time: time.toISOString(), release: (release ? true : false)  } );
}


var Storage = (function() {
  function Storage( remote ) {
    var self = this;
    self.remote    = remote;
    self.files     = new Util.Map();
    self.listeners = [];
    self.unique    = 1;
    // we only pull again from remote storage every minute or so..
    self.pullFails = new Util.Map();
    self.pullIval  = setInterval( function() { 
      self.pullFails.clear(); 
    }, 60000 );
  }

  Storage.prototype.destroy = function() {
    var self = this;
    self._fireEvent("destroy");
    self.listeners = [];
    if (self.pullIval) {
      clearInterval( self.pullIval );
      self.pullIval = 0;
    }
  }

  Storage.prototype.folder = function() {
    var self = this;
    return self.remote.getFolder();
  }

  Storage.prototype.persist = function(minimal) {
    var self = this;
    var pfiles = self.files.copy();
    pfiles.forEach( function(path,file) {
      if (file.nosync || (minimal && (!Util.isTextMime(file.mime) || Util.hasGeneratedExt(path)))) pfiles.remove(path);
    });
    
    return { 
      remote: self.remote.persist(), 
      remoteType: self.remote.type(),
      files: pfiles.persist(), 
    };
  };

  Storage.prototype.createSnapshot = function(docName) {
    var self = this;
    return createSnapshot(self,docName);
  }

  Storage.prototype.checkConnected = function() {
    var self = this;
    return checkConnected(self.remote);
  }

  /* Generic */
  Storage.prototype.forEachFile = function( action ) {
    var self = this;
    self.files.forEach( function(fname,file) {
      return action(file);
    });
  }

  Storage.prototype.isConnected = function() {
    var self = this;
    return (self.remote && self.remote.type() !== NullRemote.type() && self.remote.type() !== HttpRemote.type() );
  }

  Storage.prototype.isSynced = function(full) {
    var self = this;
    var synced = true;
    self.forEachFile( function(file) {
      if (file.modified && (full || !Util.hasGeneratedExt(file.path))) {
        synced = false;
        return false; // break
      }
    });
    return synced;
  }

  Storage.prototype.writeFile = function( fpath, content, opts ) {
    var self = this;    
    var file = self.files.get(fpath);
    opts = self._initFileOptions(fpath,opts);
    
    if (file) {
      // modify existing file
      if (file.content === content) return;
      file.encoding  = file.encoding || opts.encoding;
      file.mime      = file.mime || opts.mime;
      file.modified  = file.modified || (content !== file.content);
      file.content   = content;
      file.position  = opts.position || file.position;
      self._updateFile(file);
    }
    else {
      // create new file
      self._updateFile( {
        path      : fpath,
        encoding  : opts.encoding,
        mime      : opts.mime,
        content   : content,
        original  : content,
        createdTime: new Date(),
        modified  : false,
        position  : opts.position,
        nosync    : opts.nosync,
      });
    }
  }

  Storage.prototype.addEventListener = function( type, listener ) {
    if (!listener) return;
    var self = this;
    var id = self.unique++;
    var entry = { type: type, id: id };
    if (typeof listener === "object" && listener.handleEvent) {
      entry.listener = listener;
    }
    else {
      entry.action = listener;
    }
    self.listeners.push( entry );
    return id;
  }

  Storage.prototype.clearEventListener = function( id ) {
    var self = this;
    self.listeners = self.listeners.filter( function(listener) {
      return (listener && 
                (typeof id === "object" ? listener.listener !== id : listener.id !== id));
    });
  }

  // private
  Storage.prototype._updateFile = function( finfo ) {
    var self = this;
    Util.assert(typeof finfo==="object");
    finfo.path    = finfo.path || "unknown.mdk";
    finfo.content = finfo.content || "";
    finfo.encoding    = finfo.encoding || Encoding.fromExt(finfo.path);
    finfo.mime        = finfo.mime || Util.mimeFromExt(finfo.path);
    finfo.createdTime = finfo.createdTime || new Date();
    self._setUniqueId(finfo);

    // check same content
    // var file = self.files.get(fpath);
    // if (file && file.content === finfo.content) return;

    // update
    self.files.set(finfo.path,finfo);
    self.pullFails.remove(finfo.path);
    self._fireEvent("update", { file: finfo });
  }

  Storage.prototype._fireEvent = function( type, obj ) {
    var self = this;
    if (!obj) obj = {};
    if (!obj.type) obj.type = type;        
    self.listeners.forEach( function(listener) {
      if (listener) {
        if (listener.listener) {
          listener.listener.handleEvent(obj);
        }
        else if (listener.action) {
          listener.action(obj);
        }
      }
    });
  }

  Storage.prototype._initFileOptions = function( fpath, opts ) {
    var self = this;
    if (!opts) opts = {};
    if (!opts.encoding) opts.encoding = Encoding.fromExt(fpath);
    if (!opts.mime) opts.mime = Util.mimeFromExt(fpath);
    if (opts.searchDirs==null) opts.searchDirs = [];
    return opts;
  }

  Storage.prototype.setEditPosition = function(fpath,pos) {
    var self = this;
    var file = self.files.get(fpath);
    if (!file || !pos) return;
    file.position = pos;    
  }

  Storage.prototype.connect = function(dontForce) {
    var self = this;
    return self.remote.connect(dontForce);
  }

  Storage.prototype.getShareUrl = function(fpath) {
    var self = this;
    var file = self.files.get(fpath);
    return (file && file.shareUrl ? file.shareUrl : "");
    //return self.remote.getShareUrl(fpath);
  }

  Storage.prototype._pullFile = function( fpath, opts ) {
    var self = this;
    opts = self._initFileOptions(fpath,opts);
    return self.remote.pullFile(fpath,opts.encoding !== Encoding.Utf8).then( function(file) {
      file.path      = file.path || fpath;
      file.mime      = opts.mime;
      file.encoding  = opts.encoding;
      file.modified  = false;
      file.content   = Encoding.encode(opts.encoding,file.content);
      file.original  = file.content;
      file.position  = file.position || opts.position;
      self._setUniqueId(file)
      
      //file.uniqueId  = file.uniqueId || null;
      return file;
    });
  }

  Storage.prototype._setUniqueId = function(file) {
    var self = this;
    var root = "//" + self.remote.type() + "/" + file.path;
    file.uniqueId = root + "@" + (file.rev || file.createdTime.toISOString());
  }
  
  /* Interface */
  Storage.prototype._pullFileSearch = function( fbase, opts, dirs ) {
    var self = this;
    if (!dirs || dirs.length===0) return Promise.resolved(null);
    var dir = dirs.shift();
    return self._pullFile( Util.combine(dir,fbase), opts ).then( function(file) {
        return file;
      }, function(err) {
        if (dirs.length===0) return null;
        return self._pullFileSearch( fbase, opts, dirs );
      });
  }

  Storage.prototype.isModified = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    return (file ? file.modified : false);
  }

  Storage.prototype.getUniqueFileId = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    if (file && file.uniqueId) return file.uniqueId;
    var root = "//" + self.remote.type();    
    return "//" + self.remote.type() + "/" + self.folder() + "/" + fpath + (file ? "@" + file.createdTime.toISOString() : "");
  }


  Storage.prototype.readLocalFile = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    return (file ? file.content : "");
  }

  Storage.prototype.readFile = function( fpath, createOnErr, opts ) {  // : Promise<file>
    var self = this;
    var file = self.files.get(fpath);
    if (file) return Promise.resolved(file);

    //if (!fpath) throw new Error("no path:" + fpath)

    // prevent too many calls to remote storage... 
    if (!createOnErr && self.pullFails.contains(fpath)) return Promise.rejected(new Error("cannot find file: " + fpath));

    opts = self._initFileOptions(fpath,opts);
    var dirs = [Util.dirname(fpath)].concat(opts.searchDirs);
    return self._pullFileSearch( Util.basename(fpath), opts, dirs ).then( function(file) {      
      if (file) {
        self._updateFile( file );
        return file;
      }
      else  {
        function noContent() {
          if (createOnErr) {
            self.writeFile(fpath,"",opts);
            return self.files.get(fpath);            
          }
          else {
            self.pullFails.set(fpath,true);
            throw new Error("cannot find file: " + fpath);
          }
        }

        // only try standard style if necessary
        if (!Util.hasEmbedExt(fpath) && Util.extname(fpath) !== ".png") {
          return noContent();
        }

        // try to find the file as a madoko standard style on the server..
        var spath = "styles/" + fpath;
        var opath = "out/" + fpath;
        if (Util.extname(fpath) === ".json" && !Util.dirname(fpath)) spath = "styles/lang/" + fpath;
        if (Util.extname(fpath) === ".png") opath = fpath;

        return serverGetInitialContent(spath).then( function(content,req) {
            if (!content) return noContent();
            if (Util.extname(fpath)===".json") content = req.responseText;
            opts.nosync = true;
            self.writeFile(opath,Encoding.encode(opts.encoding, content),opts);
            return self.files.get(opath);
          },
          function(err) {
            Util.message( err, Util.Msg.Exn );
            return noContent();
          });
      }      
    });    
  }

  function isRoot( fpath, roots ) {
    if (Util.contains(roots,fpath)) return true;
    if (Util.firstdirname(fpath) === "out") {  // so "out/madoko.css" is not collected
      if (Util.contains(roots,fpath.substr(4))) return true;
    }
    if (Util.extname(fpath) === ".pdf" || Util.extname(fpath) === ".html" || Util.extname(fpath) === ".tex") return true;
    return false;
  }

  Storage.prototype.collect = function( roots ) {
    var self = this;
    self.forEachFile( function(file) {
      if (!isRoot(file.path,roots) && 
          (!file.content || !isEditable(file) || !file.modified) ) {
        self._removeFile(file.path);
      }
    });
  }

  Storage.prototype._removeFile = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    if (file == null) return;
    self.files.remove(fpath);
    self._fireEvent("delete", { file: file }); 
  }

  Storage.prototype.existsLocal = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    return (file != null);
  }

  var rxConflicts = /^ *<!-- *begin +merge +.*?--> *$/im;

  Storage.prototype.sync = function( diff, cursors ) {
    var self = this;
    var remotes = new Util.Map();

    return self.connect(self.isSynced()).then( function() {      
      var syncs = self.files.elems().map( function(file) { return self._syncFile(diff,cursors,file); } );
      return Promise.when( syncs ).then( function(res) {
        res.forEach( function(msg) {
          if (msg) Util.message(msg, Util.Msg.Trace);
        });
        Util.message("synchronized with cloud storage", Util.Msg.Info );
      });
    });
  }

  Storage.prototype._syncFile = function(diff,cursors,file) {  // : Promise<string>
    var self = this;
    if (file.nosync) return Promise.resolved( self._syncMsg(file,"no sync") );
    return self.remote.getRemoteTime( file.path ).then( function(remoteTime) {
      if (!remoteTime) {
        remoteTime = new Date(0);
      }
      if (file.createdTime.getTime() < remoteTime.getTime()) {
        return self._pullFile(file.path, file).then( function(remoteFile) {
          return self._syncPull(diff,cursors,file,remoteFile);
        });
      }
      else {
        return self._syncPush(file,remoteTime);
      }
    }).then( function(res) {
      if (!file.shareUrl && (file.mime === "application/pdf" || file.mime === "text/html")) {
        return self.remote.getShareUrl( file.path ).then( function(url) {
          file.shareUrl = url;
          return res;
        })
      }
      else return res;
    });
  }

  Storage.prototype.pushFile = function( file ) {
    var self = this;
    return self.remote.pushFile(file.path, Encoding.decode( file.encoding, file.content ));
  }

  Storage.prototype._syncPush = function(file,remoteTime) {
    var self = this;
    // file.createdTime >= remoteTime
    if (file.createdTime.getTime() === remoteTime.getTime() && !file.modified) {
      // nothing to do
      return self._syncMsg(file,"up-to-date");
    }
    else if (remoteTime.getTime() === 0 && file.content === "") {  
      // deleted on server and no content: don't sync
      return self._syncMsg(file,"up-to-date (empty and removed on server)");
    }
    else if (Util.isTextMime(file.mime) && rxConflicts.test(file.content)) {
      // don't save files with merge conflicts
      throw new Error( self._syncMsg(file,"cannot save to server: resolve merge conflicts first!", "save to server") );
    }
    else {
      // write back the client changes
      return pushAtomic( file.uniqueId, remoteTime ).then( function() {
        // note: if the remote file is deleted and the local one unmodified, we may choose to delete locally?
        var file0 = Util.copy(file);
        return self.pushFile( file0 ).then( function(info) {
          //newFile.modified = false;
          var file1 = self.files.get(file.path);
          if (file1) { // could be deleted in the mean-time?
            file1.original = file0.content;
            file1.modified = (file1.content !== file0.content); // could be modified in the mean-time
            file1.createdTime = info.createdTime;
            file1.rev         = info.rev;
            self._updateFile(file1);
          }
          if (remoteTime.getTime() == info.createdTime.getTime()) {  // this happens if the file equal and not updated on the server; release our lock in that case
            return pushAtomic( file0.uniqueId, remoteTime, true ).then( function () {
              return self._syncMsg(file, "saved to server (unmodified)");     
            });
          }
          else return self._syncMsg(file, "saved to server"); 
        });
      }, function(err) {
        if (err.httpCode == 409) 
          throw new Error( self._syncMsg(file,"cannot save to server: file was saved concurrently by another user!", "save to server") );
        else 
          throw err;
      });
    }
  }

  Storage.prototype._syncPull = function(diff,cursors,file,remoteFile) {
    var self = this;
    var canMerge = isEditable(file); // Util.isTextMime(file.mime);
    // file.createdTime < remoteFile.createdTime
    if (file.modified && canMerge) {
      if (rxConflicts.test(file.content)) {
        throw new Error( self._syncMsg(file, "cannot update from server: resolve merge conflicts first!", "update from server" ));
      }
      return self._syncMerge(diff,cursors,file,remoteFile);
    }
    else {
      // overwrite with server content
      if (!canMerge && file.modified) {
        Util.message( "warning: binary- or generated file modified on server and client, overwrite local one: " + file.path, Util.Msg.Warning );
      }
      self._updateFile( remoteFile );
      return self._syncMsg( remoteFile, "update from server");
    }
  }

  Storage.prototype._syncMerge = function(diff,cursors,file,remoteFile) {
    var self = this;
    var original = (file.original != null ? file.original : file.content);
    var content  = file.content;
    return merge.merge3(diff, null, cursors["/" + file.path] || 1, 
                        original, remoteFile.content, file.content).then( 
      function(res) {
        self._fireEvent("flush", { path: file.path }); // save editor state
        if (content !== file.content) {
          // modified in the mean-time!
          throw new Error( self._syncMsg(file,"merged from server, but modified in the mean-time","merge from server"));
        }
        if (cursors["/" + file.path]) {
          cursors["/" + file.path] = res.cursorLine;
        }
        if (res.conflicts) {
          // don't save if there were real conflicts
          remoteFile.original = file.orginal; // so next merge does not get too confused
          remoteFile.content  = res.merged;
          remoteFile.modified = true;
          self._updateFile(remoteFile);
          throw new Error( self._syncMsg( file, "merged from server but cannot save: resolve merge conflicts first!", "merge from server") );
        }
        else {
          // write back merged result
          var file0 = Util.copy(remoteFile);
          file0.content  = res.merged;
          file0.modified = true;
          self._updateFile(file0);
          return pushAtomic(file0.uniqueId, remoteFile.createdTime).then( function() {
            return self.pushFile(file0).then( function(info) {
              var file1 = self.files.get(file.path);
              if (file1) { // could be deleted?
                file1.modified    = (file1.content !== file0.content); // could be modified in the mean-time
                file1.createdTime = info.createdTime;
                file1.rev         = info.rev
                file1.original    = file0.content;
                self._updateFile(file1);
              }
              if (remoteFile.createdTime.getTime() == info.createdTime.getTime()) {  // this happens if the file equal and not updated on the server; release our lock in that case
                return pushAtomic( file.uniqueId, remoteFile.createdTime, true ).then( function () {
                  return self._syncMsg(file, "merge from server (unmodified)");     
                });
              }
              else return self._syncMsg(file, "saved to server"); 
              return self._syncMsg( file, "merge from server" );
            });
          }, function(err) {
            if (err.httpCode == 409) 
              throw new Error( self_syncMsg( file, "merged from server but cannot save: file was saved concurrently by another user", "merge from server" ) );
            else 
              throw err;
          });
        }
      }
    );
  }

  Storage.prototype._syncMsg = function( file, msg, action ) {
    var self = this;
    return file.path + (action ? ": " + action : "") + (msg ? ": " + msg : "");
  }

  return Storage;
})();
  

return {
  openFile: openFile,
  createFile: createFile,
  connect: connect,
  discard: discard,
  saveAs: saveAs,
  httpOpenFile    : httpOpenFile,
  createNullStorage: createNullStorage,
  createFromTemplate: createFromTemplate,
  
  Storage         : Storage,
  unpersistStorage: unpersistStorage,  
  Encoding        : Encoding,
  isEditable      : isEditable,
  getEditPosition : getEditPosition,

  publishSite     : publishSite,
}

});