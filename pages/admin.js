import Head from 'next/head';
import ControlPanel from '../components/ControlPanel';

export default function AdminPage() {
  return (
    <>
      <Head>
        <title>Control Panel — HS Code VN</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <ControlPanel />
    </>
  );
}
