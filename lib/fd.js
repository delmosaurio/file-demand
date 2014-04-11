/*!
 * file-demand
 *
 * Copyright(c) 2014 Delmo Carrozzo <dcardev@gmail.com>
 * MIT Licensed
 */

var fs = require("graceful-fs")
  , path = require("path")
  , mkdirp = require("mkdirp")
  , extend = require("extend")
  , Store = require("./store")

/**
 * 
 * Initialize a new FileDemand with `conf`.
 *
 * @param {String} dir
 * @param {Object} conf
 */
var FileDemand = module.exports = function(dir, conf) {
  var self = this

  if(false === (self instanceof FileDemand)) {
    return new FileDemand()
  }

  self.version = require("../package.json").version

  // initialize de store
  self.objects = {}
  self.root = path.resolve(dir)

  if (!fs.existsSync(self.root))
    throw new Error("The root path `" + self.root + "` not exists")

  self.store = Store(conf)

  // set configs
  self.config(conf)

  process.on("exit",function(){
    self.store.stop()
    if (self.process.length === 0) return

    var reg = new RegExp("(" + self.process.join("|") + ")", "ig")

    var tosave = Object.keys(self.store.cache).filter(function(key){
      return self.store.cache[key].mode.match(reg)
    })

    tosave.forEach(function(key){
      var obj = self.store.cache[key]
      var content = obj.content
      
      if (obj.json === true)
        content = JSON.stringify(content)

      fs.writeFileSync(key, content)
    })
    
  })

  return self
}

/**
 *  
 * Configure the FileDemand instance
 *
 * @param {Object} conf
 */
FileDemand.prototype.config = function(conf) {
  var self = this
  conf = conf || {}

  self.process = (conf.process !== undefined) ? conf.process : true
  self.exted = (conf.exted !== undefined) ? conf.exted : false
  self.encoding = conf.encoding || 'utf-8'

  self.cache = extend(false, 
                      { expire:((1000 * 60) * 10 ), length: 20  },
                      conf.cache || {}
                     )
 
  self.store.config(conf)

  return self
}

/**
 *  
 * Register a new object
 *
 */
FileDemand.prototype.add = function() {
  var self = this

  if (arguments.length === 2) {
    return self.__add(arguments[0], arguments[1])
  }

  if (arguments.length === 1 && arguments[0] instanceof Array) {
    arguments[0].forEach(function(obj){
      self.__add(obj.key, obj)
    })
  }

  return self
}

// add function implementation
FileDemand.prototype.__add = function(key, obj) {
  var self = this

  if (self.objects[key] !== undefined) 
    throw new Error("The key `" + key + "` already exists")
  
  if (obj.type === undefined || !obj.type.match(/(file|folder)/g))
      throw new Error("Invalid object type `" + obj.type + "`")

  obj.key = key
  self.objects[key] = obj

  return self
}

/**
 *  
 * Resolve paths
 *
 */
FileDemand.prototype.resolve = function(key, args) {
  var self = this

  var fargs = Array.prototype.slice.call(arguments, 0);

  key = fargs[0]

  var obj = self.objects[key]
  if (obj === undefined || obj === null)
    throw new Error("The key `" + key + "` not found")

  if (obj.type === "file")
    return path.join(self.root, obj.name)

  // is a folder
  //if (obj.type === "folder")
  var paths = fargs.slice(1)
  if (paths.length === 0) 
    return path.join(self.root, obj.name)

  var tojoin = [self.root, obj.name].concat(paths)

  return path.join.apply(self, tojoin)
}

/**
 *  
 * Initialize folders and files
 * the json statics and json dinamics
 * will be extended defined at `exted`
 * when demand the file
 *
 * NOTE: with exted=true all json files will be readed
 *
 */
