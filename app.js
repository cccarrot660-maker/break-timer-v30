/* ENFORCE AUTH (PROFILE / session) */
(function(){
  try{
    const session = JSON.parse(localStorage.getItem('session_auth_v1') || 'null');
    if(session && session.expiresAt && Date.now() < session.expiresAt && session.profileId){
      // allowed
    } else {
      if(window.location.pathname.indexOf('login.html')===-1){ window.location.replace('login.html'); }
    }
  }catch(e){ if(window.location.pathname.indexOf('login.html')===-1) window.location.replace('login.html'); }
})();
/* END ENFORCE AUTH */

// app.js V11 PRO - improved and cleaned for hosting
(function(){
  'use strict';
  const qs = s=>document.querySelector(s);
  const STORAGE_KEY = 'bt_v11_logs', SSET_KEY='bt_v11_settings';
  // Elements
  const timeLarge = qs('#timeLarge'), timerLabel = qs('#timerLabel'), timeInfo = qs('#timeInfo');
  const startBtn = qs('#startBtn'), pauseBtn = qs('#pauseBtn'), endBtn = qs('#endBtn');
  const modeSelect = qs('#modeSelect'), limitMinutesEl = qs('#limitMinutes'), warnBeforeEl = qs('#warnBefore');
  const soundToggle = qs('#soundToggle');
  const manualToggle = qs('#manualToggle'), manualForm = qs('#manualForm');
  const manualSave = qs('#manualSave'), manualCancel = qs('#manualCancel');
  const logsBody = qs('#logsTable tbody');
  const sumTodayEl = qs('#sumToday'), sumWeekEl = qs('#sumWeek'), sumAllEl = qs('#sumAll');
  const tgResult = qs('#tgResult'), tgDebug = qs('#tgDebug');
  const dailyTargetInput = qs('#dailyTargetInput');

  let interval=null, running=false, startTime=null, pausedAt=null, elapsedPaused=0;
  let currentLogIndex=null, nearWarnSentIndex=null;
  let chart=null;

  // small sound
  const ding = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=');

  function loadSettings(){ try{return JSON.parse(localStorage.getItem(SSET_KEY)||'{}'); }catch(e){return {}; } }
  function saveSettings(s){ try{ localStorage.setItem(SSET_KEY, JSON.stringify(s||{})); }catch(e){} }
  function loadLogs(){ try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); }catch(e){return []; } }
  function saveLogs(v){ localStorage.setItem(STORAGE_KEY, JSON.stringify(v||[])); }

  function nowISO(){ return new Date().toISOString(); }
  function fmtLocal(iso){ return iso ? new Date(iso).toLocaleString('th-TH') : '-'; }
  function secs(s,e){ if(!s) return 0; const st=new Date(s), ed=e?new Date(e):new Date(); return Math.max(0, Math.floor((ed-st)/1000)); }

  // Telegram sender with optional proxy
  async function sendTelegram(token, chatId, text){
    const proxy = (qs('#proxyUrl') ? qs('#proxyUrl').value.trim() : '');
    try{
      if(proxy){
        const r = await fetch(proxy, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({token, chatId, text})});
        const txt = await r.text().catch(()=>null);
        if(!r.ok) throw new Error('proxy HTTP '+r.status+' '+(txt||''));
        return {ok:true};
      } else {
        const r = await fetch('https://api.telegram.org/bot'+token+'/sendMessage', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({chat_id:chatId, text, parse_mode:'HTML'})});
        const j = await r.json().catch(()=>null);
        if(!r.ok) return {ok:false, status:r.status, detail:j};
        if(j && j.ok) return {ok:true};
        return {ok:false, detail:j};
      }
    }catch(e){ return {ok:false, error:e.message}; }
  }

  function updateDisplay(){
    if(!running && !startTime){ timeLarge.textContent='00:00:00'; timerLabel.textContent='สถานะ: พร้อม'; timeInfo.textContent='ไม่มีการจับเวลา'; return; }
    let total = 0;
    if(startTime) total = Math.floor((Date.now() - new Date(startTime).getTime() - elapsedPaused)/1000);
    const h = String(Math.floor(total/3600)).padStart(2,'0'), m = String(Math.floor((total%3600)/60)).padStart(2,'0'), s = String(total%60).padStart(2,'0');
    timeLarge.textContent = `${h}:${m}:${s}`;
    timerLabel.textContent = `สถานะ: ${running?modeSelect.value:'หยุดชั่วคราว'}`;
    timeInfo.textContent = `เริ่ม: ${fmtLocal(startTime)} • ผ่านไป ${Math.round(total/60)} นาที`;
    // smart and near-end
    smartChecks(total);
    try{ checkNearEnd(total); }catch(e){ console.error(e); }
  }

  let warned=false, alerted=false;
  function smartChecks(totalSec){
    const limit = Number(limitMinutesEl.value||30); const warn = Number(warnBeforeEl.value||5);
    if(!warned && totalSec >= Math.max(0,(limit-warn)*60) && totalSec < limit*60){ warned=true; quickNotify('เตือนใกล้หมด',`เหลือประมาณ ${warn} นาที`); }
    if(!alerted && totalSec >= limit*60){ alerted=true; quickNotify('ครบเวลา',`ครบ ${limit} นาที`); }
  }
  function quickNotify(title, body){
    if(window.Notification && Notification.permission==='granted') new Notification(title, {body});
    else if(window.Notification && Notification.permission!=='denied') Notification.requestPermission();
    if(soundToggle && soundToggle.checked){ try{ ding.play().catch(()=>{}); }catch(e){} }
    if(tgResult) tgResult.textContent = title + ' — ' + body;
  }

  // near-end per round
  async function checkNearEnd(totalSec){
    const nearChk = qs('#sendNearNotif'); if(!nearChk || !nearChk.checked) return;
    if(currentLogIndex==null) return;
    const logs = loadLogs(); if(currentLogIndex<0 || currentLogIndex>=logs.length) return;
    if(nearWarnSentIndex===currentLogIndex) return;
    const entry = logs[currentLogIndex]; if(!entry || entry.end) return;
    const limit = Number(limitMinutesEl.value||30); const warn = Number(warnBeforeEl.value||5);
    const remain = Math.max(0, limit*60 - totalSec); const remainMin = Math.ceil(remain/60);
    if(remain>0 && remain <= warn*60){
      const token = (qs('#tgToken').value||'').trim(); const chatId = (qs('#tgChatId').value||'').trim();
      if(!token||!chatId){ tgResult.textContent='ยังไม่ได้ตั้งค่า Bot Token/Chat ID'; return; }
      const usedMin = Math.round(totalSec/60);
      const msg = `<b>เตือนใกล้ครบ</b>
ประเภท: ${entry.type}
เริ่ม: ${fmtLocal(entry.start)}
ใช้เวลา: ${usedMin} นาที
เวลาเหลือประมาณ: ${remainMin} นาที`;
      tgResult.textContent='กำลังส่งแจ้งเตือนใกล้หมด...';
      const res = await sendTelegram(token, chatId, msg);
      if(res.ok){ tgResult.textContent='ส่ง near-end สำเร็จ ✨'; tgDebug.textContent=''; nearWarnSentIndex = currentLogIndex; }
      else { tgResult.textContent='ส่ง near-end ไม่สำเร็จ'; tgDebug.textContent = JSON.stringify(res); }
    }
  }

  // start/pause/end handlers
  startBtn.addEventListener('click', async function(){
    try{
      if(running) return;
      if(!startTime){ startTime = nowISO(); elapsedPaused=0; warned=false; alerted=false; }
      else if(pausedAt){ const pd=Date.now()-new Date(pausedAt).getTime(); elapsedPaused += pd; pausedAt=null; }
      running=true; updateDisplay(); interval=setInterval(updateDisplay,1000);
      const logs = loadLogs(); logs.push({type:modeSelect.value, start:startTime, end:null, note:''}); saveLogs(logs);
      currentLogIndex = logs.length-1; nearWarnSentIndex = null; renderLogs(); updateStats();
      // send start telegram
      const sendStart = qs('#sendStartNotif') && qs('#sendStartNotif').checked;
      if(sendStart){
        const token=(qs('#tgToken').value||'').trim(), chatId=(qs('#tgChatId').value||'').trim();
        if(!token||!chatId){ tgResult.textContent='ยังไม่ได้ตั้งค่า Bot Token/Chat ID'; return; }
        const roundLimit = Number(limitMinutesEl.value||30);
        const msg = `<b>เริ่ม${modeSelect.value}</b>
ประเภท: ${modeSelect.value}
เริ่ม: ${fmtLocal(startTime)}
ใช้เวลา: 0 นาที
เวลามีเหลือ: ${roundLimit} นาที`;
        tgResult.textContent='ส่งแจ้งเตือนเริ่ม...'; const r = await sendTelegram(token, chatId, msg);
        if(r.ok){ tgResult.textContent='ส่งเริ่มสำเร็จ ✨'; tgDebug.textContent=''; } else { tgResult.textContent='ส่งเริ่มไม่สำเร็จ'; tgDebug.textContent=JSON.stringify(r); }
      }
    }catch(e){ console.error(e); tgResult.textContent='เกิดข้อผิดพลาดขณะเริ่ม'; tgDebug.textContent=e.message; }
  });

  pauseBtn.addEventListener('click', function(){ if(!startTime) return; if(running){ running=false; pausedAt=nowISO(); clearInterval(interval); updateDisplay(); } else { if(pausedAt){ const pd=Date.now()-new Date(pausedAt).getTime(); elapsedPaused+=pd; pausedAt=null; running=true; interval=setInterval(updateDisplay,1000); } } });

  endBtn.addEventListener('click', async function(){
    try{
      if(!startTime) return;
      const logs = loadLogs(); let finished=null;
      for(let i=logs.length-1;i>=0;i--){ if(!logs[i].end){ logs[i].end = nowISO(); finished = logs[i]; break; } }
      saveLogs(logs); running=false; startTime=null; pausedAt=null; elapsedPaused=0; clearInterval(interval); updateDisplay(); renderLogs(); updateStats();
      const sendEnd = qs('#sendEndNotif') && qs('#sendEndNotif').checked;
      if(sendEnd){
        const token=(qs('#tgToken').value||'').trim(), chatId=(qs('#tgChatId').value||'').trim();
        if(!token||!chatId){ tgResult.textContent='ยังไม่ได้ตั้งค่า Bot Token/Chat ID'; return; }
        if(!finished){ tgResult.textContent='ไม่พบบันทึกที่จบ'; currentLogIndex=null; return; }
        const usedSec = secs(finished.start, finished.end); const usedMin = Math.round(usedSec/60);
        const limit = Number(limitMinutesEl.value||30); const remain = Math.max(0, limit - usedMin);
        const durH = Math.floor(usedSec/3600), durM = Math.floor((usedSec%3600)/60), durS = usedSec%60;
        const dur = (durH>0?durH+' ช.ม ':'') + durM + ' นาที ' + durS + ' วินาที';
        const msg = `<b>จบ${finished.type}</b>
ประเภท: ${finished.type}
เริ่ม: ${fmtLocal(finished.start)}
จบ: ${fmtLocal(finished.end)}
ใช้เวลา: ${usedMin} นาที
เวลาเหลือจากลิมิตรอบ: ${remain} นาที
(สรุป: ${dur})`;
        tgResult.textContent='ส่งแจ้งเตือนจบ...'; const r = await sendTelegram(token, chatId, msg);
        if(r.ok){ tgResult.textContent='ส่งจบสำเร็จ ✨'; tgDebug.textContent=''; nearWarnSentIndex=null; currentLogIndex=null; } else { tgResult.textContent='ส่งจบไม่สำเร็จ'; tgDebug.textContent=JSON.stringify(r); }
      }
    }catch(e){ console.error(e); tgResult.textContent='เกิดข้อผิดพลาดขณะจบ'; tgDebug.textContent=e.message; }
  });

  // Manual form
  qs('#manualToggle').addEventListener('click', ()=>{ if(manualForm) manualForm.classList.toggle('hidden'); });
  manualSave.addEventListener('click', ()=>{
    const t = (qs('#manualType').value||'พัก'), s = qs('#manualStart').value, e = qs('#manualEnd').value;
    if(!s){ alert('กรุณาระบุเวลาเริ่ม'); return; } if(e && new Date(e) < new Date(s)){ alert('เวลาจบต้องมากกว่าเวลาเริ่ม'); return; }
    const logs = loadLogs(); logs.push({type:t, start:new Date(s).toISOString(), end:e?new Date(e).toISOString():null, note: qs('#manualNote').value||''}); saveLogs(logs); renderLogs(); updateStats();
    qs('#manualType').value=''; qs('#manualStart').value=''; qs('#manualEnd').value=''; qs('#manualNote').value=''; manualForm.classList.add('hidden');
  });
  manualCancel.addEventListener('click', ()=>{ qs('#manualType').value=''; qs('#manualStart').value=''; qs('#manualEnd').value=''; qs('#manualNote').value=''; manualForm.classList.add('hidden'); });

  // render logs
  function renderLogs(filterStart, filterEnd){
    const logs = loadLogs().slice().reverse(); logsBody.innerHTML='';
    const fs = filterStart? new Date(filterStart+'T00:00:00') : null; const fe = filterEnd? new Date(filterEnd+'T23:59:59') : null;
    logs.forEach(l=>{ const st = new Date(l.start); if(fs && st<fs) return; if(fe && st>fe) return; const tr = document.createElement('tr'); const mins = Math.round(secs(l.start,l.end)/60); tr.innerHTML = `<td>${l.type||''}</td><td>${fmtLocal(l.start)}</td><td>${l.end?fmtLocal(l.end):'-'}</td><td>${mins}</td>`; logsBody.appendChild(tr); });
  }

  // stats + chart
  function updateStats(){ const logs = loadLogs(); const today=new Date(); today.setHours(0,0,0,0); const weekStart=new Date(); weekStart.setDate(weekStart.getDate()-6); weekStart.setHours(0,0,0,0); let sumToday=0, sumWeek=0, sumAll=0; const daily={}; for(const l of logs){ const mins=Math.round(secs(l.start,l.end)/60); if(!isFinite(mins)||mins<=0) continue; const st=new Date(l.start); const k=st.toISOString().slice(0,10); daily[k]=(daily[k]||0)+mins; sumAll+=mins; if(st>=today) sumToday+=mins; if(st>=weekStart) sumWeek+=mins; } sumTodayEl.textContent = sumToday; sumWeekEl.textContent = sumWeek; sumAllEl.textContent = sumAll; const dt = Number(dailyTargetInput.value||60); if(dt>0 && sumToday>=dt){ timerLabel.textContent='สถานะ: บรรลุเป้ารายวัน 🎯'; if(window.Notification && Notification.permission!=='denied') Notification.requestPermission().then(p=>{ if(p==='granted') new Notification('เป้ารายวันสำเร็จ 🎉',{body:'ครบเป้ารายวันแล้ว'}); }); } const labels=[]; const data=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=d.toISOString().slice(0,10); labels.push(k); data.push(daily[k]||0); } if(chart){ chart.data.labels=labels; chart.data.datasets[0].data=data; chart.update(); } else { chart = new Chart(qs('#chartDaily').getContext('2d'), {type:'bar', data:{labels, datasets:[{label:'นาที/วัน', data, backgroundColor:'#7c3aed'}]}, options:{responsive:true, plugins:{legend:{display:false}}}}); } 
    // update progress bar & big today label
    try{
      const sumTodayBigEl = qs('#sumTodayLarge');
      const bar = qs('#sumTodayBar');
      const dtLabel = qs('#dailyTargetLabel');
      const dtVal = Number(dailyTargetInput.value||60);
      if(sumTodayBigEl) sumTodayBigEl.textContent = sumToday;
      if(dtLabel) dtLabel.textContent = dtVal;
      if(bar){
        const pct = dtVal>0 ? Math.min(100, Math.round((sumToday/dtVal)*100)) : 0;
        bar.style.width = pct + '%';
        bar.setAttribute('aria-valuenow', pct);
      }
    }catch(e){ console.error('progress update err', e); }
  }

  qs('#applyFilter').addEventListener('click', ()=>{ renderLogs(qs('#filterStart').value, qs('#filterEnd').value); });
  qs('#clearAll').addEventListener('click', ()=>{ if(confirm('ลบบันทึกทั้งหมด?')){ localStorage.removeItem(STORAGE_KEY); renderLogs(); updateStats(); } });
  qs('#exportCsv').addEventListener('click', ()=>{ const logs=loadLogs(); if(!logs.length){ alert('ไม่มีข้อมูล'); return; } const header=['ประเภท','เริ่ม','จบ','นาที']; const rows=logs.map(l=>[l.type,l.start,l.end||'',Math.round(secs(l.start,l.end)/60)]); const csv=[header,...rows].map(r=>r.map(c=>`"${(''+(c||'')).replace(/"/g,'""')}"`).join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='break_logs_v11.csv'; a.click(); URL.revokeObjectURL(url); });

  // test tg
  qs('#testTg').addEventListener('click', async ()=>{ const token=(qs('#tgToken').value||'').trim(), chatId=(qs('#tgChatId').value||'').trim(), proxy=(qs('#proxyUrl').value||'').trim(); if(!token||!chatId){ alert('กรุณาใส่ Bot Token และ Chat ID'); return; } const txt = '<b>ทดสอบจาก Break Timer V11 PRO</b>'; try{ let res; if(proxy){ res = await fetch(proxy,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,chatId,text:txt})}); } else { res = await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:txt,parse_mode:'HTML'})}); } if(res && res.ok){ tgResult.textContent='ส่งสำเร็จ ✨'; tgDebug.textContent=''; } else { tgResult.textContent='ส่งไม่สำเร็จ — ตรวจสอบค่าและ CORS'; tgDebug.textContent = res?('HTTP '+res.status):'no response'; } }catch(e){ tgResult.textContent = 'เกิดข้อผิดพลาด: '+e.message; tgDebug.textContent = e.stack||e.message; } });

  // dark toggle and init
  qs('#darkToggle').addEventListener('click', ()=>{ document.body.classList.toggle('dark'); try{ localStorage.setItem('bt_v11_dark', document.body.classList.contains('dark')?'1':'0'); }catch(e){} });
  if(localStorage.getItem('bt_v11_dark')==='1') document.body.classList.add('dark');
  dailyTargetInput.addEventListener('change', ()=>{ try{ const s={}; s.dailyTarget = Number(dailyTargetInput.value||60); saveSettings(s); updateStats(); }catch(e){} });

  // restore running session
  function init(){ renderLogs(); updateStats(); const logs = loadLogs(); for(let i=logs.length-1;i>=0;i--){ if(!logs[i].end){ startTime = logs[i].start; running=true; currentLogIndex=i; interval=setInterval(updateDisplay,1000); break; } } updateDisplay(); }
  init();

  function nowISO(){ return new Date().toISOString(); }

})();

