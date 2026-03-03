'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Trash2, GitBranch, Play, Edit3, X, Save,
  ChevronUp, ChevronDown, GripVertical, Bot,
} from 'lucide-react';
import styles from './myworkflows.module.css';

const ALL_BOTS: { id: string; name: string }[] = [
  { id: '1', name: 'KPI教练' }, { id: '2', name: 'SOP梳理AI教练' }, { id: '3', name: 'OKR教练' },
  { id: '4', name: '电商商业顾问' }, { id: '5', name: '招聘教练' }, { id: '6', name: 'AI通用助手' },
  { id: '7', name: '一键出10图提示词' }, { id: '8', name: '天猫爆款趋势拆解' }, { id: '9', name: '卖点教练' },
  { id: '10', name: '天猫主图策划教练' }, { id: '11', name: '爆款裂变分析AI教练' }, { id: '12', name: '天猫评价教练' },
  { id: '13', name: '天猫竞争策略教练' }, { id: '14', name: '天猫客单价提升教练' },
  { id: '15', name: '小红书爆文封面拆解' }, { id: '16', name: '小红书私域搭建SOP' }, { id: '17', name: '小红书爆文拆解复制' },
  { id: '18', name: '小红书爆款标题' }, { id: '19', name: '小红书起号话题' }, { id: '20', name: '小红书达人SOP流程' },
  { id: '21', name: '小红书正文拆解SOP' }, { id: '22', name: '小红书笔记评论生成' },
  { id: '23', name: '毛泽东战略智能体' }, { id: '24', name: '乔布斯产品教练' }, { id: '25', name: '张一鸣商业教练' },
  { id: '26', name: '降税模型测算' }, { id: '27', name: '股权架构设计' }, { id: '28', name: '电商平台专项合规' },
  { id: '29', name: '薪酬与个税规划' }, { id: '30', name: '预警诊断&稽查' },
  { id: '31', name: 'AI工作流开发需求细化' }, { id: '32', name: '调研访谈—高价值场景' },
  { id: '33', name: '火火提示词调试' }, { id: '34', name: 'AI工作流访谈教练' },
];

interface WfStep { botId: string; botName: string; }
interface Workflow { id: string; name: string; description: string; steps: WfStep[]; createdAt: number; updatedAt: number; }

const WF_KEY = 'custom_workflows';

