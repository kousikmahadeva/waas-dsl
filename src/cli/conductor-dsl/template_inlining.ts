import { randomUUID } from 'node:crypto';
import {
    isJSON_Object,
    isJSON_Value,
    type Code_Block,
    type JSON_Object,
    type JSON_Value,
    type Task,
    type Task_Composition,
    type Task_Or_Code,
    type Template
} from '../../language/generated/ast.js';
import type { ConductorTaskDefinition, ConductorValue } from './conductor_types.js';

export type GenerationScope = {
    resolveTemplate: ResolveTemplateFn;
    inputMap: Map<string, ConductorValue>;
    referenceMap: Map<string, string>;
    returnMap: Map<string, ConductorValue>;
};

export type ResolveTemplateFn = (templateName: string) => Promise<Template>;

type GenericAnyValueNode = {
    $type: string;
    $cstNode?: {
        text?: string;
    };
};

export type SplitTaskOrCodeFn = (taskOrCode: Task_Or_Code, scope: GenerationScope) => Promise<ConductorTaskDefinition[]>;

export function createGenerationScope(resolveTemplate: ResolveTemplateFn): GenerationScope {
    return {
        resolveTemplate,
        inputMap: new Map<string, ConductorValue>(),
        referenceMap: new Map<string, string>(),
        returnMap: new Map<string, ConductorValue>()
    };
}

export function cloneScope(scope: GenerationScope): GenerationScope {
    return {
        resolveTemplate: scope.resolveTemplate,
        inputMap: new Map(scope.inputMap),
        referenceMap: new Map(scope.referenceMap),
        returnMap: new Map(scope.returnMap)
    };
}

export function registerTaskReference(scope: GenerationScope, originalName: string, taskReferenceName: string): void {
    scope.referenceMap.set(originalName, taskReferenceName);
}

export function resolveJsonObject(jsonObject: JSON_Object, scope: GenerationScope): Record<string, ConductorValue> {
    const resolvedObject: Record<string, ConductorValue> = {};
    jsonObject.key.forEach((key, index) => {
        const keyName = getJsonKeyName(key);
        const value = jsonObject.value[index];
        if (value !== undefined) {
            resolvedObject[keyName] = resolveAnyValue(value, scope);
        }
    });
    return resolvedObject;
}

