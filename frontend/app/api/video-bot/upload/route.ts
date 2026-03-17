import { errorResponse, getAuthUser } from '@/app/lib/auth';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

function toPublicUrl(req: NextRequest, fileName: string): string {
    const host = req.headers.get('host') || 'localhost:3000';
    const forwardedProto = req.headers.get('x-forwarded-proto');
    const protocol = forwardedProto || (host.includes('localhost') ? 'http' : 'https');
    return `${protocol}://${host}/video-bot-uploads/${fileName}`;
}

export async function POST(req: NextRequest) {
    try {
        await getAuthUser(req);
        const body = await req.json();
        const data = typeof body?.image === 'string'
            ? body.image
            : typeof body?.video === 'string'
                ? body.video
                : '';

        if (!data) {
            return Response.json({ error: '没有可上传的文件数据。' }, { status: 400 });
        }

        if (!data.startsWith('data:')) {
            return Response.json({ url: data });
        }

        const match = data.match(/^data:(\w+)\/([\w.+-]+);base64,(.+)$/);
        if (!match) {
            return Response.json({ error: '文件格式无效。' }, { status: 400 });
        }

        const mediaType = match[1];
        const subType = match[2];
        const ext = subType === 'jpeg' ? 'jpg' : subType.replace(/\+.*/, '');
        const buffer = Buffer.from(match[3], 'base64');

        try {
            const formData = new FormData();
            const blob = new Blob([buffer], { type: `${mediaType}/${subType}` });
            formData.append('file', blob, `upload.${ext}`);

            const uploadResponse = await fetch('https://tmpfiles.org/api/v1/upload', {
                method: 'POST',
                body: formData,
            });

            if (uploadResponse.ok) {
                const uploadData = await uploadResponse.json() as { data?: { url?: string } };
                if (uploadData.data?.url) {
                    const directUrl = uploadData.data.url
                        .replace(/^http:\/\//, 'https://')
                        .replace('tmpfiles.org/', 'tmpfiles.org/dl/');
                    return Response.json({ url: directUrl });
                }
            }
        } catch {
            // Fall through to local persistence so the UI remains usable.
        }

        const uploadsDir = path.join(process.cwd(), 'public', 'video-bot-uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const fileName = `${crypto.randomUUID()}.${ext}`;
        fs.writeFileSync(path.join(uploadsDir, fileName), buffer);

        return Response.json({
            url: toPublicUrl(req, fileName),
            warning: '已改为本地保存。如果当前站点未暴露公网地址，云端视频接口可能无法访问该文件。',
        });
    } catch (error) {
        return errorResponse(error);
    }
}
