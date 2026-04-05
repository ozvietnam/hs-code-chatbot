import Head from 'next/head';
import { useState, useEffect } from 'react';
import ChatUI from '../components/ChatUI';
import Dashboard from '../components/Dashboard';

export default function Home() {
  const [debugData, setDebugData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [messageCount, setMessageCount] = useState(0);
  const [showDash, setShowDash] = useState(false); // default OFF, especially for mobile
  const [sessionId, setSessionId] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setSessionId(sessionStorage.getItem('chatSessionId'));
    // Show dashboard by default on desktop only
    const mq = window.matchMedia('(max-width: 900px)');
    setIsMobile(mq.matches);
    setShowDash(!mq.matches);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  function handleDebugUpdate(debug) {
    setDebugData(debug);
    setMessageCount(prev => prev + 1);
    setSessionId(sessionStorage.getItem('chatSessionId'));
  }

  function handleNewChat() {
    setDebugData(null);
    setStatus('idle');
    setMessageCount(0);
    setSessionId(sessionStorage.getItem('chatSessionId'));
  }

  return (
    <>
      <Head>
        <title>HS Code VN Chatbot</title>
        <meta name="description" content="Tra c\u1EE9u m\u00E3 HS Code Vi\u1EC7t Nam - Thu\u1EBF su\u1EA5t, TB-TCHQ, m\u00F4 t\u1EA3 ECUS" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>

      <div className="app-layout">
        <div className="app-chat">
          <ChatUI onDebugUpdate={handleDebugUpdate} onStatusChange={setStatus} onNewChat={handleNewChat} />
        </div>

        {/* Backdrop for mobile dashboard overlay */}
        {isMobile && showDash && (
          <div
            className="dash-backdrop"
            onClick={() => setShowDash(false)}
          />
        )}

        <div className={`app-dashboard ${showDash ? '' : 'app-dashboard-hidden'}`}>
          <Dashboard
            debugData={debugData}
            status={status}
            sessionId={sessionId}
            messageCount={messageCount}
          />
        </div>

        <button
          className="dash-toggle-btn"
          onClick={() => setShowDash(prev => !prev)}
          title={showDash ? '\u1EA8n Dashboard' : 'Hi\u1EC7n Dashboard'}
        >
          {showDash ? '\uD83D\uDCCA \u2715' : '\uD83D\uDCCA'}
        </button>
      </div>
    </>
  );
}
