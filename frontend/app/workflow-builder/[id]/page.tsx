'use client';

import { useCallback, useRef, useState, useEffect, DragEvent, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    ReactFlow,
    Controls,
    MiniMap,
    Background,
    addEdge,
    useNodesState,
    useEdgesState,
    BackgroundVariant,
    Connection,
    Node,
    Edge,
    ReactFlowProvider,
    ReactFlowInstance,
    Handle,
    Position,
    ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAuthStore } from '../../stores/auth';
import StepRunner from './StepRunner';
import styles from './builder.module.css';
import {
    Bot, Download, Upload, GitBranch, Repeat, Plug, Settings,
    Target, ClipboardList, Lightbulb, MessageSquare, Trash2,
    TrendingUp, Rocket, Zap, PenTool, Play, Save, CheckCircle,
    ArrowLeft,
} from 'lucide-react';

// -------- Custom Node Component --------
function CustomNode({ data, type }: { data: Record<string, unknown>; type?: string }) {
    const icons: Record<string, ReactNode> = {
        ai_agent: <Bot size={16} />, input: <Download size={16} />, output: <Upload size={16} />,
        condition: <GitBranch size={16} />, loop: <Repeat size={16} />, api_component: <Plug size={16} />,
    };
    const colors: Record<string, string> = {
        ai_agent: '#3b82f6', input: '#22c55e', output: '#f59e0b',
        condition: '#8b5cf6', loop: '#ec4899', api_component: '#06b6d4',
    };
    const t = type || 'ai_agent';
    const isInput = t === 'input';
    const isOutput = t === 'output';
    const hasSaved = !!(data.savedOutput as string);
    return (
        <div className={styles.customNode} style={{ borderColor: colors[t] || '#666' }}>
            {!isInput && <Handle id="t-top" type="target" position={Position.Top} className={styles.handle} />}
            {!isInput && <Handle id="t-left" type="target" position={Position.Left} className={styles.handle} />}
            {!isInput && <Handle id="t-right" type="target" position={Position.Right} className={styles.handle} />}
            {!isInput && <Handle id="t-bottom" type="target" position={Position.Bottom} className={styles.handle} />}
            {!isOutput && <Handle id="s-top" type="source" position={Position.Top} className={styles.handleSource} />}
            {!isOutput && <Handle id="s-left" type="source" position={Position.Left} className={styles.handleSource} />}
            {!isOutput && <Handle id="s-right" type="source" position={Position.Right} className={styles.handleSource} />}
            {!isOutput && <Handle id="s-bottom" type="source" position={Position.Bottom} className={styles.handleSource} />}

            <div className={styles.nodeHeader} style={{ background: colors[t] || '#666' }}>
                <span>{icons[t] || <Settings size={16} />}</span>
                <span className={styles.nodeLabel}>{(data.label as string) || t}</span>
                {hasSaved && <span className={styles.savedBadge}><CheckCircle size={12} /></span>}
            </div>
            <div className={styles.nodeBody}>
                <p className={styles.nodeDesc}>
                    {hasSaved ? <><CheckCircle size={12} /> 已填写数据</> : (data.botName as string) || (data.description as string) || ''}
                </p>
            </div>
        </div>
    );
}

const nodeTypes = {
    ai_agent: CustomNode,
    input: CustomNode,
    output: CustomNode,
    condition: CustomNode,
    loop: CustomNode,
    api_component: CustomNode,
};

// -------- Draggable palette items --------
const PALETTE_ITEMS: Array<{ type: string; label: string; icon: ReactNode; desc: string }> = [
    { type: 'input', label: '用户输入', icon: <Download size={18} />, desc: '工作流起点' },
    { type: 'ai_agent', label: 'AI 智能体', icon: <Bot size={18} />, desc: '调用AI分析' },
    { type: 'api_component', label: 'API 组件', icon: <Plug size={18} />, desc: '外部数据' },
    { type: 'condition', label: '条件判断', icon: <GitBranch size={18} />, desc: 'if/else 分流' },
    { type: 'loop', label: '循环', icon: <Repeat size={18} />, desc: '遍历列表' },
    { type: 'output', label: '输出结果', icon: <Upload size={18} />, desc: '工作流终点' },
];

