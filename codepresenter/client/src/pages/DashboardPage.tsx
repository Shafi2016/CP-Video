import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string;
  created_at: string;
}

interface BalanceInfo {
  total_credits: number;
  used_credits: number;
  remaining_credits: number;
  is_trial: boolean;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { getAuth } = await import('@/lib/firebase');
  const auth = await getAuth();
  if (!auth?.currentUser) return {};
  const token = await auth.currentUser.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

export default function DashboardPage() {
  const { currentUser, loading, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!currentUser) {
      setLocation('/login');
      return;
    }

    (async () => {
      try {
        const headers = await getAuthHeaders();
        const [balRes, txRes] = await Promise.all([
          fetch('/api/credits/balance', { headers }),
          fetch('/api/credits/transactions', { headers }),
        ]);

        if (balRes.ok) setBalance(await balRes.json());
        if (txRes.ok) {
          const data = await txRes.json();
          setTransactions(data.transactions || []);
        }
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
      } finally {
        setLoadingData(false);
      }
    })();
  }, [currentUser, loading, setLocation]);

  // Check for payment success from URL params
  const params = new URLSearchParams(window.location.search);
  const paymentSuccess = params.get('payment') === 'success';

  if (loading || loadingData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-900 to-emerald-950 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

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
            <Button
              className="bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
              onClick={() => setLocation('/code')}
            >
              Create Notebook
            </Button>
            <Button
              className="bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
              onClick={async () => {
                await logout();
                setLocation('/login');
              }}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-12">
        {/* Payment success banner */}
        {paymentSuccess && (
          <div className="mb-8 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-center">
            Payment successful! Your credits have been added.
          </div>
        )}

        {/* User info */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-1">Dashboard</h2>
          <p className="text-slate-400">{currentUser?.email}</p>
        </div>

        {/* Credit balance card */}
        {balance && (
          <div className="p-8 rounded-2xl bg-white/5 border border-white/10 mb-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-sm text-slate-400 mb-1">Available Credits</p>
                <p className="text-5xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  {balance.remaining_credits}
                </p>
              </div>
              <Button
                className="bg-emerald-600 hover:bg-emerald-500 font-medium"
                onClick={() => setLocation('/pricing')}
              >
                Buy More Credits
              </Button>
            </div>

            <div className="flex gap-8 text-sm">
              <div>
                <span className="text-slate-400">Total purchased: </span>
                <span className="font-medium">{balance.total_credits}</span>
              </div>
              <div>
                <span className="text-slate-400">Used: </span>
                <span className="font-medium">{balance.used_credits}</span>
              </div>
              {balance.is_trial && (
                <div className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-xs font-medium">
                  Trial Account
                </div>
              )}
            </div>
          </div>
        )}

        {/* Transaction history */}
        <div>
          <h3 className="text-lg font-semibold mb-4">Transaction History</h3>
          {transactions.length === 0 ? (
            <div className="p-6 rounded-xl bg-white/5 border border-white/10 text-center text-slate-400">
              No transactions yet.
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10"
                >
                  <div>
                    <p className="text-sm font-medium">{tx.description}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(tx.created_at).toLocaleDateString()} &middot;{' '}
                      {tx.type === 'purchase'
                        ? 'Purchase'
                        : tx.type === 'usage'
                        ? 'Video Export'
                        : tx.type === 'trial_grant'
                        ? 'Trial Grant'
                        : tx.type === 'refund'
                        ? 'Refund'
                        : tx.type}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-mono font-semibold ${
                      tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {tx.amount > 0 ? '+' : ''}
                    {tx.amount}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
