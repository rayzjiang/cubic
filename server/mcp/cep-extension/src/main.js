// CEP panel main — WebSocket client + ExtendScript dispatch via CSInterface
// Built by build-cep-extension.mjs: HANDLERS_BUNDLE is injected at build time.

/* global HANDLERS_BUNDLE, CSInterface */

(function () {
  "use strict";

  // Node.js child_process is available when --mixed-context is set in manifest.xml.
  // Used to trigger undoAction via osascript (bypasses CEP evalScript undo restriction).
  const childProcess = (function () {
    try { return require("child_process"); } catch (_) { return null; }
  })();

  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error-box");
  const reconnectBtn = document.getElementById("reconnect-btn");
  const portInput = document.getElementById("port-input");

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

  function getPort() {
    const v = parseInt(portInput.value, 10);
    return isNaN(v) ? 17923 : v;
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

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    clearError();
    setStatus("Connecting…", "connecting");
    const url = "ws://127.0.0.1:" + getPort();
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
      ws.send(JSON.stringify({ type: "hello" }));
    };

    ws.onmessage = function (evt) {
      var msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }
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

  // undoAction: send ⌘Z to the After Effects process via osascript.
  // AE silently ignores app.executeCommand(Undo) when called from within an active
  // evalScript — the command runs but nothing reverts. osascript delivers a genuine
  // UI event that AE processes the same way as a user pressing ⌘Z.
  // Requires --mixed-context in manifest.xml (enables Node.js require in CEP panel).
  function handleUndoAction(id, args) {
    const stepsRaw = (args && args.steps) ? parseInt(args.steps, 10) : 1;
    const steps = Math.max(1, Math.min(20, isNaN(stepsRaw) ? 1 : stepsRaw));

    // Build a multi-line AppleScript passed as individual -e args (no shell escaping needed).
    const scriptLines = [
      'tell application "System Events"',
      '    tell process "After Effects"',
      '        repeat ' + steps + ' times',
      '            keystroke "z" using {command down}',
      '            delay 0.05',
      '        end repeat',
      '    end tell',
      'end tell'
    ];
    const osaArgs = scriptLines.reduce(function (acc, line) { acc.push('-e', line); return acc; }, []);

    childProcess.execFile(
      '/usr/bin/osascript', osaArgs,
      { timeout: steps * 300 + 3000 },
      function (err, _stdout, stderr) {
        const executed = err ? 0 : steps;
        // Wait 400 ms before responding. osascript exits as soon as the keystroke is
        // *delivered* to AE's input queue, but AE processes UI events asynchronously.
        // Without this gap, the test's next WS command (getLayerInfo evalScript) can
        // arrive and run in AE before AE's event loop has consumed the Cmd+Z.
        setTimeout(function () {
          sendResponse(id, true, JSON.stringify({
            status: err ? 'error' : 'success',
            message: err
              ? 'undoAction osascript failed: ' + (stderr || String(err))
              : 'Undid ' + executed + ' action(s)',
            requested: steps,
            executed: executed,
            _via: 'osascript'
          }), null);
        }, err ? 0 : 400);
      }
    );
  }

  async function executeCommand(id, command, args) {
    // undoAction is handled via osascript (not evalScript) on macOS when Node.js is
    // available. See handleUndoAction() above for the full explanation.
    if (command === 'undoAction' && childProcess) {
      handleUndoAction(id, args);
      return;
    }

    const footer = "(function(){\n" +
      "  try {\n" +
      "    var __r = dispatchCommand(" + JSON.stringify(command) + ", eval(\"(\" + " + JSON.stringify(JSON.stringify(args)) + " + \")\"));\n" +
      "    return (typeof __r === \"string\") ? __r : JSON.stringify(__r);\n" +
      "  } catch(e) {\n" +
      "    return JSON.stringify({ status: \"error\", message: e.toString(), line: e.line });\n" +
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

  reconnectBtn.addEventListener("click", function () {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
    backoffMs = 1000;
    connect();
  });

  connect();
})();
