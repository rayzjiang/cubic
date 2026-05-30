import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AE_TOOLS, COMMAND_NAMES } from './definitions.js';

describe('AE_TOOLS', () => {
  it('exports exactly 4 tools', () => {
    expect(AE_TOOLS).toHaveLength(4);
    const names = AE_TOOLS.map(t => t.name);
    expect(names).toContain('runScript');
    expect(names).toContain('batch');
    expect(names).toContain('createComposition');
    expect(names).toContain('getHelp');
  });

  it('every tool has a non-empty name and description', () => {
    for (const tool of AE_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('every tool schema converts to a valid JSON Schema object', () => {
    for (const tool of AE_TOOLS) {
      const schema = zodToJsonSchema(tool.schema);
      expect(schema).toBeDefined();
      expect(typeof schema).toBe('object');
      // Anthropic requires type: 'object' at the top level
      expect((schema as { type?: string }).type).toBe('object');
    }
  });

  it('runScript script field enum equals COMMAND_NAMES', () => {
    const runScript = AE_TOOLS.find(t => t.name === 'runScript')!;
    const schema = zodToJsonSchema(runScript.schema) as {
      properties?: { script?: { enum?: string[] } };
    };
    const enumValues = schema.properties?.script?.enum ?? [];
    expect(new Set(enumValues)).toEqual(new Set(COMMAND_NAMES));
  });

  it('batch commands[].script enum equals COMMAND_NAMES', () => {
    const batch = AE_TOOLS.find(t => t.name === 'batch')!;
    const schema = zodToJsonSchema(batch.schema) as {
      properties?: {
        commands?: {
          items?: { properties?: { script?: { enum?: string[] } } };
        };
      };
    };
    const enumValues = schema.properties?.commands?.items?.properties?.script?.enum ?? [];
    expect(new Set(enumValues)).toEqual(new Set(COMMAND_NAMES));
  });

  it('COMMAND_NAMES has no duplicates', () => {
    const set = new Set(COMMAND_NAMES);
    expect(set.size).toBe(COMMAND_NAMES.length);
  });

  it('createComposition schema includes required fields', () => {
    const createComp = AE_TOOLS.find(t => t.name === 'createComposition')!;
    const schema = zodToJsonSchema(createComp.schema) as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toContain('name');
    expect(schema.required).toContain('width');
    expect(schema.required).toContain('height');
    expect(schema.properties).toHaveProperty('frameRate');
    expect(schema.properties).toHaveProperty('backgroundColor');
  });
});
