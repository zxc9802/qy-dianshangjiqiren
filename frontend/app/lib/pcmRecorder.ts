export interface Pcm16Recorder {
    stop: () => Promise<Blob>;
}

export async function startPcm16kMonoRecorder(): Promise<Pcm16Recorder> {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        },
    });

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    const chunks: Float32Array[] = [];

    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);

    processor.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(channelData));
    };

    return {
        stop: async () => {
            processor.disconnect();
            source.disconnect();
            silentGain.disconnect();
            stream.getTracks().forEach(track => track.stop());
            await audioContext.close();

            const merged = mergeFloat32Arrays(chunks);
            const targetSampleRate = 16000;
            const downsampled = downsampleFloat32Array(merged, audioContext.sampleRate, targetSampleRate);
            const wav = encodeWavFromFloat32(downsampled, targetSampleRate);

            return new Blob([wav], { type: 'audio/wav' });
        },
    };
}

function mergeFloat32Arrays(chunks: Float32Array[]): Float32Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    return merged;
}

function downsampleFloat32Array(
    input: Float32Array,
    inputSampleRate: number,
    outputSampleRate: number,
): Float32Array {
    if (outputSampleRate >= inputSampleRate) {
        return input;
    }

    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.round(input.length / ratio);
    const output = new Float32Array(outputLength);

    let outputIndex = 0;
    let inputIndex = 0;

    while (outputIndex < outputLength) {
        const nextInputIndex = Math.round((outputIndex + 1) * ratio);
        let accumulator = 0;
        let count = 0;

        for (let i = inputIndex; i < nextInputIndex && i < input.length; i++) {
            accumulator += input[i];
            count++;
        }

        output[outputIndex] = count > 0 ? accumulator / count : 0;
        outputIndex++;
        inputIndex = nextInputIndex;
    }

    return output;
}

function encodeWavFromFloat32(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const bytesPerSample = 2;
    const numChannels = 1;
    const dataLength = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    float32ToInt16Pcm(view, 44, samples);
    return buffer;
}

function float32ToInt16Pcm(view: DataView, offset: number, input: Float32Array) {
    for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        const value = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(offset, value, true);
    }
}

function writeAscii(view: DataView, offset: number, text: string) {
    for (let i = 0; i < text.length; i++) {
        view.setUint8(offset + i, text.charCodeAt(i));
    }
}
