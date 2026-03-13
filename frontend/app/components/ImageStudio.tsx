'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ImageGenerationItem, ImagePromptTagItem, resolveImageAssetUrl } from '../lib/api';
import { PROMPT_LIBRARY_GROUPS, PROMPT_LIBRARY_GROUP_KEY_SET } from './imagePromptLibrary';
import styles from './ImageStudio.module.css';

interface ImageStudioProps {
    isAuthenticated: boolean;
    onRequireLogin: () => void;
}

const DRAFT_KEY = 'image_studio_draft_v2';
const TAG_LIMIT = 300;

const ASPECT_RATIOS = ['1:1', '4:5', '3:4', '16:9', '9:16'];
const STYLE_PRESETS = ['电商清透', '高级时尚', '生活场景', '高反差冲击', '极简高级'];
const BACKGROUNDS = ['纯白背景', '浅灰背景', '柔和渐变', '暖色氛围', '场景化背景'];
const LIGHTING_OPTIONS = ['棚拍柔光', '自然窗光', '高对比硬光', '逆光氛围', '俯拍清晰光'];

type ParameterField = 'aspectRatio' | 'stylePreset' | 'background' | 'lighting';
interface ParameterTagGroup {
    key: ParameterField;
    title: string;
    options: string[];
}

const PARAMETER_TAG_GROUPS: ParameterTagGroup[] = [
    { key: 'aspectRatio', title: '画幅比例', options: ASPECT_RATIOS },
];
const GROUP_KEY_TO_PARAMETER_FIELD: Record<string, ParameterField> = {
    aspectRatio: 'aspectRatio',
    style: 'stylePreset',
    background: 'background',
    lighting: 'lighting',
};

type CustomTagsByGroup = Record<string, ImagePromptTagItem[]>;

interface DraftState {
    manualPrompt: string;
    negativePrompt: string;
    aspectRatio: string;
    stylePreset: string;
    background: string;
    lighting: string;
    referenceStrength: number;
    count: number;
    selectedTags: string[];
}

const DEFAULT_STATE: DraftState = {
    manualPrompt: '1:1，电商清透，纯白背景，棚拍柔光',
    negativePrompt: '',
    aspectRatio: '1:1',
    stylePreset: STYLE_PRESETS[0],
    background: BACKGROUNDS[0],
    lighting: LIGHTING_OPTIONS[0],
    referenceStrength: 50,
    count: 1,
    selectedTags: ['1:1', '电商清透', '纯白背景', '棚拍柔光'],
};

function statusText(status: string): string {
    if (status === 'success') return '成功';
    if (status === 'partial') return '部分成功';
    if (status === 'failed') return '失败';
    return status;
}