function loadWorkflows(): Workflow[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(WF_KEY) || '[]'); } catch { return []; }
}
function saveWorkflows(list: Workflow[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(WF_KEY, JSON.stringify(list));
}

export default function MyWorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<WfStep[]>([{ botId: '', botName: '' }]);

  // Load custom bots for selection
  const [customBots, setCustomBots] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    setWorkflows(loadWorkflows());
    // Load custom bots
    const token = localStorage.getItem('token');
    if (token) {
      fetch('http://localhost:3001/api/custom-bots', {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.ok ? r.json() : { data: [] })
        .then(d => setCustomBots((d.data || []).map((b: { id: string; name: string }) => ({ id: `custom-${b.id}`, name: b.name }))))
        .catch(() => { });
    }
  }, []);

  const allBotOptions = [...ALL_BOTS, ...customBots];

  const resetForm = () => {
    setName('');
    setDescription('');
    setSteps([{ botId: '', botName: '' }]);
    setEditing(null);
  };

  const openCreate = () => { resetForm(); setShowForm(true); };
  const openEdit = (wf: Workflow) => {
    setEditing(wf);
    setName(wf.name);
    setDescription(wf.description);
    setSteps(wf.steps.length ? [...wf.steps] : [{ botId: '', botName: '' }]);
    setShowForm(true);
  };

  const addStep = () => setSteps(s => [...s, { botId: '', botName: '' }]);
  const removeStep = (i: number) => setSteps(s => s.filter((_, idx) => idx !== i));
  const updateStep = (i: number, botId: string) => {
    const bot = allBotOptions.find(b => b.id === botId);
    setSteps(s => s.map((step, idx) => idx === i ? { botId, botName: bot?.name || '' } : step));
  };
  const moveStep = (i: number, dir: -1 | 1) => {
    setSteps(s => {
      const arr = [...s];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  };

  const handleSave = () => {
    if (!name.trim()) return alert('请输入工作流名称');
    const validSteps = steps.filter(s => s.botId);
    if (validSteps.length < 2) return alert('至少需要 2 个步骤');

    const now = Date.now();
    let updated: Workflow[];

    if (editing) {
      updated = workflows.map(w => w.id === editing.id
        ? { ...w, name, description, steps: validSteps, updatedAt: now }
        : w
      );
    } else {
      const newWf: Workflow = { id: `wf-${now}`, name, description, steps: validSteps, createdAt: now, updatedAt: now };
      updated = [newWf, ...workflows];
    }

    saveWorkflows(updated);
    setWorkflows(updated);
    setShowForm(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (!confirm('确定删除这个工作流？')) return;
    const updated = workflows.filter(w => w.id !== id);
    saveWorkflows(updated);
    setWorkflows(updated);
  };

  const launchWorkflow = (wf: Workflow) => {
    const state = {
      workflowId: wf.id,
      workflowName: wf.name,
      steps: wf.steps.map(s => ({ botId: s.botId, botName: s.botName })),
      currentStep: 0,
      stepOutputs: [] as string[],
      selectedMessages: {} as Record<number, string[]>,
    };
    sessionStorage.setItem('wf_state', JSON.stringify(state));
    router.push(`/chat/${wf.steps[0].botId}?wf=1`);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.push('/')}>
          <ArrowLeft size={16} /> 返回首页
        </button>
        <span className={styles.headerTitle}><GitBranch size={18} /> 我的工作流</span>
        <button className={styles.newBtn} onClick={openCreate}>
          <Plus size={16} /> 新建工作流
        </button>
      </header>

      <div className={styles.content}>
        {showForm ? (
          <div className={styles.formCard}>
            <div className={styles.formHeader}>
              <h2>{editing ? '编辑工作流' : '新建工作流'}</h2>
              <button onClick={() => { setShowForm(false); resetForm(); }} className={styles.closeBtn}><X size={18} /></button>
            </div>

            <div className={styles.formGroup}>
              <label>工作流名称 *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="例如：新品上架全流程" />
            </div>
            <div className={styles.formGroup}>
              <label>描述</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="简要描述工作流的用途" />
            </div>

            <div className={styles.formGroup}>
              <label>工作流步骤 *（至少 2 步）</label>
              <div className={styles.stepList}>
                {steps.map((step, i) => (
                  <div key={i} className={styles.stepItem}>
                    <span className={styles.stepNum}>{i + 1}</span>
                    <select
                      value={step.botId}
                      onChange={e => updateStep(i, e.target.value)}
                      className={styles.stepSelect}
                    >
                      <option value="">选择机器人...</option>
                      <optgroup label="预设机器人">
                        {ALL_BOTS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </optgroup>
                      {customBots.length > 0 && (
                        <optgroup label="我的智能体">
                          {customBots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </optgroup>
                      )}
                    </select>
                    <div className={styles.stepActions}>
                      <button onClick={() => moveStep(i, -1)} disabled={i === 0} className={styles.stepBtn}><ChevronUp size={14} /></button>
                      <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className={styles.stepBtn}><ChevronDown size={14} /></button>
                      {steps.length > 1 && (
                        <button onClick={() => removeStep(i)} className={`${styles.stepBtn} ${styles.stepBtnDanger}`}><Trash2 size={14} /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={addStep} className={styles.addStepBtn}><Plus size={14} /> 添加步骤</button>
            </div>

            {/* Preview */}
            {steps.filter(s => s.botId).length >= 2 && (
              <div className={styles.preview}>
                <span className={styles.previewLabel}>流程预览：</span>
                {steps.filter(s => s.botId).map((s, i, arr) => (
                  <span key={i}>
                    <span className={styles.previewStep}>{s.botName}</span>
                    {i < arr.length - 1 && <span className={styles.previewArrow}> → </span>}
                  </span>
                ))}
              </div>
            )}

            <div className={styles.formActions}>
              <button onClick={() => { setShowForm(false); resetForm(); }} className={styles.cancelBtn}>取消</button>
              <button onClick={handleSave} className={styles.saveBtn}><Save size={14} /> 保存</button>
            </div>
          </div>
        ) : workflows.length === 0 ? (
          <div className={styles.empty}>
            <GitBranch size={48} color="#cbd5e1" />
            <h3>还没有自定义工作流</h3>
            <p>创建多步骤工作流，串联多个 AI 机器人协作完成任务</p>
            <button className={styles.emptyBtn} onClick={openCreate}><Plus size={16} /> 创建第一个工作流</button>
          </div>
        ) : (
          <div className={styles.grid}>
            {workflows.map(wf => (
              <div key={wf.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <h3 className={styles.cardName}>{wf.name}</h3>
                </div>
                {wf.description && <p className={styles.cardDesc}>{wf.description}</p>}
                <div className={styles.cardSteps}>
                  {wf.steps.map((s, i) => (
                    <span key={i}>
                      <span className={styles.cardStep}><Bot size={12} /> {s.botName}</span>
                      {i < wf.steps.length - 1 && <span className={styles.cardArrow}> → </span>}
                    </span>
                  ))}
                </div>
                <div className={styles.cardActions}>
                  <button onClick={() => launchWorkflow(wf)} className={styles.runBtn}><Play size={14} /> 运行</button>
                  <button onClick={() => openEdit(wf)} className={styles.editBtn}><Edit3 size={14} /> 编辑</button>
                  <button onClick={() => handleDelete(wf.id)} className={styles.deleteBtn}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
