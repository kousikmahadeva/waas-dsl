import { randomUUID } from 'node:crypto';
import type { Task, Workflow, Code_Block, Task_Composition, JSON_Object, JSON_Value } from '../../language/generated/ast.js';

type ConductorTaskDefinition = {
    name: string;
    taskReferenceName: string;
    type?: string;
    timeoutPolicy?: string;
    timeoutSeconds?: number;
    retryCount?: number;
    inputParameters?: Record<string, unknown>;
    subWorkflowParam?: {
        name: string;
    };
    decisionCases?: Record<string, ConductorTaskDefinition[]>;
};

type ConductorWorkflowDefinition = {
    name: string;
    description?: string;
    version?: number;
    tasks?: ConductorTaskDefinition[];
    createTime: string;
    inputParameters?: string[];
};

export function generateWorkflowDefinitions(workflows: Workflow[]): ConductorWorkflowDefinition[] {
    return workflows.map(workflow => generateWorkflowDefinition(workflow));
}

function generateWorkflowDefinition(workflow: Workflow): ConductorWorkflowDefinition {
    const workflowDefinition: ConductorWorkflowDefinition = {
        name: workflow.name,
        createTime: new Date().toISOString(),
        tasks: []
    };
    if (workflow.version !== undefined) {
        workflowDefinition.version = workflow.version;
    }
    if (workflow.description !== undefined) {
        workflowDefinition.description = workflow.description;
    }
    if(workflow.inputs !== undefined) {
        workflowDefinition.inputParameters = workflow.inputs.elements;
    }

    workflow.tasks.forEach(task => {
        workflowDefinition.tasks?.push(splitTaskOrCode(task));
    });

    return workflowDefinition;
}

function splitTaskOrCode(taskOrCode: Task | Code_Block | Task_Composition): ConductorTaskDefinition {
    if (taskOrCode.$type === 'Task') {
        return generateTaskDefinition(taskOrCode as Task);
    } else {
        if (taskOrCode.$type === 'Code_Block') {
            return generateCodeDefinition(taskOrCode as Code_Block);
        } else {
            return generateTaskCompositionDefinition(taskOrCode as Task_Composition);
        }
    }
}

function generateTaskCompositionDefinition(taskComposition: Task_Composition): ConductorTaskDefinition {
    const taskReferenceName = taskComposition.variablename ?? taskComposition.template_name;
    const taskDefinition: ConductorTaskDefinition = {
        name: taskComposition.template_name,
        taskReferenceName,
        type: 'SUB_WORKFLOW',
        inputParameters: generateInputParameters(taskComposition.inputs),
        subWorkflowParam: {
            name: taskComposition.template_name
        }
    };
    return taskDefinition;
}

function generateTaskDefinition(task: Task): ConductorTaskDefinition {
    const taskDefinition: ConductorTaskDefinition = {
        name: task.task_name,
        taskReferenceName: task.task_name
    };
    task.blocks.forEach(block => {
        if (block.type !== undefined) {
            taskDefinition.type = block.type;
        } else if (block.timeout !== undefined) {
            taskDefinition.timeoutPolicy = "TIME_OUT_WF";
            taskDefinition.timeoutSeconds = parseInt(block.timeout.replace('m', '')) * 60;
        } else if (block.retries !== undefined) {
            taskDefinition.retryCount = block.retries;
        }
    });
    return taskDefinition;
}

function generateCodeDefinition(code: Code_Block): ConductorTaskDefinition {
    if(code.parallel_blocks?.length > 0) {
        return generateParallelDefinition(code as Code_Block);
    } else {
        return generateIfDefinition(code as Code_Block);
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

function generateIfDefinition(if_block: Code_Block): ConductorTaskDefinition {
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
    if_block.condition_blocks.forEach(block => {
        taskDefinition.decisionCases?.['TRUE']?.push(splitTaskOrCode(block));
    });
    if_block.else_blocks.forEach(block => {
        taskDefinition.decisionCases?.['FALSE']?.push(splitTaskOrCode(block));
    });
    return taskDefinition;
}

function generateInputParameters(inputObject: JSON_Object): Record<string, unknown> {
    const inputParameters: Record<string, unknown> = {};
    inputObject.key.forEach((key, index) => {
        const keyName = key.member !== undefined ? `${key.name}.${key.member}` : key.name;
        const value = inputObject.value[index];
        if (value !== undefined) {
            inputParameters[keyName] = convertAnyValue(value);
        }
    });
    return inputParameters;
}

function convertAnyValue(value: JSON_Object | JSON_Value): unknown {
    if ('key' in value) {
        return generateInputParameters(value);
    }
    if (value.member === undefined) {
        return parsePrimitiveValue(value.name);
    }
    if (value.name === 'inputs') {
        return `\${workflow.input.${value.member}}`;
    }
    return `\${${value.name}.output.${value.member}}`;
}

function parsePrimitiveValue(value: string): string | number | boolean {
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    if (/^-?\d+$/.test(value)) {
        return Number(value);
    }
    return value;
}