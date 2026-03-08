import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from 'next-themes';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: '电商聚合机器人',
  description: '企业内部使用的电商 AI 工具平台，支持智能体、工作流、图片生成和对话分析。',
  keywords: ['电商 AI', '智能体', '工作流', '图片生成', '企业工具'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange={false}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
