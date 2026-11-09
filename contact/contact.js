(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const form = byId('contact-form'), confirmation = byId('confirmation');
  const notice = byId('availability'), result = byId('result');
  let config, widget, draft, busy = false;
  const selectedApp = new URLSearchParams(location.search).get('app');
  if (Array.from(byId('app').options).some((item) => item.value === selectedApp)) byId('app').value = selectedApp;
  function error(message) {
    result.textContent = message; result.hidden = false; result.focus();
  }
  function canSend() {return config?.ready === true && Boolean(config.sitekey);}
  function addReview(title, content) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = title; dd.textContent = content; byId('review').append(dt, dd);
  }
  async function challenge() {
    byId('send').disabled = true;
    const target = byId('challenge');
    confirmation.insertBefore(target, confirmation.querySelector('.actions'));
    if (!window.turnstile) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.onload = resolve; script.onerror = reject; document.head.append(script);
      });
    }
    if (widget !== undefined) window.turnstile.remove(widget);
    widget = window.turnstile.render(target, {
      sitekey: config.sitekey, action: 'contact', language: 'ja',
      callback: () => {if (!busy) byId('send').disabled = false;},
      'expired-callback': () => {byId('send').disabled = true;},
      'error-callback': () => {byId('send').disabled = true; error('送信確認を読み込めませんでした。「入力に戻る」からお試しください。');},
    });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy || !form.reportValidity()) return;
    result.hidden = true;
    const values = new FormData(form);
    draft = Object.fromEntries(['app', 'kind', 'email', 'name', 'version', 'subject', 'message', 'website'].map((key) => [key, String(values.get(key) || '').trim()]));
    draft.consent = byId('consent').checked;
    if (!draft.subject || !draft.message) return error('件名とお問い合わせ内容をご記入ください。');
    byId('review').replaceChildren();
    for (const [label, value] of [
      ['アプリ', byId('app').selectedOptions[0].textContent], ['種類', byId('kind').selectedOptions[0].textContent],
      ['お名前', draft.name || '未記入'], ['返信先', draft.email || '未記入（個別の返信はできません）'],
      ['バージョン', draft.version || '未記入'], ['件名', draft.subject], ['お問い合わせ内容', draft.message],
    ]) addReview(label, value);
    form.hidden = true; confirmation.hidden = false; confirmation.scrollIntoView({block: 'start'});
    byId('preview-notice').hidden = canSend();
    byId('send').textContent = canSend() ? 'この内容で送信する' : '送信受付は準備中です';
    if (!canSend()) {byId('send').disabled = true; return;}
    try {await challenge();} catch {error('送信確認を読み込めませんでした。「入力に戻る」からお試しください。');}
  });
  byId('edit').addEventListener('click', () => {
    if (busy) return;
    confirmation.hidden = true; form.hidden = false; result.hidden = true;
    if (widget !== undefined && window.turnstile) {window.turnstile.remove(widget); widget = undefined;}
    byId('subject').focus();
  });
  byId('send').addEventListener('click', async () => {
    if (busy || !draft || !canSend()) return;
    const token = window.turnstile?.getResponse(widget);
    if (!token) return error('送信確認が完了するまでお待ちください。');
    busy = true; byId('send').disabled = true; byId('edit').disabled = true;
    byId('send').textContent = '送信しています…'; result.hidden = true;
    try {
      const response = await fetch('/api/contact', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...draft, token}), signal: AbortSignal.timeout(40000),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || '送信できませんでした。時間をおいてお試しください。');
      confirmation.hidden = true; byId('success').hidden = false;
      form.reset(); draft = null; byId('success').focus();
    } catch (cause) {
      error(cause.name === 'TimeoutError' || cause.name === 'TypeError'
        ? '送信完了を確認できませんでした。入力内容は残しています。時間をおいてお試しください。' : cause.message);
      if (window.turnstile) window.turnstile.reset(widget);
    } finally {
      busy = false; byId('edit').disabled = false; byId('send').textContent = 'この内容で送信する';
    }
  });
  byId('fields').disabled = false;
  fetch('/api/contact', {cache: 'no-store'}).then(async (response) => {
    if (!response.ok) throw new Error('configuration');
    config = await response.json();
    if (!canSend()) {notice.textContent = '現在は入力・内容確認のみお試しいただけます。送信はまだできません。入力内容はこの画面内だけで扱われます。'; return;}
    notice.hidden = true;
  }).catch(() => {notice.textContent = '送信の準備を確認できませんでした。入力・内容確認はお試しいただけますが、送信はできません。';});
})();
