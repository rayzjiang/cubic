// TEMP verification — delete after use.
// Confirms createLayer(text) no longer throws "Text document not of Box document type".
// Zero API cost: talks straight to the AE bridge over WebSocket (no LLM).
//   Run:  node tests/_verify-text-fix.mjs   (AE open + Cubic panel REOPENED after the rebuild)
import { send, green, red, bold } from './helpers.mjs';

const COMP = '__VERIFY_TEXT_FIX__';
let failed = false;

try {
  await send('createComposition', { name: COMP, width: 1920, height: 1080, frameRate: 30, duration: 5, pixelAspect: 1 });

  const r = await send('createLayer', { compName: COMP, type: 'text', text: 'VERIFY' });

  if (r.status === 'error') {
    failed = true;
    console.log(red(bold('\n FAIL — createLayer(text) still errors:')));
    console.log('   ' + r.errorCode + ': ' + r.message + (r.line ? '  (line ' + r.line + ')' : ''));
    console.log('   If this says "Box document type", the panel is still running the OLD bundle — reopen it.');
  } else {
    const cp = Array.isArray(r.configurableProperties) ? r.configurableProperties.length : 0;
    console.log(green(bold('\n PASS — text layer created + response serialized cleanly.')));
    console.log('   layer: "' + (r.layer && r.layer.name) + '"  ·  configurableProperties: ' + cp + ' entries');
  }
} catch (e) {
  failed = true;
  console.log(red(bold('\n FAIL — ' + e.message)));
  console.log('   (Is AE open with the Cubic panel connected?)');
} finally {
  try { await send('deleteComposition', { name: COMP }); } catch {}
  process.exit(failed ? 1 : 0);
}
