'use client';

import type { CSSProperties, ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VideoBotConfigMap, VideoBotEngineConfig, VideoBotMode, VideoBotTaskRecord } from '@/app/lib/video-bot/types';
import styles from './VideoForgeStudio.module.css';
import {
    IconBan,
    IconChevronDown,
    IconClapperboard,
    IconClipboard,
    IconCpu,
    IconDownload,
    IconExpand,
    IconFileText,
    IconFilm,
    IconFolder,
    IconFolderOpen,
    IconImage,
    IconInbox,
    IconKey,
    IconLightbulb,
    IconMonitor,
    IconMoon,
    IconPen,
    IconRocket,
    IconSave,
    IconSettings,
    IconSun,
    IconUpload,
    IconVideo,
    IconX,
    IconZoom,
} from './Icons';

type ThemeMode = 'dark' | 'light';
type ToastType = 'error' | 'success';

interface SnapshotState {
    apiKey: string;
    engine: string;
    mode: VideoBotMode;
    model: string;
    prompt: string;
    negativePrompt: string;
    firstFrame: string | null;
    lastFrame: string | null;
    aspectRatio: string;
    duration: string;
    resolution: string;
    enhancePrompt: boolean;
    enableUpsample: boolean;
    cameraMotion: string;
    watermark: boolean;
    audio: boolean;
    videoRef: string;
    theme: ThemeMode;
    selectedTaskId: string | null;
}

interface ToastState {
    message: string;
    type: ToastType;
}

const MODE_LABELS: Record<VideoBotMode, string> = {
    text2video: 'Text to Video',
    image2video: 'Image to Video',
    keyframe: 'Keyframe',
    video2video: 'Video Reference',
};

const CAMERA_LABELS: Record<string, string> = {
    simple: 'Auto',
    zoom_in: 'Zoom In',
    zoom_out: 'Zoom Out',
    pan_left: 'Pan Left',
    pan_right: 'Pan Right',
    tilt_up: 'Tilt Up',
    tilt_down: 'Tilt Down',
};

const STATUS_LABELS = {
    queued: 'Queued',
    processing: 'Processing',
    completed: 'Completed',
    failed: 'Failed',
} as const;

const SNAPSHOT_KEY = 'videoforge_snapshot_v2';
const THEME_KEY = 'videoforge_theme_v2';

function getToken(): string {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('token') || '';
}

