export type ConductorValue = string | number | boolean | null | ConductorValue[] | { [key: string]: ConductorValue };

export type ConductorTaskDefinition = {
    name: string;
    taskReferenceName: string;
    type?: string;
    timeoutPolicy?: string;
    timeoutSeconds?: number;
    retryCount?: number;
    inputParameters?: Record<string, ConductorValue>;
    decisionCases?: Record<string, ConductorTaskDefinition[]>;
};

export type ConductorWorkflowDefinition = {
    name: string;
    description?: string;
    version?: number;
    tasks: ConductorTaskDefinition[];
    createTime: string;
    inputParameters?: string[];
};
