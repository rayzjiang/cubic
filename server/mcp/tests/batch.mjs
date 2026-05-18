// batch.mjs — tests for the batch command in mcp-bridge-auto.jsx
// batch collapses N sub-commands into a single 2-tool round-trip.
//
// Tests:
//   1. Read-only batch — no write flag needed
//   2. Write batch — sets Scale keyframes in one call (stays for visual verification)
//                    tests removePropertyKeyframes via Rotation (overridden by expression)

import {
  test, send,
  assertNoError, assertField, assertArray,
  requireSetup,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_batch__';

export async function run(ctx, opts) {
  console.log(bold('\nBatch'));

  // ── Read-only batch (always runs) ─────────────────────────────────────────

  await test('batch — read-only: getProjectInfo + listCompositions', async () => {
    const r = await send('batch', {
      commands: [
        { command: 'getProjectInfo',    args: {} },
        { command: 'listCompositions',  args: {} }
      ]
    });
    assertField(r, 'total', 'number');
    assertField(r, 'executed', 'number');
    assertField(r, 'succeeded', 'number');
    assertField(r, 'failed', 'number');
    assertArray(r, 'results');
    if (r.total !== 2) throw new Error(`expected total=2, got ${r.total}`);
    if (r.succeeded !== 2) throw new Error(`${r.failed} sub-command(s) failed: ${JSON.stringify(r.results.filter(x => !x.success))}`);
    assertField(r.results[0], 'command', 'string');
    assertField(r.results[0], 'success', 'boolean');
    assertField(r.results[0], 'result', 'object');
    return `${r.succeeded}/${r.total} succeeded`;
  });

  await test('batch — stopOnError: stops after first failure', async () => {
    const r = await send('batch', {
      stopOnError: true,
      commands: [
        { command: 'getProjectInfo', args: {} },
        { command: 'nonExistentCommand', args: {} },
        { command: 'listCompositions', args: {} }  // should not run
      ]
    });
    assertField(r, 'total', 'number');
    assertField(r, 'executed', 'number');
    if (r.executed >= 3) throw new Error(`stopOnError should have halted before command 3, but executed=${r.executed}`);
    if (r.failed === 0) throw new Error('expected at least 1 failure from nonExistentCommand');
    return `stopped at command ${r.executed}/${r.total}`;
  });

  await test('batch — nested batch is rejected', async () => {
    const r = await send('batch', {
      commands: [
        { command: 'batch', args: { commands: [] } }
      ]
    });
    assertArray(r, 'results');
    if (r.results[0]?.success !== false) {
      throw new Error('nested batch should return success=false');
    }
    return 'correctly rejected';
  });

  await test('batch — missing command field is handled gracefully', async () => {
    const r = await send('batch', {
      commands: [
        { args: {} }  // no "command" key
      ]
    });
    assertArray(r, 'results');
    if (r.results[0]?.success !== false) {
      throw new Error('missing command field should return success=false');
    }
    return 'correctly handled';
  });

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  let ci, li;

  const setupOk = await test('setup — create batch test comp + text layer', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');
    ci = cr.composition.itemIndex;

    const lr = await send('createTextLayer', {
      compName: COMP_NAME, text: 'Batch Test', fontSize: 120,
      position: [960, 540], color: [1, 1, 1]
    });
    assertNoError(lr);
    li = 1;
    return `comp ${ci}, layer ${li}`;
  });

  if (!requireSetup(setupOk)) return;

  // ── Write batch (Scale animation stays for visual verification) ────────────

  await test('batch — write: two setLayerKeyframe + setKeyframeEasing in one call', async () => {
    const r = await send('batch', {
      commands: [
        {
          command: 'setLayerKeyframe',
          args: { compName: COMP_NAME, layerIndex: li, propertyName: 'Scale', timeInSeconds: 0, value: [50, 50] }
        },
        {
          command: 'setLayerKeyframe',
          args: { compName: COMP_NAME, layerIndex: li, propertyName: 'Scale', timeInSeconds: 3, value: [100, 100] }
        },
        {
          command: 'setKeyframeEasing',
          args: { compName: COMP_NAME, layerIndex: li, propertyName: 'Scale', easeType: 'easyEase' }
        }
      ]
    });
    if (r.failed > 0) {
      throw new Error(`${r.failed} sub-command(s) failed: ${JSON.stringify(r.results.filter(x => !x.success))}`);
    }
    return `${r.succeeded}/${r.total} succeeded`;
  });

  // Set a Rotation expression then test removePropertyKeyframes via batch.
  // Expression overrides any keyframes so the visual is unaffected.
  await test('batch — write: setLayerExpression + removePropertyKeyframes via batch', async () => {
    const setExpr = await send('setLayerExpression', {
      compName: COMP_NAME, layerIndex: li, propertyName: 'Rotation', expressionString: 'time * 30'
    });
    assertNoError(setExpr);

    // Set two Rotation keyframes (overridden by expression but exist on timeline)
    const setKfs = await send('batch', {
      commands: [
        { command: 'setLayerKeyframe', args: { compName: COMP_NAME, layerIndex: li, propertyName: 'Rotation', timeInSeconds: 0, value: 0 } },
        { command: 'setLayerKeyframe', args: { compName: COMP_NAME, layerIndex: li, propertyName: 'Rotation', timeInSeconds: 3, value: 360 } }
      ]
    });
    if (setKfs.failed > 0) throw new Error('failed to set Rotation keyframes');

    // Remove them via batch
    const r = await send('batch', {
      commands: [
        { command: 'removePropertyKeyframes', args: { compName: COMP_NAME, layerIndex: li, propertyName: 'Rotation' } }
      ]
    });
    if (r.failed > 0) throw new Error('removePropertyKeyframes via batch failed');
    return `${r.succeeded}/${r.total} succeeded`;
  });
}