// ---- Added Daily Remaining + Telegram Notify ----

// notify when daily remaining <= 110
async function notifyDailyRemaining(remain, target){
  const token = (qs('#tgToken').value||'').trim();
  const chatId = (qs('#tgChatId').value||'').trim();
  if(!token||!chatId) return;
  const msg = `<b>แจ้งเตือนเวลาคงเหลือรายวัน</b>
เวลาคงเหลือ: ${remain} นาที
เป้าวันนี้: ${target} นาที`;
  try{
    await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text:msg,parse_mode:'HTML'})
    });
  }catch(e){console.error(e);}
}

// send summary on end button
async function sendDailySummary(){
  const token=(qs('#tgToken').value||'').trim();
  const chatId=(qs('#tgChatId').value||'').trim();
  if(!token||!chatId) return;
  const dailyTarget=Number(dailyTargetInput.value||120);
  const logs=loadLogs();
  let sumToday=0;
  const today=new Date(); today.setHours(0,0,0,0);
  logs.forEach(l=>{
    const st=new Date(l.start);
    if(st>=today){
      const mins=Math.round(secs(l.start,l.end)/60);
      if(mins>0) sumToday+=mins;
    }
  });
  const remain=Math.max(0,dailyTarget-sumToday);
  const msg = `<b>สรุปเวลาทั้งหมดวันนี้</b>
ใช้ไปแล้ว: ${sumToday} นาที
เวลาคงเหลือ: ${remain} นาที
เป้าวันนี้: ${dailyTarget} นาที`;
  try{
    await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text:msg,parse_mode:'HTML'})
    });
  }catch(e){console.error(e);}
}
// --- Universal UI persistence: save/restore inputs by id ---
// Stores UI element states (value / checked) in localStorage under key 'breaker_ui_state_v1'
(function(){
  const STORAGE_KEY = 'breaker_ui_state_v1';

  function loadUIState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY) || '{}';
      return JSON.parse(raw);
    }catch(e){ console.error('loadUIState parse', e); return {}; }
  }
  function saveUIState(obj){
    try{
      const cur = loadUIState();
      Object.assign(cur, obj);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
    }catch(e){ console.error('saveUIState', e); }
  }

  function readElementState(el){
    if(!el) return null;
    const tag = el.tagName.toLowerCase();
    const type = el.type || '';
    if(tag === 'input' && (type === 'checkbox' || type === 'radio')){
      return {checked: el.checked};
    } else if(tag === 'select'){
      return {value: el.value};
    } else {
      return {value: el.value};
    }
  }

  function writeElementState(el, state){
    if(!el || !state) return;
    const tag = el.tagName.toLowerCase();
    const type = el.type || '';
    if('checked' in state && (tag === 'input' && (type === 'checkbox' || type === 'radio'))){
      el.checked = !!state.checked;
    }
    if('value' in state){
      // preserve cursor? simply set value
      el.value = state.value;
      // trigger input event if some code listens to changes
      try{
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
      }catch(e){}
    }
  }

  // Save all elements with id (inputs, selects, textareas) automatically on change/blur
  function wireAutoPersist(){
    try{
      const selector = 'input[id], select[id], textarea[id]';
      const elems = Array.from(document.querySelectorAll(selector));
      elems.forEach(el => {
        // ignore file inputs or password if you want? we still store but you can tweak
        const id = el.id;
        if(!id) return;
        // initial restore from saved UI state
        const state = loadUIState();
        if(state && state[id]) writeElementState(el, state[id]);

        // only attach handlers once
        if(el.__ui_persisted) return;
        el.__ui_persisted = true;

        const saveFn = () => {
          const st = readElementState(el);
          if(st) {
            const obj = {}; obj[id] = st;
            saveUIState(obj);
          }
        };

        // for checkboxes/radios listen to change; for text inputs listen to blur+input (debounced)
        if(el.tagName.toLowerCase() === 'input' && (el.type === 'checkbox' || el.type === 'radio')){
          el.addEventListener('change', saveFn);
        } else {
          // input debounce
          let t=null;
          el.addEventListener('input', ()=>{
            if(t) clearTimeout(t);
            t = setTimeout(()=>{ saveFn(); t=null; }, 600);
          });
          el.addEventListener('blur', saveFn);
          el.addEventListener('change', saveFn);
        }
      });
    }catch(e){ console.error('wireAutoPersist error', e); }
  }

  // Utility: clear saved UI (for debugging)
  function clearSavedUI(){
    localStorage.removeItem(STORAGE_KEY);
  }

  // Restore some elements that are created later by UI code: try again after short delays
  function tryWireWithRetries(retries=6, delay=400){
    let attempts = 0;
    function _attempt(){
      attempts++;
      try{
        wireAutoPersist();
      }catch(e){ console.error(e); }
      if(attempts < retries){
        setTimeout(_attempt, delay);
      }
    }
    _attempt();
  }

  // Auto-run on DOM ready
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ tryWireWithRetries(); });
  } else {
    tryWireWithRetries();
  }

  // expose for debugging
  window.__breaker_ui_persist = {
    clear: clearSavedUI,
    key: STORAGE_KEY
  };
})();




