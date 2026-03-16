import type { Model } from '../language/generated/ast.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './cli-util.js';
import { generateWorkflowDefinitions } from './conductor-dsl/conductor_generator.js';
import type { Workflow } from '../language/generated/ast.js';

export function generateJavaScript(model: Model, filePath: string, destination: string | undefined): string {
    const data = extractDestinationAndName(filePath, destination);
    const generatedFilePath = `${path.join(data.destination, data.name)}.js`;
    if (!fs.existsSync(data.destination)) {
        fs.mkdirSync(data.destination, { recursive: true });
    }
    return generatedFilePath;
}

export function generateConductorDSL(model: Model, filePath: string, destination: string | undefined): string {
    const data = extractDestinationAndName(filePath, destination);
    const generatedFilePath = `${path.join(data.destination, data.name)}-conductor.json`;

    if (!fs.existsSync(data.destination)) {
        fs.mkdirSync(data.destination, { recursive: true });
    }

    if(model.elements.some(element => element.$type === 'Workflow')) {
        const workflowDefinitions = generateWorkflowDefinitions(model.elements as Workflow[]);
        fs.writeFileSync(generatedFilePath, JSON.stringify(workflowDefinitions, null, 2));
    }
    return generatedFilePath;
}