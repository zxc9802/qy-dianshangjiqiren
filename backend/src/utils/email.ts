import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export function generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendVerificationEmail(email: string, code: string): Promise<void> {
    await resend.emails.send({
        from: 'AI电商平台 <onboarding@resend.dev>',
        to: email,
        subject: '您的验证码',
        html: `
            <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 32px;">
                <h2 style="color: #1a1a2e; margin-bottom: 8px;">邮箱验证码</h2>
                <p style="color: #666; margin-bottom: 24px;">您正在注册电商AI智能平台，请使用以下验证码：</p>
                <div style="background: #f0f4ff; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #3b82f6;">${code}</span>
                </div>
                <p style="color: #999; font-size: 13px;">验证码 5 分钟内有效，请勿泄露给他人。</p>
            </div>
        `,
    });
}
