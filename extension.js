const { Clutter, Gio, GLib, GObject, Meta, Shell, St } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

let _indicator = null;
let json = null;
let _timeoutId = null;
let _increment = 0;
let current_background = "";
let stack = [];

// Stack handler to manage a list of items with push and pop operations with a maximum size (7 items max)
function pushToStack(item) {
  // valid if item is not already in stack
  if (stack.includes(item)) {
    return;
  }

  stack.push(item);
  if (stack.length > 7) {
    stack.shift(); // Remove the oldest item
  }
}

function popFromStack() {
  return stack.pop();
}

function At(index) {
  if (index < 0 || index >= stack.length) {
    return 0; // Out of bounds
  }
  return stack[index];
}

function next() {
  if (++_increment > stack.length) {
    _increment = 0; // Loop back to start
  }
  debug("Next wallpaper index: " + _increment);
  return stack[_increment];
}

function get_peak() {
  return stack.length > 0 ? stack[0] : null;
}

function fullpath(background_name) {
  return GLib.get_home_dir() + "/.cache/bingwallpapers/" + background_name;
}

const bingextension = GObject.registerClass(
  class bingextension extends PanelMenu.Button {
    constructor() {
      super(0.0, "Bing Extension", false);

      this.label = new St.Label({
        text: "Bing",
        y_align: Clutter.ActorAlign.CENTER,
      });

      this.add_child(this.label);

      this.connect("button-press-event", this._onButtonPress.bind(this));
    }

    set_text(text) {
      this.label.set_text(text);
    }

    // Action when the button is clicked
    _onButtonPress() {
      next();
      set_bing_wallpaper();
      let info = get_bing_info();
      this.set_text(info.title);
      debug("Bing wallpaper updated for date: " + info.date);
    }
  }
);

function _get_json_api() {
  let url =
    "https://www.bing.com/HPImageArchive.aspx?format=js&idx=" +
    _increment +
    "&n=1&mkt=es-ES";
  try {
    // Use bash to fetch the JSON
    let [success, stdout, stderr, status] = GLib.spawn_command_line_sync(
      "curl -s " + url
    );
    if (success) {
      let jsonString = imports.byteArray.toString(stdout);
      let jsonData = JSON.parse(jsonString);
      debug("Fetched JSON from " + url);
      return jsonData;
    }
  } catch (e) {
    debug("Error fetching JSON from " + url + ": " + e);
  }
  return null;
}

// If Internet is available, fetch the Bing wallpaper URL
function _get_bing_wallpaper_url() {
  if (json && json.images && json.images.length > 0) {
    let image = json.images[0];
    let urlBase = image.urlbase;
    let fullUrl = "https://www.bing.com" + urlBase + "_1920x1080.jpg";
    return fullUrl;
  }
  return null;
}

// Get info from the JSON API
function get_bing_info() {
  if (json && json.images && json.images.length > 0) {
    let image = json.images[0];
    return {
      title: image.title,
      copyright: image.copyright,
      url: _get_bing_wallpaper_url(),
      date: image.startdate,
    };
  } else {
    // get the title from current background if available
    if (current_background !== "") {
      let parts = current_background.split("_");
      if (parts.length >= 2) {
        let date_part = parts[0];
        return {
          title: parts[1].replace(/-/g, " "),
          copyright: "Unknown",
          url: "https://www.bing.com/",
          date: date_part,
        };
      }
    }

    // return default info
    return {
      title: "Bing Wallpaper",
      copyright: "Unknown",
      url: "https://www.bing.com",
      date: "Unknown",
    };
  }
  return null;
}

// Storage the image locally
function _store_image_locally(imageUrl) {
  let info = get_bing_info();
  let date = info.date;
  let title = info.title.replace(/ /g, "-");
  let urlbase = imageUrl.split("/").pop();
  let fileName =
    GLib.get_home_dir() +
    "/.cache/bingwallpapers/" +
    date +
    "_" +
    title +
    "_1920x1080.jpg";
    // if file already exists, return the path
  let gfile = Gio.File.new_for_path(fileName);
  if (gfile.query_exists(null)) {
    debug("Image already exists locally: " + fileName);
    return fileName;
  }

  try {
    // use bash to fetch the image and save it locally and save a copy
    let [success, stdout, stderr, status] = GLib.spawn_command_line_sync(
      "curl -s " + imageUrl + " -o " + fileName + " && cp " + fileName + " " + GLib.get_home_dir() + "/.cache/bingwallpapers/today_wallpaper.jpg"
    );
    if (success) {
      debug("Image saved locally: " + fileName);
      return fileName;
    } else {
      debug("Error fetching image from " + imageUrl + ": " + stderr);
      return null;
    }
  } catch (e) {
    debug("Error storing image locally: " + e);
  }
  return null;
}

// If the image is saved locally, return the complete local path

function debug(msg) {
  //log(`[bingwallpaper@kennethbriones.com] ${msg}`);
}

