import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildImageProviderConfig,
    buildImageProviderRequest,
    extractGeneratedImageResult,
} from './image-generation-provider';

test('uses OpenAI-compatible image env when image model is configured', () => {
    const config = buildImageProviderConfig({
        YUNWU_IMAGE_API_KEY: 'test-key',
        YUNWU_IMAGE_BASE_URL: 'https://yunwu.ai/v1',
        YUNWU_IMAGE_MODEL: 'gpt-image-2',
    });

    assert.equal(config.kind, 'openai');
    if (config.kind !== 'openai') throw new Error('expected openai image provider');
    assert.equal(config.endpointUrl, 'https://yunwu.ai/v1/images/generations');
    assert.equal(config.model, 'gpt-image-2');
    assert.equal(config.size, '1024x1024');

    const request = buildImageProviderRequest(config, {
        prompt: 'Draw a clean product image.',
        aspectRatio: '1:1',
    });
    const body = JSON.parse(String(request.body));

    assert.equal(request.url, 'https://yunwu.ai/v1/images/generations');
    assert.equal(request.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(body, {
        model: 'gpt-image-2',
        prompt: 'Draw a clean product image.',
        size: '1024x1024',
        n: 1,
    });
});

test('uses 1K OpenAI-compatible image size from requested aspect ratio', () => {
    const config = buildImageProviderConfig({
        YUNWU_IMAGE_API_KEY: 'test-key',
        YUNWU_IMAGE_BASE_URL: 'https://yunwu.ai/v1',
        YUNWU_IMAGE_MODEL: 'gpt-image-2',
    });

    if (config.kind !== 'openai') throw new Error('expected openai image provider');

    const defaultRequest = buildImageProviderRequest(config, {
        prompt: '生成一张电商宣传图。',
        aspectRatio: '1:1',
    });
    assert.equal(JSON.parse(defaultRequest.body).size, '1024x1024');

    const widescreenRequest = buildImageProviderRequest(config, {
        prompt: '生成一张 16:9 横版电商宣传图。',
        aspectRatio: '1:1',
    });
    assert.equal(JSON.parse(widescreenRequest.body).size, '1024x576');
});

test('keeps legacy Gemini image URL env working', () => {
    const config = buildImageProviderConfig({
        YUNWU_IMAGE_API_KEY: 'test-key',
        YUNWU_IMAGE_API_URL: 'https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    });

    assert.equal(config.kind, 'gemini');
    if (config.kind !== 'gemini') throw new Error('expected gemini image provider');
    assert.equal(
        config.apiUrl,
        'https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=test-key',
    );
});

test('extracts generated image results from OpenAI-compatible responses', () => {
    assert.deepEqual(
        extractGeneratedImageResult({ data: [{ url: 'https://cdn.example.test/image.png' }] }),
        { kind: 'url', url: 'https://cdn.example.test/image.png' },
    );

    assert.deepEqual(
        extractGeneratedImageResult({ data: [{ b64_json: 'abc123' }] }),
        { kind: 'base64', mimeType: 'image/png', data: 'abc123' },
    );
});
