// login.js - profile-based login manager
// Profiles stored in localStorage key: 'breaker_profiles_v1' as array of {id,name,note,pinHash,createdAt}
// Session stored as session_auth_v1 = {profileId, createdAt, expiresAt}
(function(){
  const PROFILES_KEY = 'breaker_profiles_v1';
  const SESSION_KEY = 'session_auth_v1';

  // helpers (use app.js versions if available)
  async function hashPin(pin){
    if(typeof hashPinLocal === 'function') return hashPinLocal(pin);
    // fallback simple SHA-256
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(pin)));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  function loadProfiles(){
    try{ return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); }
    catch(e){ console.error('loadProfiles',e); return []; }
  }
  function saveProfiles(arr){
    try{ localStorage.setItem(PROFILES_KEY, JSON.stringify(arr||[])); }
    catch(e){ console.error('saveProfiles',e); }
  }

  function createId(){
    return 'p_' + Math.random().toString(36).slice(2,10);
  }

  // render profiles list
  function renderProfiles(){
    const list = document.getElementById('profilesList');
    if(!list) return;
    list.innerHTML = '';
    const profiles = loadProfiles();
    if(!profiles || profiles.length===0){
      list.innerHTML = '<div class="muted">ยังไม่มีโปรไฟล์ สร้างโปรไฟล์ใหม่ด้านล่าง</div>';
      return;
    }
    profiles.forEach(p => {
      const wrap = document.createElement('div');
      wrap.style.display='flex'; wrap.style.gap='8px'; wrap.style.alignItems='center';
      wrap.style.justifyContent='space-between'; wrap.style.padding='8px'; wrap.style.border='1px solid rgba(0,0,0,0.04)'; wrap.style.borderRadius='8px';
      const left = document.createElement('div');
      left.innerHTML = `<strong>${escapeHtml(p.name)}</strong> <div class="muted" style="font-size:13px">${escapeHtml(p.note||'')}</div>`;
      const right = document.createElement('div');
      right.style.display='flex'; right.style.gap='8px';
      // PIN input and buttons
      const pinInput = document.createElement('input'); pinInput.type='password'; pinInput.placeholder='PIN'; pinInput.style.width='120px'; pinInput.id = 'pin_for_'+p.id;
      const loginBtn = document.createElement('button'); loginBtn.className='btn'; loginBtn.textContent='ล็อกอิน';
      const resetPinBtn = document.createElement('button'); resetPinBtn.className='btn ghost'; resetPinBtn.textContent='ตั้ง PIN ใหม่';
      const delBtn = document.createElement('button'); delBtn.className='btn ghost'; delBtn.textContent='ลบ';
      right.appendChild(pinInput); right.appendChild(loginBtn); right.appendChild(resetPinBtn); right.appendChild(delBtn);
      wrap.appendChild(left); wrap.appendChild(right);
      list.appendChild(wrap);

      loginBtn.addEventListener('click', async ()=>{
        const v = (pinInput.value||'').trim();
        if(!v) return alert('กรุณากรอก PIN');
        const h = await hashPin(v);
        if(h === p.pinHash){
          // create session for 8 hours
          const session = { profileId: p.id, createdAt: Date.now(), expiresAt: Date.now() + (8*60*60*1000) };
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
          alert('ล็อกอินสำเร็จ ('+p.name+')');
          window.location.href = 'index.html';
        } else {
          alert('PIN ไม่ถูกต้อง');
        }
      });

      resetPinBtn.addEventListener('click', async ()=>{
        const nv = prompt('ใส่ PIN ใหม่สำหรับโปรไฟล์ '+p.name+' (อย่างน้อย 4 หลัก)');
        if(!nv || nv.length<4) return alert('PIN ต้องมีความยาวอย่างน้อย 4 หลัก');
        const hh = await hashPin(nv);
        const profilesArr = loadProfiles();
        const idx = profilesArr.findIndex(x=>x.id===p.id);
        if(idx!==-1){ profilesArr[idx].pinHash = hh; profilesArr[idx].updatedAt = Date.now(); saveProfiles(profilesArr); alert('ตั้ง PIN ใหม่เรียบร้อย'); renderProfiles(); }
      });

      delBtn.addEventListener('click', ()=>{
        if(!confirm('ลบโปรไฟล์ '+p.name+' และข้อมูลที่เกี่ยวข้อง?')) return;
        const profilesArr = loadProfiles().filter(x=>x.id!==p.id);
        saveProfiles(profilesArr);
        renderProfiles();
      });
    });
  }

  // create profile handler
  async function handleCreateProfile(){
    const name = (document.getElementById('profileName')||{value:''}).value.trim();
    const note = (document.getElementById('profileNote')||{value:''}).value.trim();
    const pin = (document.getElementById('profilePin')||{value:''}).value.trim();
    if(!name) return alert('กรุณาใส่ชื่อโปรไฟล์');
    if(!pin || pin.length<4) return alert('กรุณาตั้ง PIN อย่างน้อย 4 หลัก');
    const h = await hashPin(pin);
    const id = createId();
    const obj = { id:id, name:name, note:note, pinHash:h, createdAt: Date.now() };
    const profilesArr = loadProfiles(); profilesArr.unshift(obj); saveProfiles(profilesArr);
    // optionally generate recovery code for profile (exportable)
    try{ const code = await generateProfileRecoveryCode(obj); console.log('Recovery code for profile (save it):', code); }catch(e){}
    alert('สร้างโปรไฟล์เรียบร้อย ' + name);
    // clear inputs
    document.getElementById('profileName').value=''; document.getElementById('profileNote').value=''; document.getElementById('profilePin').value='';
    renderProfiles();
  }

  // recovery code: encrypt profile object and produce base64 (valid 24h)
  async function generateProfileRecoveryCode(profile, ttlMinutes=1440){
    // simple envelope: payload {profile, createdAt, expiresAt} encrypted with ephemeral key
    const payload = { profile: profile, createdAt: Date.now(), expiresAt: Date.now() + ttlMinutes*60*1000 };
    const json = JSON.stringify(payload);
    const keyRaw = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey('raw', keyRaw, {name:'AES-GCM'}, false, ['encrypt']);
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, cryptoKey, enc.encode(json));
    const combined = new Uint8Array(keyRaw.byteLength + iv.byteLength + cipher.byteLength);
    combined.set(keyRaw,0); combined.set(iv, keyRaw.byteLength); combined.set(new Uint8Array(cipher), keyRaw.byteLength+iv.byteLength);
    return btoa(String.fromCharCode.apply(null, combined));
  }

  async function useProfileRecovery(code){
    try{
      const bin = atob(code);
      const arr = new Uint8Array([...bin].map(c=>c.charCodeAt(0)));
      const keyRaw = arr.slice(0,32);
      const iv = arr.slice(32,44);
      const cipher = arr.slice(44);
      const cryptoKey = await crypto.subtle.importKey('raw', keyRaw, {name:'AES-GCM'}, false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, cryptoKey, cipher);
      const payload = JSON.parse(new TextDecoder().decode(plain));
      if(Date.now() > payload.expiresAt) throw new Error('Recovery code หมดอายุแล้ว');
      // add profile back
      const p = payload.profile; p.createdAt = Date.now();
      const profilesArr = loadProfiles(); profilesArr.unshift(p); saveProfiles(profilesArr); renderProfiles();
      return true;
    }catch(e){ console.error('useProfileRecovery', e); throw e; }
  }

  // escape helper
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];}); }

  // wire DOM
  function init(){
    const createBtn = document.getElementById('createProfileBtn');
    const useRecoveryBtn = document.getElementById('useProfileRecoveryBtn');
    if(createBtn) createBtn.addEventListener('click', handleCreateProfile);
    if(useRecoveryBtn) useRecoveryBtn.addEventListener('click', async ()=>{
      const code = (document.getElementById('profileRecoveryInput')||{value:''}).value.trim();
      if(!code) return alert('กรุณาวาง Recovery Code');
      try{ await useProfileRecovery(code); alert('กู้โปรไฟล์เรียบร้อย'); }catch(e){ alert('กู้ไม่สำเร็จ: '+e.message); }
    });
    renderProfiles();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();

  // expose functions for other modules
  window.breakerProfiles = {
    loadProfiles, saveProfiles, generateProfileRecoveryCode, useProfileRecovery
  };
})();
