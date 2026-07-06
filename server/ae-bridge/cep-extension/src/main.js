// CEP panel main — WebSocket client + ExtendScript dispatch via CSInterface
// Built by build-cep-extension.mjs: HANDLERS_BUNDLE is injected at build time.

/* global HANDLERS_BUNDLE, CSInterface, cep_node */

(function () {
  "use strict";

  // The backend OS-assigns its WS port and mints a per-launch session token, publishing both to
  // ~/.cubic/conn.json. This headless worker reads that file and — via Node's fs.watch — wakes the
  // instant the backend (re)writes it, so it connects with no idle polling. It echoes the token in its
  // `hello`; the backend drops any socket whose first frame lacks it.
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error-box");

  const cs = (typeof CSInterface !== "undefined") ? new CSInterface() : null;

  // Node.js is enabled for this extension (manifest CEFCommandLine --enable-nodejs) so the panel can
  // read ~/.cubic/conn.json directly AND fs.watch it — it wakes the instant Cubic writes the file,
  // with zero idle polling. If node is somehow unavailable we fall back to the ExtendScript read + a
  // bounded backoff poll, so the panel still works.
  const nodeRequire = (function () {
    try { if (typeof require === "function") return require; } catch (e) {}
    try { if (typeof cep_node !== "undefined" && cep_node.require) return cep_node.require; } catch (e) {}
    try { if (typeof window !== "undefined" && window.cep_node && window.cep_node.require) return window.cep_node.require; } catch (e) {}
    return null;
  })();
  let nodeFs = null, nodeOs = null, nodePath = null;
  try {
    if (nodeRequire) { nodeFs = nodeRequire("fs"); nodeOs = nodeRequire("os"); nodePath = nodeRequire("path"); }
  } catch (e) { nodeFs = null; }

  function cubicDir() { return nodePath.join(nodeOs.homedir(), ".cubic"); }
  function cubicConnPath() { return nodePath.join(cubicDir(), "conn.json"); }

  let ws = null;
  let backoffMs = 1000;
  let backoffTimer = null;
  let connWatcher = null;
  let quickRetries = 0;
  let quickTimer = null;

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = cls;
  }

  function showError(msg) {
    errorEl.style.display = "block";
    errorEl.textContent = msg;
  }

  function clearError() {
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  // Wrap CSInterface.evalScript in a Promise.
  // CEP returns the literal string "EvalScript error." on script-level failures.
  function runExtendScript(source) {
    return new Promise(function (resolve, reject) {
      if (!cs) {
        return reject(new Error("CSInterface unavailable — not running inside a CEP host"));
      }
      cs.evalScript(source, function (raw) {
        if (raw === "EvalScript error.") {
          return reject(new Error("ExtendScript syntax/runtime error (CEP evalScript returned error sentinel)"));
        }
        resolve(raw);
      });
    });
  }

  // Read {port, token} from ~/.cubic/conn.json. Prefer Node fs (sync, no evalScript round-trip);
  // fall back to ExtendScript (which resolves ~) if node isn't available. Calls back with the conn
  // object or null if the file is missing/unreadable (backend not up yet).
  function readConn(cb) {
    if (nodeFs) {
      try {
        const raw = nodeFs.readFileSync(cubicConnPath(), "utf8");
        const conn = JSON.parse(raw);
        cb((conn && typeof conn.port === "number" && typeof conn.token === "string") ? conn : null);
      } catch (e) { cb(null); }
      return;
    }
    if (!cs) { cb(null); return; }
    const es =
      "(function(){" +
      "  try {" +
      "    var f = new File(\"~/.cubic/conn.json\");" +
      "    if (!f.exists) return \"\";" +
      "    f.open(\"r\"); var c = f.read(); f.close();" +
      "    return c;" +
      "  } catch (e) { return \"\"; }" +
      "})();";
    cs.evalScript(es, function (raw) {
      if (!raw || raw === "EvalScript error.") { cb(null); return; }
      try {
        const conn = JSON.parse(raw);
        cb((conn && typeof conn.port === "number" && typeof conn.token === "string") ? conn : null);
      } catch (e) { cb(null); }
    });
  }

  // Event-driven wake: watch ~/.cubic and reconnect the instant the backend (re)writes conn.json.
  // Zero polling — while Cubic is closed the panel sits dormant on this watcher. Idempotent.
  function armWatch() {
    if (!nodeFs || connWatcher) return;
    try {
      const dir = cubicDir();
      if (!nodeFs.existsSync(dir)) { nodeFs.mkdirSync(dir, { recursive: true }); }
      connWatcher = nodeFs.watch(dir, function (evt, filename) {
        if (!filename || filename === "conn.json") { quickRetries = 0; connect(); }
      });
    } catch (e) { connWatcher = null; }
  }

  // Bounded quick retries recover a TRANSIENT socket drop while the backend is still alive
  // (conn.json unchanged, so the watch won't fire). After these fail (backend truly gone) we stop and
  // stay dormant — the fs.watch wakes us when Cubic next writes conn.json.
  function scheduleQuickRetry() {
    if (quickTimer || quickRetries >= 4) return;
    quickRetries++;
    quickTimer = setTimeout(function () { quickTimer = null; connect(); }, 750);
  }

  // On any failure: with node, arm the fs.watch (dormant wake, no poll) and — for a transient drop
  // where conn.json is unchanged — do a few bounded quick retries. Without node, fall back to the
  // exponential backoff poll.
  function onConnectFailure(errMsg, hadConn) {
    if (nodeFs) {
      armWatch();
      if (hadConn) { scheduleQuickRetry(); }
      if (errMsg) { showError(errMsg); }
    } else {
      scheduleReconnect(errMsg);
    }
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    clearError();
    setStatus("Connecting…", "connecting");
    readConn(function (conn) {
      if (!conn) {
        // No backend yet — dormant wait on the watch (node) or backoff poll (fallback).
        onConnectFailure("Waiting for Cubic backend (no ~/.cubic/conn.json yet)…", false);
        return;
      }
      const url = "ws://127.0.0.1:" + conn.port;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        onConnectFailure("Failed to create WebSocket: " + e, true);
        return;
      }

      ws.onopen = function () {
        backoffMs = 1000;
        quickRetries = 0;
        clearError();
        setStatus("Connected", "connected");
        // Authenticate as the worker (token) + report the baked-in bundle id (stale-panel preflight).
        ws.send(JSON.stringify({
          type: "hello",
          token: conn.token,
          role: "worker",
          buildId: (typeof __CUBIC_BUILD_ID__ !== "undefined" ? __CUBIC_BUILD_ID__ : null),
        }));
      };

      ws.onmessage = function (evt) {
        var msg;
        try { msg = JSON.parse(evt.data); } catch (e) { return; }
        // Dev preflight asks a stale panel to reload — re-fetches index.html → main.js?b=<newid>
        // with the fresh baked-in bundle (the only way to swap HANDLERS_BUNDLE without a manual reopen).
        if (msg.type === "reload") { location.reload(); return; }
        if (msg.id === undefined || msg.command === undefined) return;
        executeCommand(msg.id, msg.command, msg.args || {});
      };

      ws.onerror = function () {
        showError("WebSocket error on " + url);
      };

      ws.onclose = function () {
        ws = null;
        setStatus("Disconnected", "disconnected");
        // Transient drop (backend alive, conn.json unchanged) → bounded quick retries; backend gone →
        // those fail and we go dormant on the watch until Cubic rewrites conn.json.
        onConnectFailure(null, true);
      };
    });
  }

  // Fallback-only (node unavailable): exponential backoff poll, capped at 10s.
  function scheduleReconnect(errMsg) {
    if (errMsg) showError(errMsg);
    if (backoffTimer) clearTimeout(backoffTimer);
    backoffTimer = setTimeout(function () {
      backoffTimer = null;
      connect();
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 10000);
  }

  async function executeCommand(id, command, args) {
    const footer = "(function(){\n" +
      "  try {\n" +
      "    var __r = dispatchCommand(" + JSON.stringify(command) + ", eval(\"(\" + " + JSON.stringify(JSON.stringify(args)) + " + \")\"));\n" +
      "    return (typeof __r === \"string\") ? __r : JSON.stringify(__r);\n" +
      "  } catch(e) {\n" +
      "    return JSON.stringify({ status: \"error\", errorCode: \"HANDLER_UNCAUGHT\", message: e.toString(), line: e.line, stack: (e.stack || null) });\n" +
      "  }\n" +
      "})();";

    const source = HANDLERS_BUNDLE + "\n" + footer;

    var result;
    try {
      result = await runExtendScript(source);
    } catch (e) {
      sendResponse(id, false, null, String(e));
      showError("evalScript error: " + e);
      return;
    }

    const resultStr = (typeof result === "string") ? result : JSON.stringify(result);
    sendResponse(id, true, resultStr, null);
  }

  function sendResponse(id, ok, result, error) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = ok
      ? { id: id, ok: true, result: result }
      : { id: id, ok: false, error: error };
    ws.send(JSON.stringify(msg));
  }

  // Arm the watch up front so no conn.json write is missed during the first connect, then attempt.
  if (nodeFs) { armWatch(); }
  connect();
})();