// 34 bot options for AI agent config
const BOT_OPTIONS = [
    { id: '1', name: 'KPI教练' }, { id: '2', name: 'SOP梳理AI教练' }, { id: '3', name: 'OKR教练' },
    { id: '4', name: '电商商业顾问' }, { id: '5', name: '招聘教练' }, { id: '6', name: 'AI通用助手' },
    { id: '7', name: '一键出10图提示词' }, { id: '8', name: '天猫爆款趋势拆解' }, { id: '9', name: '卖点教练' },
    { id: '10', name: '天猫主图策划教练' }, { id: '11', name: '爆款裂变分析AI教练' }, { id: '12', name: '天猫评价教练' },
    { id: '13', name: '天猫竞争策略教练' }, { id: '14', name: '天猫客单价提升教练' },
    { id: '15', name: '小红书爆文封面拆解' }, { id: '16', name: '小红书私域搭建SOP' },
    { id: '17', name: '小红书爆文拆解复制' }, { id: '18', name: '小红书爆款标题' },
    { id: '19', name: '小红书起号话题' }, { id: '20', name: '小红书达人SOP流程' },
    { id: '21', name: '小红书正文拆解SOP' }, { id: '22', name: '小红书笔记评论生成' },
    { id: '23', name: '毛泽东战略智能体' }, { id: '24', name: '乔布斯产品教练' },
    { id: '25', name: '张一鸣商业教练' }, { id: '26', name: '降税模型测算' },
    { id: '27', name: '股权架构设计' }, { id: '28', name: '电商平台专项合规' },
    { id: '29', name: '薪酬与个税规划' }, { id: '30', name: '预警诊断&稽查' },
    { id: '31', name: 'AI工作流开发需求细化' }, { id: '32', name: '调研访谈—高价值场景' },
    { id: '33', name: '火火提示词调试' }, { id: '34', name: 'AI工作流访谈教练' },
];

// Smart suggestion rules: after dropping a node, suggest next
const NEXT_SUGGESTIONS: Record<string, Array<{ type: string; label: string; icon: ReactNode; botId?: string; botName?: string }>> = {
    input: [
        { type: 'ai_agent', label: 'AI通用助手', icon: <Bot size={14} />, botId: '6', botName: 'AI通用助手' },
        { type: 'ai_agent', label: '天猫爆款趋势拆解', icon: <TrendingUp size={14} />, botId: '8', botName: '天猫爆款趋势拆解' },
        { type: 'ai_agent', label: '小红书起号话题', icon: <Rocket size={14} />, botId: '19', botName: '小红书起号话题' },
    ],
    ai_agent: [
        { type: 'ai_agent', label: '卖点教练', icon: <Zap size={14} />, botId: '9', botName: '卖点教练' },
        { type: 'ai_agent', label: '小红书爆款标题', icon: <PenTool size={14} />, botId: '18', botName: '小红书爆款标题' },
        { type: 'output', label: '输出结果', icon: <Upload size={14} /> },
    ],
    condition: [
        { type: 'ai_agent', label: 'AI通用助手', icon: <Bot size={14} />, botId: '6', botName: 'AI通用助手' },
        { type: 'output', label: '输出结果', icon: <Upload size={14} /> },
    ],
};

const ONBOARDING_KEY = 'workflow_onboarding_done';

const API_BASE = '/api';

function getToken(): string | null {
    return typeof window !== 'undefined' ? localStorage.getItem('token') : null;
}

async function apiFetch(url: string, options: RequestInit = {}) {
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '请求失败');
    return data;
}

