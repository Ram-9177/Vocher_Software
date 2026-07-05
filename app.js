(function(){
  'use strict';

  var adapterReady = false;
  var domEventHeld = false;

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
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = function(){ reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  load('app.old.js')
    .then(function(){ return load('live-adapter.js'); })
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
