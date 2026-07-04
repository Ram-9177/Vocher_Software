'use strict';
(function loadVoucherApp(){
  const files = ['js/state.js','js/api-client.js','js/render.js','js/actions.js'];
  function load(i){
    if(i >= files.length){ if(window.initVoucherApp) window.initVoucherApp(); return; }
    const s = document.createElement('script');
    s.src = files[i];
    s.defer = true;
    s.onload = () => load(i+1);
    s.onerror = () => alert('Failed to load ' + files[i]);
    document.head.appendChild(s);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => load(0));
  else load(0);
})();
