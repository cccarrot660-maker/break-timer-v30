
// fixes.js - runtime patches for UI, Telegram resilience, and history restore
(function(){
  'use strict';
  const LOG_KEY = 'bt_v11_logs';
  const UI_STATE_KEY = 'breaker_ui_state_v1';

  function loadLogs(){ try{ return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); }catch(e){ return []; } }
  function saveLogs(v){ try{ localStorage.setItem(LOG_KEY, JSON.stringify(v||[])); }catch(e){} }

  function secs(s,e){ if(!s) return 0; try{ const st=new Date(s); const ed=e?new Date(e):new Date(); return Math.max(0, Math.floor((ed-st)/1000)); }catch(e){ return 0; } }

  // If history appears empty after refresh, try simple recovery from other keys
  function tryRecoverLogs(){
    const candidateKeys = Object.keys(localStorage).filter(k=>/log|history|breaker/i.test(k));
    if(candidateKeys.indexOf(LOG_KEY)!==-1) return; // already present
    for(const k of candidateKeys){
      try{
        const v = JSON.parse(localStorage.getItem(k));
        if(Array.isArray(v) && v.length>0 && v[0] && v[0].start){
          // migrate to expected key
          localStorage.setItem(LOG_KEY, JSON.stringify(v));
          console.info('Recovered logs from', k);
          return;
        }
      }catch(e){}
    }
  }

  // Re-render the history table if app's renderLogs exists; otherwise build a minimal renderer
  function renderHistoryIfMissing(){
    tryRecoverLogs();
    const logs = loadLogs();
    const tbody = document.querySelector('#logsTable tbody');
    if(!tbody) return;
    // If table already populated, do nothing
    if(tbody.children.length>0) return;
    tbody.innerHTML = '';
    logs.slice().reverse().forEach(l=>{
      const tr = document.createElement('tr');
      const mins = Math.round(secs(l.start,l.end)/60);
      tr.innerHTML = `<td>${l.type||''}</td><td>${l.start?new Date(l.start).toLocaleString('th-TH'):'-'}</td><td>${l.end?new Date(l.end).toLocaleString('th-TH'):'-'}</td><td>${mins}</td><td class="actionCell"></td>`;
      tbody.appendChild(tr);
    });
  }

  // Telegram resilient sender (can use proxy or direct). Returns a promise resolving {ok, detail}
  async function sendTelegramResilient(token, chatId, text, proxyUrl){
    if(!token||!chatId) return {ok:false, error:'missing token/chatId'};
    try{
      if(proxyUrl){
        const r = await fetch(proxyUrl, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({token, chatId, text})});
        const j = await r.json().catch(()=>null);
        return r.ok ? {ok:true, detail:j} : {ok:false, status:r.status, detail:j};
      } else {
        const r = await fetch('https://api.telegram.org/bot'+token+'/sendMessage', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({chat_id:chatId, text, parse_mode:'HTML'})});
        const j = await r.json().catch(()=>null);
        return (r.ok && j && j.ok) ? {ok:true, detail:j} : {ok:false, status:r.status, detail:j};
      }
    }catch(e){ return {ok:false, error: e.message}; }
  }

  // Periodic check: send daily-remaining when <= threshold once per day
  const DAILY_FLAG_KEY = 'bt_v11_daily_rem_sent_on';
  function shouldSendDailyFlagToday(){ const v = localStorage.getItem(DAILY_FLAG_KEY); if(!v) return true; const d = new Date(v); const now = new Date(); return d.toDateString() !== now.toDateString(); }
  function markDailyFlagToday(){ localStorage.setItem(DAILY_FLAG_KEY, new Date().toISOString()); }

  async function checkDailyRemainingAndNotify(){
    try{
      const dailyTargetEl = document.querySelector('#dailyTargetInput');
      if(!dailyTargetEl) return;
      const target = Number(dailyTargetEl.value||0);
      if(target<=0) return;
      const logs = loadLogs();
      let sumToday = 0;
      const today = new Date(); today.setHours(0,0,0,0);
      logs.forEach(l=>{ const st=new Date(l.start); if(st>=today){ const mins = Math.round(secs(l.start,l.end)/60); if(mins>0) sumToday+=mins; } });
      const remain = Math.max(0, target - sumToday);
      // update UI small text if present
      const remainEl = document.querySelector('#sumRemainBarText');
      if(remainEl) remainEl.textContent = remain;
      // if remain <=110 and not sent today, send telegram notification
      if(remain <= 110 && remain > 0 && shouldSendDailyFlagToday()){
        const token = (document.querySelector('#tgToken')||{value:''}).value.trim();
        const chatId = (document.querySelector('#tgChatId')||{value:''}).value.trim();
        const proxy = (document.querySelector('#proxyUrl')||{value:''}).value.trim();
        if(token && chatId){
          const txt = `<b>แจ้งเตือนเวลาคงเหลือรายวัน</b>\nเวลาคงเหลือ: ${remain} นาที\nเป้าวันนี้: ${target} นาที`;
          const res = await sendTelegramResilient(token, chatId, txt, proxy);
          if(res.ok) markDailyFlagToday();
          // update debug
          const tgResult = document.querySelector('#tgResult'); if(tgResult) tgResult.textContent = res.ok ? 'แจ้งเวลาคงเหลือส่งสำเร็จ' : ('แจ้งเวลาคงเหลือไม่สำเร็จ: '+(res.error||res.status));
        }
      }
    }catch(e){ console.error('checkDailyRemainingAndNotify', e); }
  }

  // Periodic near-end check to ensure app's near-end sends if not already triggered
  async function periodicNearEndFallback(){
    try{
      const sendNear = document.querySelector('#sendNearNotif');
      if(!sendNear || !sendNear.checked) return;
      // find active log (no end)
      const logs = loadLogs();
      const active = logs.slice().reverse().find(l=>!l.end);
      if(!active) return;
      const limit = Number((document.querySelector('#limitMinutes')||{value:30}).value||30);
      const warn = Number((document.querySelector('#warnBefore')||{value:5}).value||5);
      const elapsed = Math.round(secs(active.start)/60);
      const remain = Math.max(0, limit - elapsed);
      if(remain <= warn && remain>0){
        // send near-end if not sent for this active start
        const flagKey = 'bt_v11_near_sent_' + active.start;
        if(localStorage.getItem(flagKey)) return;
        const token = (document.querySelector('#tgToken')||{value:''}).value.trim();
        const chatId = (document.querySelector('#tgChatId')||{value:''}).value.trim();
        const proxy = (document.querySelector('#proxyUrl')||{value:''}).value.trim();
        if(token && chatId){
          const msg = `<b>เตือนใกล้ครบ</b>\nประเภท: ${active.type}\nเริ่ม: ${new Date(active.start).toLocaleString('th-TH')}\nใช้เวลา: ${elapsed} นาที\nเวลาเหลือประมาณ: ${remain} นาที`;
          const res = await sendTelegramResilient(token, chatId, msg, proxy);
          if(res.ok) localStorage.setItem(flagKey, '1');
          const tgResult = document.querySelector('#tgResult'); if(tgResult) tgResult.textContent = res.ok ? 'near-end สำเร็จ' : ('near-end ผิดพลาด: '+(res.error||res.status));
        }
      }
    }catch(e){ console.error('periodicNearEndFallback', e); }
  }

  // Attach handlers for testTg button if present to use resilient sender
  function wireTestButton(){
    const btn = document.querySelector('#testTg');
    if(!btn) return;
    btn.removeEventListener('click', btn._fix_handler);
    btn._fix_handler = async function(){
      const token = (document.querySelector('#tgToken')||{value:''}).value.trim();
      const chatId = (document.querySelector('#tgChatId')||{value:''}).value.trim();
      const proxy = (document.querySelector('#proxyUrl')||{value:''}).value.trim();
      if(!token || !chatId) return alert('กรุณาใส่ Bot Token และ Chat ID');
      const txt = '<b>ทดสอบจาก Break Timer (fixes)</b>';
      const res = await sendTelegramResilient(token, chatId, txt, proxy);
      const tgResult = document.querySelector('#tgResult'); if(tgResult) tgResult.textContent = res.ok ? 'ส่งสำเร็จ (fixes)' : ('ส่งไม่สำเร็จ (fixes): '+(res.error||res.status));
    };
    btn.addEventListener('click', btn._fix_handler);
  }

  // Run on DOM ready
  function init(){
    tryRecoverLogs();
    renderHistoryIfMissing();
    wireTestButton();
    // run periodic checks
    setInterval(checkDailyRemainingAndNotify, 30*1000); // every 30s
    setInterval(periodicNearEndFallback, 15*1000); // every 15s
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // expose for debugging
  window.__bt_fixes = { loadLogs, saveLogs, tryRecoverLogs };
})();
