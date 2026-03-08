const T="".trim(),u="siteBaseUrl",g="extensionAuthToken",w="extensionSessionData",f="ecommerce-ai-extension-auth",E=[".ytp-caption-segment",".bpx-player-subtitle-panel-text",".bpx-player-subtitle-item-text",'[class*="caption"]','[class*="subtitle"]','[data-testid*="caption"]','[data-testid*="subtitle"]'];function r(t,o=12e3){return t.replace(/\u00a0/g," ").replace(/\r/g,`
`).replace(/[ \t]+\n/g,`
`).replace(/\n{3,}/g,`

`).replace(/[ \t]{2,}/g," ").trim().slice(0,o)}function s(t,o="name"){const e=document.querySelector(`meta[${o}="${t}"]`);return r((e==null?void 0:e.getAttribute("content"))||"",1200)}function k(){const e=(["article","main",'[role="main"]',"#content","#main",".content"].map(n=>document.querySelector(n)).find(Boolean)||document.body).cloneNode(!0);return e.querySelectorAll(["script","style","noscript","svg","form","button","nav","footer","header",'[role="navigation"]','[role="banner"]','[aria-hidden="true"]'].join(",")).forEach(n=>n.remove()),r(e.innerText||e.textContent||"",12e3)}function A(){const t=new Set;for(const o of E)document.querySelectorAll(o).forEach(e=>{const n=r(e.textContent||"",180);n&&t.add(n)});return r(Array.from(t).join(`
`),4e3)}function v(t){const o=t.split(`
`).map(e=>e.trim()).filter(e=>e&&!e.startsWith("WEBVTT")&&!e.includes("-->")&&!/^\d+$/.test(e));return r(o.join(`
`),4e3)}async function x(){const t=Array.from(document.querySelectorAll('track[kind="captions"], track[kind="subtitles"]')).map(o=>o.src).filter(Boolean).slice(0,2);for(const o of t)try{const e=await fetch(o);if(!e.ok)continue;const n=v(await e.text());if(n)return n}catch{continue}return""}function _(){var t;return r(s("og:title","property")||((t=document.querySelector("h1"))==null?void 0:t.textContent)||document.title,500)}function I(){var t;return r(s("og:description","property")||s("description")||((t=document.querySelector('[data-testid="video-description"]'))==null?void 0:t.textContent)||"",1600)}async function C(){var m,p;const t=r(document.title||"",300),o=location.href,e=location.hostname,n=k(),d=s("description"),y=r(((p=(m=window.getSelection)==null?void 0:m.call(window))==null?void 0:p.toString())||"",1200),a=!!document.querySelector("video"),S=a?_():"",h=a?I():"";let i="",l="none";return a&&(i=A(),i?l="dom":(i=await x(),i?l="track":(n||d)&&(l="page"))),{title:t,url:o,domain:e,mainText:n,metaDescription:d,selectedText:y,hasVideo:a,videoTitle:S,videoDescription:h,captionsText:i,transcriptSource:l}}async function B(){const t=await chrome.storage.local.get(u),o=typeof t[u]=="string"?t[u]:T;try{return new URL(o).origin}catch{return null}}async function b(){const t=await B();return!!(t&&t===location.origin&&window.top===window)}function c(t){if(t){chrome.storage.local.set({[g]:t});return}chrome.storage.local.remove([g,w])}function N(){if(document.documentElement.dataset.ecommerceAiAuthBridge==="1")return;document.documentElement.dataset.ecommerceAiAuthBridge="1";const t=document.createElement("script");t.textContent=`
    (() => {
      const emit = () => {
        window.postMessage({
          source: '${f}',
          token: window.localStorage.getItem('token')
        }, '*');
      };

      const originalSetItem = Storage.prototype.setItem;
      const originalRemoveItem = Storage.prototype.removeItem;
      const originalClear = Storage.prototype.clear;

      Storage.prototype.setItem = function(key, value) {
        const result = originalSetItem.apply(this, [key, value]);
        if (this === window.localStorage && key === 'token') emit();
        return result;
      };

      Storage.prototype.removeItem = function(key) {
        const result = originalRemoveItem.apply(this, [key]);
        if (this === window.localStorage && key === 'token') emit();
        return result;
      };

      Storage.prototype.clear = function() {
        const result = originalClear.apply(this);
        emit();
        return result;
      };

      window.addEventListener('storage', (event) => {
        if (event.storageArea === window.localStorage && event.key === 'token') emit();
      });

      emit();
    })();
  `,(document.head||document.documentElement).appendChild(t),t.remove();try{c(window.localStorage.getItem("token"))}catch{c(null)}}window.addEventListener("message",t=>{var o;t.source===window&&((o=t.data)==null?void 0:o.source)===f&&c(typeof t.data.token=="string"?t.data.token:null)});b().then(t=>{t&&N()});chrome.runtime.onMessage.addListener((t,o,e)=>{if(t.type==="PING_EXTENSION_CONTENT"){e({ok:!0});return}if(t.type==="GET_AUTH_STATE"){let n=!1;try{n=!!window.localStorage.getItem("token")}catch{n=!1}e({ok:!0,origin:location.origin,href:location.href,tokenPresent:n});return}if(t.type==="SYNC_AUTH_STATE"){try{c(window.localStorage.getItem("token"))}catch{c(null)}e({ok:!0});return}if(t.type==="GET_PAGE_CONTEXT")return C().then(n=>e(n)).catch(()=>e(null)),!0});
