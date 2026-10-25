import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { LandingPage } from '@/components/LandingPage';
import { AuthPage } from '@/components/AuthPage';
import { ChatApp } from '@/components/ChatApp';

type Route = 'landing' | 'auth';

export default function App() {
  const { user, loading, signIn, signUp, signOut } = useAuth();
  const [route, setRoute] = useState<Route>('landing');

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-neutral-500" />
      </div>
    );
  }

  if (user) {
    return <ChatApp user={user} onSignOut={signOut} />;
  }

  if (route === 'auth') {
    return (
      <AuthPage
        onSignIn={signIn}
        onSignUp={signUp}
        onBack={() => setRoute('landing')}
      />
    );
  }

  return <LandingPage onGetStarted={() => setRoute('auth')} />;
}