/* ===== ENHANCE HISTORY ROWS: nicer action buttons & binding ===== */
(function(){
  const STORAGE='bt_v11_logs';
  const qs = s => document.querySelector(s);
  function loadLogs(){ try{ return JSON.parse(localStorage.getItem(STORAGE)||'[]'); }catch(e){return[];} }
  function saveLogs(v){ localStorage.setItem(STORAGE, JSON.stringify(v||[])); }

  function toLocalFmt(iso){ return iso ? new Date(iso).toLocaleString('th-TH') : '-'; }
  function minsBetween(s,e){ if(!s) return 0; try{ const st=new Date(s); const ed=e?new Date(e):new Date(); return Math.round((ed-st)/60000); }catch(e){return 0;} }

  function renderEnhancedLogs(filterStart, filterEnd){
    const tbody = qs('#logsTable tbody');
    if(!tbody) return;
    const raw = loadLogs();
    // apply filters (same logic as original renderLogs if present)
    const fs = filterStart ? new Date(filterStart+'T00:00:00') : null;
    const fe = filterEnd ? new Date(filterEnd+'T23:59:59') : null;
    tbody.innerHTML = '';
    raw.slice().reverse().forEach((l, revIdx)=>{
      const idx = raw.length - 1 - revIdx;
      const mins = minsBetween(l.start, l.end);
      if(fs && new Date(l.start) < fs) return;
      if(fe && new Date(l.start) > fe) return;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${l.type || ''}</td>
        <td>${toLocalFmt(l.start)}</td>
        <td>${l.end ? toLocalFmt(l.end) : '-'}</td>
        <td>${mins}</td>
        <td class="actionCell">
          <button class="actionBtn edit" data-i="${idx}" title="แก้ไข">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 21v-3l11-11 3 3L6 21H3z" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="text">แก้ไข</span>
          </button>
          <button class="actionBtn del" data-i="${idx}" title="ลบ">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18M8 6v12m8-12v12M10 6V4h4v2" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="text">ลบ</span>
          </button>
        </td>`;
      tbody.appendChild(tr);
    });
    bindEnhanced();
  }

  function bindEnhanced(){
    document.querySelectorAll('.actionBtn.edit').forEach(b=>{
      b.onclick = function(){
        const i = Number(this.dataset.i);
        openEditModal(i);
      };
    });
    document.querySelectorAll('.actionBtn.del').forEach(b=>{
      b.onclick = function(){
        const i = Number(this.dataset.i);
        if(!confirm('ต้องการลบรายการนี้หรือไม่?')) return;
        const arr = loadLogs();
        if(i<0 || i>=arr.length) return alert('Index ไม่ถูกต้อง');
        arr.splice(i,1);
        saveLogs(arr);
        // call original render if exists
        if(typeof window.renderLogs === 'function'){ try{ window.renderLogs(); }catch(e){ renderEnhancedLogs(); } } else renderEnhancedLogs();
        if(typeof window.updateStats === 'function'){ try{ window.updateStats(); }catch(e){} }
      };
    });
  }

  function openEditModal(i){
    const arr = loadLogs();
    const d = arr[i];
    if(!d) return alert('ไม่พบบันทึก');
    qs('#editIndex').value = i;
    qs('#editType').value = d.type || '';
    qs('#editStart').value = d.start ? toInputDT(d.start) : '';
    qs('#editEnd').value = d.end ? toInputDT(d.end) : '';
    qs('#editNote').value = d.note || '';
    qs('#editModal').style.display = 'flex';
  }

  function toInputDT(iso){
    const d = new Date(iso);
    const p = n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // wire save for modal form
  document.addEventListener('DOMContentLoaded', ()=>{
    // try to enhance after initial render
    setTimeout(()=>{ renderEnhancedLogs(); }, 350);

    const form = qs('#editForm');
    if(form){
      form.addEventListener('submit', function(e){
        e.preventDefault();
        const i = Number(qs('#editIndex').value);
        const arr = loadLogs();
        if(i<0 || i>=arr.length) return alert('Index ผิดพลาด');
        arr[i].type = qs('#editType').value;
        arr[i].start = qs('#editStart').value ? new Date(qs('#editStart').value).toISOString() : arr[i].start;
        arr[i].end = qs('#editEnd').value ? new Date(qs('#editEnd').value).toISOString() : arr[i].end;
        arr[i].note = qs('#editNote').value;
        saveLogs(arr);
        qs('#editModal').style.display = 'none';
        if(typeof window.renderLogs === 'function'){ try{ window.renderLogs(); }catch(e){ renderEnhancedLogs(); } } else renderEnhancedLogs();
        if(typeof window.updateStats === 'function'){ try{ window.updateStats(); }catch(e){} }
      });
    }

    const cancel = qs('#editCancel');
    if(cancel) cancel.addEventListener('click', ()=>{ qs('#editModal').style.display='none'; });

    // re-run enhance when filters applied
    const applyBtn = qs('#applyFilter');
    if(applyBtn) applyBtn.addEventListener('click', ()=>{ renderEnhancedLogs(qs('#filterStart').value, qs('#filterEnd').value); });
  });

})();