async function requestJson<T>(url: string, init: RequestInit = {}, extraHeaders?: Record<string, string>): Promise<T> {
    const headers = new Headers(init.headers || {});
    if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    headers.set('Accept', 'application/json');

    const token = getToken();
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    if (extraHeaders) {
        Object.entries(extraHeaders).forEach(([key, value]) => {
            if (value) headers.set(key, value);
        });
    }

    const response = await fetch(url, {
        ...init,
        headers,
        cache: 'no-store',
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    if (!response.ok) {
        const message = typeof payload === 'string'
            ? payload
            : payload?.error || payload?.message || 'Request failed';
        throw new Error(message);
    }

    return payload as T;
}

function getModeIcon(mode: VideoBotMode) {
    switch (mode) {
        case 'text2video':
            return IconFileText;
        case 'image2video':
            return IconImage;
        case 'keyframe':
            return IconClapperboard;
        case 'video2video':
            return IconFilm;
    }
}

function readModels(config: VideoBotEngineConfig, mode: VideoBotMode) {
    return config.modeModels?.[mode] || config.models || [];
}

function isAuthError(message: string): boolean {
    return /log in|login|expired|invite code required|unauthorized|forbidden/i.test(message);
}

function canRenderImage(value: string | null): value is string {
    if (!value) {
        return false;
    }

    return /^data:/i.test(value) || /^https?:\/\//i.test(value) || value.startsWith('/');
}

function formatTaskTime(iso: string): string {
    try {
        return new Date(iso).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

export function VideoForgeStudio() {
    const router = useRouter();
    const firstFrameInputRef = useRef<HTMLInputElement | null>(null);
    const lastFrameInputRef = useRef<HTMLInputElement | null>(null);
    const videoInputRef = useRef<HTMLInputElement | null>(null);
    const toastTimerRef = useRef<number | null>(null);

    const [engineConfigMap, setEngineConfigMap] = useState<VideoBotConfigMap>({});
    const [configLoading, setConfigLoading] = useState(true);
    const [configError, setConfigError] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [engine, setEngine] = useState('veo');
    const [mode, setMode] = useState<VideoBotMode>('text2video');
    const [model, setModel] = useState('');
    const [prompt, setPrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('');
    const [firstFrame, setFirstFrame] = useState<string | null>(null);
    const [lastFrame, setLastFrame] = useState<string | null>(null);
    const [aspectRatio, setAspectRatio] = useState('16:9');
    const [duration, setDuration] = useState('');
    const [resolution, setResolution] = useState('');
    const [enhancePrompt, setEnhancePrompt] = useState(true);
    const [enableUpsample, setEnableUpsample] = useState(true);
    const [cameraMotion, setCameraMotion] = useState('');
    const [watermark, setWatermark] = useState(false);
    const [audio, setAudio] = useState(false);
    const [videoRef, setVideoRef] = useState('');
    const [tasks, setTasks] = useState<VideoBotTaskRecord[]>([]);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [theme, setTheme] = useState<ThemeMode>('dark');
    const [paramsCollapsed, setParamsCollapsed] = useState(false);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);
    const [fullscreen, setFullscreen] = useState(false);
    const [toast, setToast] = useState<ToastState | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const currentEngineConfig = engineConfigMap[engine] || null;
    const availableModels = currentEngineConfig ? readModels(currentEngineConfig, mode) : [];
    const effectiveParams = currentEngineConfig
        ? { ...currentEngineConfig.params, ...(currentEngineConfig.modeParams?.[mode] || {}) }
        : null;
    const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;
    const showImageUpload = mode === 'image2video' || mode === 'keyframe';
    const showLastFrame = mode === 'keyframe';

    function showToast(message: string, type: ToastType = 'error') {
        setToast({ message, type });
        if (toastTimerRef.current) {
            window.clearTimeout(toastTimerRef.current);
        }
        toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
    }

    function buildSnapshot(): SnapshotState {
        return {
            apiKey,
            engine,
            mode,
            model,
            prompt,
            negativePrompt,
            firstFrame,
            lastFrame,
            aspectRatio,
            duration,
            resolution,
            enhancePrompt,
            enableUpsample,
            cameraMotion,
            watermark,
            audio,
            videoRef,
            theme,
            selectedTaskId,
        };
    }

    function applySnapshot(snapshot: Partial<SnapshotState>) {
        if (snapshot.apiKey !== undefined) setApiKey(snapshot.apiKey);
        if (snapshot.engine) setEngine(snapshot.engine);
        if (snapshot.mode) setMode(snapshot.mode);
        if (snapshot.model !== undefined) setModel(snapshot.model);
        if (snapshot.prompt !== undefined) setPrompt(snapshot.prompt);
        if (snapshot.negativePrompt !== undefined) setNegativePrompt(snapshot.negativePrompt);
        if (snapshot.firstFrame !== undefined) setFirstFrame(snapshot.firstFrame);
        if (snapshot.lastFrame !== undefined) setLastFrame(snapshot.lastFrame);
        if (snapshot.aspectRatio) setAspectRatio(snapshot.aspectRatio);
        if (snapshot.duration !== undefined) setDuration(snapshot.duration);
        if (snapshot.resolution !== undefined) setResolution(snapshot.resolution);
        if (snapshot.enhancePrompt !== undefined) setEnhancePrompt(snapshot.enhancePrompt);
        if (snapshot.enableUpsample !== undefined) setEnableUpsample(snapshot.enableUpsample);
        if (snapshot.cameraMotion !== undefined) setCameraMotion(snapshot.cameraMotion);
        if (snapshot.watermark !== undefined) setWatermark(snapshot.watermark);
        if (snapshot.audio !== undefined) setAudio(snapshot.audio);
        if (snapshot.videoRef !== undefined) setVideoRef(snapshot.videoRef);
        if (snapshot.theme) setTheme(snapshot.theme);
        if (snapshot.selectedTaskId !== undefined) setSelectedTaskId(snapshot.selectedTaskId);
    }

    async function uploadMedia(type: 'image' | 'video', value: string) {
        const payload = type === 'image' ? { image: value } : { video: value };
        const response = await requestJson<{ url: string; warning?: string }>('/api/video-bot/upload', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        if (response.warning) showToast(response.warning);
        return response.url;
    }

    function handleImageUpload(event: ChangeEvent<HTMLInputElement>, setter: (value: string | null) => void) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
            showToast('Image must be smaller than 10MB.');
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => setter(typeof reader.result === 'string' ? reader.result : null);
        reader.readAsDataURL(file);
        event.target.value = '';
    }

    async function uploadVideoFile(file: File) {
        if (file.size > 100 * 1024 * 1024) {
            showToast('Video must be smaller than 100MB.');
            return;
        }

        const reader = new FileReader();
        reader.onload = async () => {
            if (typeof reader.result !== 'string') return;
            try {
                showToast('Uploading reference video...', 'success');
                const url = await uploadMedia('video', reader.result);
                setVideoRef(url);
                showToast('Reference video uploaded.', 'success');
            } catch (error) {
                showToast(error instanceof Error ? error.message : 'Video upload failed.');
            }
        };
        reader.readAsDataURL(file);
    }

    function useAsReference(videoUrl: string) {
        setVideoRef(videoUrl);
        setEngine('kling');
        setMode('video2video');
        showToast('Result video set as reference.', 'success');
    }

    useEffect(() => {
        const savedTheme = window.localStorage.getItem(THEME_KEY);
        if (savedTheme === 'dark' || savedTheme === 'light') {
            setTheme(savedTheme);
        }
    }, []);

    useEffect(() => {
        window.localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    useEffect(() => {
        return () => {
            if (toastTimerRef.current) {
                window.clearTimeout(toastTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function loadBootstrap() {
            setConfigLoading(true);
            setConfigError('');
            try {
                const [configData, taskData] = await Promise.all([
                    requestJson<VideoBotConfigMap>('/api/video-bot/config'),
                    requestJson<VideoBotTaskRecord[]>('/api/video-bot/tasks'),
                ]);

                if (cancelled) return;
                const snapshotRaw = window.localStorage.getItem(SNAPSHOT_KEY);
                const initialEngine = Object.keys(configData)[0] || 'veo';

                setEngineConfigMap(configData);
                setTasks(taskData);
                setSelectedTaskId((current) => current || taskData[0]?.id || null);

                if (snapshotRaw) {
                    try {
                        const snapshot = JSON.parse(snapshotRaw) as Partial<SnapshotState>;
                        applySnapshot({
                            ...snapshot,
                            engine: snapshot.engine && configData[snapshot.engine] ? snapshot.engine : initialEngine,
                        });
                    } catch {
                        window.localStorage.removeItem(SNAPSHOT_KEY);
                        setEngine(initialEngine);
                    }
                } else {
                    setEngine(initialEngine);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to load VideoForge config.';
                if (!cancelled) {
                    setConfigError(message);
                    if (isAuthError(message)) router.replace('/login');
                }
            } finally {
                if (!cancelled) setConfigLoading(false);
            }
        }

        void loadBootstrap();
        return () => {
            cancelled = true;
        };
    }, [router]);

    useEffect(() => {
        if (!currentEngineConfig) return;
        if (!currentEngineConfig.modes.includes(mode)) {
            setMode(currentEngineConfig.modes[0]);
            return;
        }

        const nextParams = { ...currentEngineConfig.params, ...(currentEngineConfig.modeParams?.[mode] || {}) };
        const nextModels = readModels(currentEngineConfig, mode);

        if (!nextModels.some((item) => item.value === model)) {
            setModel(nextModels[0]?.value || '');
        }
        if (Array.isArray(nextParams.duration) && nextParams.duration.length > 0) {
            const durationOptions = nextParams.duration;
            setDuration((current) => (durationOptions.includes(Number(current)) ? current : String(durationOptions[0])));
        } else if (duration) {
            setDuration('');
        }
        if (Array.isArray(nextParams.resolution) && nextParams.resolution.length > 0) {
            const resolutionOptions = nextParams.resolution;
            setResolution((current) => (resolutionOptions.includes(current) ? current : resolutionOptions[0]));
        } else if (resolution) {
            setResolution('');
        }
        if (Array.isArray(nextParams.aspectRatio) && nextParams.aspectRatio.length > 0) {
            const aspectRatioOptions = nextParams.aspectRatio;
            setAspectRatio((current) => (aspectRatioOptions.includes(current) ? current : aspectRatioOptions[0]));
        }
        if (!Array.isArray(nextParams.cameraMotion) && cameraMotion) {
            setCameraMotion('');
        }

        setEnhancePrompt(Boolean(nextParams.enhancePrompt));
        setEnableUpsample(Boolean(nextParams.enableUpsample));
        setWatermark(false);
        setAudio(false);
    }, [cameraMotion, currentEngineConfig, duration, mode, model, resolution]);

    useEffect(() => {
        window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(buildSnapshot()));
    }, [apiKey, aspectRatio, audio, cameraMotion, duration, enableUpsample, engine, firstFrame, lastFrame, mode, model, negativePrompt, prompt, resolution, selectedTaskId, theme, videoRef, watermark, enhancePrompt]);

    useEffect(() => {
        if (!selectedTaskId) {
            setSelectedTaskId(tasks[0]?.id || null);
            return;
        }
        if (!tasks.some((task) => task.id === selectedTaskId)) {
            setSelectedTaskId(tasks[0]?.id || null);
        }
    }, [selectedTaskId, tasks]);

    useEffect(() => {
        if (!apiKey.trim()) return;
        const pendingTasks = tasks.filter((task) => task.engineTaskId && task.status !== 'failed' && (task.status === 'queued' || task.status === 'processing' || !task.videoUrl));
        if (pendingTasks.length === 0) return;

        const timer = window.setInterval(async () => {
            for (const task of pendingTasks) {
                try {
                    const nextTask = await requestJson<VideoBotTaskRecord>(`/api/video-bot/tasks/${task.id}`, {}, {
                        'x-api-key': apiKey.trim(),
                    });
                    setTasks((current) => current.map((item) => (item.id === task.id ? nextTask : item)));
                    if (nextTask.status === 'completed' && nextTask.videoUrl && task.status !== 'completed') {
                        showToast(`${engineConfigMap[nextTask.engine]?.label || nextTask.engine} task completed.`, 'success');
                    }
                } catch {
                    // Ignore transient polling errors.
                }
            }
        }, 3000);

        return () => window.clearInterval(timer);
    }, [apiKey, engineConfigMap, tasks]);

    async function handleSubmit() {
        if (!apiKey.trim()) return showToast('API Key is required.');
        if (!prompt.trim() && mode === 'text2video') return showToast('Prompt is required for text to video.');
        if ((mode === 'image2video' || mode === 'keyframe') && !firstFrame) return showToast('First frame is required.');
        if (mode === 'keyframe' && !lastFrame) return showToast('Last frame is required for keyframe mode.');
        if (mode === 'video2video' && !videoRef.trim()) return showToast('Reference video is required.');

        setIsSubmitting(true);
        try {
            let firstFrameUrl = firstFrame;
            let lastFrameUrl = lastFrame;

            if (firstFrame?.startsWith('data:')) firstFrameUrl = await uploadMedia('image', firstFrame);
            if (lastFrame?.startsWith('data:')) lastFrameUrl = await uploadMedia('image', lastFrame);

            const nextTask = await requestJson<VideoBotTaskRecord>('/api/video-bot/tasks', {
                method: 'POST',
                body: JSON.stringify({
                    engine,
                    mode,
                    apiKey: apiKey.trim(),
                    params: {
                        prompt: prompt.trim(),
                        model,
                        aspectRatio: Array.isArray(effectiveParams?.aspectRatio) ? aspectRatio : undefined,
                        duration: duration ? Number(duration) : undefined,
                        resolution: resolution || undefined,
                        enhancePrompt,
                        enableUpsample,
                        cameraMotion: cameraMotion || undefined,
                        negativePrompt: negativePrompt.trim() || undefined,
                        watermark,
                        audio,
                        firstFrameImage: firstFrameUrl || undefined,
                        lastFrameImage: lastFrameUrl || undefined,
                        videoUrl: videoRef.trim() || undefined,
                    },
                }),
            });

            setTasks((current) => [nextTask, ...current]);
            setSelectedTaskId(nextTask.id);
            showToast('Task submitted.', 'success');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Task submission failed.';
            if (isAuthError(message)) {
                router.replace('/login');
                return;
            }
            showToast(message);
        } finally {
            setIsSubmitting(false);
        }
    }

    async function refreshTask(taskId: string) {
        try {
            const nextTask = await requestJson<VideoBotTaskRecord>(`/api/video-bot/tasks/${taskId}`, {}, {
                'x-api-key': apiKey.trim(),
            });
            setTasks((current) => current.map((task) => (task.id === taskId ? nextTask : task)));
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Refresh failed.');
        }
    }

    async function handleDeleteTask(taskId: string) {
        try {
            await requestJson<{ success: boolean }>(`/api/video-bot/tasks/${taskId}`, { method: 'DELETE' });
            setTasks((current) => current.filter((task) => task.id !== taskId));
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Delete failed.');
        }
    }

    return (
        <div className={styles.page} data-theme={theme}>
            <header className={styles.topbar}>
                <button type="button" className={styles.brand} onClick={() => router.push('/')}>
                    <IconClapperboard size={18} />
                    <span>VideoForge</span>
                    <small>Video Generator Bot</small>
                </button>
                <div className={styles.topbarActions}>
                    <button type="button" className={styles.secondaryAction} onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}>
                        {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
                        {theme === 'dark' ? 'Light' : 'Dark'}
                    </button>
                    <button type="button" className={styles.secondaryAction} onClick={() => {
                        window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(buildSnapshot()));
                        showToast('Snapshot saved.', 'success');
                    }}>
                        <IconSave size={14} />
                        Save Snapshot
                    </button>
                    <button type="button" className={styles.secondaryAction} onClick={() => {
                        const raw = window.localStorage.getItem(SNAPSHOT_KEY);
                        if (!raw) return showToast('No snapshot found.');
                        try {
                            applySnapshot(JSON.parse(raw) as Partial<SnapshotState>);
                            showToast('Snapshot restored.', 'success');
                        } catch {
                            showToast('Snapshot is invalid.');
                        }
                    }}>
                        <IconFolderOpen size={14} />
                        Load Snapshot
                    </button>
                    <label className={styles.apiKeyField}>
                        <span><IconKey size={14} /> API Key</span>
                        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Enter your Yunwu API Key" />
                    </label>
                </div>
            </header>

            <main className={styles.layout}>
                <section className={styles.leftColumn}>
                    <div className={styles.heroCard}>
                        <div>
                            <div className={styles.heroBadge}>VideoForge Native</div>
                            <h1>Run multi-engine video generation from one workspace</h1>
                            <p>Create, monitor, retry, and reuse video jobs with personal API keys and per-user task history.</p>
                        </div>
                        <div className={styles.heroStats}>
                            <div><strong>{tasks.length}</strong><span>Total tasks</span></div>
                            <div><strong>{tasks.filter((task) => task.status === 'completed').length}</strong><span>Completed</span></div>
                            <div><strong>{tasks.filter((task) => task.status === 'queued' || task.status === 'processing').length}</strong><span>In progress</span></div>
                        </div>
                    </div>

                    {configLoading ? <div className={styles.notice}>Loading engine config...</div> : null}
                    {configError ? <div className={styles.errorNotice}>{configError}</div> : null}

                    <div className={styles.engineTabs}>
                        {Object.entries(engineConfigMap).map(([engineId, config]) => (
                            <button key={engineId} type="button" className={`${styles.engineTab} ${engine === engineId ? styles.engineTabActive : ''}`} onClick={() => setEngine(engineId)} style={{ ['--engine-accent' as string]: config.color } as CSSProperties}>
                                <span className={styles.engineDot} />
                                {config.label}
                            </button>
                        ))}
                    </div>

                    <div className={styles.modeRow}>
                        {(Object.keys(MODE_LABELS) as VideoBotMode[]).map((modeKey) => {
                            const ModeIcon = getModeIcon(modeKey);
                            const disabled = !currentEngineConfig?.modes.includes(modeKey);
                            return (
                                <button key={modeKey} type="button" disabled={disabled} className={`${styles.modeButton} ${mode === modeKey ? styles.modeButtonActive : ''}`} onClick={() => setMode(modeKey)}>
                                    <ModeIcon size={14} />
                                    {MODE_LABELS[modeKey]}
                                </button>
                            );
                        })}
                    </div>

                    <section className={styles.card}>
                        <label className={styles.blockField}>
                            <span className={styles.fieldLabel}><IconCpu size={14} /> Model</span>
                            <select value={model} onChange={(event) => setModel(event.target.value)}>
                                {availableModels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                        </label>

                        <label className={styles.blockField}>
                            <span className={styles.fieldLabel}><IconPen size={14} /> Prompt</span>
                            <textarea rows={5} maxLength={2000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the motion, camera language, scene, lighting, and pacing..." />
                            <small className={styles.fieldMeta}>{prompt.length}/2000</small>
                        </label>

                        {effectiveParams?.negativePrompt ? (
                            <label className={styles.blockField}>
                                <span className={styles.fieldLabel}><IconBan size={14} /> Negative Prompt</span>
                                <textarea rows={3} value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} placeholder="Describe what should be excluded..." />
                            </label>
                        ) : null}

                        {showImageUpload ? (
                            <div className={styles.blockField}>
                                <span className={styles.fieldLabel}><IconImage size={14} /> Frame Inputs</span>
                                <div className={styles.imageUploadGrid}>
                                    {[{ label: 'First Frame', value: firstFrame, setter: setFirstFrame, inputRef: firstFrameInputRef }, ...(showLastFrame ? [{ label: 'Last Frame', value: lastFrame, setter: setLastFrame, inputRef: lastFrameInputRef }] : [])].map((item) => (
                                        <div key={item.label} className={styles.imageUploadCol}>
                                            <button type="button" className={`${styles.uploadZone} ${item.value ? styles.uploadZoneFilled : ''}`} onClick={() => item.inputRef.current?.click()}>
                                                {canRenderImage(item.value) ? (
                                                    <>
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={item.value} alt={item.label} className={styles.uploadPreview} />
                                                        <div className={styles.uploadActions}>
                                                            <button type="button" onClick={(event) => { event.stopPropagation(); setLightboxImage(item.value); }}><IconZoom size={12} /></button>
                                                            <button type="button" onClick={(event) => { event.stopPropagation(); item.setter(null); }}><IconX size={12} /></button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className={styles.uploadPlaceholder}>
                                                        <IconUpload size={18} />
                                                        <span>{item.label}</span>
                                                    </div>
                                                )}
                                            </button>
                                            <input ref={item.inputRef} type="file" hidden accept="image/*" onChange={(event) => handleImageUpload(event, item.setter)} />
                                            <input type="text" value={item.value?.startsWith('data:') ? '' : item.value || ''} onChange={(event) => item.setter(event.target.value.trim() || null)} placeholder={`${item.label} URL`} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {mode === 'video2video' ? (
                            <div className={styles.blockField}>
                                <span className={styles.fieldLabel}><IconFilm size={14} /> Reference Video</span>
                                <button type="button" className={`${styles.videoDropzone} ${videoRef ? styles.videoDropzoneFilled : ''}`} onClick={() => videoInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                                    event.preventDefault();
                                    const file = event.dataTransfer.files?.[0];
                                    if (file && file.type.startsWith('video/')) void uploadVideoFile(file);
                                }}>
                                    {videoRef ? <div className={styles.videoReferenceInfo}><IconFilm size={18} /><span>{videoRef.length > 80 ? `${videoRef.slice(0, 80)}...` : videoRef}</span></div> : <div className={styles.uploadPlaceholder}><IconFolder size={20} /><span>Drop a video file or click to upload</span></div>}
                                </button>
                                <input ref={videoInputRef} type="file" hidden accept="video/*" onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void uploadVideoFile(file);
                                    event.target.value = '';
                                }} />
                                <input type="text" value={videoRef} onChange={(event) => setVideoRef(event.target.value.trim())} placeholder="Reference video URL" />
                                <small className={styles.fieldMeta}><IconLightbulb size={12} /> You can also reuse a completed output from the task list.</small>
                            </div>
                        ) : null}

                        <div className={styles.paramsCard}>
                            <button type="button" className={styles.paramsToggle} onClick={() => setParamsCollapsed((value) => !value)}>
                                <span><IconSettings size={14} /> Advanced Params</span>
                                <IconChevronDown className={paramsCollapsed ? styles.chevronCollapsed : ''} />
                            </button>
                            {!paramsCollapsed ? (
                                <div className={styles.paramsGrid}>
                                    {Array.isArray(effectiveParams?.aspectRatio) ? <div className={styles.paramBlock}><span className={styles.paramLabel}>Aspect Ratio</span><div className={styles.segmentedRow}>{effectiveParams.aspectRatio.map((ratio) => <button key={ratio} type="button" className={`${styles.segmentedButton} ${aspectRatio === ratio ? styles.segmentedButtonActive : ''}`} onClick={() => setAspectRatio(ratio)}>{ratio}</button>)}</div></div> : null}
                                    {Array.isArray(effectiveParams?.duration) ? <div className={styles.paramBlock}><span className={styles.paramLabel}>Duration</span><div className={styles.segmentedRow}>{effectiveParams.duration.map((value) => <button key={value} type="button" className={`${styles.segmentedButton} ${duration === String(value) ? styles.segmentedButtonActive : ''}`} onClick={() => setDuration(String(value))}>{value}s</button>)}</div></div> : null}
                                    {Array.isArray(effectiveParams?.resolution) ? <label className={styles.paramBlock}><span className={styles.paramLabel}>Resolution</span><select value={resolution} onChange={(event) => setResolution(event.target.value)}>{effectiveParams.resolution.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
                                    {Array.isArray(effectiveParams?.cameraMotion) ? <label className={styles.paramBlock}><span className={styles.paramLabel}>Camera Motion</span><select value={cameraMotion} onChange={(event) => setCameraMotion(event.target.value)}><option value="">None</option>{effectiveParams.cameraMotion.map((value) => <option key={value} value={value}>{CAMERA_LABELS[value] || value}</option>)}</select></label> : null}
                                    {effectiveParams?.enhancePrompt !== undefined ? <label className={styles.switchBlock}><span>Enhance Prompt</span><input type="checkbox" checked={enhancePrompt} onChange={(event) => setEnhancePrompt(event.target.checked)} /></label> : null}
                                    {effectiveParams?.enableUpsample !== undefined ? <label className={styles.switchBlock}><span>Upsample</span><input type="checkbox" checked={enableUpsample} onChange={(event) => setEnableUpsample(event.target.checked)} /></label> : null}
                                    {effectiveParams?.watermark ? <label className={styles.switchBlock}><span>Watermark</span><input type="checkbox" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} /></label> : null}
                                    {effectiveParams?.audio ? <label className={styles.switchBlock}><span>Audio Sync</span><input type="checkbox" checked={audio} onChange={(event) => setAudio(event.target.checked)} /></label> : null}
                                </div>
                            ) : null}
                        </div>

                        <button type="button" className={styles.primaryAction} onClick={() => void handleSubmit()} disabled={isSubmitting || configLoading || !currentEngineConfig}>
                            <IconRocket size={15} />
                            {isSubmitting ? 'Submitting...' : 'Generate Video'}
                        </button>
                    </section>
                </section>

                <aside className={styles.rightColumn}>
                    <div className={styles.sidebarHeader}>
                        <span><IconClipboard size={14} /> Tasks</span>
                        <span>{tasks.length} total</span>
                    </div>
                    <div className={styles.taskList}>
                        {tasks.length === 0 ? (
                            <div className={styles.emptyState}>
                                <IconInbox size={28} />
                                <p>No tasks yet. Submit one to start.</p>
                            </div>
                        ) : tasks.map((task) => (
                            <div key={task.id} className={`${styles.taskCard} ${selectedTaskId === task.id ? styles.taskCardActive : ''}`} style={{ ['--task-accent' as string]: engineConfigMap[task.engine]?.color || '#4f46e5' } as CSSProperties} onClick={() => setSelectedTaskId(task.id)}>
                                <button type="button" className={styles.taskDeleteButton} onClick={(event) => { event.stopPropagation(); void handleDeleteTask(task.id); }}>
                                    <IconX size={12} />
                                </button>
                                <div className={styles.taskHeader}>
                                    <span className={styles.taskEngineBadge}>{engineConfigMap[task.engine]?.label || task.engine}</span>
                                    <span className={`${styles.taskStatus} ${styles[`taskStatus${task.status}`]}`}>{STATUS_LABELS[task.status]}</span>
                                </div>
                                <strong>{MODE_LABELS[task.mode]}</strong>
                                <p>{task.prompt || 'No prompt'}</p>
                                <div className={styles.taskFooter}>
                                    <span>{`${task.model || 'Default model'} - ${formatTaskTime(task.createdAt)}`}</span>
                                    <div className={styles.taskActions}>
                                        {task.videoUrl ? <button type="button" onClick={(event) => { event.stopPropagation(); useAsReference(task.videoUrl || ''); }}>Use as Ref</button> : null}
                                        {task.videoUrl ? <button type="button" onClick={(event) => { event.stopPropagation(); window.open(task.videoUrl || '', '_blank', 'noopener,noreferrer'); }}>Download</button> : null}
                                        {task.status !== 'completed' && apiKey.trim() ? <button type="button" onClick={(event) => { event.stopPropagation(); void refreshTask(task.id); }}>Refresh</button> : null}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className={styles.previewCard}>
                        <div className={styles.previewHeader}>
                            <span><IconMonitor size={14} /> Preview</span>
                        </div>
                        {selectedTask?.videoUrl ? (
                            <>
                                <video className={styles.previewVideo} src={selectedTask.videoUrl} controls autoPlay loop playsInline />
                                <div className={styles.previewActions}>
                                    <button type="button" onClick={() => setFullscreen(true)}><IconExpand size={13} /> Expand</button>
                                    <button type="button" onClick={() => window.open(selectedTask.videoUrl || '', '_blank', 'noopener,noreferrer')}><IconDownload size={13} /> Download</button>
                                </div>
                            </>
                        ) : (
                            <div className={styles.emptyState}>
                                <IconVideo size={28} />
                                <p>{selectedTask ? (selectedTask.status === 'failed' ? selectedTask.error || 'Task failed.' : selectedTask.pollError || 'Still rendering. Refresh in a moment.') : 'Select a task to preview the result.'}</p>
                            </div>
                        )}
                    </div>
                </aside>
            </main>

            {fullscreen && selectedTask?.videoUrl ? (
                <div className={styles.modalOverlay} onClick={() => setFullscreen(false)}>
                    <div className={styles.modalContent} onClick={(event) => event.stopPropagation()}>
                        <button type="button" className={styles.modalClose} onClick={() => setFullscreen(false)}>
                            <IconX size={16} />
                        </button>
                        <video className={styles.modalVideo} src={selectedTask.videoUrl} controls autoPlay loop playsInline />
                    </div>
                </div>
            ) : null}

            {lightboxImage ? (
                <div className={styles.modalOverlay} onClick={() => setLightboxImage(null)}>
                    <div className={styles.imageLightbox} onClick={(event) => event.stopPropagation()}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={lightboxImage} alt="Preview" />
                    </div>
                </div>
            ) : null}

            {toast ? <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>{toast.message}</div> : null}
        </div>
    );
}
