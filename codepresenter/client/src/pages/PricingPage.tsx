import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

interface CreditPack {
  key: string;
  name: string;
  credits: number;
  price: number;
  pricePerCredit: number;
  popular?: boolean;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { getAuth } = await import('@/lib/firebase');
  const auth = await getAuth();
  if (!auth?.currentUser) return {};
  const token = await auth.currentUser.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

export default function PricingPage() {
  const { currentUser } = useAuth();
  const [, setLocation] = useLocation();
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/credits/packs')
      .then((r) => r.json())
      .then((data) => setPacks(data.packs || []))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/credits/balance', { headers });
        if (res.ok) {
          const data = await res.json();
          setBalance(data.remaining_credits);
        }
      } catch {}
    })();
  }, [currentUser]);

  const handlePurchase = async (packKey: string) => {
    if (!currentUser) {
      setLocation('/login');
      return;
    }

    setPurchasing(packKey);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders()),
      };

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers,
        body: JSON.stringify({ pack: packKey }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to start checkout');
      }
    } catch (error) {
      console.error('Purchase error:', error);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setPurchasing(null);
    }
  };

  // Check for payment result from URL params
  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get('payment');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-900 to-emerald-950 text-white">
      {/* Nav */}
      <nav className="border-b border-white/10 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1
            className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent cursor-pointer"
            onClick={() => setLocation('/')}
          >
            CodePresenter
          </h1>
          <div className="flex items-center gap-3">
            {balance !== null && (
              <span className="text-sm text-slate-400">
                {balance} credits remaining
              </span>
            )}
            <Button
              className="bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
              onClick={() => setLocation('/dashboard')}
            >
              Dashboard
            </Button>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        {/* Payment result banner */}
        {paymentStatus === 'cancelled' && (
          <div className="mb-8 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-center">
            Payment was cancelled. You can try again anytime.
          </div>
        )}

        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-4">Credit Packs</h2>
          <p className="text-lg text-slate-400 max-w-xl mx-auto">
            Each credit = one video export. Buy the pack that fits your needs.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {packs.map((pack) => (
            <div
              key={pack.key}
              className={`relative p-8 rounded-2xl border ${
                pack.popular
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-white/5 border-white/10'
              }`}
            >
              {pack.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-emerald-500 text-white text-xs font-semibold">
                  Most Popular
                </div>
              )}

              <h3 className="text-xl font-semibold mb-1">{pack.name}</h3>
              <div className="mb-4">
                <span className="text-4xl font-bold">${pack.price}</span>
              </div>
              <p className="text-slate-400 text-sm mb-6">
                {pack.credits} video exports
                <br />
                ${pack.pricePerCredit.toFixed(2)} per video
              </p>

              <Button
                className={`w-full py-5 font-medium ${
                  pack.popular
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-slate-700 hover:bg-slate-600'
                }`}
                onClick={() => handlePurchase(pack.key)}
                disabled={purchasing !== null}
              >
                {purchasing === pack.key ? 'Redirecting...' : `Buy ${pack.credits} Credits`}
              </Button>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="mt-16 max-w-2xl mx-auto space-y-6">
          <h3 className="text-2xl font-semibold text-center mb-8">FAQ</h3>
          <div className="p-5 rounded-xl bg-white/5 border border-white/10">
            <h4 className="font-medium mb-2">What is a credit?</h4>
            <p className="text-sm text-slate-400">
              1 credit = 1 notebook teaching video export.
            </p>
          </div>
          <div className="p-5 rounded-xl bg-white/5 border border-white/10">
            <h4 className="font-medium mb-2">Do credits expire?</h4>
            <p className="text-sm text-slate-400">
              No. Credits never expire. Use them whenever you need.
            </p>
          </div>
          <div className="p-5 rounded-xl bg-white/5 border border-white/10">
            <h4 className="font-medium mb-2">What if an export fails?</h4>
            <p className="text-sm text-slate-400">
              If a video export fails due to a server error, your credit is automatically refunded.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