// -------- Main Builder Component --------
function WorkflowBuilderInner() {
    const params = useParams();
    const router = useRouter();
    const workflowId = params.id as string;
    const { user } = useAuthStore();

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
    const reactFlowWrapper = useRef<HTMLDivElement>(null);

    const [workflowName, setWorkflowName] = useState('新工作流');
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const [saving, setSaving] = useState(false);
    const [showRunner, setShowRunner] = useState(false);
    const [executionSteps, setExecutionSteps] = useState<Array<{ id: string; type: string; label: string; botId: string; botName: string }>>([]);
    const [chatNodeId, setChatNodeId] = useState<string | null>(null);

    // Onboarding
    const [onboardingStep, setOnboardingStep] = useState(-1); // -1 = not shown
    const [lastDroppedNode, setLastDroppedNode] = useState<Node | null>(null);

    useEffect(() => {
        if (typeof window !== 'undefined' && !localStorage.getItem(ONBOARDING_KEY)) {
            setOnboardingStep(0);
        }
    }, []);

    const dismissOnboarding = () => {
        setOnboardingStep(-1);
        localStorage.setItem(ONBOARDING_KEY, '1');
    };

    const nextOnboardingStep = () => {
        if (onboardingStep >= 2) {
            dismissOnboarding();
        } else {
            setOnboardingStep(s => s + 1);
        }
    };

    // Load workflow data
    useEffect(() => {
        if (workflowId === 'new') return;
        apiFetch(`/workflows/${workflowId}`)
            .then(res => {
                const wf = res.data;
                setWorkflowName(wf.name);
                try {
                    const canvas = JSON.parse(wf.canvasData);
                    if (canvas.nodes) setNodes(canvas.nodes);
                    if (canvas.edges) setEdges(canvas.edges);
                } catch { /* empty canvas */ }
            })
            .catch(() => router.push('/workflow-builder'));
    }, [workflowId, router, setNodes, setEdges]);

    const onConnect = useCallback(
        (connection: Connection) => setEdges(eds => addEdge({ ...connection, animated: true }, eds)),
        [setEdges],
    );

    const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        setSelectedNode(node);
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
    }, []);

    // Drag-and-drop from palette
    const onDragOver = useCallback((event: DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: DragEvent) => {
            event.preventDefault();
            const type = event.dataTransfer.getData('application/reactflow');
            const label = event.dataTransfer.getData('label');
            if (!type || !rfInstance || !reactFlowWrapper.current) return;

            const bounds = reactFlowWrapper.current.getBoundingClientRect();
            const position = rfInstance.screenToFlowPosition({
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
            });

            const newNode: Node = {
                id: `node_${Date.now()}`,
                type,
                position,
                data: { label: label || type, description: '', botId: '', botName: '', prompt: '' },
            };
            setNodes(nds => [...nds, newNode]);
            setLastDroppedNode(newNode);
        },
        [rfInstance, setNodes],
    );

    // Add suggested node with auto-connect
    const addSuggestedNode = (suggestion: typeof NEXT_SUGGESTIONS['input'][0]) => {
        if (!lastDroppedNode) return;
        const newNode: Node = {
            id: `node_${Date.now()}`,
            type: suggestion.type,
            position: { x: lastDroppedNode.position.x, y: lastDroppedNode.position.y + 160 },
            data: {
                label: suggestion.label,
                botId: suggestion.botId || '',
                botName: suggestion.botName || '',
                prompt: '', description: '',
            },
        };
        setNodes(nds => [...nds, newNode]);
        setEdges(eds => addEdge({ id: `edge_${lastDroppedNode.id}_${newNode.id}`, source: lastDroppedNode.id, target: newNode.id, animated: true }, eds));
        setLastDroppedNode(newNode);
    };

    // Save
    const handleSave = async () => {
        setSaving(true);
        try {
            const canvasData = JSON.stringify({ nodes, edges });
            if (workflowId === 'new') {
                const res = await apiFetch('/workflows', {
                    method: 'POST',
                    body: JSON.stringify({ name: workflowName, canvasData }),
                });
                router.replace(`/workflow-builder/${res.data.id}`);
            } else {
                await apiFetch(`/workflows/${workflowId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ name: workflowName, canvasData }),
                });
            }
        } catch (err) {
            alert(err instanceof Error ? err.message : '保存失败');
        } finally {
            setSaving(false);
        }
    };

    // Run: compute topological order and launch StepRunner
    const handleRun = () => {
        if (nodes.length === 0) return;

        // Topological sort
        const inDegree = new Map<string, number>();
        const adj = new Map<string, string[]>();
        for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []); }
        for (const e of edges) {
            adj.get(e.source)?.push(e.target);
            inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
        }
        const queue: string[] = [];
        for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }
        const order: string[] = [];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            order.push(cur);
            for (const next of adj.get(cur) || []) {
                const nd = (inDegree.get(next) || 1) - 1;
                inDegree.set(next, nd);
                if (nd === 0) queue.push(next);
            }
        }

        // Build step list
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const steps = order.map(id => {
            const n = nodeMap.get(id)!;
            return {
                id: n.id,
                type: n.type || 'ai_agent',
                label: (n.data.label as string) || '',
                botId: (n.data.botId as string) || '',
                botName: (n.data.botName as string) || (n.data.label as string) || '',
            };
        });

        setExecutionSteps(steps);
        setShowRunner(true);
    };

    // Update selected node data
    const updateNodeData = (key: string, value: string) => {
        if (!selectedNode) return;
        setNodes(nds =>
            nds.map(n =>
                n.id === selectedNode.id
                    ? { ...n, data: { ...n.data, [key]: value } }
                    : n,
            ),
        );
        setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, [key]: value } } : null);
    };

    // Delete selected node
    const deleteSelectedNode = () => {
        if (!selectedNode) return;
        setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
        setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
        setSelectedNode(null);
    };

    return (
        <div className={styles.layout}>
            <header className={styles.header}>
                <button onClick={() => router.push('/')} className={styles.backBtn}><ArrowLeft size={16} /> 返回</button>
                <input
                    className={styles.nameInput}
                    value={workflowName}
                    onChange={e => setWorkflowName(e.target.value)}
                    placeholder="工作流名称"
                />
                <div className={styles.headerActions}>
                    <button
                        className={styles.runBtn}
                        onClick={handleRun}
                        disabled={showRunner || nodes.length === 0}
                    >
                        {showRunner ? <><Settings size={14} /> 执行中...</> : <><Play size={14} /> 开始执行</>}
                    </button>
                    <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                        {saving ? '保存中...' : <><Save size={14} /> 保存</>}
                    </button>
                    <span className={styles.pointsBadge}>{user?.pointsBalance ?? 0} 积分</span>
                </div>
            </header>

            <div className={styles.body}>
                {/* Left: Node Palette */}
                <aside className={styles.palette}>
                    <h3 className={styles.paletteTitle}>节点面板</h3>
                    {PALETTE_ITEMS.map(item => (
                        <div
                            key={item.type}
                            className={styles.paletteItem}
                            draggable
                            onDragStart={e => {
                                e.dataTransfer.setData('application/reactflow', item.type);
                                e.dataTransfer.setData('label', item.label);
                                e.dataTransfer.effectAllowed = 'move';
                            }}
                        >
                            <span className={styles.paletteIcon}>{item.icon}</span>
                            <div>
                                <div className={styles.paletteName}>{item.label}</div>
                                <div className={styles.paletteDesc}>{item.desc}</div>
                            </div>
                        </div>
                    ))}
                </aside>

                {/* Center: Canvas */}
                <div className={styles.canvasWrapper} ref={reactFlowWrapper}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onInit={setRfInstance}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        onNodeClick={onNodeClick}
                        onPaneClick={() => { onPaneClick(); setLastDroppedNode(null); }}
                        nodeTypes={nodeTypes}
                        fitView
                        deleteKeyCode="Delete"
                        connectionMode={ConnectionMode.Loose}
                    >
                        <Controls />
                        <MiniMap
                            style={{ background: 'var(--color-card)' }}
                            maskColor="rgba(0,0,0,0.15)"
                        />
                        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
                    </ReactFlow>

                    {/* Empty Canvas Hint */}
                    {nodes.length === 0 && (
                        <div className={styles.emptyHint}>
                            <div className={styles.emptyHintIcon}><Target size={32} /></div>
                            <h3>开始搭建工作流</h3>
                            <p>从左侧拖拽节点到画布，或使用快捷操作</p>
                            <div className={styles.emptyHintActions}>
                                <button onClick={() => router.push('/workflow-builder')}><ClipboardList size={14} /> 使用模板</button>
                                <button onClick={() => {
                                    const inputNode: Node = {
                                        id: 'node_input', type: 'input',
                                        position: { x: 300, y: 50 },
                                        data: { label: '用户输入', description: '', botId: '', botName: '', prompt: '' },
                                    };
                                    setNodes([inputNode]);
                                    setLastDroppedNode(inputNode);
                                }}><Download size={14} /> 快速添加输入节点</button>
                            </div>
                        </div>
                    )}

                    {/* Smart Suggestions Popup */}
                    {lastDroppedNode && NEXT_SUGGESTIONS[lastDroppedNode.type!] && (
                        <div className={styles.suggestionsBar}>
                            <span className={styles.suggestionsLabel}><Lightbulb size={14} /> 推荐下一步：</span>
                            {NEXT_SUGGESTIONS[lastDroppedNode.type!].map((sug, i) => (
                                <button
                                    key={i}
                                    className={styles.suggestionBtn}
                                    onClick={() => addSuggestedNode(sug)}
                                >
                                    {sug.icon} {sug.label}
                                </button>
                            ))}
                            <button className={styles.suggestionDismiss} onClick={() => setLastDroppedNode(null)}>✕</button>
                        </div>
                    )}
                </div>

                {/* Right: Config Panel */}
                {selectedNode && (
                    <aside className={styles.configPanel}>
                        <h3 className={styles.configTitle}>节点配置</h3>
                        <div className={styles.configField}>
                            <label>名称</label>
                            <input
                                value={(selectedNode.data.label as string) || ''}
                                onChange={e => updateNodeData('label', e.target.value)}
                            />
                        </div>
                        <div className={styles.configField}>
                            <label>说明</label>
                            <textarea
                                value={(selectedNode.data.description as string) || ''}
                                onChange={e => updateNodeData('description', e.target.value)}
                                rows={2}
                            />
                        </div>

                        {selectedNode.type === 'ai_agent' && (
                            <>
                                <div className={styles.configField}>
                                    <label>选择智能体</label>
                                    <select
                                        value={(selectedNode.data.botId as string) || ''}
                                        onChange={e => {
                                            const bot = BOT_OPTIONS.find(b => b.id === e.target.value);
                                            updateNodeData('botId', e.target.value);
                                            if (bot) updateNodeData('botName', bot.name);
                                        }}
                                    >
                                        <option value="">请选择...</option>
                                        {BOT_OPTIONS.map(bot => (
                                            <option key={bot.id} value={bot.id}>{bot.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className={styles.configField}>
                                    <label>自定义提示词</label>
                                    <textarea
                                        value={(selectedNode.data.prompt as string) || ''}
                                        onChange={e => updateNodeData('prompt', e.target.value)}
                                        rows={3}
                                        placeholder="可选，覆盖默认提示词"
                                    />
                                </div>
                            </>
                        )}

                        {selectedNode.type === 'condition' && (
                            <div className={styles.configField}>
                                <label>判断关键词</label>
                                <input
                                    value={(selectedNode.data.keyword as string) || ''}
                                    onChange={e => updateNodeData('keyword', e.target.value)}
                                    placeholder="输入包含则走 true 分支"
                                />
                            </div>
                        )}

                        {selectedNode.type === 'ai_agent' && (selectedNode.data.botId as string) && (
                            <button
                                className={styles.enterChatBtn}
                                onClick={() => setChatNodeId(selectedNode.id)}
                            >
                                <MessageSquare size={14} /> 进入对话
                            </button>
                        )}

                        {(selectedNode.data.savedOutput as string) && (
                            <div className={styles.savedPreview}>
                                <label>已保存的数据</label>
                                <pre>{(selectedNode.data.savedOutput as string).slice(0, 200)}...</pre>
                                <button
                                    className={styles.clearSavedBtn}
                                    onClick={() => updateNodeData('savedOutput', '')}
                                >清除数据</button>
                            </div>
                        )}

                        <button className={styles.deleteNodeBtn} onClick={deleteSelectedNode}>
                            <Trash2 size={14} /> 删除节点
                        </button>
                    </aside>
                )}
            </div>

            {/* Step-by-Step Runner */}
            {showRunner && executionSteps.length > 0 && (
                <StepRunner
                    steps={executionSteps}
                    onClose={() => setShowRunner(false)}
                    onComplete={() => setShowRunner(false)}
                />
            )}

            {/* Single-node chat modal */}
            {chatNodeId && (() => {
                const chatNode = nodes.find(n => n.id === chatNodeId);
                if (!chatNode || chatNode.type !== 'ai_agent') return null;

                // Gather predecessor saved outputs for context
                const predecessorSteps: Array<{ id: string; type: string; label: string; botId: string; botName: string }> = [];

                // Walk up the graph to find predecessors with saved data
                const visited = new Set<string>();
                const collectPredecessors = (nodeId: string) => {
                    const parentEdges = edges.filter(e => e.target === nodeId);
                    for (const edge of parentEdges) {
                        if (visited.has(edge.source)) continue;
                        visited.add(edge.source);
                        const parentNode = nodes.find(n => n.id === edge.source);
                        if (parentNode && parentNode.data.savedOutput) {
                            predecessorSteps.push({
                                id: parentNode.id,
                                type: parentNode.type || 'ai_agent',
                                label: (parentNode.data.label as string) || '',
                                botId: (parentNode.data.botId as string) || '',
                                botName: (parentNode.data.botName as string) || (parentNode.data.label as string) || '',
                            });
                        }
                        collectPredecessors(edge.source);
                    }
                };
                collectPredecessors(chatNodeId);

                const singleStep = [{
                    id: chatNode.id,
                    type: chatNode.type || 'ai_agent',
                    label: (chatNode.data.label as string) || '',
                    botId: (chatNode.data.botId as string) || '',
                    botName: (chatNode.data.botName as string) || (chatNode.data.label as string) || '',
                }];

                return (
                    <StepRunner
                        steps={singleStep}
                        onClose={() => setChatNodeId(null)}
                        onComplete={(results) => {
                            // Save the output back to the node's data
                            if (results[0]?.savedOutput) {
                                setNodes(nds => nds.map(n =>
                                    n.id === chatNodeId
                                        ? { ...n, data: { ...n.data, savedOutput: results[0].savedOutput } }
                                        : n
                                ));
                            }
                            setChatNodeId(null);
                        }}
                    />
                );
            })()}

            {/* Onboarding Overlay */}
            {onboardingStep >= 0 && (
                <div className={styles.onboardingOverlay}>
                    <div className={styles.onboardingCard}>
                        {onboardingStep === 0 && (
                            <>
                                <div className={styles.onboardingIcon}><Download size={32} /></div>
                                <h3>第 1 步：添加节点</h3>
                                <p>从左侧面板拖一个 用户输入 节点到画布上</p>
                            </>
                        )}
                        {onboardingStep === 1 && (
                            <>
                                <div className={styles.onboardingIcon}><Bot size={32} /></div>
                                <h3>第 2 步：连接智能体</h3>
                                <p>再拖一个 AI 智能体 节点，从输入拖线连接到它</p>
                            </>
                        )}
                        {onboardingStep === 2 && (
                            <>
                                <div className={styles.onboardingIcon}><Play size={32} /></div>
                                <h3>第 3 步：运行</h3>
                                <p>点击右上角 运行 按钮查看AI输出结果</p>
                            </>
                        )}
                        <div className={styles.onboardingActions}>
                            <span className={styles.onboardingDots}>
                                {[0, 1, 2].map(i => (
                                    <span key={i} className={`${styles.onboardingDot} ${i === onboardingStep ? styles.onboardingDotActive : ''}`} />
                                ))}
                            </span>
                            <div className={styles.onboardingBtns}>
                                <button className={styles.onboardingSkip} onClick={dismissOnboarding}>跳过</button>
                                <button className={styles.onboardingNext} onClick={nextOnboardingStep}>
                                    {onboardingStep === 2 ? '开始使用！' : '下一步'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function WorkflowBuilderPage() {
    return (
        <ReactFlowProvider>
            <WorkflowBuilderInner />
        </ReactFlowProvider>
    );
}
