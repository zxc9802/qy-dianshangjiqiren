import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function LegacyVideoWorkbenchSeedancePage() {
    redirect('/bot/video-workbench');
}
