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
    assert.equal(config.size, '2048x2048');

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
        size: '2048x2048',
        n: 1,
    });
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
