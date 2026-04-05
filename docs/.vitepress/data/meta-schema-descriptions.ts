/**
 * Build source-backed description annotations for DreamCLI's definition meta-schema.
 *
 * @module
 */

import type { NormalizedApiModel, NormalizedApiNode } from './typedoc.ts';

interface MetaSchemaDescriptionNode {
  readonly description?: string;
  readonly properties?: Readonly<Record<string, MetaSchemaDescriptionNode>>;
}

interface MetaSchemaDescriptionResult {
  readonly root: MetaSchemaDescriptionNode;
  readonly defs: Readonly<Record<string, MetaSchemaDescriptionNode>>;
}

interface NodeTarget {
  readonly exportId: string;
  readonly property?: string;
}

const ROOT_TARGET: NodeTarget = { exportId: 'dreamcli:CLISchema' };

const ROOT_PROPERTY_TARGETS: Readonly<Record<string, NodeTarget>> = {
  name: { exportId: 'dreamcli:CLISchema', property: 'name' },
  version: { exportId: 'dreamcli:CLISchema', property: 'version' },
  description: { exportId: 'dreamcli:CLISchema', property: 'description' },
  defaultCommand: {
    exportId: 'dreamcli:CLISchema',
    property: 'defaultCommand',
  },
  commands: { exportId: 'dreamcli:CLISchema', property: 'commands' },
};

const DEF_TARGETS: Readonly<Record<string, NodeTarget>> = {
  command: { exportId: 'dreamcli:CommandSchema' },
  flag: { exportId: 'dreamcli:FlagSchema' },
  arg: { exportId: 'dreamcli:ArgSchema' },
  prompt: { exportId: 'dreamcli:PromptConfig' },
  choice: { exportId: 'dreamcli:SelectChoice' },
  example: { exportId: 'dreamcli:CommandExample' },
};

const DEF_PROPERTY_TARGETS: Readonly<
  Record<string, Readonly<Record<string, NodeTarget>>>
> = {
  command: {
    name: { exportId: 'dreamcli:CommandSchema', property: 'name' },
    description: {
      exportId: 'dreamcli:CommandSchema',
      property: 'description',
    },
    aliases: { exportId: 'dreamcli:CommandSchema', property: 'aliases' },
    hidden: { exportId: 'dreamcli:CommandSchema', property: 'hidden' },
    examples: { exportId: 'dreamcli:CommandSchema', property: 'examples' },
    flags: { exportId: 'dreamcli:CommandSchema', property: 'flags' },
    args: { exportId: 'dreamcli:CommandSchema', property: 'args' },
    commands: { exportId: 'dreamcli:CommandSchema', property: 'commands' },
  },
  flag: {
    kind: { exportId: 'dreamcli:FlagSchema', property: 'kind' },
    presence: { exportId: 'dreamcli:FlagPresence' },
    defaultValue: { exportId: 'dreamcli:FlagSchema', property: 'defaultValue' },
    aliases: { exportId: 'dreamcli:FlagSchema', property: 'aliases' },
    envVar: { exportId: 'dreamcli:FlagSchema', property: 'envVar' },
    configPath: { exportId: 'dreamcli:FlagSchema', property: 'configPath' },
    description: { exportId: 'dreamcli:FlagSchema', property: 'description' },
    enumValues: { exportId: 'dreamcli:FlagSchema', property: 'enumValues' },
    elementSchema: {
      exportId: 'dreamcli:FlagSchema',
      property: 'elementSchema',
    },
    prompt: { exportId: 'dreamcli:FlagSchema', property: 'prompt' },
    deprecated: { exportId: 'dreamcli:FlagSchema', property: 'deprecated' },
    propagate: { exportId: 'dreamcli:FlagSchema', property: 'propagate' },
  },
  arg: {
    name: { exportId: 'dreamcli:CommandArgEntry' },
    kind: { exportId: 'dreamcli:ArgSchema', property: 'kind' },
    presence: { exportId: 'dreamcli:ArgPresence' },
    variadic: { exportId: 'dreamcli:ArgSchema', property: 'variadic' },
    stdinMode: { exportId: 'dreamcli:ArgSchema', property: 'stdinMode' },
    defaultValue: { exportId: 'dreamcli:ArgSchema', property: 'defaultValue' },
    description: { exportId: 'dreamcli:ArgSchema', property: 'description' },
    envVar: { exportId: 'dreamcli:ArgSchema', property: 'envVar' },
    enumValues: { exportId: 'dreamcli:ArgSchema', property: 'enumValues' },
    deprecated: { exportId: 'dreamcli:ArgSchema', property: 'deprecated' },
  },
  prompt: {
    kind: { exportId: 'dreamcli:PromptKind' },
    message: { exportId: 'dreamcli:PromptConfigBase', property: 'message' },
    placeholder: {
      exportId: 'dreamcli:InputPromptConfig',
      property: 'placeholder',
    },
    choices: { exportId: 'dreamcli:SelectPromptConfig', property: 'choices' },
    min: { exportId: 'dreamcli:MultiselectPromptConfig', property: 'min' },
    max: { exportId: 'dreamcli:MultiselectPromptConfig', property: 'max' },
  },
  choice: {
    value: { exportId: 'dreamcli:SelectChoice', property: 'value' },
    label: { exportId: 'dreamcli:SelectChoice', property: 'label' },
    description: { exportId: 'dreamcli:SelectChoice', property: 'description' },
  },
  example: {
    command: { exportId: 'dreamcli:CommandExample', property: 'command' },
    description: {
      exportId: 'dreamcli:CommandExample',
      property: 'description',
    },
  },
};

