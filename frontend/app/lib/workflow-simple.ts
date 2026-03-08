export interface SimpleWorkflowStep {
    botId: string;
    botName: string;
}

interface WorkflowCanvasNode {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
}

interface WorkflowCanvasEdge {
    id?: string;
    source: string;
    target: string;
}

interface WorkflowCanvasData {
    nodes: WorkflowCanvasNode[];
    edges: WorkflowCanvasEdge[];
    meta?: {
        workflowType?: string;
        simpleSteps?: SimpleWorkflowStep[];
    };
}

function normalizeSteps(steps: SimpleWorkflowStep[]): SimpleWorkflowStep[] {
    return steps
        .filter((step) => step.botId && step.botName)
        .map((step) => ({ botId: String(step.botId), botName: String(step.botName) }));
}

export function serializeSimpleWorkflow(steps: SimpleWorkflowStep[]): string {
    const normalized = normalizeSteps(steps);
    const nodes: WorkflowCanvasNode[] = [
        {
            id: 'input',
            type: 'input',
            position: { x: 300, y: 50 },
            data: { label: '用户输入', defaultValue: '' },
        },
        ...normalized.map((step, index) => ({
            id: `step_${index + 1}`,
            type: 'ai_agent',
            position: { x: 300, y: 200 + index * 150 },
            data: {
                label: step.botName,
                botId: step.botId,
                botName: step.botName,
                prompt: '',
                description: '',
            },
        })),
        {
            id: 'output',
            type: 'output',
            position: { x: 300, y: 200 + normalized.length * 150 },
            data: { label: '最终输出' },
        },
    ];

    const edges: WorkflowCanvasEdge[] = [];
    let previousId = 'input';

    normalized.forEach((_, index) => {
        const currentId = `step_${index + 1}`;
        edges.push({
            id: `edge_${previousId}_${currentId}`,
            source: previousId,
            target: currentId,
        });
        previousId = currentId;
    });

    edges.push({
        id: `edge_${previousId}_output`,
        source: previousId,
        target: 'output',
    });

    const canvasData: WorkflowCanvasData = {
        nodes,
        edges,
        meta: {
            workflowType: 'simple_linear',
            simpleSteps: normalized,
        },
    };

    return JSON.stringify(canvasData);
}

export function deserializeSimpleWorkflow(canvasData: string): SimpleWorkflowStep[] {
    try {
        const parsed = JSON.parse(canvasData) as WorkflowCanvasData;

        if (Array.isArray(parsed?.meta?.simpleSteps)) {
            return normalizeSteps(parsed.meta.simpleSteps);
        }

        if (!Array.isArray(parsed?.nodes)) {
            return [];
        }

        return parsed.nodes
            .filter((node) => node.type === 'ai_agent')
            .sort((a, b) => {
                const ay = a.position?.y ?? 0;
                const by = b.position?.y ?? 0;
                if (ay !== by) return ay - by;
                return (a.position?.x ?? 0) - (b.position?.x ?? 0);
            })
            .map((node) => ({
                botId: String(node.data?.botId || ''),
                botName: String(node.data?.botName || node.data?.label || ''),
            }))
            .filter((step) => step.botId && step.botName);
    } catch {
        return [];
    }
}
