'use client';

import { useEffect, useState } from 'react';
import {
    api,
    VideoFieldDefinition,
    VideoGenerationFamily,
    VideoGenerationTaskResponse,
} from '../lib/api';
import styles from './VideoStudio.module.css';

interface VideoStudioProps {
    isAuthenticated: boolean;
    onRequireLogin: () => void;
}

interface PersistedDraft {
    selectedFamilyId?: string;
    inputsByFamily?: Record<string, Record<string, unknown>>;
}

const DRAFT_KEY = 'video_studio_draft_v1';

function buildDefaultValue(field: VideoFieldDefinition): string | number | boolean {
    if (field.defaultValue !== undefined) {
        return field.defaultValue;
    }
    if (field.type === 'switch') {
        return false;
    }
    return '';
}

function buildFamilyDefaults(family: VideoGenerationFamily): Record<string, unknown> {
    return family.fields.reduce<Record<string, unknown>>((acc, field) => {
        acc[field.key] = buildDefaultValue(field);
        return acc;
    }, {});
}

function mergeFamilyInputs(
    family: VideoGenerationFamily,
    current: Record<string, unknown> | undefined,
): Record<string, unknown> {
    return {
        ...buildFamilyDefaults(family),
        ...(current || {}),
    };
}

function stringifyJson(value: unknown): string {
    if (value === undefined || value === null) return '';
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function isTerminalStatus(status: string | null | undefined): boolean {
    if (!status) return false;
    return /success|succeed|succeeded|completed|failed|error|cancelled|canceled|done/i.test(status);
}

function verificationLabel(state: VideoGenerationFamily['verification']['state']): string {
    switch (state) {
        case 'working':
            return '已验证可用';
        case 'blocked':
            return '当前阻塞';
        case 'submission_only':
            return '仅验证提交';
        default:
            return '部分可用';
    }
}

function statusTone(status: string | null | undefined): 'success' | 'warning' | 'danger' | 'muted' {
    if (!status) return 'muted';
    if (/success|succeed|succeeded|completed|done/i.test(status)) return 'success';
    if (/failed|error|cancelled|canceled/i.test(status)) return 'danger';
    return 'warning';
}

function verificationTone(state: VideoGenerationFamily['verification']['state']): 'success' | 'warning' | 'danger' {
    if (state === 'working') return 'success';
    if (state === 'blocked') return 'danger';
    return 'warning';
}

function taskStatusLabel(status: string | null | undefined): string {
    if (!status) return '处理中';

    const normalized = status.toLowerCase();
    if (/(success|succeed|succeeded|completed|done)/i.test(normalized)) return '已完成';
    if (/(failed|error)/i.test(normalized)) return '失败';
    if (/(cancelled|canceled)/i.test(normalized)) return '已取消';
    if (/(pending|submitted|created|preparing|processing|running|queue)/i.test(normalized)) return '处理中';
    return status;
}

export default function VideoStudio({ isAuthenticated, onRequireLogin }: VideoStudioProps) {
    const [families, setFamilies] = useState<VideoGenerationFamily[]>([]);
    const [rawModels, setRawModels] = useState<string[]>([]);
    const [selectedFamilyId, setSelectedFamilyId] = useState('');
    const [inputsByFamily, setInputsByFamily] = useState<Record<string, Record<string, unknown>>>({});
    const [isLoadingModels, setIsLoadingModels] = useState(true);
    const [modelError, setModelError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [latestTask, setLatestTask] = useState<VideoGenerationTaskResponse | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const currentFamily = families.find((item) => item.id === selectedFamilyId) || null;
    const currentInputs = currentFamily ? inputsByFamily[currentFamily.id] || buildFamilyDefaults(currentFamily) : {};
    const workingCount = families.filter((item) => item.verification.state === 'working').length;
    const blockedCount = families.filter((item) => item.verification.state === 'blocked').length;
    const partialCount = families.filter((item) => item.verification.state !== 'working' && item.verification.state !== 'blocked').length;

    useEffect(() => {
        let cancelled = false;

        const loadModels = async () => {
            setIsLoadingModels(true);
            setModelError(null);
            try {
                const draftRaw = typeof window === 'undefined' ? null : window.localStorage.getItem(DRAFT_KEY);
                let draft: PersistedDraft = {};
                if (draftRaw) {
                    try {
                        draft = JSON.parse(draftRaw) as PersistedDraft;
                    } catch {
                        window.localStorage.removeItem(DRAFT_KEY);
                    }
                }
                const response = await api.getVideoGenerationModels();
                if (cancelled) return;

                const nextFamilies = response.data.families;
                const nextInputs = nextFamilies.reduce<Record<string, Record<string, unknown>>>((acc, family) => {
                    acc[family.id] = mergeFamilyInputs(family, draft.inputsByFamily?.[family.id]);
                    return acc;
                }, {});

                const fallbackFamilyId = nextFamilies.find((item) => item.verification.state === 'working')?.id || nextFamilies[0]?.id || '';
                const nextFamilyId = nextFamilies.some((item) => item.id === draft.selectedFamilyId)
                    ? draft.selectedFamilyId || fallbackFamilyId
                    : fallbackFamilyId;

                setFamilies(nextFamilies);
                setRawModels(response.data.rawModels);
                setInputsByFamily(nextInputs);
                setSelectedFamilyId(nextFamilyId);
            } catch (error) {
                if (cancelled) return;
                setModelError(error instanceof Error ? error.message : '加载视频模型列表失败。');
            } finally {
                if (!cancelled) {
                    setIsLoadingModels(false);
                }
            }
        };

        void loadModels();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || families.length === 0) return;
        const payload: PersistedDraft = {
            selectedFamilyId,
            inputsByFamily,
        };
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    }, [families.length, inputsByFamily, selectedFamilyId]);

    useEffect(() => {
        if (!latestTask?.taskId || !latestTask.familyId || isTerminalStatus(latestTask.status)) {
            return undefined;
        }

        const timer = window.setInterval(async () => {
            try {
                const response = await api.getVideoGenerationStatus({
                    familyId: latestTask.familyId,
                    taskId: latestTask.taskId,
                });
                setLatestTask((current) => current ? {
                    ...current,
                    latest: response.data.query,
                    latestError: null,
                    status: response.data.status,
                    videoUrl: response.data.videoUrl,
                } : current);
            } catch {
                // keep the latest successful response visible
            }
        }, 5000);

        return () => window.clearInterval(timer);
    }, [latestTask?.familyId, latestTask?.status, latestTask?.taskId]);

    const updateField = (key: string, value: unknown) => {
        if (!currentFamily) return;
        setInputsByFamily((prev) => ({
            ...prev,
            [currentFamily.id]: {
                ...mergeFamilyInputs(currentFamily, prev[currentFamily.id]),
                [key]: value,
            },
        }));
    };

    const handleSubmit = async () => {
        if (!currentFamily) return;
        if (!isAuthenticated) {
            onRequireLogin();
            return;
        }

        setIsSubmitting(true);
        setSubmitError(null);
        try {
            const response = await api.generateVideo({
                familyId: currentFamily.id,
                inputs: currentInputs,
            });
            setLatestTask(response.data);
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : '视频生成任务提交失败。');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRefreshStatus = async () => {
        if (!latestTask?.taskId || !latestTask.familyId) return;
        setIsRefreshing(true);
        setSubmitError(null);
        try {
            const response = await api.getVideoGenerationStatus({
                familyId: latestTask.familyId,
                taskId: latestTask.taskId,
            });
            setLatestTask((current) => current ? {
                ...current,
                latest: response.data.query,
                latestError: null,
                status: response.data.status,
                videoUrl: response.data.videoUrl,
            } : current);
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : '刷新任务状态失败。');
        } finally {
            setIsRefreshing(false);
        }
    };

    const renderField = (field: VideoFieldDefinition) => {
        const value = currentInputs[field.key];

        if (field.type === 'switch') {
            return (
                <label key={field.key} className={styles.switchField}>
                    <div>
                        <span className={styles.fieldLabel}>{field.label}</span>
                        {field.description ? <span className={styles.fieldHint}>{field.description}</span> : null}
                    </div>
                    <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) => updateField(field.key, event.target.checked)}
                    />
                </label>
            );
        }

        if (field.type === 'select') {
            return (
                <label key={field.key} className={styles.field}>
                    <span className={styles.fieldLabel}>{field.label}{field.required ? ' *' : ''}</span>
                    <select
                        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
                        onChange={(event) => updateField(field.key, event.target.value)}
                    >
                        {(field.options || []).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    {field.description ? <span className={styles.fieldHint}>{field.description}</span> : null}
                </label>
            );
        }

        if (field.type === 'textarea' || field.type === 'url-list' || field.type === 'json') {
            return (
                <label key={field.key} className={styles.field}>
                    <span className={styles.fieldLabel}>{field.label}{field.required ? ' *' : ''}</span>
                    <textarea
                        rows={field.rows || (field.type === 'url-list' ? 4 : 5)}
                        value={typeof value === 'string' ? value : stringifyJson(value)}
                        onChange={(event) => updateField(field.key, event.target.value)}
                        placeholder={field.placeholder}
                    />
                    {field.description ? <span className={styles.fieldHint}>{field.description}</span> : null}
                </label>
            );
        }

        if (field.type === 'number') {
            return (
                <label key={field.key} className={styles.field}>
                    <span className={styles.fieldLabel}>{field.label}{field.required ? ' *' : ''}</span>
                    <input
                        type="number"
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={typeof value === 'number' || typeof value === 'string' ? value : ''}
                        onChange={(event) => updateField(field.key, event.target.value)}
                        placeholder={field.placeholder}
                    />
                    {field.description ? <span className={styles.fieldHint}>{field.description}</span> : null}
                </label>
            );
        }

        return (
            <label key={field.key} className={styles.field}>
                <span className={styles.fieldLabel}>{field.label}{field.required ? ' *' : ''}</span>
                <input
                    type="text"
                    value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
                    onChange={(event) => updateField(field.key, event.target.value)}
                    placeholder={field.placeholder}
                />
                {field.description ? <span className={styles.fieldHint}>{field.description}</span> : null}
            </label>
        );
    };

    return (
        <section className={styles.shell}>
            <div className={styles.hero}>
                <div>
                    <span className={styles.heroBadge}>云雾视频接口实验台</span>
                    <h2 className={styles.heroTitle}>视频生成机器人</h2>
                    <p className={styles.heroText}>
                        把云雾支持的视频接口集中到一个页面里，直接切换模型家族、查看已验证结果、调整参数并提交任务。
                    </p>
                </div>
                <div className={styles.statGrid}>
                    <div className={styles.statCard}><strong>{workingCount}</strong><span>已验证可用</span></div>
                    <div className={styles.statCard}><strong>{blockedCount}</strong><span>当前不可用</span></div>
                    <div className={styles.statCard}><strong>{partialCount}</strong><span>部分可用 / 仅提交</span></div>
                </div>
            </div>

            <div className={styles.familyGrid}>
                {families.map((family) => (
                    <button
                        key={family.id}
                        type="button"
                        className={`${styles.familyCard} ${family.id === selectedFamilyId ? styles.familyCardActive : ''}`}
                        onClick={() => setSelectedFamilyId(family.id)}
                    >
                        <div className={styles.familyTop}>
                            <h3>{family.label}</h3>
                            <span className={`${styles.badge} ${styles[`badge${family.verification.state}`]}`}>{verificationLabel(family.verification.state)}</span>
                        </div>
                        <p>{family.description}</p>
                        <div className={styles.familyMeta}>
                            <span>{family.supportedModels.length > 0 ? `支持 ${family.supportedModels.length} 个模型` : '未出现在 /v1/models 列表中'}</span>
                            <span>{family.createPath}</span>
                        </div>
                    </button>
                ))}
            </div>

            {isLoadingModels ? <p className={styles.info}>正在加载视频模型清单...</p> : null}
            {modelError ? <p className={styles.error}>{modelError}</p> : null}

            <div className={styles.layout}>
                <div className={styles.panel}>
                    {currentFamily ? (
                        <>
                            <div className={styles.panelHeader}>
                                <div>
                                    <h3>{currentFamily.label}</h3>
                                    <p>{currentFamily.verification.summary}</p>
                                </div>
                                <span className={`${styles.statusPill} ${styles[`status${verificationTone(currentFamily.verification.state)}`]}`}>
                                    {verificationLabel(currentFamily.verification.state)}
                                </span>
                            </div>

                            <div className={styles.routeMeta}>
                                <div><span>创建接口</span><code>{currentFamily.createPath}</code></div>
                                <div><span>查询接口</span><code>{currentFamily.queryPathTemplate || '暂无'}</code></div>
                                <div><span>支持说明</span><p>{currentFamily.supportNotes}</p></div>
                            </div>

                            <div className={styles.modelTokens}>
                                {(currentFamily.supportedModels.length > 0 ? currentFamily.supportedModels : rawModels.slice(0, 12)).map((modelId) => (
                                    <span key={modelId} className={styles.token}>{modelId}</span>
                                ))}
                            </div>

                            <div className={styles.fieldGrid}>
                                {currentFamily.fields.map(renderField)}
                            </div>

                            <div className={styles.actions}>
                                <button className={styles.primaryBtn} onClick={handleSubmit} disabled={isSubmitting}>
                                    {isSubmitting ? '提交中...' : '提交任务'}
                                </button>
                                <button className={styles.secondaryBtn} onClick={() => window.location.reload()}>
                                    重新加载模型
                                </button>
                            </div>

                            {!isAuthenticated ? <p className={styles.info}>登录后才能提交视频生成任务。</p> : null}
                            {submitError ? <p className={styles.error}>{submitError}</p> : null}
                        </>
                    ) : (
                        <p className={styles.info}>先选择一个视频接口家族再开始。</p>
                    )}
                </div>

                <div className={styles.panel}>
                    <div className={styles.panelHeader}>
                        <div>
                            <h3>最新任务</h3>
                            <p>任务未完成前会每 5 秒自动轮询一次状态。</p>
                        </div>
                        <button className={styles.secondaryBtn} onClick={handleRefreshStatus} disabled={!latestTask?.taskId || isRefreshing}>
                            {isRefreshing ? '刷新中...' : '立即刷新'}
                        </button>
                    </div>

                    {latestTask ? (
                        <>
                            <div className={styles.resultMeta}>
                                <div><span>接口家族</span><strong>{families.find((item) => item.id === latestTask.familyId)?.label || '未知接口'}</strong></div>
                                <div><span>任务 ID</span><code>{latestTask.taskId}</code></div>
                                <div><span>任务状态</span><span className={`${styles.statusPill} ${styles[`status${statusTone(latestTask.status)}`]}`}>{taskStatusLabel(latestTask.status)}</span></div>
                            </div>

                            {latestTask.videoUrl ? (
                                <video className={styles.videoPlayer} src={latestTask.videoUrl} controls playsInline preload="metadata" />
                            ) : (
                                <div className={styles.videoPlaceholder}>暂时还没有返回视频地址，请继续等待任务完成。</div>
                            )}

                            {latestTask.latestError ? <p className={styles.info}>{latestTask.latestError}</p> : null}

                            <details className={styles.rawBlock} open>
                                <summary>创建接口原始响应</summary>
                                <pre>{stringifyJson(latestTask.create.data)}</pre>
                            </details>

                            <details className={styles.rawBlock}>
                                <summary>最新查询原始响应</summary>
                                <pre>{stringifyJson(latestTask.latest?.data || null)}</pre>
                            </details>
                        </>
                    ) : (
                        <p className={styles.info}>提交任意一个视频任务后，这里会显示任务 ID、状态和输出结果。</p>
                    )}
                </div>
            </div>
        </section>
    );
}
