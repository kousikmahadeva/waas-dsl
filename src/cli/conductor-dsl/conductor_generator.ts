import { randomUUID } from 'node:crypto';
import type { Code_Block, Task, Task_Or_Code, Workflow } from '../../language/generated/ast.js';
import type { ConductorTaskDefinition, ConductorWorkflowDefinition } from './conductor_types.js';
import {
    cloneScope,
    createGenerationScope,
    generateTaskCompositionDefinition,
    registerTaskReference,
    resolveJsonObject,
    type GenerationScope,
    type ResolveTemplateFn
} from './template_inlining.js';

export async function generateWorkflowDefinitions(
    workflows: Workflow[],
    resolveTemplate: ResolveTemplateFn
): Promise<ConductorWorkflowDefinition[]> {
    const workflowDefinitions: ConductorWorkflowDefinition[] = [];
    for (const workflow of workflows) {
        workflowDefinitions.push(await generateWorkflowDefinition(workflow, createGenerationScope(resolveTemplate)));
    }
    return workflowDefinitions;
}

async function generateWorkflowDefinition(workflow: Workflow, scope: GenerationScope): Promise<ConductorWorkflowDefinition> {
    const workflowDefinition: ConductorWorkflowDefinition = {
        name: workflow.name,
        createTime: new Date().toISOString(),
        tasks: []
    };
    if(workflow.version !== undefined) {
        workflowDefinition.version = workflow.version;
    }
    if(workflow.description !== undefined) {
        workflowDefinition.description = workflow.description;
    }
    if(workflow.inputs !== undefined) {
        workflowDefinition.inputParameters = workflow.inputs.elements;
    }

    for (const task of workflow.tasks) {
        workflowDefinition.tasks.push(...(await splitTaskOrCode(task, scope)));
    }

    return workflowDefinition;
}

async function splitTaskOrCode(taskOrCode: Task_Or_Code, scope: GenerationScope): Promise<ConductorTaskDefinition[]> {
    if (taskOrCode.$type === 'Task') {
        return [generateTaskDefinition(taskOrCode, scope)];
    }
    if (taskOrCode.$type === 'Code_Block') {
        return [await generateCodeDefinition(taskOrCode, scope)];
    }
    return await generateTaskCompositionDefinition(taskOrCode, scope, splitTaskOrCode);
}

function generateTaskDefinition(task: Task, scope: GenerationScope): ConductorTaskDefinition {
    const defaultReferenceName = task.variablename ?? task.task_name;
    const taskReferenceName = scope.referenceMap.get(defaultReferenceName) ?? defaultReferenceName;
    const taskDefinition: ConductorTaskDefinition = {
        name: task.task_name,
        taskReferenceName
    };
    task.blocks.forEach(block => {
        if (block.type !== undefined) {
            taskDefinition.type = block.type;
        } else if (block.timeout !== undefined) {
            taskDefinition.timeoutPolicy = "TIME_OUT_WF";
            const timeoutSeconds = convertTimeoutToSeconds(block.timeout);
            if (timeoutSeconds !== undefined) {
                taskDefinition.timeoutSeconds = timeoutSeconds;
            }
        } else if (block.retries !== undefined) {
            taskDefinition.retryCount = block.retries;
        } else if (block.payload !== undefined) {
            taskDefinition.inputParameters = resolveJsonObject(block.payload, scope);
        }
    });
    registerTaskReference(scope, task.task_name, taskReferenceName);
    if (task.variablename !== undefined) {
        registerTaskReference(scope, task.variablename, taskReferenceName);
    }
    return taskDefinition;
}

async function generateCodeDefinition(code: Code_Block, scope: GenerationScope): Promise<ConductorTaskDefinition> {
    if(code.parallel_blocks?.length > 0) {
        return generateParallelDefinition(code);
    } else {
        return await generateIfDefinition(code, scope);
    }
}

function generateParallelDefinition(parallel: Code_Block): ConductorTaskDefinition {
    const uuid = randomUUID();
    const taskDefinition: ConductorTaskDefinition = {
        name: uuid,
        taskReferenceName: uuid,
        type: 'PARALLEL'
    };
    return taskDefinition;
}

async function generateIfDefinition(if_block: Code_Block, scope: GenerationScope): Promise<ConductorTaskDefinition> {
    const uuid = randomUUID();
    const taskDefinition: ConductorTaskDefinition = {
        name: uuid,
        taskReferenceName: uuid,
        type: 'SWITCH',
        decisionCases:{
            TRUE: [],
            FALSE: []
        }
    };
    const trueBranchScope = cloneScope(scope);
    for (const block of if_block.condition_blocks) {
        taskDefinition.decisionCases?.['TRUE']?.push(...(await splitTaskOrCode(block, trueBranchScope)));
    }
    const falseBranchScope = cloneScope(scope);
    for (const block of if_block.else_blocks) {
        taskDefinition.decisionCases?.['FALSE']?.push(...(await splitTaskOrCode(block, falseBranchScope)));
    }
    return taskDefinition;
}

function convertTimeoutToSeconds(timeout: string): number | undefined {
    const normalizedTimeout = normalizeLiteralString(timeout).trim();
    const match = normalizedTimeout.match(/^(\d+)([smhd])?$/i);
    if (match === null) {
        return undefined;
    }

    const value = Number.parseInt(match[1], 10);
    const unit = (match[2] ?? 's').toLowerCase();
    if (unit === 'm') {
        return value * 60;
    }
    if (unit === 'h') {
        return value * 60 * 60;
    }
    if (unit === 'd') {
        return value * 24 * 60 * 60;
    }

    return value;
}

function normalizeLiteralString(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        return value.slice(1, -1);
    }
    return value;
}