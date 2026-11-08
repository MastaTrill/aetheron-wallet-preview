// Isolated QA: synthetic EIP-1193 wallet. Never connects a real wallet or submits transactions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('./qa-tools/node_modules/puppeteer-core');

const URL = 'https://mastatrill.github.io/aetheron-wallet-preview/';
const fakeAddress = '0x1111111111111111111111111111111111111111';
const results = { url: URL, scope: 'synthetic browser interaction only; no real MetaMask authorization', cases: [] };
fs.mkdirSync('qa-evidence', {recursive: true});

async function testScenario(browser, scenario) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({width: 390, height: 844, isMobile: true, deviceScaleFactor: 1});
  await page.evaluateOnNewDocument((scenario, address) => {
    const state = { calls: [], accounts: [], chainId: '0x89', clicked: 0 };
    window.__aethQA = state;
    window.addEventListener('DOMContentLoaded', () => {
      document.getElementById('connectBtn')?.addEventListener('click', () => state.clicked++, true);
    });
    const rejected = method => {
      const error = new Error(method === 'eth_requestAccounts'
        ? 'User rejected the request' : 'QA simulated wallet blocks non-connection requests');
      error.code = 4001;
      throw error;
    };
    const handlers = new Map();
    window.ethereum = {
      isMetaMask: true,
      request: async ({method, params = []}) => {
        state.calls.push(method);
        if (method === 'eth_accounts') return state.accounts;
        if (method === 'eth_requestAccounts') {
          if (scenario === 'cancel') return rejected(method);
          state.accounts = [address];
          return state.accounts;
        }
        if (method === 'eth_chainId') return state.chainId;
        if (method === 'net_version') return state.chainId === '0x2105' ? '8453' : '137';
        if (method === 'wallet_switchEthereumChain') {
          if (params[0]?.chainId !== '0x2105') return rejected(method);
          state.chainId = '0x2105';
          (handlers.get('chainChanged') || []).forEach(cb => cb(state.chainId));
          return null;
        }
        if (method === 'eth_blockNumber') return '0x1';
        if (method === 'eth_call') return '0x' + '0'.repeat(64);
        return rejected(method);
      },
      on: (event, cb) => handlers.set(event, [...(handlers.get(event) || []), cb]),
      removeListener: (event, cb) => handlers.set(event, (handlers.get(event) || []).filter(f => f !== cb))
    };
  }, scenario, fakeAddress);

  let record = { scenario, pass: false };
  try {
    await page.goto(URL, {waitUntil: 'domcontentloaded', timeout: 45000});
    await page.waitForSelector('#hamburger', {timeout: 15000});
    const visible = await page.evaluate(() => ({
      logo: !!document.querySelector('svg.logo-rocket'),
      status: document.getElementById('aetheronLiveTradingBanner')?.textContent.includes('BASE PRESALE ENDED'),
      menuVisible: getComputedStyle(document.querySelector('#hamburger')).display !== 'none'
    }));
    assert.ok(visible.logo && visible.status && visible.menuVisible, 'QA branding, launch status and mobile menu must be present');
    await page.click('#hamburger');
    await page.waitForFunction(() => document.querySelector('#hamburger')?.getAttribute('aria-expanded') === 'true');
    const menu = await page.evaluate(() => {
      const nav = document.getElementById('navLinks');
      return {overflow: getComputedStyle(nav).overflowY, scrollHeight: nav.scrollHeight, clientHeight: nav.clientHeight};
    });
    assert.equal(menu.overflow, 'auto', 'Mobile menu must scroll independently of the locked page');
    assert.ok(menu.scrollHeight >= menu.clientHeight, 'Menu must have a valid scroll area');
    const beforeClick = await page.evaluate(() => {
      const b = document.getElementById('connectBtn');
      const r = b?.getBoundingClientRect();
      const n = document.getElementById('navLinks');
      return {url:location.href,ready:document.readyState,bound:b?.dataset.walletBound,
        rect:r ? {top:r.top,bottom:r.bottom,left:r.left,right:r.right} : null,
        navScrollTop:n?.scrollTop,navScrollHeight:n?.scrollHeight,navClientHeight:n?.clientHeight,
        atCenter:r ? document.elementFromPoint((r.left+r.right)/2,Math.max(0,Math.min(innerHeight-1,(r.top+r.bottom)/2)))?.outerHTML.slice(0,170) : null};
    });
    console.log('BEFORE_CONNECT_CLICK', scenario, JSON.stringify(beforeClick));
    await page.click('#connectBtn');
    await page.waitForFunction(() => window.__aethQA?.clicked > 0, {timeout: 5000});
    await page.waitForFunction(() => window.__aethQA?.calls.includes('eth_requestAccounts'), {timeout: 35000});
    if (scenario === 'approve') {
      await page.waitForFunction(() => window.__aethQA?.chainId === '0x2105', {timeout: 20000});
    }
    const state = await page.evaluate(() => ({
      ...window.__aethQA,
      walletText: document.getElementById('connectBtn')?.textContent.trim(),
      walletVisible: document.getElementById('walletConnected')?.classList.contains('hidden') === false
    }));
    const forbidden = state.calls.filter(method => /sign|sendTransaction|sendCalls|personal_|approve|transfer/i.test(method));
    assert.deepEqual(forbidden, [], 'Wallet QA must not sign, approve tokens, or submit a transaction');
    if (scenario === 'cancel') assert.deepEqual(state.accounts, [], 'Reject must leave account disconnected');
    else assert.deepEqual(state.accounts, [fakeAddress], 'Simulated consent shares only fake address');
    record = {scenario, pass: true, menu, requests: [...new Set(state.calls)], chainId: state.chainId,
      clicked: state.clicked, walletVisible: state.walletVisible, errors};
    await page.screenshot({path: `qa-evidence/wallet-${scenario}-mobile.png`});
  } catch (error) {
    record = {scenario, pass: false, error: String(error.message || error), errors};
    try {
      record.diagnostic = await page.evaluate(() => {
        const b=document.getElementById('connectBtn');
        const n=document.getElementById('navLinks');
        const r=b?.getBoundingClientRect();
        return {
          url:location.href,ready:document.readyState,
          clicked:window.__aethQA?.clicked || 0,calls:window.__aethQA?.calls || [],
          walletBound:b?.dataset.walletBound || null,
          buttonText:b?.textContent?.trim(),buttonRect:r?{top:r.top,bottom:r.bottom}:null,
          navActive:n?.classList.contains('active'),navScroll:n?.scrollTop,
          navHeight:n?.scrollHeight,navClient:n?.clientHeight,
          ethersLoaded:!!window.ethers,
          dynamicEthers:[...document.scripts].some(s=>s.src.includes('ethers.umd.min'))
        };
      });
    } catch {}
    try {await page.screenshot({path:`qa-evidence/wallet-${scenario}-failure.png`});} catch {}
    throw error;
  } finally {
    results.cases.push(record);
    fs.writeFileSync('qa-evidence/wallet-interaction-synthetic.json', JSON.stringify(results, null, 2));
    await page.close();
  }
}

(async () => {
  const browser = await puppeteer.launch({executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  try {
    await testScenario(browser, 'cancel');
    await testScenario(browser, 'approve');
    console.log('ISOLATED QA synthetic wallet checks PASSED');
  } finally {
    await browser.close();
    console.log(JSON.stringify(results, null, 2));
  }
})().catch(error => {console.error('ISOLATED QA synthetic wallet checks FAILED', error.stack || error);process.exitCode = 1;});
