// CEP panel main — WebSocket client + ExtendScript dispatch via CSInterface
// Built by build-cep-extension.mjs: HANDLERS_BUNDLE is injected at build time.

/* global HANDLERS_BUNDLE, CSInterface */

(function () {
  "use strict";

  // The backend OS-assigns its WS port and mints a per-launch session token, publishing both to
  // ~/.cubic/conn.json. This headless worker reads that file (via ExtendScript, which resolves ~)
  // on every connect attempt and echoes the token in its `hello` — the backend drops any socket whose
  // first frame lacks it. Re-reading each attempt means a backend restart (new port/token) is picked up.
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error-box");

  const cs = (typeof CSInterface !== "undefined") ? new CSInterface() : null;

  let ws = null;
  let backoffMs = 1000;
  let backoffTimer = null;

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

  // Read ~/.cubic/conn.json through ExtendScript (resolves ~ on both platforms; the panel has no Node
  // fs). Calls back with {port, token} or null if the file is missing/unreadable (backend not up yet).
  function readConn(cb) {
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

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    clearError();
    setStatus("Connecting…", "connecting");
    readConn(function (conn) {
      if (!conn) {
        scheduleReconnect("Waiting for Cubic backend (no ~/.cubic/conn.json yet)…");
        return;
      }
      const url = "ws://127.0.0.1:" + conn.port;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        scheduleReconnect("Failed to create WebSocket: " + e);
        return;
      }

      ws.onopen = function () {
        backoffMs = 1000;
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
        scheduleReconnect();
      };
    });
  }

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

  connect();
})();