export async function generateTaskCompositionDefinition(
    taskComposition: Task_Composition,
    scope: GenerationScope,
    splitTaskOrCode: SplitTaskOrCodeFn
): Promise<ConductorTaskDefinition[]> {
    const template = await scope.resolveTemplate(taskComposition.template_name);

    const inlineScope = cloneScope(scope);
    inlineScope.inputMap = buildTemplateInputMap(template, taskComposition, scope);

    const inlinePrefix = `${taskComposition.variablename ?? taskComposition.template_name}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    registerTemplateTaskReferences(template.tasks, inlinePrefix, inlineScope);

    const inlinedTasks: ConductorTaskDefinition[] = [];
    for (const task of template.tasks) {
        inlinedTasks.push(...(await splitTaskOrCode(task, inlineScope)));
    }

    if (taskComposition.variablename !== undefined && template.returns !== undefined) {
        const mappedReturnObject = resolveJsonObject(template.returns, inlineScope);
        Object.entries(mappedReturnObject).forEach(([key, value]) => {
            scope.returnMap.set(`${taskComposition.variablename}.${key}`, value);
        });
        scope.returnMap.set(taskComposition.variablename, mappedReturnObject);
    }

    return inlinedTasks;
}

function buildTemplateInputMap(template: Template, taskComposition: Task_Composition, scope: GenerationScope): Map<string, ConductorValue> {
    const providedInputMap = new Map<string, ConductorValue>();
    taskComposition.inputs.key.forEach((key, index) => {
        const keyName = getJsonKeyName(key);
        const value = taskComposition.inputs.value[index];
        if (value !== undefined) {
            providedInputMap.set(keyName, resolveAnyValue(value, scope));
        }
    });

    const templateInputMap = new Map<string, ConductorValue>();
    template.inputs.elements.forEach(inputName => {
        templateInputMap.set(inputName, providedInputMap.get(inputName) ?? `inputs.${inputName}`);
    });

    providedInputMap.forEach((value, key) => {
        if (!templateInputMap.has(key)) {
            templateInputMap.set(key, value);
        }
    });

    return templateInputMap;
}

function registerTemplateTaskReferences(tasks: Task_Or_Code[], inlinePrefix: string, scope: GenerationScope): void {
    tasks.forEach(taskOrCode => {
        if (taskOrCode.$type === 'Task') {
            const task = taskOrCode as Task;
            const originalReferenceName = task.variablename ?? task.task_name;
            const prefixedReferenceName = `${inlinePrefix}_${originalReferenceName}`;
            registerTaskReference(scope, task.task_name, prefixedReferenceName);
            if (task.variablename !== undefined) {
                registerTaskReference(scope, task.variablename, prefixedReferenceName);
            }
        } else if (taskOrCode.$type === 'Code_Block') {
            const codeBlock = taskOrCode as Code_Block;
            registerTemplateTaskReferences(codeBlock.condition_blocks, inlinePrefix, scope);
            registerTemplateTaskReferences(codeBlock.else_blocks, inlinePrefix, scope);
            registerTemplateTaskReferences(codeBlock.parallel_blocks, inlinePrefix, scope);
        }
    });
}

function resolveAnyValue(value: unknown, scope: GenerationScope): ConductorValue {
    if (typeof value === 'string') {
        return normalizeLiteralString(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (value === null) {
        return null;
    }
    if (Array.isArray(value)) {
        return value.map(element => resolveAnyValue(element, scope));
    }
    if (isJSON_Object(value)) {
        return resolveJsonObject(value, scope);
    }
    if (isJSON_Value(value)) {
        return resolveJsonValue(value, scope);
    }
    if (isGenericAnyValueNode(value)) {
        return parseCstLiteral(value.$cstNode?.text);
    }

    return String(value);
}

function resolveJsonValue(value: JSON_Value, scope: GenerationScope): ConductorValue {
    const name = value.name;
    if (value.member !== undefined) {
        const returnAlias = scope.returnMap.get(`${name}.${value.member}`);
        if (returnAlias !== undefined) {
            return returnAlias;
        }

        if (name === 'inputs') {
            return scope.inputMap.get(value.member) ?? `inputs.${value.member}`;
        }

        const mappedReference = scope.referenceMap.get(name) ?? name;
        return `${mappedReference}.${value.member}`;
    }

    const directReturnAlias = scope.returnMap.get(name);
    if (directReturnAlias !== undefined) {
        return directReturnAlias;
    }

    const mappedInput = scope.inputMap.get(name);
    if (mappedInput !== undefined) {
        return mappedInput;
    }

    if (name === 'true') {
        return true;
    }
    if (name === 'false') {
        return false;
    }

    return scope.referenceMap.get(name) ?? name;
}

function getJsonKeyName(key: JSON_Value): string {
    return key.member !== undefined ? `${key.name}.${key.member}` : key.name;
}

function normalizeLiteralString(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        return value.slice(1, -1);
    }
    return value;
}

function parseCstLiteral(rawValue: string | undefined): ConductorValue {
    if (rawValue === undefined) {
        return '';
    }

    const value = rawValue.trim();
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }

    if (/^\d+$/.test(value)) {
        return Number.parseInt(value, 10);
    }

    return normalizeLiteralString(value);
}

function isGenericAnyValueNode(value: unknown): value is GenericAnyValueNode {
    return typeof value === 'object'
        && value !== null
        && '$type' in value
        && (value as { $type?: string }).$type === 'ANY_VALUE';
}