FileDemand.prototype.init = function(exted) {
  var self = this

  // gets the folders
  Object.keys(self.objects).forEach(function(key){
    var obj = self.objects[key]
    
    var d = self.resolve(key)

    if (obj.type === "file"){
      d = path.dirname(d)
    }

    if (!fs.existsSync(d)) {
      mkdirp.sync(d)
      //console.log("mkdir " + d)
    }
  })

  // initialize the files or exted
  var files = []

  Object.keys(self.objects).forEach(function(key){
    var obj = self.objects[key]
    if (obj.type === "file") 
      files.push(obj)
  })

  files.forEach(function(file){
    var filename = self.resolve(file.key)
    if (!fs.existsSync(filename)) {
      // save into store?
      var content = file.json === true ? JSON.stringify(file.defaults) : file.defaults
      fs.writeFileSync(filename, content)
      return
    } else if (file.json === true && exted === true) {
      // save into store?
      var now = JSON.parse(fs.readFileSync(filename, self.encoding))
      var be = extend(true, now, file.defaults)
      fs.writeFileSync(filename, JSON.stringify(be))
    }
  })

  return self
}


/**
 * Demand a file or folder,
 * if not exists will be created
 *  if is a file by defauls
 *    extended if conf.exted are `true`
 */
FileDemand.prototype.getSync = function(key, filename, ops) {
  var self = this

  var obj = self.objects[key]
  
  if (obj === undefined || obj === null)
    throw new Error("The key `" + key + "` not found")

  // when is type=file
  if (typeof filename === "object")
    ops = filename

  ops = extend(false, ops || {}, { type: "content", encoding: self.encoding })

  filename = self.resolve(key, filename)

  switch(ops.type){
    case "content":  return self.__getContentSync(obj, filename, ops)
    case "stream":  return self.__getStreamSync(obj, filename, ops)
    default: throw new Error("Unknown type `" + ops.type + "`")
  }
}

FileDemand.prototype.__getContentSync = function(obj, filename, ops) {
  var self = this

  if (self.store[filename] !== undefined && self.store[filename] !== null)
    return self.store[filename].content

  var content = fs.readFileSync(filename, ops.encoding)

  if(obj.json === true)
    content = JSON.parse(content)

  if (!obj.mode.match(/(static|dynamic|cache)/g))
    return content

  if (self.store.exists(filename) === true){
    var st = self.store.get(filename)
    return st.content
  }

  // store the content
  self.store.set(filename, content, {mode: obj.mode, json: obj.json})
  
  return content
}

FileDemand.prototype.__getStreamSync = function(filename, ops) {
  var self = this
  return fs.createReadStream(filename, {encoding: ops.encoding})
}

/**
 * Save a file content
 */
FileDemand.prototype.setSync = function(key, relative, content, ops) {
  var self = this

  var obj = self.objects[key]
  if (obj === undefined || obj === null)
    throw new Error("The key `" + key + "` not found")

  if (obj.mode === "static")
    throw new Error("Can be set an static file")

  if (obj.type === "file" && arguments.length >= 4)
    throw new Error("Something wrong the `" + key + "` is a file")

  if (obj.type === "file"){
    content = relative
    ops = content
    return self.__setFileSync(obj, content, ops)
  }

  return self.__setFolderSync(obj, relative, content, ops)
}

FileDemand.prototype.__setFileSync = function(obj, content, ops) {
  var self = this

  filename = self.resolve(obj.key)
  var json = obj.json === true || ops.json === true

  if (obj.mode.match(/(dynamic|cache)/g)) {

    // save the file if not exist
    if (!fs.existsSync(filename)) {
      if (json) {
        fs.writeFileSync(filename, JSON.stringify(content))
      } else {
        fs.writeFileSync(filename, content)
      }
    }
      
    self.store.set(filename, content, {mode: obj.mode, json:json } )

    return self
  }

  // always write temp files
  fs.writeFileSync(filename, content)

  return self
}

FileDemand.prototype.__setFolderSync = function(obj, relative, content, ops) {
  var self = this

  var json = obj.json === true || ops.json === true
 
  filename = self.resolve(obj.key, relative)

  if (obj.mode.match(/(dynamic|cache)/g)) {

    // save the file if not exist
    if (!fs.existsSync(filename)) {
        if (json) {
          fs.writeFileSync(filename, JSON.stringify(content))
        } else {
          fs.writeFileSync(filename, content)
        }
    }

    self.store.set(filename, content, {mode: obj.mode, json:json })

    return self
  }

  // always write temp files
  fs.writeFileSync(filename, content)

  return self
}