function getExportNode(
  normalized: NormalizedApiModel,
  exportId: string,
): NormalizedApiNode | undefined {
  return normalized.exports.find((entry) => entry.id === exportId)?.reflection;
}

function getNodeDescription(
  normalized: NormalizedApiModel,
  target: NodeTarget,
): MetaSchemaDescriptionNode | undefined {
  const node = getExportNode(normalized, target.exportId);
  if (node === undefined) {
    return undefined;
  }

  if (target.property === undefined) {
    return toDescriptionNode(node.comment?.summary);
  }

  const child = node.children.find((entry) => entry.name === target.property);
  return toDescriptionNode(child?.comment?.summary);
}

function toDescriptionNode(
  summary: string | undefined,
): MetaSchemaDescriptionNode | undefined {
  const description = normalizeSummary(summary);
  if (description === undefined) {
    return undefined;
  }

  return { description };
}

function normalizeSummary(summary: string | undefined): string | undefined {
  if (summary === undefined) {
    return undefined;
  }

  const trimmed = summary.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildNode(
  normalized: NormalizedApiModel,
  nodeTarget: NodeTarget,
  propertyTargets: Readonly<Record<string, NodeTarget>>,
): MetaSchemaDescriptionNode {
  const description = getNodeDescription(normalized, nodeTarget)?.description;
  const properties: Record<string, MetaSchemaDescriptionNode> = {};
  for (const [name, target] of Object.entries(propertyTargets)) {
    const descriptionNode = getNodeDescription(normalized, target);
    if (descriptionNode !== undefined) {
      properties[name] = descriptionNode;
    }
  }

  return {
    ...(description !== undefined ? { description } : {}),
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
  };
}

function qualifyTarget(packageName: string, target: NodeTarget): NodeTarget {
  return {
    exportId: target.exportId.replace(/^dreamcli:/, `${packageName}:`),
    ...(target.property !== undefined ? { property: target.property } : {}),
  };
}

function qualifyTargets(
  packageName: string,
  targets: Readonly<Record<string, NodeTarget>>,
): Record<string, NodeTarget> {
  return Object.fromEntries(
    Object.entries(targets).map(([name, target]) => [
      name,
      qualifyTarget(packageName, target),
    ]),
  );
}

function renderDescriptionNode(
  node: MetaSchemaDescriptionNode,
  indent: number,
): string {
  const pad = '\t'.repeat(indent);
  const lines: string[] = ['{'];

  if (node.description !== undefined) {
    lines.push(`${pad}\tdescription: ${JSON.stringify(node.description)},`);
  }

  if (node.properties !== undefined) {
    lines.push(`${pad}\tproperties: {`);
    for (const [name, child] of Object.entries(node.properties)) {
      lines.push(
        `${pad}\t\t${JSON.stringify(name)}: ${renderDescriptionNode(child, indent + 2)},`,
      );
    }
    lines.push(`${pad}\t},`);
  }

  lines.push(`${pad}}`);
  return lines.join('\n');
}

export function buildDefinitionMetaSchemaDescriptions(
  normalized: NormalizedApiModel,
): MetaSchemaDescriptionResult {
  const rootTarget = qualifyTarget(normalized.packageName, ROOT_TARGET);
  const rootPropertyTargets = qualifyTargets(
    normalized.packageName,
    ROOT_PROPERTY_TARGETS,
  );
  const defTargets = qualifyTargets(normalized.packageName, DEF_TARGETS);
  const defPropertyTargets: Record<
    string,
    Record<string, NodeTarget>
  > = Object.fromEntries(
    Object.entries(DEF_PROPERTY_TARGETS).map(([name, targets]) => [
      name,
      qualifyTargets(normalized.packageName, targets),
    ]),
  );

  return {
    root: buildNode(normalized, rootTarget, rootPropertyTargets),
    defs: Object.fromEntries(
      Object.entries(defTargets).map(([name, target]) => [
        name,
        buildNode(normalized, target, defPropertyTargets[name] ?? {}),
      ]),
    ),
  };
}

export function renderDefinitionMetaSchemaDescriptions(
  descriptions: MetaSchemaDescriptionResult,
): string {
  const defs = Object.entries(descriptions.defs)
    .map(
      ([name, node]) =>
        `\t\t${JSON.stringify(name)}: ${renderDescriptionNode(node, 2)},`,
    )
    .join('\n');

  return [
    '/**',
    ' * Generated definition meta-schema descriptions from normalized TypeDoc output.',
    ' *',
    ' * @module',
    ' */',
    '',
    'const definitionMetaSchemaDescriptions = {',
    `\troot: ${renderDescriptionNode(descriptions.root, 1)},`,
    '\tdefs: {',
    defs,
    '\t},',
    '} as const;',
    '',
    'export { definitionMetaSchemaDescriptions };',
    '',
  ].join('\n');
}
