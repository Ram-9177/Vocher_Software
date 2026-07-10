(function(){
  'use strict';

  var adapterReady = false;
  var domEventHeld = false;
  var buildVersion = '20260710-session-persist-v2';

  try {
    var currentSrc = document.currentScript && document.currentScript.src;
    var currentVersion = currentSrc ? new URL(currentSrc, window.location.href).searchParams.get('v') : '';
    if(currentVersion) buildVersion = currentVersion;
  } catch(e) {}

  function holdDomReady(e){
    if(!adapterReady){
      domEventHeld = true;
      if(e && e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
  }

  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', holdDomReady, true);
  }

  function load(src){
    return new Promise(function(resolve,reject){
      var s = document.createElement('script');
      s.src = src + (src.indexOf('?') === -1 ? '?' : '&') + 'v=' + encodeURIComponent(buildVersion);
      s.async = false;
      s.onload = resolve;
      s.onerror = function(){ reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  load('app.old.js')
    .then(function(){ return load('live-adapter.js'); })
    .then(function(){ return load('live-save-override.js'); })
    .then(function(){
      adapterReady = true;
      document.removeEventListener('DOMContentLoaded', holdDomReady, true);
      if(domEventHeld || document.readyState !== 'loading') {
        setTimeout(function(){
          document.dispatchEvent(new Event('DOMContentLoaded', { bubbles:true, cancelable:true }));
        }, 0);
      }
    })
    .catch(function(e){ alert(e.message); });
})();
