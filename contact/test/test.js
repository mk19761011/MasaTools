(() => {
  const button = document.getElementById('test-send'), result = document.getElementById('test-result');
  let config, widget, preparing = false, sending = false;
  button.addEventListener('click', async () => {
    if (sending) return;
    if (!preparing) {
      preparing = true; button.disabled = true;
      result.textContent = '送信確認を読み込んでいます…';
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.onload = resolve; script.onerror = reject; document.head.append(script);
        });
        widget = window.turnstile.render('#test-challenge', {
          sitekey: config.sitekey, action: 'contact', language: 'ja',
          callback: () => {button.disabled = false; button.textContent = '定型のテストメールを送る'; result.textContent = '準備できました。ボタンを押すとテストメールを送信します。';},
          'expired-callback': () => {button.disabled = true; result.textContent = '送信確認の期限が切れました。ページを開き直してください。';},
          'error-callback': () => {button.disabled = true; result.textContent = '送信確認を読み込めませんでした。ページを開き直してください。';},
        });
      } catch {result.textContent = '送信確認を読み込めませんでした。ページを開き直してください。';}
      return;
    }
    const token = window.turnstile?.getResponse(widget);
    if (!token) return;
    sending = true; button.disabled = true; result.textContent = '定型のテストメールを送信しています…';
    try {
      const response = await fetch('/api/contact', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({mode: 'delivery-test', token}), signal: AbortSignal.timeout(40000)});
      const body = await response.json();
      if (!response.ok || !body.ok || !body.test) throw new Error(body.error || 'テストメールの送信を確認できませんでした。');
      button.textContent = '送信手続きが完了しました';
      result.textContent = 'メール配信サービスがテストメールを受け付けました。運営者の受信箱で「[MasaTools] お問い合わせフォームの受信テスト」という件名のメールを確認してください。迷惑メールフォルダーもご確認ください。';
    } catch (cause) {
      button.textContent = '送信を確認できませんでした';
      result.textContent = (cause.name === 'TimeoutError' || cause.name === 'TypeError' ? 'テストメールの送信を確認できませんでした。' : cause.message) + ' この画面の結果をCodexにお知らせください。一般のお問い合わせの受付は停止したままです。';
    }
  });
  fetch('/api/contact', {cache:'no-store'}).then(async response => {
    if (!response.ok) throw new Error('configuration');
    config = await response.json();
    if (!config.testReady || !config.sitekey) throw new Error('configuration');
    button.disabled = false; button.textContent = '受信テストを準備する'; result.textContent = 'ボタンを押して、送信確認へ進んでください。';
  }).catch(() => {button.textContent = '受信テストは準備中です'; result.textContent = '受信テストの準備が整っていません。時間をおいてページを開き直してください。';});
})();