function _set_background_image(filePath) {
  GLib.spawn_command_line_sync(
    'gsettings set org.gnome.desktop.background picture-uri "file://' +
      filePath +
      '"'
  );
  GLib.spawn_command_line_sync(
    'gsettings set org.gnome.desktop.background picture-uri-dark "file://' +
      filePath +
      '"'
  );
  current_background = Gio.File.new_for_path(filePath).get_basename();
}

function _mount_backgrounds() {
  // if stack is empty, load all images from the local storage
  if (stack.length === 0) {
    let dir = GLib.get_home_dir() + "/.cache/bingwallpapers/";
    let gdir = Gio.File.new_for_path(dir);

    let fileEnum = gdir.enumerate_children(
      "standard::name",
      Gio.FileQueryInfoFlags.NONE,
      null
    );
    let info;
    while ((info = fileEnum.next_file(null)) !== null) {
      let name = info.get_name();
      if (name.endsWith("_1920x1080.jpg")) {
        pushToStack(name);
      }
    }
    fileEnum.close(null);
  }
}

// Set background to Bing wallpaper
function set_bing_wallpaper() {
  json = _get_json_api();
  if (json && json.images && json.images.length > 0) {
    let imageUrl = _get_bing_wallpaper_url();
    if (imageUrl) {
      let localFilePath = _store_image_locally(imageUrl);
      if (localFilePath) {
        _set_background_image(localFilePath);
        pushToStack(current_background);
        debug("Bing wallpaper set: " + current_background);
      }
    } else {
      debug("No Bing wallpaper URL found");
    }
  } else {
    if (stack.length > 0) {
      // if no internet, set the current background from stack
      let background_name = At(_increment);
      let file = fullpath(background_name);
      // valid if image exists locally
      let gdir = Gio.File.new_for_path(file);
      if (gdir.query_exists(null)) {
        _set_background_image(file);
        debug("No Bing JSON data available, using local wallpaper: " + background_name);
      }
    }
    else {
      _set_background_image("/usr/share/backgrounds/pop/kate-hazen-pop-m3lvin.png");
      debug("No Bing JSON data available and no local wallpapers found.");
    }
  }
}

// Service functions, check if today is a new today to update wallpaper
function bing_wallpaper_service() {
  _increment = 0; // Reset increment on daily update

  // Fetch new JSON if not available or if the date is different
  set_bing_wallpaper();
  let title = get_bing_info().title;
  _indicator.set_text(title);

  // Delete the image files older than 7 days
  let dir = GLib.get_home_dir() + "/.cache/bingwallpapers/";
  let gdir = Gio.File.new_for_path(dir);

  // If there is more than 10 files, delete the oldest ones
  let fileEnum = gdir.enumerate_children(
    "standard::name,standard::time",
    Gio.FileQueryInfoFlags.NONE,
    null
  );
  let files = [];
  let info;
  while ((info = fileEnum.next_file(null)) !== null) {
    let name = info.get_name();
    if (name.endsWith("_1920x1080.jpg")) {
      let mtime = info.get_modification_time().tv_sec;
      files.push({ name: name, mtime: mtime });
    }
  }
  fileEnum.close(null);
  if (files.length > 10) {
    // Sort files by modification time
    files.sort((a, b) => a.mtime - b.mtime);
    let filesToDelete = files.length - 10;
    for (let i = 0; i < filesToDelete; i++) {
      let filePath = dir + files[i].name;
      let gfile = Gio.File.new_for_path(filePath);
      gfile.delete(null);
      debug("Deleted old wallpaper: " + filePath);
    }
  }
  return true; // Continue the timeout
}

// change style on panelMenu
// function _set_panel_style() {
//   // set a new backcolor for all panel menus
//   let panelMenuStyle = `
//     .panel-button .label {
//       color: #FFFFFF;
//       font-weight: bold;
//     }
//     .panel {
//       background-color:rgba(121, 13, 13, 0.5);
//     }
//   `;
//   let styleProvider = St.StyleProvider();
//   styleProvider.load_from_data(panelMenuStyle);
//   St.ThemeContext.get_for_stage(global.stage).add_style_provider(
//     styleProvider,
//     St.StyleProviderPriority.USER
//   );
// }

function enable() {
  _indicator = new bingextension();
  Main.panel.addToStatusArea("bingwallpaper@kennethbriones.com", _indicator);

  bing_wallpaper_service(); // Initial call
  _timeoutId = GLib.timeout_add_seconds(
    GLib.PRIORITY_DEFAULT,
    23 * 60 * 60,
    bing_wallpaper_service
  );
}

function disable() {
  if (_indicator) {
    _indicator.destroy();
    _indicator = null;
    debug("Bing Extension disabled");
  }
  if (_timeoutId) {
    GLib.source_remove(_timeoutId);
    _timeoutId = null;
    debug("Bing Extension timeout removed");
  }
}

function init() {
  //_set_panel_style();
  //debug("Bing Extension initialized");
  _mount_backgrounds();
}
