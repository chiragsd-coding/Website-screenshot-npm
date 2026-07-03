import { Router, Response, Request } from 'express';
import { getSubscriptionByApiKey } from '../../subscriptions/manager.js';
import { getUsage, getCurrentMonth } from '../../subscriptions/usage.js';
import { getPlanByTier, PLANS } from '../../subscriptions/plans.js';
import { logger } from '../../utils/logger.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const apiKey = (req.query.key as string) || (req.query.apiKey as string);

  if (!apiKey) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Customer Dashboard - PageSnap</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
      </head>
      <body class="bg-gray-50 flex items-center justify-center h-screen">
        <div class="bg-white p-8 rounded-xl shadow-lg max-w-md w-full">
          <div class="text-center mb-8">
            <i class="fas fa-camera-retro text-indigo-600 text-4xl mb-4"></i>
            <h1 class="text-2xl font-bold text-gray-800">PageSnap Dashboard</h1>
            <p class="text-gray-500">Enter your API key to view your account</p>
          </div>
          <form action="/dashboard" method="GET" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700">API Key</label>
              <input type="text" name="key" required class="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500" placeholder="ps_...">
            </div>
            <button type="submit" class="w-full bg-indigo-600 text-white py-2 rounded-md font-semibold hover:bg-indigo-700 transition">
              Access Dashboard
            </button>
          </form>
          <div class="mt-6 text-center text-sm text-gray-400">
            Don't have a key? <a href="/docs.html" class="text-indigo-500 hover:underline">Get started here</a>.
          </div>
        </div>
      </body>
      </html>
    `);
  }

  try {
    const subscription = getSubscriptionByApiKey(apiKey);

    if (!subscription) {
      return res.status(404).send(`
        <script src="https://cdn.tailwindcss.com"></script>
        <div class="bg-red-50 text-red-700 p-4 rounded-lg m-10 border border-red-200">
          <h2 class="font-bold">Error</h2>
          <p>Invalid API Key. Please <a href="/dashboard" class="underline">try again</a>.</p>
        </div>
      `);
    }

    const currentMonth = getCurrentMonth();
    const count = getUsage(apiKey, currentMonth);
    const plan = getPlanByTier(subscription.tier);
    const percentage = Math.min(100, (count / plan.limit) * 100);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Dashboard - PageSnap</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
      </head>
      <body class="bg-gray-100 font-sans">
        <!-- Nav -->
        <nav class="bg-white shadow-sm border-b">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16">
              <div class="flex items-center">
                <a href="/" class="flex items-center space-x-2">
                  <i class="fas fa-camera-retro text-indigo-600 text-2xl"></i>
                  <span class="text-xl font-bold text-gray-800">PageSnap</span>
                </a>
              </div>
              <div class="flex items-center text-sm text-gray-500">
                <i class="fas fa-user-circle mr-2"></i> ${subscription.email}
              </div>
            </div>
          </div>
        </nav>

        <main class="max-w-7xl mx-auto py-10 px-4 sm:px-6 lg:px-8">
          <div class="md:flex md:items-center md:justify-between mb-8">
            <div class="flex-1 min-w-0">
              <h2 class="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
                Customer Dashboard
              </h2>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <!-- API Key Card -->
            <div class="bg-white overflow-hidden shadow rounded-lg border">
              <div class="p-5">
                <div class="flex items-center">
                  <div class="flex-shrink-0 bg-indigo-500 rounded-md p-3">
                    <i class="fas fa-key text-white"></i>
                  </div>
                  <div class="ml-5 w-0 flex-1">
                    <dl>
                      <dt class="text-sm font-medium text-gray-500 truncate">Your API Key</dt>
                      <dd class="flex items-center mt-1">
                        <div class="text-lg font-mono font-bold text-gray-900 truncate mr-2" id="apiKeyDisplay">
                          ${apiKey}
                        </div>
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <!-- Subscription Card -->
            <div class="bg-white overflow-hidden shadow rounded-lg border">
              <div class="p-5">
                <div class="flex items-center">
                  <div class="flex-shrink-0 bg-green-500 rounded-md p-3">
                    <i class="fas fa-crown text-white"></i>
                  </div>
                  <div class="ml-5 w-0 flex-1">
                    <dl>
                      <dt class="text-sm font-medium text-gray-500 truncate">Current Tier</dt>
                      <dd>
                        <div class="text-lg font-bold text-gray-900 capitalize">${subscription.tier}</div>
                        <div class="text-xs text-green-600 font-medium">Status: ${subscription.status}</div>
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
              <div class="bg-gray-50 px-5 py-3">
                <div class="text-sm">
                  <button onclick="upgradePlan('${subscription.email}', '${subscription.tier === 'free' ? 'pro' : 'business'}')" class="font-medium text-indigo-600 hover:text-indigo-500">
                    Upgrade plan &rarr;
                  </button>
                </div>
              </div>
            </div>

            <!-- Usage Card -->
            <div class="bg-white overflow-hidden shadow rounded-lg border">
              <div class="p-5">
                <div class="flex items-center">
                  <div class="flex-shrink-0 bg-purple-500 rounded-md p-3">
                    <i class="fas fa-chart-line text-white"></i>
                  </div>
                  <div class="ml-5 w-0 flex-1">
                    <dl>
                      <dt class="text-sm font-medium text-gray-500 truncate">Usage (${currentMonth})</dt>
                      <dd>
                        <div class="text-lg font-bold text-gray-900">${count} / ${plan.limit === 999999999 ? '∞' : plan.limit}</div>
                      </dd>
                    </dl>
                  </div>
                </div>
                <div class="mt-4">
                   <div class="relative pt-1">
                    <div class="overflow-hidden h-2 mb-4 text-xs flex rounded bg-purple-100">
                      <div style="width: ${percentage}%" class="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-purple-500"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Recent Usage / Stats table could go here -->
          <div class="mt-10 bg-white shadow rounded-lg border overflow-hidden">
             <div class="px-4 py-5 sm:px-6 border-b">
                <h3 class="text-lg leading-6 font-medium text-gray-900">Plan Details</h3>
             </div>
             <div class="p-6">
                <ul class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                   <li><i class="fas fa-check text-green-500 mr-2"></i> Concurrency: ${plan.concurrency}</li>
                   <li><i class="fas fa-check text-green-500 mr-2"></i> Viewports: ${plan.viewports.join(', ')}</li>
                   <li><i class="fas fa-check text-green-500 mr-2"></i> Webhooks: ${plan.webhooks ? 'Enabled' : 'Disabled'}</li>
                   <li><i class="fas fa-check text-green-500 mr-2"></i> Email: ${subscription.email}</li>
                </ul>
             </div>
          </div>

        </main>

        <script>
          async function upgradePlan(email, tier) {
            if (!confirm('Are you sure you want to upgrade to ' + tier + '?')) return;
            
            try {
              const response = await fetch('/v1/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, tier })
              });
              
              const data = await response.json();
              if (data.paymentLink) {
                window.location.href = data.paymentLink;
              } else if (data.message) {
                alert(data.message);
                window.location.reload();
              }
            } catch (err) {
              console.error(err);
              alert('Failed to initiate upgrade');
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.status(500).send('Internal Server Error');
  }
});

export default router;
