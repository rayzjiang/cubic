import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolUse } from '../llm/types.js';

// Mock the bridge client + session cache before importing the unit under test.
const { callRunScript, invalidate } = vi.hoisted(() => ({
  callRunScript: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('../mcp/client.js', () => ({ mcpClient: { callRunScript } }));
vi.mock('../context/cache.js', () => ({ sessionCache: { invalidate } }));

import { executeTool } from './executeTool.js';

const runScript = (script: string): ToolUse => ({ id: 'x', name: 'runScript', input: { script } });

describe('executeTool', () => {
  beforeEach(() => {
    callRunScript.mockReset();
    invalidate.mockReset();
  });

  it('runs a mutating command and invalidates the cache on success', async () => {
    callRunScript.mockResolvedValue({ status: 'success', layerIndex: 1 });
    const exec = await executeTool(runScript('createLayer'));

    expect(callRunScript).toHaveBeenCalledWith('createLayer', {});
    expect(exec.ok).toBe(true);
    expect(exec.block.is_error).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('does NOT invalidate the cache after a read-only command', async () => {
    callRunScript.mockResolvedValue({ status: 'success', projectName: 'demo' });
    const exec = await executeTool(runScript('getProjectInfo'));

    expect(exec.ok).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('surfaces a handler error as an error tool_result without retrying (non-retryable)', async () => {
    callRunScript.mockResolvedValue({ status: 'error', errorCode: 'LAYER_NOT_FOUND', message: 'no layer 9' });
    const exec = await executeTool(runScript('setLayerProperties'));

    expect(callRunScript).toHaveBeenCalledTimes(1);
    expect(exec.ok).toBe(false);
    expect(exec.errorCode).toBe('LAYER_NOT_FOUND');
    expect(exec.block.is_error).toBe(true);
    expect(exec.retried).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('retries a RENDER_FAILED exactly once', async () => {
    callRunScript
      .mockResolvedValueOnce({ status: 'error', errorCode: 'RENDER_FAILED', message: 'flush race' })
      .mockResolvedValueOnce({ status: 'success', path: '/tmp/f.png' });
    const exec = await executeTool(runScript('saveFrameToPng'));

    expect(callRunScript).toHaveBeenCalledTimes(2);
    expect(exec.ok).toBe(true);
    expect(exec.retried).toBe(true);
  });

  it('translates batch sub-commands from {script,parameters} to the bridge {command,args} shape', async () => {
    callRunScript.mockResolvedValue({ status: 'success' });
    const tool: ToolUse = {
      id: 'b',
      name: 'batch',
      input: {
        commands: [
          { script: 'createLayer', parameters: { type: 'solid' } },
          { script: 'setLayerKeyframe', parameters: { propertyName: 'Opacity', value: 0, timeInSeconds: 0 } },
        ],
        groupLabel: 'add',
      },
    };
    await executeTool(tool);

    expect(callRunScript).toHaveBeenCalledWith('batch', {
      commands: [
        { command: 'createLayer', args: { type: 'solid' } },
        { command: 'setLayerKeyframe', args: { propertyName: 'Opacity', value: 0, timeInSeconds: 0 } },
      ],
      groupLabel: 'add',
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('turns a transport throw into a BRIDGE_ERROR tool_result instead of throwing', async () => {
    callRunScript.mockRejectedValue(new Error('timed out after 10s'));
    const exec = await executeTool(runScript('createLayer'));

    expect(exec.ok).toBe(false);
    expect(exec.errorCode).toBe('BRIDGE_ERROR');
    expect(exec.block.is_error).toBe(true);
    expect(exec.block.content).toContain('timed out');
    expect(invalidate).not.toHaveBeenCalled();
  });
});
