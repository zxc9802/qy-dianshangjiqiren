import VideoWorkbenchClient from '../video-workbench/VideoWorkbenchClient';

export const dynamic = 'force-dynamic';

export default function LegacyVideoWorkbenchSeedancePage() {
    return <VideoWorkbenchClient site="seedance" />;
}
