'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { formatMessage } from '../../lib/formatMessage';
import { startPcm16kMonoRecorder, type Pcm16Recorder } from '../../lib/pcmRecorder';
import styles from './runner.module.css';

interface StepNode {
    id: string;
    type: string;
    label: string;
    botId: string;
    botName: string;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

interface StepData {
    nodeId: string;
    messages: ChatMessage[];
    savedOutput: string;
    completed: boolean;
}

interface StepRunnerProps {
    steps: StepNode[];
    onClose: () => void;
    onComplete: (results: StepData[]) => void;
}

const BOT_WELCOMES: Record<string, string> = {
    '1': '你好，你们团队现在是怎么做绩效考核的？',
    '2': '你好，你想梳理哪个环节的流程？',
    '3': '你好，你们今年最重要的目标是什么？',
    '4': '你好，聊聊你现在遇到的问题吧。',
    '5': '你好，最近在招什么岗位？',
    '6': '你好，说说你的需求。',
    '7': '你好，你的产品是什么？',
    '8': '你好，你想看哪个品类的趋势？',
    '9': '你好，你的产品是什么？',
    '10': '你好，你的产品是什么？目前主图点击率怎么样？',
    '11': '你好，你想复制哪个爆款的打法？',
    '12': '你好，你是什么品类的？',
    '13': '你好，你想分析哪个竞品？',
    '14': '你好，你目前客单价多少？卖什么品类的？',
    '15': '你好，把爆文封面发过来看看。',
    '16': '你好，你目前小红书粉丝量级多少？',
    '17': '你好，把想拆解的爆文发过来。',
    '18': '你好，你做什么方向的内容？',
    '19': '你好，你的账号定位和目标人群是什么？',
    '20': '你好，你的产品是什么？预算大概多少？',
    '21': '你好，把想拆解的爆文发过来。',
    '22': '你好，你是什么产品？想营造什么样的评论氛围？',
    '23': '你好，说说你现在面对的挑战。',
    '24': '你好，你的产品解决的是什么问题？',
    '25': '你好，你想分析什么问题？',
    '26': '你好，你的企业类型和年营收大概多少？',
    '27': '你好，你们目前几个合伙人？股权怎么分的？',
    '28': '你好，你在哪个平台经营？',
    '29': '你好，你们团队多少人？现在薪酬结构是怎样的？',
    '30': '你好，说说你担心的税务问题。',
    '31': '你好，你想用AI解决什么业务场景？',
    '32': '你好，你们是做什么业务的？',
    '33': '你好，把你的提示词发过来看看。',
    '34': '你好，说说你的业务流程。',
};

export default function StepRunner({ steps, onClose, onComplete }: StepRunnerProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [stepDataMap, setStepDataMap] = useState<Map<string, StepData>>(new Map());
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [isComplete, setIsComplete] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // File upload
    const [isUploading, setIsUploading] = useState(false);
    const [attachedFile, setAttachedFile] = useState<{
        name: string; content: string; previewUrl: string | null; isImage: boolean;
    } | null>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const isImage = imageExts.includes(ext);
        let previewUrl: string | null = null;
        if (isImage) previewUrl = URL.createObjectURL(file);
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.error) { alert(data.error); if (previewUrl) URL.revokeObjectURL(previewUrl); return; }
            setAttachedFile({ name: data.fileName, content: data.content, previewUrl, isImage });
        } catch { alert('鏂囦欢涓婁紶澶辫触'); if (previewUrl) URL.revokeObjectURL(previewUrl); }
        finally { setIsUploading(false); }
    };

    const removeAttachment = () => {
        if (attachedFile?.previewUrl) URL.revokeObjectURL(attachedFile.previewUrl);
        setAttachedFile(null);
    };

    // Voice input
    const [isRecording, setIsRecording] = useState(false);
    const pcmRecorderRef = useRef<Pcm16Recorder | null>(null);

    const toggleVoice = async () => {
        if (isRecording) {
            setIsRecording(false);
            const recorder = pcmRecorderRef.current;
            pcmRecorderRef.current = null;
            if (!recorder) return;
            try {
                const audioBlob = await recorder.stop();
                if (audioBlob.size < 1000) return;
                const fd = new FormData();
                fd.append('audio', audioBlob, 'recording.wav');
                const res = await fetch('/api/voice', { method: 'POST', body: fd });
                const data = await res.json();
                if (data.text) setInputText(prev => prev + data.text);
                else if (data.error) alert('语音识别失败: ' + data.error);
                else alert('语音未识别到文字。调试信息:\n' + (data.debug || []).join('\\n'));
            } catch {
                alert('语音识别请求失败');
            }
            return;
        }
        try {
            pcmRecorderRef.current = await startPcm16kMonoRecorder();
            setIsRecording(true);
        } catch {
            alert('无法访问麦克风，请检查浏览器权限');
        }
    };

    const currentNode = steps[currentStep];

    // Scroll to bottom on new messages
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingText]);

    // Load messages when step changes
    useEffect(() => {
        const existing = stepDataMap.get(currentNode?.id);
        if (existing && existing.messages.length > 0) {
            setMessages(existing.messages);
        } else if (currentNode) {
            const welcomeText = BOT_WELCOMES[currentNode.botId] || `你好，我是${currentNode.botName}，请告诉我你的需求。`;
            setMessages([{
                id: `welcome-${Date.now()}`,
                role: 'assistant',
                content: welcomeText,
            }]);
        }
        setInputText('');
        setStreamingText('');
        inputRef.current?.focus();
    }, [currentStep, currentNode]);

    // Build messages for the API call (same format as main chat page)
    const buildApiMessages = useCallback(() => {
        const allMessages: Array<{ role: string; content: string }> = [];

        // Inject previous step context as a single background user message
        const previousOutputs: string[] = [];
        for (let i = 0; i < currentStep; i++) {
            const prevData = stepDataMap.get(steps[i].id);
            if (prevData?.savedOutput) {
                previousOutputs.push(`[${steps[i].botName || steps[i].label}的分析]\n${prevData.savedOutput}`);
            }
        }
        if (previousOutputs.length > 0) {
            allMessages.push({
                role: 'user',
                content: `浠ヤ笅鏄伐浣滄祦涓墠闈㈢殑鍒嗘瀽缁撴灉锛岃鍙傝€冿細\n\n${previousOutputs.join('\n\n---\n\n')}`,
            });
            allMessages.push({
                role: 'assistant',
                content: '好的，我已经了解前面的分析结果，请继续提问。',
            });
        }

        // Add current conversation (skip welcome message)
        for (const msg of messages) {
            if (msg.id.startsWith('welcome-')) continue;
            allMessages.push({ role: msg.role, content: msg.content });
        }

        return allMessages;
    }, [currentStep, messages, stepDataMap, steps]);

    const sendMessage = async () => {
        const hasFile = !!attachedFile;
        if ((!inputText.trim() && !hasFile) || isStreaming) return;

        // Combine file content with user text
        let finalText = inputText.trim();
        if (attachedFile) {
            const filePrefix = `[鏂囦欢: ${attachedFile.name}]\n\n${attachedFile.content}`;
            finalText = finalText ? `${filePrefix}\n\n鐢ㄦ埛杩介棶: ${finalText}` : filePrefix;
            removeAttachment();
        }

        const userMsg: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: finalText,
        };

        const newMessages = [...messages, userMsg];
        setMessages(newMessages);
        setInputText('');
        setIsStreaming(true);
        setStreamingText('');

        try {
            const history = buildApiMessages();
            history.push({ role: 'user', content: userMsg.content });

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    botId: currentNode.botId,
                    messages: history,
                }),
            });

            if (!res.ok) throw new Error('API 璇锋眰澶辫触');

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                for (const line of chunk.split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        if (event.type === 'text' && event.content) {
                            fullText += event.content;
                            setStreamingText(fullText);
                        }
                    } catch { /* skip */ }
                }
            }

            if (fullText) {
                const assistantMsg: ChatMessage = {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: fullText,
                };
                setMessages(prev => [...prev, assistantMsg]);
            }
        } catch (err) {
            const errMsg: ChatMessage = {
                id: `err-${Date.now()}`,
                role: 'assistant',
                content: `鉂?${err instanceof Error ? err.message : '璇锋眰澶辫触'}`,
            };
            setMessages(prev => [...prev, errMsg]);
        } finally {
            setIsStreaming(false);
            setStreamingText('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const saveAndNext = () => {
        // Collect the last assistant message as saved output
        const assistantMessages = messages.filter(m => m.role === 'assistant');
        const lastOutput = assistantMessages[assistantMessages.length - 1]?.content || '';

        const newMap = new Map(stepDataMap);
        newMap.set(currentNode.id, {
            nodeId: currentNode.id,
            messages: [...messages],
            savedOutput: lastOutput,
            completed: true,
        });
        setStepDataMap(newMap);

        if (currentStep < steps.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            // All steps done
            setIsComplete(true);
            const results = steps.map(s => newMap.get(s.id)!).filter(Boolean);
            onComplete(results);
        }
    };

    const nextStepNode = currentStep < steps.length - 1 ? steps[currentStep + 1] : null;

    // Skip non-agent nodes (input/output)
    useEffect(() => {
        if (currentNode && (currentNode.type === 'input' || currentNode.type === 'output')) {
            // Auto-skip input/output nodes
            const newMap = new Map(stepDataMap);
            newMap.set(currentNode.id, {
                nodeId: currentNode.id,
                messages: [],
                savedOutput: currentNode.type === 'input' ? '鐢ㄦ埛鍚姩浜嗗伐浣滄祦' : '',
                completed: true,
            });
            setStepDataMap(newMap);
            if (currentStep < steps.length - 1) {
                setCurrentStep(currentStep + 1);
            } else {
                setIsComplete(true);
                const results = steps.map(s => newMap.get(s.id)!).filter(Boolean);
                onComplete(results);
            }
        }
    }, [currentStep]);

    if (!currentNode) return null;

    // Completion summary screen
    if (isComplete) {
        return (
            <div className={styles.overlay}>
                <div className={styles.container}>
                    <div className={styles.summaryHeader}>
                        <h2>Workflow Completed</h2>
                        <button className={styles.closeBtn} onClick={onClose}>Close</button>
                    </div>
                    <div className={styles.summaryBody}>
                        {steps.filter(s => s.type === 'ai_agent').map((step, i) => {
                            const data = stepDataMap.get(step.id);
                            return (
                                <div key={step.id} className={styles.summaryCard}>
                                    <h3>Step {i + 1}: {step.botName || step.label}</h3>
                                    <pre className={styles.summaryOutput}>
                                        {data?.savedOutput?.slice(0, 500) || '(empty)'}
                                    </pre>
                                </div>
                            );
                        })}
                    </div>
                    <button className={styles.doneBtn} onClick={onClose}>Done</button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.overlay}>
            <div className={styles.container}>
                {/* Progress bar */}
                <div className={styles.progressBar}>
                    {steps.filter(s => s.type === 'ai_agent').map((step, i) => {
                        const stepIndex = steps.indexOf(step);
                        const isDone = stepDataMap.get(step.id)?.completed;
                        const isCurrent = stepIndex === currentStep;
                        return (
                            <div
                                key={step.id}
                                className={`${styles.progressStep} ${isDone ? styles.progressDone : ''} ${isCurrent ? styles.progressActive : ''}`}
                            >
                                <div className={styles.progressDot}>
                                    {isDone ? 'Done' : (i + 1)}
                                </div>
                                <span className={styles.progressLabel}>{step.botName || step.label}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Chat header */}
                <div className={styles.chatHeader}>
                    <span className={styles.chatBotIcon}>AI</span>
                    <div>
                        <h3 className={styles.chatBotName}>{currentNode.botName || currentNode.label}</h3>
                        <span className={styles.chatStepHint}>
                            Step {steps.filter(s => s.type === 'ai_agent').indexOf(currentNode) + 1} / {steps.filter(s => s.type === 'ai_agent').length}
                        </span>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}>Close</button>
                </div>

                {/* Messages */}
                <div className={styles.chatMessages}>
                    {messages.map(msg => (
                        <div key={msg.id} className={`${styles.message} ${styles[msg.role]}`}>
                            <div className={styles.messageBubble} dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }} />
                        </div>
                    ))}
                    {streamingText && (
                        <div className={`${styles.message} ${styles.assistant}`}>
                            <div className={styles.messageBubble}>
                                <span dangerouslySetInnerHTML={{ __html: formatMessage(streamingText) }} />
                                <span className={styles.cursor}>...</span>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* Input area */}
                <div className={styles.chatInput}>
                    {attachedFile && (
                        <div className={styles.attachBar}>
                            {attachedFile.isImage && attachedFile.previewUrl ? (
                                <img src={attachedFile.previewUrl} alt={attachedFile.name} className={styles.attachThumb} />
                            ) : <span>[file]</span>}
                            <span className={styles.attachName}>{attachedFile.name}</span>
                            <button className={styles.attachRemove} onClick={removeAttachment}>X</button>
                        </div>
                    )}
                    {isUploading && (
                        <div className={styles.attachBar}>
                            <span>...</span>
                            <span className={styles.attachName}>Uploading...</span>
                        </div>
                    )}
                    <div className={styles.inputRow}>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.docx,.txt,.md,.csv,.pptx,.jpg,.jpeg,.png,.gif,.webp"
                            onChange={handleFileUpload}
                            style={{ display: 'none' }}
                        />
                        <button
                            className={styles.toolBtn}
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isStreaming || isUploading}
                            title="Upload file"
                        >
                            {isUploading ? '...' : 'Upload'}
                        </button>
                        <button
                            className={`${styles.toolBtn} ${isRecording ? styles.recording : ''}`}
                            onClick={toggleVoice}
                            disabled={isStreaming}
                            title={isRecording ? 'Stop recording' : 'Voice input'}
                        >
                            Voice
                        </button>
                        <textarea
                            ref={inputRef}
                            className={styles.textArea}
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={`Chat with ${currentNode.botName || 'AI'}...`}
                            rows={2}
                            disabled={isStreaming}
                        />
                        <button
                            className={styles.sendBtn}
                            onClick={sendMessage}
                            disabled={(!inputText.trim() && !attachedFile) || isStreaming}
                        >
                            {isStreaming ? 'Sending...' : 'Send'}
                        </button>
                    </div>
                </div>

                {/* Next step bar */}
                <div className={styles.nextBar}>
                    {messages.length >= 2 && !isStreaming && (
                        <button className={styles.nextBtn} onClick={saveAndNext}>
                            {nextStepNode
                                ? `Save and continue -> ${nextStepNode.botName || nextStepNode.label}`
                                : 'Save and finish workflow'}
                        </button>
                    )}
                    {messages.length < 2 && (
                        <span className={styles.nextHint}>Talk with AI first, then click Save and continue.</span>
                    )}
                </div>
            </div>
        </div>
    );
}
