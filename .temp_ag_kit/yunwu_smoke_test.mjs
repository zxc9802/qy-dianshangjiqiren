import fs from 'node:fs';

const key = process.env.YUNWU_KEY;

if (!key) {
  throw new Error('YUNWU_KEY is required');
}

const headersJson = {
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const IMG_URL = 'https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_5_imageToimage.png';
const IMG_URL_2 = 'https://filesystem.site/cdn/20250612/VfgB5ubjInVt8sG6rzMppxnu7gEfde.png';
const IMG_URL_3 = 'https://filesystem.site/cdn/20250612/998IGmUiM2koBGZM3UnZeImbPBNIUL.png';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(name, url, options = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`timeout:${name}`), 35000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return {
      name,
      ok: response.ok,
      status: response.status,
      url,
      ms: Date.now() - started,
      data,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      url,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function pickTaskId(data) {
  if (!data || typeof data !== 'object') return null;
  const candidate = data;
  return candidate.id
    || candidate.task_id
    || candidate.taskId
    || candidate.data?.id
    || candidate.data?.task_id
    || candidate.output?.task_id
    || null;
}

async function downloadBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download fixture: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

const authHeaders = () => ({
  Authorization: `Bearer ${key}`,
  Accept: 'application/json',
});

async function buildTests() {
  const imageBuffer = await downloadBuffer(IMG_URL);

  return [
    {
      name: 'unified-veo3.1-fast',
      create: () => request('unified-veo3.1-fast', 'https://yunwu.ai/v1/video/create', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model: 'veo3.1-fast',
          prompt: 'A clean product bottle slowly rotates on a white table.',
          aspect_ratio: '16:9',
          enhance_prompt: true,
          enable_upsample: false,
        }),
      }),
      query: (taskId) => request(
        'unified-veo3.1-fast-query',
        `https://yunwu.ai/v1/video/query?id=${encodeURIComponent(taskId)}`,
        { headers: authHeaders() },
      ),
    },
    {
      name: 'unified-grok-video-3-10s',
      create: () => request('unified-grok-video-3-10s', 'https://yunwu.ai/v1/video/create', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model: 'grok-video-3-10s',
          prompt: 'A small orange cat waves at the camera. --mode=custom',
          aspect_ratio: '16:9',
          size: '720P',
          images: [IMG_URL],
        }),
      }),
      query: (taskId) => request(
        'unified-grok-video-3-10s-query',
        `https://yunwu.ai/v1/video/query?id=${encodeURIComponent(taskId)}`,
        { headers: authHeaders() },
      ),
    },
    {
      name: 'openai-sora-2',
      create: async () => {
        const form = new FormData();
        form.set('model', 'sora-2');
        form.set('prompt', 'A happy toy robot dancing in a bright studio.');
        form.set('seconds', '5');
        form.set('size', '16x9');
        form.set('watermark', 'false');
        form.set('input_reference', new Blob([imageBuffer], { type: 'image/png' }), 'reference.png');

        return request('openai-sora-2', 'https://yunwu.ai/v1/videos', {
          method: 'POST',
          headers: authHeaders(),
          body: form,
        });
      },
      query: (taskId) => request(
        'openai-sora-2-query',
        `https://yunwu.ai/v1/videos/${encodeURIComponent(taskId)}`,
        { headers: authHeaders() },
      ),
    },
    {
      name: 'hailuo-02',
      create: () => request('hailuo-02', 'https://yunwu.ai/minimax/v1/video_generation', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model: 'MiniMax-Hailuo-02',
          prompt: 'A toy car drives across a desk.',
          duration: 6,
        }),
      }),
      query: (taskId) => request(
        'hailuo-02-query',
        `https://yunwu.ai/minimax/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${key}` } },
      ),
    },
    {
      name: 'runway-gen4-turbo',
      create: () => request('runway-gen4-turbo', 'https://yunwu.ai/runwayml/v1/image_to_video', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          promptImage: IMG_URL,
          model: 'gen4_turbo',
          promptText: 'Camera slowly pushes in.',
          watermark: false,
          duration: 5,
          ratio: '1280:768',
        }),
      }),
      query: (taskId) => request(
        'runway-gen4-turbo-query',
        `https://yunwu.ai/runwayml/v1/tasks/${encodeURIComponent(taskId)}`,
        { headers: authHeaders() },
      ),
    },
    {
      name: 'kling-text2video',
      create: () => request('kling-text2video', 'https://yunwu.ai/kling/v1/videos/text2video', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model_name: 'kling-v1',
          prompt: 'A dancer performs on the beach at sunset.',
          negative_prompt: '',
          cfg_scale: 0.5,
          mode: 'std',
          sound: 'off',
          aspect_ratio: '16:9',
          duration: '5',
        }),
      }),
      query: (taskId) => request(
        'kling-text2video-query',
        `https://yunwu.ai/kling/v1/videos/text2video/${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } },
      ),
    },
    {
      name: 'kling-image2video',
      create: () => request('kling-image2video', 'https://yunwu.ai/kling/v1/videos/image2video', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model_name: 'kling-v1',
          image: IMG_URL,
          image_tail: '',
          prompt: 'Camera slowly pans right.',
          negative_prompt: '',
          cfg_scale: 0.5,
          mode: 'std',
          duration: '5',
        }),
      }),
      query: (taskId) => request(
        'kling-image2video-query',
        `https://yunwu.ai/kling/v1/videos/image2video/${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } },
      ),
    },
    {
      name: 'vidu-text2video',
      create: () => request('vidu-text2video', 'https://yunwu.ai/ent/v2/text2video', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model: 'viduq2',
          prompt: 'A cute cat runs in a sunny garden.',
        }),
      }),
      query: (taskId) => request(
        'vidu-text2video-query',
        `https://yunwu.ai/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`,
        { headers: { Authorization: `Bearer ${key}` } },
      ),
    },
    {
      name: 'vidu-img2video',
      create: () => request('vidu-img2video', 'https://yunwu.ai/ent/v2/img2video', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model: 'viduq2-turbo',
          images: [IMG_URL],
          prompt: 'Camera slowly zooms in.',
          duration: 2,
          resolution: '720p',
          aspect_ratio: '16:9',
          movement_amplitude: 'standard',
          bgm: false,
          audio: false,
          off_peak: false,
          watermark: false,
        }),
      }),
      query: (taskId) => request(
        'vidu-img2video-query',
        `https://yunwu.ai/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`,
        { headers: { Authorization: `Bearer ${key}` } },
      ),
    },
    {
      name: 'vidu-reference2video',
      create: () => request('vidu-reference2video', 'https://yunwu.ai/ent/v2/reference2video', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model: 'viduq2',
          subjects: [{ id: 'cat', images: [IMG_URL] }],
          prompt: 'A cute @cat runs across the grass.',
        }),
      }),
      query: (taskId) => request(
        'vidu-reference2video-query',
        `https://yunwu.ai/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`,
        { headers: { Authorization: `Bearer ${key}` } },
      ),
    },
    {
      name: 'vidu-start-end2video',
      create: () => request('vidu-start-end2video', 'https://yunwu.ai/ent/v2/start-end2video', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model: 'viduq2-turbo',
          prompt: 'The camera moves from start frame to end frame.',
          images: [IMG_URL_2, IMG_URL_3],
          duration: 5,
          resolution: '720p',
          movement_amplitude: 'auto',
        }),
      }),
      query: (taskId) => request(
        'vidu-start-end2video-query',
        `https://yunwu.ai/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`,
        { headers: { Authorization: `Bearer ${key}` } },
      ),
    },
    {
      name: 'wan2.6-i2v-flash',
      create: () => request('wan2.6-i2v-flash', 'https://yunwu.ai/alibailian/api/v1/services/aigc/video-generation/video-synthesis', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model: 'wan2.6-i2v-flash',
          input: {
            prompt: 'Change the lighting to warm sunset.',
            img_url: IMG_URL,
          },
          parameters: {
            resolution: '480P',
            prompt_extend: true,
            audio: false,
          },
        }),
      }),
      query: (taskId) => request(
        'wan2.6-i2v-flash-query',
        `https://yunwu.ai/alibailian/api/v1/tasks/${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${key}` } },
      ),
    },
    {
      name: 'tencent-aigc-kling',
      create: () => request('tencent-aigc-kling', 'https://yunwu.ai/tencent-vod/v1/aigc-video', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          model_name: 'Kling',
          model_version: '1.6',
          prompt: 'A car drives on a road in sunshine.',
          negative_prompt: 'blur, shake',
          enhance_prompt: 'Enabled',
          output_config: {
            storage_mode: 'Temporary',
            media_name: 'smoke-test',
            duration: 5,
            resolution: '720P',
            aspect_ratio: '16:9',
            audio_generation: 'Disabled',
            person_generation: 'AllowAdult',
            input_compliance_check: 'Enabled',
            output_compliance_check: 'Enabled',
            enhance_switch: 'Enabled',
          },
        }),
      }),
      query: (taskId) => request(
        'tencent-aigc-kling-query',
        `https://yunwu.ai/tencent-vod/v1/query/${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${key}` } },
      ),
    },
  ];
}

const tests = await buildTests();
const results = [];
const outputUrl = new URL('./yunwu_video_smoke_results.json', import.meta.url);

for (const test of tests) {
  const create = await test.create();
  const taskId = pickTaskId(create.data);
  let query = null;

  if (create.ok && taskId && test.query) {
    await wait(1200);
    query = await test.query(taskId);
  }

  results.push({
    test: test.name,
    create,
    taskId,
    query,
  });

  fs.writeFileSync(outputUrl, JSON.stringify(results, null, 2));
}

fs.writeFileSync(outputUrl, JSON.stringify(results, null, 2));

for (const item of results) {
  const summary = {
    test: item.test,
    createStatus: item.create.status,
    createOk: item.create.ok,
    taskId: item.taskId,
    createData: item.create.data,
    queryStatus: item.query?.status ?? null,
    queryOk: item.query?.ok ?? null,
    queryData: item.query?.data ?? null,
    error: item.create.error ?? item.query?.error ?? null,
  };
  console.log(JSON.stringify(summary));
}
