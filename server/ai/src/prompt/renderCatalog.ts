import { COMMAND_PARAMS, type CommandSpec } from '../tools/command-params.js';

/**
 * Renders the always-present `<command_catalog>` body from the COMMAND_PARAMS
 * registry. Output is deterministic (registry insertion order) so it stays a
 * byte-stable, cacheable prefix.
 *
 * Format — one line per command:
 *   commandName(required:spec; optional?:spec; ...) — summary
 * Params are separated by "; " (never ", ") so comma-bearing specs like
 * "{r,g,b} 0-255" stay unambiguous. Optional params carry a trailing "?".
 *
 * Shared targeting params (compName/layerIndex/layerName/propertyPath/etc.) are
 * documented once in the preamble, not repeated per command.
 */

const TARGETING_PREAMBLE = [
  'Call any command via runScript({ script, parameters }). Params are optional unless shown without "?".',
  'Shared targeting (do not guess — omit to use the active comp / selection):',
  '- Layer/comp commands accept: compName? (or compIndex?), and layerIndex? (1-based) or layerName? to pick the layer.',
  '- Property commands accept: propertyPath? (array, e.g. ["Transform","Position"]) or propertyName?.',
  '- Marker edit commands accept: markerIndex? (1-based) or time? (seconds).',
].join('\n');

function renderParam(name: string, spec: string, required: boolean): string {
  return `${name}${required ? '' : '?'}:${spec}`;
}

function renderCommand(name: string, spec: CommandSpec): string {
  const required = new Set(spec.required ?? []);
  const names = Object.keys(spec.params);
  // Required params first (in declaration order), then optional.
  const ordered = [...names.filter(n => required.has(n)), ...names.filter(n => !required.has(n))];
  const rendered = ordered.map(n => renderParam(n, spec.params[n], required.has(n))).join('; ');
  return `${name}(${rendered}) — ${spec.summary}`;
}

export function renderCommandCatalog(): string {
  const entries = Object.entries(COMMAND_PARAMS) as [string, CommandSpec][];

  // Group by domain, preserving first-seen domain order from the registry.
  const domains: string[] = [];
  const byDomain = new Map<string, string[]>();
  for (const [name, spec] of entries) {
    if (!byDomain.has(spec.domain)) {
      byDomain.set(spec.domain, []);
      domains.push(spec.domain);
    }
    byDomain.get(spec.domain)!.push(renderCommand(name, spec));
  }

  const sections = domains.map(d => `## ${d}\n${byDomain.get(d)!.join('\n')}`);
  return `${TARGETING_PREAMBLE}\n\n${sections.join('\n\n')}`;
}
