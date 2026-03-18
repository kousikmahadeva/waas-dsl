import type { Model, Template, Workflow } from '../language/generated/ast.js';
import chalk from 'chalk';
import { Command } from 'commander';
import { WaasDslLanguageMetaData } from '../language/generated/module.js';
import { createWaasDslServices } from '../language/waas-dsl-module.js';
import { extractAstNode } from './cli-util.js';
import { generateJavaScript, generateConductorDSL } from './generator.js';
import { NodeFileSystem } from 'langium/node';
import * as url from 'node:url';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const packagePath = path.resolve(__dirname, '..', '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');

export const generateAction = async (fileName: string, opts: GenerateOptions): Promise<void> => {
    const services = createWaasDslServices(NodeFileSystem).WaasDsl;
    const model = await extractAstNode<Model>(fileName, services);
    const generatedFilePath = generateJavaScript(model, fileName, opts.destination);
    console.log(chalk.green(`JavaScript code generated successfully: ${generatedFilePath}`));
};

export const generateConductorDSLAction = async (fileName: string, opts: GenerateOptions): Promise<void> => {
    const services = createWaasDslServices(NodeFileSystem).WaasDsl;
    const model = await extractAstNode<Model>(fileName, services);
    const workflows = model.elements.filter((element): element is Workflow => element.$type === 'Workflow');
    if (workflows.length === 0) {
        console.error(chalk.red('A conductor generation source file must contain a workflow definition.'));
        process.exit(1);
    }

    try {
        const resolveTemplate = async (templateName: string): Promise<Template> => {
            const workflowDirectory = path.dirname(path.resolve(fileName));
            const templateFilePath = path.join(workflowDirectory, `${templateName}.waas`);
            if (!fsSync.existsSync(templateFilePath)) {
                throw new Error(`Template file not found for call '${templateName}': ${templateFilePath}`);
            }

            const templateModel = await extractAstNode<Model>(templateFilePath, services);
            const template = templateModel.elements.find((element): element is Template => element.$type === 'Template');
            if (template === undefined) {
                throw new Error(`File '${templateFilePath}' must contain a template definition.`);
            }
            if (template.name !== templateName) {
                throw new Error(`Template name mismatch in '${templateFilePath}': expected '${templateName}', found '${template.name}'.`);
            }
            return template;
        };

        const generatedFilePath = await generateConductorDSL(model, fileName, opts.destination, resolveTemplate);
        console.log(chalk.green(`Conductor DSL code generated successfully: ${generatedFilePath}`));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(message));
        process.exit(1);
    }
};

export type GenerateOptions = {
    destination?: string;
}

export default function(): void {
    const program = new Command();

    program.version(JSON.parse(packageContent).version);

    const fileExtensions = WaasDslLanguageMetaData.fileExtensions.join(', ');
    program
        .command('generate')
        .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
        .option('-d, --destination <dir>', 'destination directory of generating')
        .description('generates JavaScript code that prints "Hello, {name}!" for each greeting in a source file')
        .action(generateAction);

    program
        .command('generate-conductor-dsl')
        .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
        .option('-d, --destination <dir>', 'destination directory of generating')
        .description('generates Conductor DSL code for a given source file')
        .action(generateConductorDSLAction);

    program.parse(process.argv);
}
