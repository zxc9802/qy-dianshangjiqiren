'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Copy, FileText } from 'lucide-react';
import styles from './run.module.css';

export interface WfState {
  workflowId: string;
  workflowName: string;
  steps: { botId: string; botName: string; instruction: string }[];
  currentStep: number;
  initialInput: string;
  stepOutputs: string[];
}

export default function WorkflowReportPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const phase = searchParams.get('phase');

  const [wfState, setWfState] = useState<WfState | null>(null);
  const [reportText, setReportText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem('wf_state');
    if (raw) {
      try {
        const state = JSON.parse(raw) as WfState;
        setWfState(state);
        generateReport(state);
      } catch { /**/ }
    } else {
      router.replace('/');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateReport = async (state: WfState) => {
    setIsGenerating(true);

    const stepsContent = state.steps
      .map((s, i) => `**步骤${i + 1}：${s.botName}**\n${state.stepOutputs[i] || '（未完成）'}`)
      .join('\n\n---\n\n');

    const prompt = `请根据以下工作流「${state.workflowName}」各步骤的分析成果，整合生成一份完整的工作报告。

${stepsContent}

---
请输出结构清晰、可直接使用的完整报告，包含：执行摘要、各步骤核心成果、综合建议与行动方案。`;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: '6',
          systemPrompt: '你是专业的商业报告撰写专家，将多步骤分析结果整合成结构清晰、可执行的工作报告。',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error('error');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      while (true) {
        const { done: d, value } = await reader.read();
        if (d) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'text' && ev.content) {
              full += ev.content;
              setReportText(full);
            }
          } catch { /**/ }
        }
      }
    } catch {
      setReportText('报告生成失败，请重试。');
    }
    setIsGenerating(false);
    setDone(true);
  };

  const copyReport = () => navigator.clipboard.writeText(reportText);

  return (
    <div className={styles.container}>
      <div className={styles.reportPanel}>
        <div className={styles.reportHeader}>
          <button className={styles.backBtn} onClick={() => router.push('/')}>
            <ArrowLeft size={16} /> 返回首页
          </button>
          <span className={styles.reportTitle}>
            <FileText size={16} /> {wfState?.workflowName || '工作流'} — 整体报告
          </span>
          {done && reportText && (
            <button className={styles.copyBtn} onClick={copyReport}>
              <Copy size={14} /> 复制
            </button>
          )}
        </div>

        <div className={styles.reportContent}>
          {isGenerating && !reportText && (
            <div className={styles.reportGenerating}>
              <div className={styles.spinner} /> 正在整合各步骤成果，生成报告…
            </div>
          )}
          {reportText && <pre className={styles.reportText}>{reportText}</pre>}
        </div>

        {done && (
          <button
            className={styles.restartBtn}
            onClick={() => {
              sessionStorage.removeItem('wf_state');
              router.push('/');
            }}
          >
            完成，返回首页
          </button>
        )}
      </div>
    </div>
  );
}
