// ==UserScript==
// @name 开发指南知识星球 VIP 激活
// @namespace doc-guide-vip
// @version 3.2
// @description 该文档仅「开发指南」星球 VIP 用户可见，知识星球激活接口
// @author admin
// @match *://cloud.iocoder.cn/*
// @match *://doc.iocoder.cn/*
// @run-at document-start
// @grant none
// @license MIT
// @downloadURL https://raw.githubusercontent.com/Gt841/doc-guide-vip/main/doc-guide-vip.user.js
// @updateURL https://raw.githubusercontent.com/Gt841/doc-guide-vip/main/doc-guide-vip.user.js
// ==/UserScript==

(function () {
'use strict';

console.log('✅ 开发指南 VIP 激活脚本 v3.2 已加载');

// ==========================================================
// 机制说明：
// 页面把认证请求交给一个独立运行环境的 Web Worker 去 fetch：
//   new Worker('doc-access-worker-xxx.js')
//   worker.postMessage({ id, url, timeout })
//   worker.onmessage = ev => 用 ev.data.text('false') 判断认证结果
// Worker 有自己独立的 fetch，无法从页面改写 fetch/XHR 骗过它。
// 因此这里「拦截 Worker 消息」：在结果回传时把认证结果 false 改成 true。
// ==========================================================

var AUTH_RE = /\/zsxq\/auth(-callback)?/;   // 兼容 auth 与 auth-callback
var idUrl = {};                              // 记录 id -> 请求 URL

function isAuthUrl(url) {
  return typeof url === 'string' && AUTH_RE.test(url);
}

// 把「认证失败」的返回结果改写为「认证成功」
function rewriteResult(data) {
  if (!data || data.id == null) return;
  if (!idUrl[data.id] || !isAuthUrl(idUrl[data.id])) return;
  if (data.text !== 'true') {
    console.log('🔓 [Auth] 认证结果改写: false -> true');
    data.text = 'true';
    // 若页面按 JSON 解析（响应头为 application/json），确保 JSON.parse 得到 true
    if ('json' in data) data.json = true;
    else data.json = true;
  }
}

// ==========================================================
// 1. 拦截 Web Worker（核心）
// ==========================================================
var OrigWorker = window.Worker;
if (OrigWorker) {
  window.Worker = function (scriptURL, options) {
    var worker = new OrigWorker(scriptURL, options);

    // 记录发出的请求：id -> url
    var origPost = worker.postMessage;
    worker.postMessage = function (message) {
      try {
        if (message && message.url && isAuthUrl(message.url)) {
          idUrl[message.id] = message.url;
        }
      } catch (e) {}
      return origPost.apply(worker, arguments);
    };

    // 接管 onmessage 属性：先改写结果，再交给页面
    var userHandler = null;
    var hooked = false;
    try {
      Object.defineProperty(worker, 'onmessage', {
        configurable: true,
        get: function () { return userHandler; },
        set: function (fn) {
          userHandler = fn;
          if (hooked) return;   // 页面重复设置 onmessage 时只挂一次，避免重复回调
          hooked = true;
          worker.addEventListener('message', function (ev) {
            try { rewriteResult(ev.data); } catch (e) {}
            if (typeof userHandler === 'function') userHandler.call(worker, ev);
          });
        }
      });
    } catch (e) {}

    // 兼容 addEventListener('message') 的写法
    var origAdd = worker.addEventListener.bind(worker);
    worker.addEventListener = function (type, listener, opts) {
      if (type === 'message' && typeof listener === 'function') {
        return origAdd('message', function (ev) {
          try { rewriteResult(ev.data); } catch (e) {}
          return listener.call(this, ev);
        }, opts);
      }
      return origAdd(type, listener, opts);
    };

    return worker;
  };
  window.Worker.prototype = OrigWorker.prototype;
}

// ==========================================================
// 2. 兜底：拦截 fetch / XHR（Worker 不可用时页面会回退到 XHR）
// ==========================================================
var originalFetch = window.fetch;
window.fetch = function (input, init) {
  var u = typeof input === 'string' ? input : (input && input.url) || '';
  if (isAuthUrl(u)) {
    console.log('🔓 [Fetch] 认证请求直接返回 true:', u);
    return Promise.resolve(new Response('true', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    }));
  }
  return originalFetch.apply(this, arguments);
};

var origXhrOpen = XMLHttpRequest.prototype.open;
var origXhrSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (method, url) {
  this._vipUrl = url;
  return origXhrOpen.apply(this, arguments);
};
XMLHttpRequest.prototype.send = function (body) {
  if (this._vipUrl && isAuthUrl(this._vipUrl)) {
    console.log('🔓 [XHR] 认证请求直接返回 true:', this._vipUrl);
    var self = this;
    setTimeout(function () {
      Object.defineProperties(self, {
        readyState: { value: 4 },
        status: { value: 200 },
        responseText: { value: 'true' },
        response: { value: 'true' }
      });
      if (self.onload) self.onload.call(self);
      if (self.onreadystatechange) self.onreadystatechange.call(self);
    }, 10);
    return;
  }
  return origXhrSend.apply(this, arguments);
};

// ==========================================================
// 3. 兜底：把认证状态属性改成可见值 + 解除遮挡
// ==========================================================
var ALLOW_VALUE = 'public';
var HIDE_STATES = ['pending', 'guest', 'error'];

function forceAccess() {
  var root = document.documentElement;
  if (!root) return;
  var cur = root.getAttribute('data-doc-access');
  if (cur && HIDE_STATES.indexOf(cur) !== -1) {
    root.setAttribute('data-doc-access', ALLOW_VALUE);
  } else if (!cur) {
    root.setAttribute('data-doc-access', ALLOW_VALUE);
  }
}

function cleanupOverlays() {
  var dialog = document.querySelector('doc-dialog-layer');
  if (dialog) { dialog.remove(); console.log('🔓 [DOM] 移除遮挡弹窗'); }
  var pending = document.getElementById('doc-vip-auth-pending');
  if (pending) pending.remove();
  var err = document.getElementById('doc-access-error');
  if (err) err.remove();
  if (document.body && document.body.style.overflow === 'hidden') {
    document.body.style.overflow = '';
  }
}

function injectSafetyCSS() {
  if (document.getElementById('vip-bypass-safety')) return;
  var host = document.head || document.documentElement;
  if (!host) return;   // document-start 阶段 <html> 可能还不存在，等 DOMContentLoaded 再注入
  var style = document.createElement('style');
  style.id = 'vip-bypass-safety';
  style.textContent =
    'html[data-doc-access]:not(#vip-bypass-x) .content-wrapper{visibility:visible !important;}';
  host.appendChild(style);
}

// 监听属性变化，改回隐藏态就立即纠正
var watching = false;
function startWatching() {
  if (watching || !document.documentElement) return;
  watching = true;
  new MutationObserver(function (ms) {
    for (var i = 0; i < ms.length; i++) {
      if (ms[i].attributeName === 'data-doc-access') forceAccess();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-doc-access'] });

  // 弹窗一出现就清理
  new MutationObserver(function () { cleanupOverlays(); })
    .observe(document.documentElement, { childList: true, subtree: true });
}

injectSafetyCSS();
forceAccess();
cleanupOverlays();
startWatching();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startWatching);
  document.addEventListener('DOMContentLoaded', injectSafetyCSS);
  document.addEventListener('DOMContentLoaded', function () { forceAccess(); cleanupOverlays(); });
}
setInterval(function () { forceAccess(); cleanupOverlays(); }, 500);

// ==========================================================
// 4. URL 签名处理（保持原脚本行为）
// ==========================================================
var pageUrl = new URL(location);
if (!document.cookie.includes('expire_time') && !pageUrl.searchParams.has('signature')) {
  pageUrl.searchParams.append('signature', 'true');
  location = pageUrl;
}

console.log('✅ 解锁器已激活');
})();
