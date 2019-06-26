var firepad = firepad || { };

firepad.Firepad = (function(global) {
  var ACEAdapter = firepad.ACEAdapter;
  var FirebaseAdapter = firepad.FirebaseAdapter;
  var EditorClient = firepad.EditorClient;
  var EntityManager = firepad.EntityManager;
  var utils = firepad.utils;
  var CodeMirror = global.CodeMirror;
  var ace = global.ace;

  function Firepad(ref, place, options) {
    if (!(this instanceof Firepad)) { return new Firepad(ref, place, options); }

    if (!CodeMirror && !ace && !global.monaco) {
      throw new Error('Couldn\'t find CodeMirror, ACE or Monaco.  Did you forget to include codemirror.js/ace.js or import monaco?');
    }

    this.zombie_ = false;

    if (CodeMirror && place instanceof CodeMirror) {
      this.codeMirror_ = this.editor_ = place;
      var curValue = this.codeMirror_.getValue();
      if (curValue !== '') {
        throw new Error("Can't initialize Firepad with a CodeMirror instance that already contains text.");
      }
    } else if (ace && place && place.session instanceof ace.EditSession) {
      this.ace_ = this.editor_ = place;
      curValue = this.ace_.getValue();
      if (curValue !== '') {
        throw new Error("Can't initialize Firepad with an ACE instance that already contains text.");
      }
    } else if (global.monaco && place && place instanceof global.monaco.constructor) {
      monaco = global.monaco;
      this.monaco_ = this.editor_ = place;
      curValue = this.monaco_.getValue();
      if (curValue !== '') {
        throw new Error("Can't initialize Firepad with a Monaco instance that already contains text.");
      }
    } else {
      this.codeMirror_ = this.editor_ = new CodeMirror(place);
    }

    var editorWrapper;
    editorWrapper = this.ace_.container;

    // var editorWrapper = this.codeMirror_ ? this.codeMirror_.getWrapperElement() : this.ace_.container;
    // this.firepadWrapper_ = utils.elt("div", null, { 'class': 'firepad' });
    // editorWrapper.parentNode.replaceChild(this.firepadWrapper_, editorWrapper);
    // this.firepadWrapper_.appendChild(editorWrapper);

    // Don't allow drag/drop because it causes issues.  See https://github.com/firebase/firepad/issues/36
    utils.on(editorWrapper, 'dragstart', utils.stopEvent);

    // Provide an easy way to get the firepad instance associated with this CodeMirror instance.
    this.editor_.firepad = this;

    this.options_ = options || { };

    var userId = this.getOption('userId', ref.push().key);
    var userColor = this.getOption('userColor', colorFromUserId(userId));

    this.entityManager_ = new EntityManager();

    this.firebaseAdapter_ = new FirebaseAdapter(ref, userId, userColor);
    this.editorAdapter_ = new ACEAdapter(this.ace_);
    this.client_ = new EditorClient(this.firebaseAdapter_, this.editorAdapter_);

    var self = this;
    this.firebaseAdapter_.on('cursor', function() {
      self.trigger.apply(self, ['cursor'].concat([].slice.call(arguments)));
    });

    this.firebaseAdapter_.on('ready', function() {
      self.ready_ = true;

      if (self.ace_) {
        self.editorAdapter_.grabDocumentState();
      }
      if (self.monaco_) {
        self.editorAdapter_.grabDocumentState();
      }

      var defaultText = self.getOption('defaultText', null);
      if (defaultText && self.isHistoryEmpty()) {
        self.setText(defaultText);
      }

      self.trigger('ready');
    });

    this.client_.on('synced', function(isSynced) { self.trigger('synced', isSynced)} );

    // Hack for IE8 to make font icons work more reliably.
    // http://stackoverflow.com/questions/9809351/ie8-css-font-face-fonts-only-working-for-before-content-on-over-and-sometimes
    if (navigator.appName == 'Microsoft Internet Explorer' && navigator.userAgent.match(/MSIE 8\./)) {
      window.onload = function() {
        var head = document.getElementsByTagName('head')[0],
          style = document.createElement('style');
        style.type = 'text/css';
        style.styleSheet.cssText = ':before,:after{content:none !important;}';
        head.appendChild(style);
        setTimeout(function() {
          head.removeChild(style);
        }, 0);
      };
    }
  }
  utils.makeEventEmitter(Firepad);

  // For readability, these are the primary "constructors", even though right now they're just aliases for Firepad.
  Firepad.fromCodeMirror = Firepad;
  Firepad.fromACE = Firepad;
  Firepad.fromMonaco = Firepad;


  Firepad.prototype.dispose = function() {
    this.zombie_ = true; // We've been disposed.  No longer valid to do anything.
    this.editor_.firepad = null;
    this.firebaseAdapter_.dispose();
    this.editorAdapter_.detach();
  };

  Firepad.prototype.setUserId = function(userId) {
    this.firebaseAdapter_.setUserId(userId);
  };

  Firepad.prototype.setUserColor = function(color) {
    this.firebaseAdapter_.setColor(color);
  };

  Firepad.prototype.getText = function() {
    this.assertReady_('getText');
    return this.ace_.getSession().getDocument().getValue();
  };

  Firepad.prototype.setText = function(textPieces) {
      this.assertReady_('setText');
    if (this.monaco_) {
      return this.monaco_.getModel().setValue(textPieces);
    } else if (this.ace_) {
      return this.ace_.getSession().getDocument().setValue(textPieces);
    } else {
      // HACK: Hide CodeMirror during setText to prevent lots of extra renders.
      this.codeMirror_.getWrapperElement().setAttribute('style', 'display: none');
      this.codeMirror_.setValue("");
      this.insertText(0, textPieces);
      this.codeMirror_.getWrapperElement().setAttribute('style', '');
      this.codeMirror_.refresh();
    }
    this.editorAdapter_.setCursor({position: 0, selectionEnd: 0});
  };

  Firepad.prototype.insertTextAtCursor = function(textPieces) {
    this.insertText(this.codeMirror_.indexFromPos(this.codeMirror_.getCursor()), textPieces);
  };

  Firepad.prototype.insertText = function(index, textPieces) {
    utils.assert(!this.ace_, "Not supported for ace yet.");
    utils.assert(!this.monaco_, "Not supported for monaco yet.");
    this.assertReady_('insertText');
  };

  Firepad.prototype.isHistoryEmpty = function() {
    this.assertReady_('isHistoryEmpty');
    return this.firebaseAdapter_.isHistoryEmpty();
  };

  Firepad.prototype.getOption = function(option, def) {
    return (option in this.options_) ? this.options_[option] : def;
  };

  Firepad.prototype.assertReady_ = function(funcName) {
    if (!this.ready_) {
      throw new Error('You must wait for the "ready" event before calling ' + funcName + '.');
    }
    if (this.zombie_) {
      throw new Error('You can\'t use a Firepad after calling dispose()!  [called ' + funcName + ']');
    }
  };

  Firepad.prototype.makeImageDialog_ = function() {
    this.makeDialog_('img', 'Insert image url');
  };

  Firepad.prototype.makeDialog_ = function(id, placeholder) {
   var self = this;

   var hideDialog = function() {
     var dialog = document.getElementById('overlay');
     dialog.style.visibility = "hidden";
     self.firepadWrapper_.removeChild(dialog);
   };

   var cb = function() {
     var dialog = document.getElementById('overlay');
     dialog.style.visibility = "hidden";
     var src = document.getElementById(id).value;
     if (src !== null)
       self.insertEntity(id, { 'src': src });
     self.firepadWrapper_.removeChild(dialog);
   };

   var input = utils.elt('input', null, { 'class':'firepad-dialog-input', 'id':id, 'type':'text', 'placeholder':placeholder, 'autofocus':'autofocus' });

   var submit = utils.elt('a', 'Submit', { 'class': 'firepad-btn', 'id':'submitbtn' });
   utils.on(submit, 'click', utils.stopEventAnd(cb));

   var cancel = utils.elt('a', 'Cancel', { 'class': 'firepad-btn' });
   utils.on(cancel, 'click', utils.stopEventAnd(hideDialog));

   var buttonsdiv = utils.elt('div', [submit, cancel], { 'class':'firepad-btn-group' });

   var div = utils.elt('div', [input, buttonsdiv], { 'class':'firepad-dialog-div' });
   var dialog = utils.elt('div', [div], { 'class': 'firepad-dialog', id:'overlay' });

   this.firepadWrapper_.appendChild(dialog);
  };

  function colorFromUserId (userId) {
    var a = 1;
    for (var i = 0; i < userId.length; i++) {
      a = 17 * (a+userId.charCodeAt(i)) % 360;
    }
    var hue = a/360;

    return hsl2hex(hue, 1, 0.75);
  }

  function rgb2hex (r, g, b) {
    function digits (n) {
      var m = Math.round(255*n).toString(16);
      return m.length === 1 ? '0'+m : m;
    }
    return '#' + digits(r) + digits(g) + digits(b);
  }

  function hsl2hex (h, s, l) {
    if (s === 0) { return rgb2hex(l, l, l); }
    var var2 = l < 0.5 ? l * (1+s) : (l+s) - (s*l);
    var var1 = 2 * l - var2;
    var hue2rgb = function (hue) {
      if (hue < 0) { hue += 1; }
      if (hue > 1) { hue -= 1; }
      if (6*hue < 1) { return var1 + (var2-var1)*6*hue; }
      if (2*hue < 1) { return var2; }
      if (3*hue < 2) { return var1 + (var2-var1)*6*(2/3 - hue); }
      return var1;
    };
    return rgb2hex(hue2rgb(h+1/3), hue2rgb(h), hue2rgb(h-1/3));
  }

  return Firepad;
})(self);

// Export Text classes
firepad.Firepad.Formatting = firepad.Formatting;
firepad.Firepad.Text = firepad.Text;
firepad.Firepad.Entity = firepad.Entity;
firepad.Firepad.LineFormatting = firepad.LineFormatting;
firepad.Firepad.Line = firepad.Line;
firepad.Firepad.TextOperation = firepad.TextOperation;

// Export adapters
firepad.Firepad.ACEAdapter = firepad.ACEAdapter;
