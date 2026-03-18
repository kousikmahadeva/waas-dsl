import type { Model } from '../language/generated/ast.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './cli-util.js';
import { generateWorkflowDefinitions } from './conductor-dsl/conductor_generator.js';
import type { Workflow } from '../language/generated/ast.js';
import type { ResolveTemplateFn } from './conductor-dsl/template_inlining.js';

export function generateJavaScript(model: Model, filePath: string, destination: string | undefined): string {
    const data = extractDestinationAndName(filePath, destination);
    const generatedFilePath = `${path.join(data.destination, data.name)}.js`;
    if (!fs.existsSync(data.destination)) {
        fs.mkdirSync(data.destination, { recursive: true });
    }
    return generatedFilePath;
}

export async function generateConductorDSL(
    model: Model,
    filePath: string,
    destination: string | undefined,
    resolveTemplate: ResolveTemplateFn
): Promise<string> {
    const data = extractDestinationAndName(filePath, destination);
    const generatedFilePath = `${path.join(data.destination, data.name)}-conductor.json`;

    if (!fs.existsSync(data.destination)) {
        fs.mkdirSync(data.destination, { recursive: true });
    }

    const workflows = model.elements.filter((element): element is Workflow => element.$type === 'Workflow');

    if (workflows.length > 0) {
        const workflowDefinitions = await generateWorkflowDefinitions(workflows, resolveTemplate);
        fs.writeFileSync(generatedFilePath, JSON.stringify(workflowDefinitions, null, 2));
    }
    return generatedFilePath;
}