function formatTime(input: string): string {
    const date = new Date(input);
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function normalizeCustomGroups(items: ImagePromptTagItem[]): CustomTagsByGroup {
    return items.reduce<CustomTagsByGroup>((acc, item) => {
        if (!acc[item.groupKey]) acc[item.groupKey] = [];
        acc[item.groupKey].push(item);
        return acc;
    }, {});
}

function uniqueTags(tags: string[]): string[] {
    return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

function trimPunctuation(input: string): string {
    return input.trim().replace(/[，,。；;、\s]+$/g, '');
}

function normalizePromptToken(input: string): string {
    return trimPunctuation(input.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim());
}

function splitPromptTokens(input: string): string[] {
    return input
        .replace(/\r\n/g, '\n')
        .split(/[，,；;\n]+/)
        .map(normalizePromptToken)
        .filter(Boolean);
}

function appendPromptTag(prompt: string, tag: string): string {
    const nextTag = normalizePromptToken(tag);
    if (!nextTag) return prompt.trim();
    if (splitPromptTokens(prompt).includes(nextTag)) return prompt.trim();
    const base = trimPunctuation(prompt);
    return base ? `${base}，${nextTag}` : nextTag;
}

function removePromptTag(prompt: string, tag: string): string {
    const nextTag = normalizePromptToken(tag);
    if (!nextTag) return prompt.trim();
    return splitPromptTokens(prompt)
        .filter((token) => token !== nextTag)
        .join('，');
}

function replacePromptTag(prompt: string, currentTag: string, nextTag: string): string {
    const withoutCurrent = currentTag ? removePromptTag(prompt, currentTag) : prompt;
    return nextTag ? appendPromptTag(withoutCurrent, nextTag) : trimPunctuation(withoutCurrent);
}

function ensurePromptContainsTags(prompt: string, tags: string[]): string {
    return uniqueTags(tags).reduce((result, tag) => appendPromptTag(result, tag), prompt);
}

function summarizeRecentPrompt(input: string): string {
    const compact = input.replace(/\s+/g, ' ').trim();
    if (compact.length <= 68) return compact;
    return `${compact.slice(0, 68)}...`;
}

function withAspectRatioTag(tags: string[], aspectRatio: string): string[] {
    const filtered = tags.filter((tag) => !ASPECT_RATIOS.includes(tag));
    return uniqueTags([...filtered, aspectRatio]);
}

function resolveParameterField(tag: string, groupKey: string | undefined, draft: DraftState): ParameterField | null {
    if (groupKey && GROUP_KEY_TO_PARAMETER_FIELD[groupKey]) return GROUP_KEY_TO_PARAMETER_FIELD[groupKey];
    if (ASPECT_RATIOS.includes(tag)) return 'aspectRatio';
    if (tag === draft.stylePreset && draft.stylePreset) return 'stylePreset';
    if (tag === draft.background && draft.background) return 'background';
    if (tag === draft.lighting && draft.lighting) return 'lighting';
    return null;
}

function applyParameterFieldTag(draft: DraftState, field: ParameterField, value: string): DraftState {
    if (field === 'aspectRatio') {
        if (draft.aspectRatio === value) return draft;
        return {
            ...draft,
            aspectRatio: value,
            manualPrompt: replacePromptTag(draft.manualPrompt, draft.aspectRatio, value),
            selectedTags: withAspectRatioTag(draft.selectedTags, value),
        };
    }

    const current = draft[field]?.trim() || '';
    const next = value.trim();
    const shouldClear = current === next;
    const resolvedValue = shouldClear ? '' : next;
    const withoutCurrent = current
        ? draft.selectedTags.filter((tag) => tag !== current)
        : draft.selectedTags.slice();
    const withNew = resolvedValue ? [...withoutCurrent, resolvedValue] : withoutCurrent;

    return {
        ...draft,
        [field]: resolvedValue,
        manualPrompt: shouldClear
            ? removePromptTag(draft.manualPrompt, current)
            : replacePromptTag(draft.manualPrompt, current, resolvedValue),
        selectedTags: withAspectRatioTag(uniqueTags(withNew), draft.aspectRatio),
    };
}

export default function ImageStudio({ isAuthenticated, onRequireLogin }: ImageStudioProps) {
    const router = useRouter();
    const [state, setState] = useState<DraftState>(DEFAULT_STATE);
    const [referenceFile, setReferenceFile] = useState<File | null>(null);
    const [referencePreview, setReferencePreview] = useState<string | null>(null);
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [latestResult, setLatestResult] = useState<ImageGenerationItem | null>(null);
    const [recentItems, setRecentItems] = useState<ImageGenerationItem[]>([]);
    const [isLoadingRecent, setIsLoadingRecent] = useState(false);

    const [customTagsByGroup, setCustomTagsByGroup] = useState<CustomTagsByGroup>({});
    const [customTagInputs, setCustomTagInputs] = useState<Record<string, string>>({});
    const [isSavingTagGroup, setIsSavingTagGroup] = useState<string | null>(null);
    const [isDeletingTagId, setIsDeletingTagId] = useState<string | null>(null);
    const [customTagError, setCustomTagError] = useState<string | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw) as Partial<DraftState>;
            setState((prev) => ({
                ...(() => {
                    const nextAspect = parsed.aspectRatio && ASPECT_RATIOS.includes(parsed.aspectRatio) ? parsed.aspectRatio : prev.aspectRatio;
                    const nextStyle = parsed.stylePreset || prev.stylePreset;
                    const nextBackground = parsed.background || prev.background;
                    const nextLighting = parsed.lighting || prev.lighting;
                    const nextTagsRaw = Array.isArray(parsed.selectedTags) ? uniqueTags(parsed.selectedTags) : prev.selectedTags;
                    return {
                        ...prev,
                        ...parsed,
                        manualPrompt: ensurePromptContainsTags(
                            typeof parsed.manualPrompt === 'string' ? parsed.manualPrompt : prev.manualPrompt,
                            withAspectRatioTag(nextTagsRaw, nextAspect),
                        ),
                        negativePrompt: typeof parsed.negativePrompt === 'string' ? parsed.negativePrompt : prev.negativePrompt,
                        aspectRatio: nextAspect,
                        stylePreset: nextStyle,
                        background: nextBackground,
                        lighting: nextLighting,
                        selectedTags: withAspectRatioTag(nextTagsRaw, nextAspect),
                        referenceStrength: typeof parsed.referenceStrength === 'number' ? parsed.referenceStrength : prev.referenceStrength,
                        count: typeof parsed.count === 'number' ? parsed.count : prev.count,
                    };
                })(),
            }));
            localStorage.removeItem(DRAFT_KEY);
        } catch {
            localStorage.removeItem(DRAFT_KEY);
        }
    }, []);

    useEffect(() => () => {
        if (referencePreview) URL.revokeObjectURL(referencePreview);
    }, [referencePreview]);

    useEffect(() => {
        if (!previewImageUrl) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setPreviewImageUrl(null);
            }
        };

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [previewImageUrl]);

    const selectedTagSet = useMemo(() => new Set(state.selectedTags), [state.selectedTags]);

    const allKnownTags = useMemo(() => {
        const defaults = PROMPT_LIBRARY_GROUPS.flatMap((group) => group.tags);
        const customs = Object.values(customTagsByGroup).flat().map((item) => item.label);
        return uniqueTags([...defaults, ...customs, ...ASPECT_RATIOS, ...STYLE_PRESETS, ...BACKGROUNDS, ...LIGHTING_OPTIONS]);
    }, [customTagsByGroup]);

    const finalPrompt = useMemo(() => trimPunctuation(state.manualPrompt), [state.manualPrompt]);

    const canGenerate = useMemo(() => {
        return finalPrompt.length > 0 && !isGenerating;
    }, [finalPrompt, isGenerating]);

    const persistDraft = () => {
        if (typeof window === 'undefined') return;
        localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    };

    const loadRecent = async () => {
        if (!isAuthenticated) {
            setRecentItems([]);
            return;
        }

        setIsLoadingRecent(true);
        try {
            const response = await api.getImageGenerations({ limit: 3 });
            setRecentItems(response.data.items.slice(0, 3));
        } catch {
            setRecentItems([]);
        } finally {
            setIsLoadingRecent(false);
        }
    };

    const loadCustomTags = async () => {
        if (!isAuthenticated) {
            setCustomTagsByGroup({});
            return;
        }
        try {
            const response = await api.getImagePromptTags();
            setCustomTagsByGroup(normalizeCustomGroups(response.data.items));
        } catch {
            setCustomTagsByGroup({});
        }
    };

    useEffect(() => {
        loadRecent();
        loadCustomTags();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    const onToggleTag = (tag: string, groupKey?: string) => {
        setState((prev) => {
            const parameterField = resolveParameterField(tag, groupKey, prev);
            if (parameterField) {
                return applyParameterFieldTag(prev, parameterField, tag);
            }

            const exists = prev.selectedTags.includes(tag);
            const next = exists
                ? prev.selectedTags.filter((item) => item !== tag)
                : [...prev.selectedTags, tag];
            return {
                ...prev,
                manualPrompt: exists ? removePromptTag(prev.manualPrompt, tag) : appendPromptTag(prev.manualPrompt, tag),
                selectedTags: withAspectRatioTag(uniqueTags(next), prev.aspectRatio),
            };
        });
    };

    const clearSelectedTags = () => {
        setState((prev) => {
            const removableTags = uniqueTags(prev.selectedTags.filter((tag) => tag !== prev.aspectRatio));
            const nextPrompt = removableTags.reduce((result, tag) => removePromptTag(result, tag), prev.manualPrompt);
            return {
                ...prev,
                manualPrompt: ensurePromptContainsTags(nextPrompt, [prev.aspectRatio]),
                stylePreset: '',
                background: '',
                lighting: '',
                selectedTags: withAspectRatioTag([], prev.aspectRatio),
            };
        });
    };

    const onPickReference = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
        if (!allowed.has(file.type)) {
            setError('参考图仅支持 JPG / PNG / WEBP。');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            setError('参考图大小不能超过 10MB。');
            return;
        }

        if (referencePreview) URL.revokeObjectURL(referencePreview);
        setReferenceFile(file);
        setReferencePreview(URL.createObjectURL(file));
        setError(null);
    };

    const removeReference = () => {
        if (referencePreview) URL.revokeObjectURL(referencePreview);
        setReferenceFile(null);
        setReferencePreview(null);
    };

    const handleGenerate = async () => {
        if (!isAuthenticated) {
            onRequireLogin();
            return;
        }
        if (!canGenerate) return;

        setIsGenerating(true);
        setError(null);

        try {
            // Build JSON body (base64 for reference image)
            const body: Record<string, unknown> = {
                prompt: finalPrompt,
                aspectRatio: state.aspectRatio,
                referenceStrength: state.referenceStrength,
                count: state.count,
            };
            if (state.negativePrompt.trim()) body.negativePrompt = state.negativePrompt.trim();
            if (state.stylePreset.trim()) body.stylePreset = state.stylePreset.trim();
            if (state.background.trim()) body.background = state.background.trim();
            if (state.lighting.trim()) body.lighting = state.lighting.trim();

            if (referenceFile) {
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const result = reader.result as string;
                        resolve(result.split(',')[1]); // strip data:...;base64, prefix
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(referenceFile);
                });
                body.referenceImage = base64;
                body.referenceImageMime = referenceFile.type;
            }

            const response = await api.generateImage(body);
            setLatestResult(response.data);
            setIsGenerating(false);
            void loadRecent();
        } catch (err) {
            setError(err instanceof Error ? err.message : '生成失败，请重试');
        } finally {
            setIsGenerating(false);
        }
    };

    const copyPrompt = async () => {
        if (!finalPrompt) return;
        try {
            await navigator.clipboard.writeText(finalPrompt);
        } catch {
            // ignore clipboard errors
        }
    };

    const closePreview = () => setPreviewImageUrl(null);

    const onChangeCustomTagInput = (groupKey: string, value: string) => {
        setCustomTagInputs((prev) => ({ ...prev, [groupKey]: value }));
    };

    const handleAddCustomTag = async (groupKey: string) => {
        if (!isAuthenticated) {
            onRequireLogin();
            return;
        }
        if (!PROMPT_LIBRARY_GROUP_KEY_SET.has(groupKey)) return;

        const raw = (customTagInputs[groupKey] || '').trim();
        const label = raw.replace(/\s+/g, ' ');
        if (!label) return;
        if (label.length > 30) {
            setCustomTagError('自定义标签长度不能超过 30 个字符。');
            return;
        }
        const defaultGroup = PROMPT_LIBRARY_GROUPS.find((group) => group.key === groupKey);
        if (defaultGroup?.tags.includes(label)) {
            setCustomTagError('该标签已在默认词库中，无需重复新增。');
            return;
        }

        const userTagCount = Object.values(customTagsByGroup).reduce((count, list) => count + list.length, 0);
        if (userTagCount >= TAG_LIMIT) {
            setCustomTagError(`自定义标签最多 ${TAG_LIMIT} 个。`);
            return;
        }

        setCustomTagError(null);
        setIsSavingTagGroup(groupKey);
        try {
            const response = await api.createImagePromptTag({ groupKey, label });
            const created = response.data;
            setCustomTagsByGroup((prev) => ({
                ...prev,
                [groupKey]: [created, ...(prev[groupKey] || [])],
            }));
            setCustomTagInputs((prev) => ({ ...prev, [groupKey]: '' }));
            setState((prev) => {
                const parameterField = GROUP_KEY_TO_PARAMETER_FIELD[groupKey];
                if (parameterField && parameterField !== 'aspectRatio') {
                    return applyParameterFieldTag(prev, parameterField, created.label);
                }
                return {
                    ...prev,
                    manualPrompt: appendPromptTag(prev.manualPrompt, created.label),
                    selectedTags: withAspectRatioTag(uniqueTags([...prev.selectedTags, created.label]), prev.aspectRatio),
                };
            });
        } catch (err) {
            setCustomTagError(err instanceof Error ? err.message : '新增自定义标签失败');
        } finally {
            setIsSavingTagGroup(null);
        }
    };

    const handleDeleteCustomTag = async (tag: ImagePromptTagItem) => {
        if (!isAuthenticated) {
            onRequireLogin();
            return;
        }

        setIsDeletingTagId(tag.id);
        setCustomTagError(null);
        try {
            await api.deleteImagePromptTag(tag.id);
            setCustomTagsByGroup((prev) => ({
                ...prev,
                [tag.groupKey]: (prev[tag.groupKey] || []).filter((item) => item.id !== tag.id),
            }));
            setState((prev) => {
                const parameterField = GROUP_KEY_TO_PARAMETER_FIELD[tag.groupKey];
                if (parameterField && parameterField !== 'aspectRatio' && prev[parameterField] === tag.label) {
                    return {
                        ...prev,
                        [parameterField]: '',
                        manualPrompt: removePromptTag(prev.manualPrompt, tag.label),
                        selectedTags: withAspectRatioTag(prev.selectedTags.filter((item) => item !== tag.label), prev.aspectRatio),
                    };
                }
                return {
                    ...prev,
                    manualPrompt: removePromptTag(prev.manualPrompt, tag.label),
                    selectedTags: withAspectRatioTag(prev.selectedTags.filter((item) => item !== tag.label), prev.aspectRatio),
                };
            });
        } catch (err) {
            setCustomTagError(err instanceof Error ? err.message : '删除自定义标签失败');
        } finally {
            setIsDeletingTagId(null);
        }
    };

    return (
        <section className={styles.studioSection}>
            <div className={styles.hero}>
                <p className={styles.heroBadge}>2K 电商绘图机器人</p>
                <h2 className={styles.heroTitle}>电商图片生成工具</h2>
                <p className={styles.heroSub}>
                    上传参考图并配置参数，生成 2K 商品图。支持历史记录、复用提示词、快速二次生成。
                </p>
            </div>

            <div className={styles.panel}>
                <div className={styles.block}>
                    <div className={styles.blockTitleRow}>
                        <h3 className={styles.blockTitle}>主提示词（可自由编辑）</h3>
                        <button className={styles.linkBtn} onClick={copyPrompt}>复制提示词</button>
                    </div>
                    <p className={styles.promptHint}>提示：点击下方标签后会直接补充到提示词框里，你也可以继续自由编辑。</p>
                    <textarea
                        className={styles.textarea}
                        rows={8}
                        value={state.manualPrompt}
                        onChange={(e) => setState((prev) => ({
                            ...prev,
                            manualPrompt: e.target.value,
                        }))}
                        placeholder="请输入你想强调的主体、卖点、镜头和风格，也可以点击下方标签补充后再修改"
                    />
                    <textarea
                        className={styles.textarea}
                        rows={2}
                        value={state.negativePrompt}
                        onChange={(e) => setState((prev) => ({ ...prev, negativePrompt: e.target.value }))}
                        placeholder="负面词（可选）：例如 模糊、杂乱背景、多余文字、畸形手部..."
                    />
                </div>

                <div className={styles.block}>
                    <div className={styles.blockTitleRow}>
                        <h3 className={styles.blockTitle}>提示词词库</h3>
                        <button className={styles.secondaryBtn} onClick={clearSelectedTags} disabled={state.selectedTags.length === 0}>
                            清空已选
                        </button>
                    </div>

                    <div className={styles.selectedWrap}>
                        <span className={styles.selectedLabel}>已选标签：</span>
                        <div className={styles.selectedTags}>
                            {state.selectedTags.length === 0 ? (
                                <span className={styles.selectedEmpty}>未选择</span>
                            ) : state.selectedTags.map((tag) => (
                                <button key={tag} type="button" className={styles.selectedTagChip} onClick={() => onToggleTag(tag)}>
                                    {tag}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className={styles.library}>
                        {PARAMETER_TAG_GROUPS.map((group) => (
                            <div key={group.key} className={styles.libraryGroup}>
                                <div className={styles.groupTitleRow}>
                                    <p className={styles.groupTitle}>{group.title}</p>
                                    <span className={styles.groupMeta}>单选</span>
                                </div>
                                <div className={styles.tags}>
                                    {group.options.map((option) => {
                                        const active = group.key === 'aspectRatio' && state.aspectRatio === option;
                                        return (
                                            <button
                                                key={option}
                                                type="button"
                                                className={`${styles.tagBtn} ${active ? styles.tagBtnActive : ''}`}
                                                onClick={() => onToggleTag(option, group.key)}
                                            >
                                                {option}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}

                        {PROMPT_LIBRARY_GROUPS.map((group) => {
                            const customTags = customTagsByGroup[group.key] || [];
                            const defaultTagSet = new Set(group.tags);
                            const mergedCustomTags = customTags.filter((item) => !defaultTagSet.has(item.label));

                            return (
                                <div key={group.key} className={styles.libraryGroup}>
                                    <div className={styles.groupTitleRow}>
                                        <p className={styles.groupTitle}>{group.title}</p>
                                        <span className={styles.groupMeta}>
                                            默认 {group.tags.length} · 自定义 {customTags.length}
                                        </span>
                                    </div>

                                    <div className={styles.tags}>
                                        {group.tags.map((tag) => (
                                            <button
                                                key={tag}
                                                type="button"
                                                className={`${styles.tagBtn} ${selectedTagSet.has(tag) ? styles.tagBtnActive : ''}`}
                                                onClick={() => onToggleTag(tag, group.key)}
                                            >
                                                {tag}
                                            </button>
                                        ))}
                                        {mergedCustomTags.map((tag) => (
                                            <div key={tag.id} className={styles.customTagWrap}>
                                                <button
                                                    type="button"
                                                    className={`${styles.tagBtn} ${styles.customTagBtn} ${selectedTagSet.has(tag.label) ? styles.tagBtnActive : ''}`}
                                                    onClick={() => onToggleTag(tag.label, group.key)}
                                                >
                                                    {tag.label}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.customDeleteBtn}
                                                    onClick={() => handleDeleteCustomTag(tag)}
                                                    disabled={isDeletingTagId === tag.id}
                                                    title="删除自定义标签"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    <div className={styles.customTagRow}>
                                        <input
                                            type="text"
                                            className={styles.customTagInput}
                                            placeholder={`在“${group.title}”新增自定义标签`}
                                            value={customTagInputs[group.key] || ''}
                                            maxLength={30}
                                            onChange={(e) => onChangeCustomTagInput(group.key, e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleAddCustomTag(group.key);
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className={styles.addTagBtn}
                                            onClick={() => handleAddCustomTag(group.key)}
                                            disabled={isSavingTagGroup === group.key}
                                        >
                                            {isSavingTagGroup === group.key ? '添加中...' : '添加'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className={styles.block}>
                    <h3 className={styles.blockTitle}>参考图（可选）</h3>
                    <div className={styles.referenceRow}>
                        <label className={styles.uploadBtn}>
                            上传图片
                            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPickReference} />
                        </label>
                        {referenceFile && (
                            <button className={styles.secondaryBtn} onClick={removeReference}>移除</button>
                        )}
                    </div>
                    {referencePreview && (
                        <img src={referencePreview} alt="参考图预览" className={styles.referencePreview} />
                    )}
                </div>

                <div className={styles.actions}>
                    <button className={styles.primaryBtn} disabled={!canGenerate} onClick={handleGenerate}>
                        {isGenerating ? '生成中...' : '生成 2K 图片'}
                    </button>
                    <button
                        className={styles.secondaryBtn}
                        onClick={() => {
                            persistDraft();
                            router.push('/history/images');
                        }}
                    >
                        查看完整历史
                    </button>
                </div>

                {!isAuthenticated && (
                    <p className={styles.notice}>需登录后才可生成并保存历史记录。</p>
                )}
                {customTagError && <p className={styles.error}>{customTagError}</p>}
                {error && <p className={styles.error}>{error}</p>}
            </div>

            <div className={styles.resultsWrap}>
                <div className={styles.resultsHead}>
                    <h3>本次生成结果</h3>
                    {isGenerating ? (
                        <span className={styles.status}>生成中...</span>
                    ) : latestResult ? (
                        <span className={styles.status}>{statusText(latestResult.status)}</span>
                    ) : null}
                </div>
                {isGenerating && (
                    <div className={styles.loadingResult} aria-live="polite" aria-busy="true">
                        <div className={styles.skeletonCard} />
                        <p className={styles.loadingHint}>正在生成图片，完成后会在这里显示结果。</p>
                    </div>
                )}
                {!isGenerating && latestResult?.resultImagePaths?.length ? (
                    <div className={styles.imageGrid}>
                        {latestResult.resultImagePaths.map((url) => {
                            const resolvedUrl = resolveImageAssetUrl(url);
                            return (
                                <div key={url} className={styles.imageCard}>
                                    <button
                                        type="button"
                                        className={styles.imagePreviewBtn}
                                        onClick={() => setPreviewImageUrl(resolvedUrl)}
                                        aria-label="放大预览生成图片"
                                    >
                                        <img src={resolvedUrl} alt="生成结果图" loading="lazy" />
                                        <span className={styles.imagePreviewHint}>点击放大预览</span>
                                    </button>
                                    <div className={styles.imageActions}>
                                        <button className={styles.linkBtn} onClick={() => setPreviewImageUrl(resolvedUrl)}>预览</button>
                                        <a className={styles.linkBtn} href={resolvedUrl} download target="_blank" rel="noreferrer">下载</a>
                                        <button className={styles.linkBtn} onClick={copyPrompt}>复制提示词</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : !isGenerating ? (
                    <p className={styles.empty}>还没有生成结果。</p>
                ) : null}
            </div>

            <div className={styles.recentWrap}>
                <div className={styles.resultsHead}>
                    <h3>最近生成</h3>
                    <button className={styles.linkBtn} onClick={() => router.push('/history/images')}>查看全部</button>
                </div>
                {isLoadingRecent ? (
                    <p className={styles.empty}>加载中...</p>
                ) : recentItems.length === 0 ? (
                    <p className={styles.empty}>暂无历史记录。</p>
                ) : (
                    <div className={styles.recentList}>
                        {recentItems.map((item) => (
                            <article key={item.id} className={styles.recentItem}>
                                <div className={styles.recentThumb}>
                                    {item.resultImagePaths[0] ? (
                                        <img src={resolveImageAssetUrl(item.resultImagePaths[0])} alt="历史缩略图" loading="lazy" />
                                    ) : (
                                        <span className={styles.thumbPlaceholder}>无图片</span>
                                    )}
                                </div>
                                <div className={styles.recentInfo}>
                                    <p className={styles.recentPrompt}>{summarizeRecentPrompt(item.prompt)}</p>
                                    <p className={styles.recentMeta}>
                                        {formatTime(item.createdAt)} · {item.aspectRatio} · {statusText(item.status)}
                                    </p>
                                </div>
                                <div className={styles.recentActions}>
                                    <button
                                        className={styles.linkBtn}
                                        onClick={() => {
                                            const inferredTags = uniqueTags(
                                                allKnownTags.filter((tag) => item.prompt.includes(tag))
                                            );
                                            const inferredAutoTokens = uniqueTags([
                                                ...inferredTags,
                                                item.aspectRatio || '',
                                                item.stylePreset || '',
                                                item.background || '',
                                                item.lighting || '',
                                            ]);
                                            const inferredAutoClause = inferredAutoTokens.join('，');
                                            setState((prev) => ({
                                                ...(() => {
                                                    const nextAspect = item.aspectRatio || prev.aspectRatio;
                                                    const nextStyle = item.stylePreset || '';
                                                    const nextBackground = item.background || '';
                                                    const nextLighting = item.lighting || '';
                                                    const nextTags = uniqueTags([
                                                        ...inferredTags,
                                                        ...(nextStyle ? [nextStyle] : []),
                                                        ...(nextBackground ? [nextBackground] : []),
                                                        ...(nextLighting ? [nextLighting] : []),
                                                    ]);
                                                    return {
                                                        ...prev,
                                                        manualPrompt: item.prompt || inferredAutoClause,
                                                        selectedTags: withAspectRatioTag(nextTags, nextAspect),
                                                        negativePrompt: item.negativePrompt || '',
                                                        aspectRatio: nextAspect,
                                                        stylePreset: nextStyle,
                                                        background: nextBackground,
                                                        lighting: nextLighting,
                                                        referenceStrength: item.referenceStrength || prev.referenceStrength,
                                                        count: item.count || prev.count,
                                                    };
                                                })(),
                                            }));
                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                        }}
                                    >
                                        复用
                                    </button>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </div>

            {previewImageUrl && (
                <div className={styles.lightbox} onClick={closePreview}>
                    <div
                        className={styles.lightboxPanel}
                        role="dialog"
                        aria-modal="true"
                        aria-label="图片预览"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.lightboxHeader}>
                            <p className={styles.lightboxTitle}>图片预览</p>
                            <button type="button" className={styles.lightboxClose} onClick={closePreview} aria-label="关闭预览">
                                关闭
                            </button>
                        </div>
                        <div className={styles.lightboxBody}>
                            <img src={previewImageUrl} alt="放大预览图" className={styles.lightboxImage} />
                        </div>
                        <div className={styles.lightboxFooter}>
                            <span className={styles.lightboxTip}>点击遮罩或按 Esc 可关闭</span>
                            <a className={styles.secondaryBtn} href={previewImageUrl} download target="_blank" rel="noreferrer">
                                下载原图
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
